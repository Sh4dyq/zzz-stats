"""5-fold CV по lam -> оценка истинного разброса силы пула."""
import json, math, collections, random

D = json.load(open('/sessions/brave-stoic-allen/mnt/zzz-stats/web/data/legacy-stats.json'))
ENC = [e for e in D['encounters'] if e['winner_id']]
cnt = collections.Counter()
for e in ENC:
    cnt[e['player1_id']] += 1; cnt[e['player2_id']] += 1
ids = sorted(cnt); idx = {p: i for i, p in enumerate(ids)}

def fit(data, lam, iters=3000):
    th = [0.0] * len(ids)
    c = collections.Counter()
    for e in data:
        c[idx[e['player1_id']]] += 1; c[idx[e['player2_id']]] += 1
    for _ in range(iters):
        g = [0.0] * len(ids)
        for e in data:
            a, b = idx[e['player1_id']], idx[e['player2_id']]
            pa = 1 / (1 + math.exp(-(th[a] - th[b])))
            s = 1.0 if e['winner_id'] == e['player1_id'] else 0.0
            g[a] += s - pa; g[b] -= s - pa
        for i in range(len(ids)):
            g[i] -= lam * th[i]
            th[i] += 0.05 * g[i] / max(1, c[i] ** .5)
    return th

random.seed(0)
res = {}
for lam in (0.1, 0.25, 0.5, 0.75, 1.0):
    tot, n = 0.0, 0
    for rep in range(6):
        d = ENC[:]; random.shuffle(d)
        F = 5
        for f in range(F):
            test = d[f::F]; train = [x for i, x in enumerate(d) if i % F != f]
            th = fit(train, lam)
            for e in test:
                a, b = idx[e['player1_id']], idx[e['player2_id']]
                p = 1 / (1 + math.exp(-(th[a] - th[b])))
                p = min(max(p, 1e-6), 1 - 1e-6)
                s = 1.0 if e['winner_id'] == e['player1_id'] else 0.0
                tot += -(s * math.log(p) + (1 - s) * math.log(1 - p)); n += 1
    th = fit(ENC, lam)
    sc = 400 / math.log(10)
    m = sum(th) / len(th)
    sd = (sum((t - m) ** 2 for t in th) / len(th)) ** .5 * sc
    res[lam] = (tot / n, sd)
    print(f"lam={lam:<4} CV logloss={tot/n:.4f}  sd(Elo400)={sd:.0f}")
best = min(res, key=lambda k: res[k][0])
print(f"\nЛучший lam={best}: CV={res[best][0]:.4f}, оценка истинного sd = {res[best][1]:.0f} очков (шкала Эло-400)")
print(f"coinflip = {math.log(2):.4f}")
