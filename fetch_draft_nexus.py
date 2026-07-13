#!/usr/bin/env python3
"""Pull a nexus-shiyu draft JSON and resolve it to readable stats JSON.
Usage: python fetch_draft_nexus.py <draftinfo_url | path.json>
URL: https://<host>/api/drafts/<id>/draftinfo?adminToken=<token>"""
import sys, json, urllib.request

def load(src):
    if src.startswith("http"):
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8")
        if body.lstrip()[:1] != "{":
            sys.exit("non-JSON response (redirect to login? endpoint not live?)")
        return json.loads(body)
    return json.load(open(src, encoding="utf-8"))

def main():
    d = load(sys.argv[1])
    chars, amps = {}, {}
    for side in d["rosters"].values():
        for c in side["characters"]:
            chars[c["characterId"]] = c
        for a in side["amplifiers"]:
            amps[a["amplifierId"]] = a

    def ch(cid):
        c = chars.get(cid)
        if not c:
            print(f"WARN: characterId {cid} not in rosters", file=sys.stderr)
            return {"name": cid, "nameRu": None, "element": None, "role": None, "rank": None, "mindscape": None, "cost": None}
        return {"name": c["nameEn"], "nameRu": c["nameRu"], "element": c["attribute"]["nameRu"],
                "role": c["specialization"]["nameRu"], "rank": c["rank"],
                "mindscape": c["mindscape"], "cost": c["cost"]}

    results = d.get("results") or {}
    out = {"draft_id": d["id"], "status": d["status"], "gameType": d["gameType"],
           "createdAt": d["createdAt"], "gameWinner": results.get("gameWinner"),
           "players": []}
    for side in ("creator", "opponent"):
        p, roster = d["players"][side], d["rosters"][side]
        res = results.get(side) or {}
        squads = d["squads"][side]
        amp_by_char = {a["charId"]: a for a in squads["amps1"] + squads["amps2"]}
        picks, bans = [], []
        for step in d["debug"]["picks"]:
            if step["side"] != side:
                continue
            info = ch(step["characterId"])
            if step["type"] == "ban":
                bans.append(info)
            else:
                a = amp_by_char.get(step["characterId"])
                amp = amps.get(a["ampId"]) if a else None
                picks.append({**info, "auto": step["auto"],
                              "engine": {"name": amp["nameEn"], "nameRu": amp["nameRu"], "rank": amp["rank"]} if amp else None,
                              "refinement": (a or {}).get("rankLevel", amp["rankLevel"] if amp else None)})
        out["players"].append({
            "name": p["nick"] or p["name"], "side": side,
            "costAgents": roster["agentCost"], "costEngines": roster["ampCost"],
            "restarts": res.get("restarts"), "restartPenalty": res.get("restartPenalty"),
            "clearTime": res.get("timeLimit"), "finalTime": res.get("finalTime"),
            "won": results.get("gameWinner") == side if results.get("gameWinner") else None,
            "squad1": [ch(c)["name"] for c in squads["squad1"]],
            "squad2": [ch(c)["name"] for c in squads["squad2"]],
            "picks": picks, "bans": bans})
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
