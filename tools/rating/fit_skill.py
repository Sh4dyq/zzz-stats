"""Оценка реального разброса силы: Bradley-Terry MLE с L2-регуляризацией к 0."""
import json, math, collections

D = json.load(open('/sessions/brave-stoic-allen/mnt/zzz-stats/web/data/legacy-stats.json'))
names = {p['id']: p['nickname'] for p in D['players']}
ENC = [e for e in D['encounters'] if e['winner_id']]

cnt = collections.Counter()
for e in ENC:
    cnt[e['player1_id']] += 1; cnt[e['player2_id']] += 1
ids = sorted(cnt)
idx = {p: i for i, p in enumerate(ids)}

def fit(lam):
    th = [0.0] * len(ids)
    for it in range(4000):
        g = [0.0] * len(ids)
        for e in ENC:
            a, b = idx[e['player1_id']], idx[e['player2_id']]
            pa = 1 / (1 + math.exp(-(th[a] - th[b])))
            s = 1.0 if e['winner_id'] == e['player1_id'] else 0.0
            g[a] += (s - pa); g[b] -= (s - pa)
        for i in range(len(ids)):
            g[i] -= lam * th[i]
            th[i] += 0.05 * g[i] / max(1, cnt[ids[i]] ** 0.5)
    return th

for lam in (1.0, 2.0, 4.0):
    th = fit(lam)
    # перевод в шкалу Эло: elo = 400/ln10 * theta  (логит-шкала -> 400)
    elo = sorted((400 / math.log(10)) * t for t in th)
    n = len(elo)
    print(f"lam={lam}: sd={ (sum((x-sum(elo)/n)**2 for x in elo)/n)**.5 :.0f}  "
          f"p5={elo[int(.05*n)]:.0f} p25={elo[int(.25*n)]:.0f} med={elo[n//2]:.0f} "
          f"p75={elo[int(.75*n)]:.0f} p95={elo[int(.95*n)]:.0f} max={elo[-1]:.0f} min={elo[0]:.0f}")

th = fit(2.0)
sc = 400 / math.log(10)
rank = sorted(((sc * th[i], names.get(ids[i], '?'), cnt[ids[i]]) for i in range(len(ids))), reverse=True)
print("\nТоп-12 (отн. среднего, шкала Эло-400):")
for r, n_, c in rank[:12]:
    print(f"  {n_:<18} {r:+7.0f}  игр={c}")
print("Низ-5:")
for r, n_, c in rank[-5:]:
    print(f"  {n_:<18} {r:+7.0f}  игр={c}")
