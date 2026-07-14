#!/usr/bin/env python3
"""Squad synergy scorer (v2) — a correction ADDED on top of individual winrate.

Design locked with the player-owner (2026-07) after an evidence pass over 4
tournaments (303 matches). Key findings that shape this code:
  * Individual winrate is the base; synergy is only a small additive nudge.
  * Pairwise tag-fit predicts observed pair-lift ONLY for pairs containing a
    damage source (r~0.27); helper+helper pairs carry no pair-level signal, so
    they are skipped (their value is already captured through each helper's pair
    with the carry).
  * Match data is noise-capped (4 tournaments) — it CALIBRATED the tag->winrate
    slope (~0.05) but cannot rank individual pairs, so there is no per-pair table.
  * Triples are statistically dead (avg 1.3 games) — no triple term; the
    "obol squad" effect lives in the carry<-helper pair coverage instead.

Tag classes (owner-defined, not scarcity-weighted):
  REWARD loops (full weight, only when a needer is present): ether_veil,
    aftershock, abloom, anomaly_assist, decibel, def_shred, pen_buff.
  SOFT buffs (contribute, no duplicate penalty): atk_buff, dmg_buff, crit_buff,
    anomaly_buff, sheer_dmg_buff, amp_on_stun.
  daze: satisfied once, NO reward for excess (too much stun helps only Hugo).

Inputs (both keyed by agent id, 57 agents):
  tools/synergy_tags_current.json   roles / gives / needs / passive_use (0-4)
  web/data/characters_synergy.json  Additional-Ability squad gate (trigger)
"""
import json, os, itertools

HERE = os.path.dirname(__file__)
TAGS = json.load(open(os.path.join(HERE, "synergy_tags_current.json"), encoding="utf-8"))
SYN = json.load(open(os.path.join(HERE, "..", "web", "data", "characters_synergy.json"),
                     encoding="utf-8"))["agents"]

NAME2ID = {v["name"]: k for k, v in TAGS.items()}
MAX = 4.0

# --- tag classes ---
REWARD = {"ether_veil", "aftershock", "abloom", "anomaly_assist", "decibel",
          "def_shred", "pen_buff"}
SOFT = {"atk_buff", "dmg_buff", "crit_buff", "anomaly_buff", "sheer_dmg_buff",
        "amp_on_stun"}
SOFT_W = 0.4
# daze and anything else -> 0 in the fit (daze handled by the Hugo rule only)


def tag_w(t):
    return 1.0 if t in REWARD else (SOFT_W if t in SOFT else 0.0)


# --- role lines ---
MAIN = ("crit_dps", "sheer_dps", "main_anomaly")
DMG = MAIN + ("sub_dps", "sub_anomaly")          # "damage side" (main or sub)
ONFIELD_CRIT = ("crit_dps", "sheer_dps")          # compete for field time

# premium near-universal supports (undercounted in stats: pricey + banned/stolen)
PREMIUM_SUPPORT = {"Ukinami Yuzuha", "Lucia Elowen", "Astra Yao", "Sunna",
                   "Nicole Demara"}

# --- weights (SCALE from data-calibrated slope; the rest hand-set, TODO tune) ---
# "maximally shrunk" preset: synergy is only a light nudge, hard-capped to CAP.
CAP = 0.10                       # |total synergy correction| never exceeds this
W = {
    "scale":            0.012,   # calibrated slope 0.049 shrunk ~4x (nudge mode)
    "crit_conflict":   -0.05,    # two committed on-field crit carries
    "sheer_conflict":  -0.08,    # sheer core + any other core (does not stack)
    "anomaly_conflict":-0.012,   # per weighted extra main-anomaly (small — anomaly is a flexible class; void if Miyabi)
    "premium_support":  0.01,    # flat, per premium support (capped at 2)
    "hugo_extra_stun":  0.015,   # Hugo rewards each stunner beyond the first
}


def rid(x):
    return x if x in TAGS else NAME2ID[x]


def is_dmg(cid):
    r = TAGS[cid]["roles"]
    return max((r.get(k, 0) for k in DMG), default=0) >= 2


def gate_active(cid, team):
    g = SYN.get(cid, {}).get("trigger")
    if not g:
        return False
    me = SYN.get(cid, {})
    for oid in team:
        if oid == cid:
            continue
        o = SYN.get(oid)
        if not o:
            continue
        if g["faction"] and o.get("faction") and o["faction"] == me.get("faction"):
            return True
        if g["attribute"] and o.get("element") and o["element"] == me.get("element"):
            return True
        if g["spec"] and o.get("specialty") in g["spec"]:
            return True
        if g["elem"] and o.get("element") in g["elem"]:
            return True
    return False


