#!/usr/bin/env python3
"""Dump each agent's full skill text (EN) from zzz.nanoka.cc for synergy tagging.

Companion to fetch_synergy.py: that one parses only the Additional-Ability squad
gate; this one pulls every skill's name+description so we can hand-draft
"gives / needs" synergy tags per agent (buffs granted to allies vs. conditions
the kit wants from allies). Output is raw material for manual tagging, not a
finished model.

Usage:  python tools/fetch_skillsets.py
Writes tools/skillsets_raw.json  { id: {name, element, faction, specialty,
skills:[{cat,name,desc}]} }.
"""
import re, json, os, sys, time, urllib.request

BASE = "https://zzz.nanoka.cc"
OUT = os.path.join(os.path.dirname(__file__), "skillsets_raw.json")

NAME_OVERRIDE = {1381: "Soldier 0 - Anby", 1531: "Starlight - Billy",
                 1551: "Pyrois", 1591: "Sigrid"}


def fetch(path):
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def deesc(s):
    return (s.replace('\\"', '"').replace('\\n', '\n')
             .replace('\\u003C', '<').replace('\\u003E', '>')
             .replace('\\u003c', '<').replace('\\u003e', '>'))


def strip_tags(t):
    t = re.sub(r'<IconMap:[^>]*>', '', t)
    return re.sub(r'<[^>]*>', '', t)


def dictval(u, key):
    m = re.search(r'"' + key + r'": ?\{\s*"(\d+)": ?"([^"]*)"', u)
    return m.group(2) if m else None


def full_name(u):
    m = re.search(r'"full_name": ?"([^"]*)"', u)
    return m.group(1) if m else None


def _balanced(u, j):
    depth = 0
    for k in range(j, len(u)):
        c = u[k]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return u[j:k + 1]
    return ''


def scope(u, key, must_contain=None):
    """Return the balanced {...} object after "key":. If must_contain is given,
    scan every occurrence of the key and return the first block containing it."""
    start = 0
    while True:
        i = u.find('"' + key + '":', start)
        if i < 0:
            return ''
        j = u.find('{', i)
        if j < 0:
            return ''
        block = _balanced(u, j)
        if must_contain is None or must_contain in block:
            return block
        start = j + 1


STR = r'"((?:[^"\\]|\\.)*)"'


def _jstrings(arr_text):
    return [strip_tags(deesc_inline(x)).strip()
            for x in re.findall(STR, arr_text, re.DOTALL)]


def extract_core(u, cid):
    """Core Passive + Additional Ability live in an object keyed by
    id = agent_id*1000+501, shaped {"name":[core,add],"desc":[coreDesc,addDesc]}.
    These carry the squad-facing text, so they matter most for synergy."""
    marker = f'"id": {cid * 1000 + 501}'
    i = u.find(marker)
    if i < 0:
        return []
    # widen to the enclosing object, then read its name[] and desc[] arrays
    obj = _balanced(u, u.rfind('{', 0, i))
    nm = re.search(r'"name":\s*\[(.*?)\]', obj, re.DOTALL)
    ds = re.search(r'"desc":\s*\[(.*?)\]', obj, re.DOTALL)
    names = _jstrings(nm.group(1)) if nm else []
    descs = _jstrings(ds.group(1)) if ds else []
    out = []
    for k, name in enumerate(names):
        if k < len(descs) and len(descs[k]) > 10:
            out.append({"name": name, "desc": descs[k]})
    return out


def extract_skills(u, cid):
    """Pull ordered (name, desc) pairs from THIS agent's "skill" object only.
    The character page also embeds a global blob of every agent's costume flavor
    text, so we must scope to the skill object by balanced braces first. Core
    Passive + Additional Ability sit in a separate object; prepend them."""
    out = list(extract_core(u, cid))
    seen = {(s["name"], s["desc"][:40]) for s in out}
    block = scope(u, 'skill', must_contain='"description"')
    for m in re.finditer(r'"name":\s*"([^"]*)"\s*,\s*"desc":\s*' + STR, block, re.DOTALL):
        nm = m.group(1)
        ds = strip_tags(deesc_inline(m.group(2))).strip()
        # drop the numeric multiplier param rows (desc is a "{Skill:...}" formula)
        if ds.startswith('{') or 'Multiplier' in nm:
            continue
        if ds and len(ds) > 10 and (nm, ds[:40]) not in seen:
            seen.add((nm, ds[:40]))
            out.append({"name": nm, "desc": ds})
    return out


def deesc_inline(s):
    # desc values still carry escaped quotes/newlines after the outer deesc pass;
    # game text also leaves stray backslashes at line breaks -> collapse to space.
    s = s.replace('\\n', '\n').replace('\\"', '"').replace('\\t', ' ')
    return re.sub(r'\s*\\+\s*', ' ', s)


def main():
    ids = list(range(1011, 1701, 10))
    print(f"{len(ids)} ids", file=sys.stderr)
    agents = {}
    for i in ids:
        try:
            u = deesc(fetch(f"/character/{i}/"))
        except Exception as ex:
            print(f"  {i}: fetch failed {ex}", file=sys.stderr); continue
        name = full_name(u)
        if (not name or name.startswith("Partner_") or name.startswith("Avatar_")
                or not re.search(r'[A-Za-z]', name)):
            name = NAME_OVERRIDE.get(i)
            if not name:
                continue
        skills = extract_skills(u, i)
        if not skills:
            print(f"  {i} {name}: no skills parsed", file=sys.stderr)
        agents[i] = {"name": name,
                     "element": dictval(u, "element_type"),
                     "faction": dictval(u, "camp"),
                     "specialty": dictval(u, "weapon_type"),
                     "skills": skills}
        print(f"  {i} {name}: {len(skills)} skill texts", file=sys.stderr)
        time.sleep(0.15)
    json.dump({"agents": agents}, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"wrote {len(agents)} agents -> {OUT}")


if __name__ == "__main__":
    main()
