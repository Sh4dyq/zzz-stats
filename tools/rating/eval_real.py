import json, math, itertools, statistics, collections, sys

D = json.load(open('/sessions/brave-stoic-allen/mnt/zzz-stats/web/data/legacy-stats.json'))
T = {t['id']: t for t in D['tournaments']}
players = {p['id']: p['nickname'] for p in D['players']}

# chronological order: tournament sort_order, then encounter sort_order
def tkey(tid):
    t = T[tid]
    return (t.get('sort_order') if t.get('sort_order') is not None else 999, t.get('event_date') or '9999')

ENC = [e for e in D['encounters'] if e['winner_id']]
ENC.sort(key=lambda e: (tkey(e['tournament_id']), e.get('sort_order') or 0))

# tournament category weights (name-based heuristic)
def cat(tid):
    n = T[tid]['name'].lower()
    if 'qualifier' in n: return 'qual'
    if 'proxy rush' in n: return 'fastcap'
    return 'main'

CATW = {'fastcap': 0.85, 'qual': 0.9, 'main': 1.0, 'final': 1.15}

def run(scale=250, kmax=48, kmin=18, tau=12, kconst=None,
        damp_start=1100, damp_span=150, damp_floor=0.2, damping=True,
        weights=True, evaluate=True, min_games=0):
    R = collections.defaultdict(lambda: 1000.0)
    N = collections.Counter()
    ll, cnt, hit = 0.0, 0, 0
    hist = []
    for e in ENC:
        a, b, w = e['player1_id'], e['player2_id'], e['winner_id']
        ra, rb = R[a], R[b]
        Ea = 1 / (1 + 10 ** ((rb - ra) / scale))
        Sa = 1.0 if w == a else 0.0
        if evaluate and N[a] >= min_games and N[b] >= min_games:
            p = min(max(Ea, 1e-6), 1 - 1e-6)
            ll += -(Sa * math.log(p) + (1 - Sa) * math.log(1 - p))
            cnt += 1
            hit += 1 if (p > .5) == (Sa == 1) else 0
        W = CATW[cat(e['tournament_id'])] if weights else 1.0
        for pid, r, S in ((a, ra, Sa), (b, rb, 1 - Sa)):
            K = kconst if kconst else kmin + (kmax - kmin) * math.exp(-N[pid] / tau)
            dmp = 1.0
            if damping and r > damp_start:
                dmp = max(damp_floor, 1.0 - (r - damp_start) / damp_span * (1 - damp_floor))
            other = rb if pid == a else ra
            Ex = 1 / (1 + 10 ** ((other - r) / scale))
            R[pid] = r + K * dmp * W * (S - Ex)
            N[pid] += 1
        hist.append((e, dict(R)))
    return R, N, (ll / cnt if cnt else None), (hit / cnt if cnt else None), cnt

def summ(R, N, min_g=3):
    v = sorted([r for p, r in R.items() if N[p] >= min_g])
    return v

print("=== A. Predictive log-loss on real data (156 encounters, 59 players) ===")
print("baseline (coinflip): log-loss = {:.4f}".format(math.log(2)))
rows = []
for scale in (200, 250, 320, 400):
    for kname, kw in (('const40', dict(kconst=40)), ('exp48-18', dict())):
        for damp in (True, False):
            for wt in (True, False):
                R, N, ll, acc, c = run(scale=scale, damping=damp, weights=wt, min_games=2, **kw)
                rows.append((ll, acc, scale, kname, damp, wt, max(R.values())))
rows.sort()
print(f"{'logloss':>8} {'acc':>6} {'SCALE':>6} {'K':>9} {'damp':>5} {'wt':>5} {'maxR':>7}")
for ll, acc, s, k, d, w, mx in rows:
    print(f"{ll:8.4f} {acc:6.3f} {s:6} {k:>9} {str(d):>5} {str(w):>5} {mx:7.0f}")