def pair_fit(a, b):
    """Class-weighted gives<->needs coverage of an ordered pair, both directions.
    A tag contributes only up to what is needed (min) — no reward without a needer."""
    s = 0.0
    for x, y in ((a, b), (b, a)):
        for tag, need in TAGS[y]["needs"].items():
            s += tag_w(tag) * min(TAGS[x]["gives"].get(tag, 0), need)
    return s / MAX


def synergy(members):
    """Return a winrate correction (points) + interpretable breakdown."""
    team = [rid(m) for m in members]
    names = [TAGS[c]["name"] for c in team]

    # 1. pair term — only pairs with a damage side (skip helper+helper)
    pair_sum, pair_detail = 0.0, []
    for a, b in itertools.combinations(team, 2):
        if not (is_dmg(a) or is_dmg(b)):
            continue
        pf = pair_fit(a, b)
        if pf:
            pair_sum += pf
            pair_detail.append((TAGS[a]["name"], TAGS[b]["name"], round(pf, 2)))
    pair_term = W["scale"] * pair_sum

    # 2. AA gate (archetype/faction) weighted by how strong the passive is
    aa = 0.0
    for c in team:
        if gate_active(c, team):
            aa += (TAGS[c].get("passive_use") or 0) / MAX
    aa_term = W["scale"] * aa

    # 3. field conflicts — cores that fight for on-field time. A carry is only
    #    "committed" if it has no fallback role (sub/support) to flex into
    #    (e.g. Seed has sub_dps:2 -> plays battery, not a competing carry).
    def committed(c, role):
        r = TAGS[c]["roles"]
        if r.get(role, 0) < 3 or r.get("off_field", 0) >= 3:
            return False
        return max(r.get("sub_dps", 0), r.get("sub_anomaly", 0),
                   r.get("support", 0)) < 2
    crit_cores  = [c for c in team if committed(c, "crit_dps")]
    sheer_cores = [c for c in team if committed(c, "sheer_dps")]
    # main anomalists are graded by how "committed" they are: a pure main role
    # weighs 1.0, one with an off_field/sub fallback weighs 0.5 (can flex, so two
    # of them clash less — e.g. Yanagi/Alice with sub_anomaly:2 vs pure Promeia).
    def anom_weight(c):
        r = TAGS[c]["roles"]
        if r.get("main_anomaly", 0) < 3:
            return 0.0
        flex = (r.get("off_field", 0) >= 3 or
                max(r.get("sub_dps", 0), r.get("sub_anomaly", 0),
                    r.get("support", 0)) >= 2)
        return 0.5 if flex else 1.0
    anom_w = sum(anom_weight(c) for c in team)
    all_cores = set(crit_cores) | set(sheer_cores) | {c for c in team if anom_weight(c)}

    if sheer_cores and len(all_cores) >= 2:
        # sheer does not stack with ANY other core (nearly unplayable)
        conflict = W["sheer_conflict"] * (len(all_cores) - 1)
    else:
        conflict = W["crit_conflict"] * max(0, len(crit_cores) - 1)
        if "Hoshimi Miyabi" not in names:      # Miyabi voids the anomaly penalty
            conflict += W["anomaly_conflict"] * max(0, anom_w - 1)

    # 4. premium support bonus (capped at 2 so it stays a nudge)
    prem = W["premium_support"] * min(2, sum(1 for n in names if n in PREMIUM_SUPPORT))

    # 5. Hugo rule: he scales with the number of stuns -> reward extra stunners
    hugo = 0.0
    if "Hugo Vlad" in names:
        stun = sum(1 for c in team if TAGS[c]["roles"].get("stunner", 0) >= 3)
        hugo = W["hugo_extra_stun"] * max(0, stun - 1)

    total = pair_term + aa_term + conflict + prem + hugo
    total = max(-CAP, min(CAP, total))       # keep synergy a bounded nudge
    return {
        "members": names,
        "total": round(total, 3),
        "parts": {"pair": round(pair_term, 3), "aa": round(aa_term, 3),
                  "conflict": round(conflict, 3), "premium": round(prem, 3),
                  "hugo": round(hugo, 3)},
        "pair_detail": pair_detail,
    }


