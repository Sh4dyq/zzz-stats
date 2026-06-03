#!/usr/bin/env python3
"""Pull a shiyu.darte.gg draft over websocket and resolve it to readable JSON.
Usage: python fetch_draft.py <draft_id> <session_key>"""
import sys, json, time, urllib.request, socketio

API="https://shiyu.darte.gg/api/shiyu"
ATTR={200:"Physical",201:"Fire",202:"Ice",203:"Electric",205:"Ether",206:"Wind"}
SPEC={1:"Attack",2:"Stun",3:"Anomaly",4:"Support",5:"Defense",6:"Rupture"}

def get(path):
    req=urllib.request.Request(f"{API}/{path}", headers={"User-Agent":"Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def pull(draft_id, key):
    sio=socketio.Client(reconnection=False); box={}
    @sio.on('init', namespace='/draft')
    def _i(d): box['init']=d
    sio.connect(f"https://shiyu.darte.gg?session_id={draft_id}&session_key={key}",
                socketio_path="/socket.io/draft", transports=["websocket"], namespaces=['/draft'])
    t=time.time()
    while 'init' not in box and time.time()-t<10: time.sleep(0.2)
    sio.disconnect(); return box.get('init')

def main():
    draft_id, key = sys.argv[1], sys.argv[2]
    state=pull(draft_id, key)
    if not state: sys.exit("no init received (bad id/key or expired)")
    agents={a['_id']:a for a in get('agents')}
    engines={e['_id']:e for e in get('engines')}
    def ag(oid):
        a=agents.get(oid,{})
        return {"name":a.get('name',{}).get('en',oid),"enkaId":a.get('enkaId'),
                "element":ATTR.get(a.get('attribute')),"role":SPEC.get(a.get('specialty')),"rarity":a.get('rarity')}
    out={"draft_id":state['_id'],"status":state['status'],"details":state.get('details'),"players":[]}
    def eng(oid):
        e=engines.get(oid,{})
        return {"name":e.get('name',{}).get('en',oid),"enkaId":e.get('enkaId')}
    for p in state['players']:
        roster={r['agent']:r for r in p['roster']['agents']}
        # Джойн pick→движок: teams[].agent.agent → engine(enka) + refinement (R1–R5).
        teams={t['agent']['agent']:t for t in p.get('teams',[]) if t.get('agent') and t.get('engine')}
        def pick_engine(aid):
            t=teams.get(aid)
            if not t: return {"engine":None,"refinement":None}
            return {"engine":eng(t['engine']['engine']),"refinement":t['engine'].get('refinement',1)}
        picks=[{**ag(s['agent']),
                "mindscape":roster.get(s['agent'],{}).get('mindscape'),
                "potential":roster.get(s['agent'],{}).get('potential'),
                **pick_engine(s['agent'])}
               for s in state['selectedAgents'] if s['type']=='PICK' and s['actor']==p_id(p,state)]
        bans=[ag(s['agent']) for s in state['selectedAgents'] if s['type']=='BAN' and s['actor']==p_id(p,state)]
        out['players'].append({"name":p['fullName'],"costAgents":p.get('costAgents'),
            "costEngines":p.get('costEngines'),"restarts":p.get('restarts'),
            "clearTime":p.get('clearTime'),"clearPoints":p.get('clearPoints'),
            "picks":picks,"bans":bans})
    return out

def p_id(p,state):
    # player0/player1 by index in state['players']
    return f"player{state['players'].index(p)}"

if __name__=="__main__":
    print(json.dumps(main(), ensure_ascii=False, indent=2))
