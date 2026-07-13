#!/usr/bin/env python3
"""Cache each agent's Additional-Ability squad synergy gate from zzz.nanoka.cc.

ZZZ Additional Abilities gate a bonus on the rest of the squad, and the trigger
is always an OR-list of a few fixed clause types:
  - "is a/an <Specialty> character"  (Attack/Stun/Anomaly/Support/Defense/Rupture)
  - "shares the same Faction"
  - "shares the same attribute"
  - (rarely) "is a/an <Element> character"  (Physical/Fire/Ice/Electric/Ether/Frost...)
So the whole thing parses with a few regexes — no manual per-character rules.

For each agent we store element / faction / specialty + the parsed trigger, so
web/predict.js can score a team by how many Additional Abilities it activates:
  activated_i = 1 if some teammate satisfies any of agent i's clauses.

Usage:  python tools/fetch_synergy.py
Writes/overwrites web/data/characters_synergy.json and prints agents whose
Additional Ability mentions the squad but did not parse (for manual review).
"""
import re, json, os, sys, time, urllib.request

BASE="https://zzz.nanoka.cc"
OUT=os.path.join(os.path.dirname(__file__),"..","web","data","characters_synergy.json")

SPEC=["Attack","Stun","Anomaly","Support","Defense","Rupture"]
ELEM=["Physical","Fire","Ice","Electric","Ether","Wind","Frost","Auric","Auric Ink"]

def fetch(path):
    req=urllib.request.Request(f"{BASE}{path}",headers={"User-Agent":"Mozilla/5.0"})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.read().decode("utf-8","replace")

def deesc(s):
    return (s.replace('\\"','"').replace('\\n','\n')
             .replace('\\u003C','<').replace('\\u003E','>')
             .replace('\\u003c','<').replace('\\u003e','>'))

def strip_tags(t): return re.sub(r'<[^>]*>','',t)

def dictval(u,key):
    # the agent's own element_type/camp/weapon_type is a single-entry {id:"Name"} dict
    m=re.search(r'"'+key+r'": ?\{\s*"(\d+)": ?"([^"]*)"',u)
    return m.group(2) if m else None

def full_name(u):
    m=re.search(r'"full_name": ?"([^"]*)"',u)
    return m.group(1) if m else None

def list_ids():
    # The /character/ grid is client-rendered (no ids in raw HTML) and there is no
    # public list endpoint, but agent ids run 10xx..15xx in steps of 10. Probe the
    # range; main() drops ids whose page has no real full_name. New agents extend
    # the range end — bump RANGE_END when they release.
    RANGE_START, RANGE_END = 1011, 1701
    return list(range(RANGE_START, RANGE_END, 10))

# nanoka is missing/incomplete for some agents; fill from the game text by hand.
# key = agent id, value = trigger dict (same shape parse_trigger emits).
OVERRIDES={
    1461:{"spec":["Attack"],"elem":[],"faction":False,"attribute":False},   # Seed: another Attack character in squad
    1561:{"spec":["Anomaly"],"elem":[],"faction":False,"attribute":True},   # Velina: Anomaly char or same attribute
    1571:{"spec":["Attack","Rupture"],"elem":[],"faction":True,"attribute":False}, # Norma (wiki/prydwen; nanoka lacks it)
}

# nanoka has full element/faction/specialty + AA gate for these, but no proper
# full_name yet (empty/"..."). Supply the name so they aren't dropped; the value
# matches nanoka's canonical spelling (predict.html SYN_ALIAS maps DB shorthand).
NAME_OVERRIDE={
    1381:"Soldier 0 - Anby", 1531:"Starlight - Billy", 1551:"Pyrois", 1591:"Sigrid",
}

def parse_trigger(u):
    """Merge every squad-gate clause found into one OR-structure.
    Returns (trigger_dict_or_None, squad_mentioned_bool)."""
    # clause text can sit AFTER "in your squad ... :" or BEFORE it
    # ("another <Specialty> character is in your squad").
    conds=re.findall(r'in (?:your|the) squad([^:]{0,220}?):',u)
    conds+=re.findall(r'([A-Za-z ]{0,60}?character)s? (?:is|are) in (?:your|the) squad',u)
    squad_mentioned=bool(re.search(r'in (?:your|the) squad',u))
    spec=set(); elem=set(); faction=False; attribute=False; got=False
    for c in conds:
        c=strip_tags(c)
        # c is only the gate text (up to the first ':'), so any specialty/element word
        # in it is part of the requirement — plain word match catches full OR-lists
        # like "Attack or Rupture character" that proximity-to-"character" would clip.
        for s in SPEC:
            if re.search(r'\b'+re.escape(s)+r'\b',c): spec.add(s); got=True
        for e in ELEM:
            if re.search(r'\b'+re.escape(e)+r'\b',c): elem.add(e); got=True
        # gate text is terse; "same Attribute or Faction" shares one "same", so match
        # the bare words rather than requiring "same" to precede each.
        if re.search(r'[Ff]action',c): faction=True; got=True
        if re.search(r'[Aa]ttribute',c): attribute=True; got=True
    if not got: return None, squad_mentioned
    return {"spec":sorted(spec),"elem":sorted(elem),
            "faction":faction,"attribute":attribute}, squad_mentioned

def main():
    ids=list_ids()
    print(f"{len(ids)} agents", file=sys.stderr)
    agents={}; unparsed=[]
    for i in ids:
        try:
            u=deesc(fetch(f"/character/{i}/"))
        except Exception as ex:
            print(f"  {i}: fetch failed {ex}", file=sys.stderr); continue
        name=full_name(u)
        if (not name or name.startswith("Partner_") or name.startswith("Avatar_")
                or not re.search(r'[A-Za-z]',name)):
            name=NAME_OVERRIDE.get(i)          # nanoka lacks the name but has the data
            if not name: continue              # truly unreleased/placeholder
        trig,squad=parse_trigger(u)
        if i in OVERRIDES: trig=OVERRIDES[i]
        agents[i]={"name":name,
                   "element":dictval(u,"element_type"),
                   "faction":dictval(u,"camp"),
                   "specialty":dictval(u,"weapon_type"),
                   "trigger":trig}
        if trig is None and squad:
            unparsed.append((i,name))
        time.sleep(0.15)

    data={"_note":"Per-agent Additional-Ability squad synergy gate from nanoka. "
                  "trigger = OR of: teammate specialty in spec[], teammate element in elem[], "
                  "faction=same faction, attribute=same element. null trigger = no squad gate. "
                  "Regenerate via tools/fetch_synergy.py.",
          "agents":agents}
    os.makedirs(os.path.dirname(OUT),exist_ok=True)
    json.dump(data,open(OUT,"w",encoding="utf-8"),ensure_ascii=False,indent=0)
    gated=sum(1 for a in agents.values() if a["trigger"])
    print(f"wrote {len(agents)} agents, {gated} with a squad gate -> {OUT}")
    if unparsed:
        print("MANUAL REVIEW (mentions squad, no clause parsed):")
        for i,n in unparsed: print(f"  {i} {n}")

if __name__=="__main__": main()
