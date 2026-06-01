#!/usr/bin/env python3
"""Cache a shiyu.darte.gg draft ruleset (costs + restart rule) for browser import.

draft_systems REST is CORS-locked to the shiyu origin, so the browser can't read
it directly. This script (server-side, no CORS) fetches the ruleset for a draft
link or system id and writes/updates web/data/shiyu_systems.json, with all Mongo
ObjectIds resolved to enkaId so the admin page can match by enka_id.

Usage:
  python tools/fetch_system.py "<draft link or draft_id>"   # resolves system via socket init
  python tools/fetch_system.py --system <system_id>          # direct system id
"""
import sys, json, time, os, re, urllib.request, urllib.parse

API="https://shiyu.darte.gg/api/shiyu"
OUT=os.path.join(os.path.dirname(__file__),"..","web","data","shiyu_systems.json")

def get(path):
    req=urllib.request.Request(f"{API}/{path}",headers={"User-Agent":"Mozilla/5.0"})
    with urllib.request.urlopen(req,timeout=30) as r: return json.load(r)

def system_from_draft(arg):
    import socketio
    # accept full link or bare draft_id
    draft_id,key=arg,None
    if "://" in arg or "draft_id" in arg or "session" in arg:
        q=urllib.parse.parse_qs(urllib.parse.urlparse(arg).query)
        draft_id=(q.get("draft_id") or q.get("session_id") or [arg])[0]
        key=(q.get("session_key") or [None])[0]
    box={}; sio=socketio.Client(reconnection=False)
    sio.on("init",lambda d:box.__setitem__("i",d),namespace="/draft")
    url=f"https://shiyu.darte.gg?session_id={draft_id}"+(f"&session_key={key}" if key else "")
    sio.connect(url,socketio_path="/socket.io/draft",transports=["websocket"],namespaces=["/draft"])
    t=time.time()
    while "i" not in box and time.time()-t<10: time.sleep(0.2)
    sio.disconnect()
    if "i" not in box: sys.exit("no init (bad/expired link)")
    return box["i"]["system"]

def main():
    if len(sys.argv)<2: sys.exit(__doc__)
    if sys.argv[1]=="--system": system_id=sys.argv[2]
    else: system_id=system_from_draft(sys.argv[1])

    agents={a["_id"]:a["enkaId"] for a in get("agents")}
    engines={e["_id"]:e["enkaId"] for e in get("engines")}
    s=get(f"draft_systems/{system_id}")
    pm=s.get("phaseMatch",{}); c=s.get("costs",{})

    ag={}
    for a in c.get("agents",[]):
        enka=agents.get(a["agent"])
        if enka: ag[enka]=a.get("costs",[])
    eng={}
    for e in c.get("engines",[]):
        enka=engines.get(e["engine"])
        if not enka: continue
        bis={agents[b["agent"]]:b.get("costs",[]) for b in e.get("bis",[]) if b.get("agent") in agents}
        eng[enka]={"base":e.get("costs",[]),"bis":bis}

    entry={"title":s.get("main",{}).get("title"),"costLimit":c.get("costLimit"),
           "restart":{"free":pm.get("freeRestarts",0),"paid":pm.get("paidRestarts",[])},
           "agents":ag,"engines":eng}

    data={"_note":"Per-system shiyu ruleset cache (ObjectId->enkaId). Costs.agents[enka]=7 by mindscape; engines[enka]={base by refinement, bis:{agentEnka:costs}}. Regenerate via tools/fetch_system.py.","systems":{}}
    if os.path.exists(OUT):
        try: data=json.load(open(OUT,encoding="utf-8"))
        except Exception: pass
    data.setdefault("systems",{})[system_id]=entry
    json.dump(data,open(OUT,"w",encoding="utf-8"),ensure_ascii=False)
    print(f"cached system {system_id} «{entry['title']}»: {len(ag)} agents, {len(eng)} engines, restart {entry['restart']}")

if __name__=="__main__": main()