# backward-compatible alias
score_team = synergy


# ---------------------------------------------------------------------------
# Shiyu element matchup layer — separate from squad synergy. Enemy vuln/res
# come from tournaments.shiyu_data (Frontier 4): each room has weakness:[elem]
# and each monster res:[elem]. Frontier 4 has 2 rooms and a player fields 2
# teams (team_slot 1/2), so slot maps to room. Owner values: resistance -20%
# / vulnerability +20% to DMG, stun and anomaly buildup alike.
# ---------------------------------------------------------------------------
# how much each character's element counts toward the team's element profile
ELEM_W = {"main": 1.0, "sub": 0.85, "stunner": 0.4, "anom_support": 0.1}
MATCHUP_CAP = 0.10           # a fully-matched mono team swings +/- this


def _anom_support(c):
    r = TAGS[c]["roles"]; g = TAGS[c]["gives"]
    return (max(r.get("support", 0), r.get("off_field", 0)) >= 2 and
            (r.get("sub_anomaly", 0) >= 1 or
             any(g.get(t, 0) >= 1 for t in ("anomaly_assist", "anomaly_buff", "abloom"))))


def element_weight(c):
    r = TAGS[c]["roles"]
    if max(r.get(k, 0) for k in MAIN) >= 3:
        return ELEM_W["main"]
    if max(r.get("sub_dps", 0), r.get("sub_anomaly", 0)) >= 2:
        return ELEM_W["sub"]
    if r.get("stunner", 0) >= 3:
        return ELEM_W["stunner"]
    if _anom_support(c):
        return ELEM_W["anom_support"]
    return 0.0


def element_matchup(members, room):
    """Winrate nudge for a team vs one Shiyu room. room = a shiyu_data['rooms']
    entry (has 'weakness' and 'monsters'[].res). Returns (points, detail)."""
    team = [rid(m) for m in members]
    prof = {}
    for c in team:
        w = element_weight(c)
        if w:
            el = (SYN.get(c, {}).get("element") or TAGS[c].get("element") or "").lower()
            if el:
                prof[el] = prof.get(el, 0.0) + w
    total = sum(prof.values())
    if not total:
        return 0.0, {}
    team_frac = {e: v / total for e, v in prof.items()}

    # enemy side weighted by HP (bigger enemy -> its elements matter more). We do
    # NOT trust monster count (a single listed "shield fool" may really be four),
    # so hp is the proxy for how much a given enemy's weak/res drives the fight.
    monsters = room.get("monsters", []) or []
    hps = [max(1, mon.get("hp", 0) or 0) for mon in monsters]
    H = sum(hps) or 1
    weakW, resW = {}, {}
    for mon, hp in zip(monsters, hps):
        w = hp / H
        for e in mon.get("weak", []):
            weakW[e.lower()] = weakW.get(e.lower(), 0.0) + w
        for e in mon.get("res", []):
            resW[e.lower()] = resW.get(e.lower(), 0.0) + w

    raw = sum(f * (weakW.get(e, 0.0) - resW.get(e, 0.0)) for e, f in team_frac.items())
    pts = max(-MATCHUP_CAP, min(MATCHUP_CAP, MATCHUP_CAP * raw))
    return round(pts, 3), {"profile": {k: round(v, 2) for k, v in prof.items()},
                           "enemy_weak": {k: round(v, 2) for k, v in weakW.items()},
                           "enemy_res": {k: round(v, 2) for k, v in resW.items()},
                           "raw": round(raw, 2)}


if __name__ == "__main__":
    DEMOS = [
        ["Promeia", "Vivian Banshee", "Ukinami Yuzuha"],
        ["Soldier 0 - Anby", "Trigger", "Orphie Magnusson & Magus"],
        ["Hoshimi Miyabi", "Von Lycaon", "Soukaku"],
        ["Ellen Joe", "Zhu Yuan", "Evelyn Chevalier"],   # 3 crit carries -> conflict
        ["Hugo Vlad", "Lighter", "Von Lycaon"],          # 2 stunners for Hugo
        ["Ye Shunguang", "Dialyn", "Lucia Elowen"],
    ]
    for d in DEMOS:
        r = synergy(d)
        print(f"\n{' + '.join(r['members'])}  ->  {r['total']:+.3f}")
        print("  parts:", r["parts"])
        if r["pair_detail"]:
            print("  pairs:", r["pair_detail"])
