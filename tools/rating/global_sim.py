"""Подбор констант ГЛОБАЛЬНОГО (несбрасываемого) рейтинга.

Отличия от verify.py: сброса нет, симулируются несколько лет подряд,
пул обновляется (часть игроков уходит, новички стартуют с 1000).
Меряем: дрейф среднего (инфляция от участия и мест), разброс,
населённость тиров и достижимость верхней границы.

    python global_sim.py
"""
import math, random, statistics, collections

START = 1000.0
TRUE_SD = 140.0          # разброс истинной силы пула (cv_spread.py)
POOL = 120               # активный пул (игроков в обороте за год)
PER_YEAR = 40            # турниров в год
YEARS = 3
LIFE_YEARS = 2.0         # средний срок жизни игрока в сцене
START_SHARE = 0.55       # доля пула, которая есть на старте; остальные приходят по ходу
CATS = [('fastcap', .40), ('main', .50), ('major', .10)]
CATEGORY_W = {'fastcap': 0.8, 'main': 1.0, 'major': 1.2}
FIELD_BETA, FIELD_SPAN = 0.10, 150.0

def p_true(a, b):
    return 1 / (1 + 10 ** ((b - a) / 400))

def de(players, play):
    win, lose, order = players[:], [], []
    while len(win) > 1:
        nw, nl = [], []
        for i in range(0, len(win) - 1, 2):
            a, b = win[i], win[i + 1]
            w = play(a, b); nw.append(w); nl.append(a if w == b else b)
        if len(win) % 2: nw.append(win[-1])
        if lose:
            surv = []
            for i in range(0, len(lose) - 1, 2):
                w = play(lose[i], lose[i + 1]); surv.append(w)
                order.append(lose[i] if w == lose[i + 1] else lose[i + 1])
            if len(lose) % 2: surv.append(lose[-1])
            merged = []
            for i in range(min(len(surv), len(nl))):
                w = play(surv[i], nl[i]); merged.append(w)
                order.append(surv[i] if w == nl[i] else nl[i])
            merged += surv[len(nl):] + nl[len(surv):]
            lose = merged
        else:
            lose = nl
        win = nw
    while len(lose) > 1:
        nl = []
        for i in range(0, len(lose) - 1, 2):
            w = play(lose[i], lose[i + 1]); nl.append(w)
            order.append(lose[i] if w == lose[i + 1] else lose[i + 1])
        if len(lose) % 2: nl.append(lose[-1])
        lose = nl
    if lose:
        a, b = win[0], lose[0]
        w = play(a, b)
        if w == b: w = play(a, b)
        order += [a if w == b else b, w]
    else:
        order += win
    return list(reversed(order))

def se(players, play):
    cur, order = players[:], []
    while len(cur) > 1:
        nxt = []
        for i in range(0, len(cur) - 1, 2):
            w = play(cur[i], cur[i + 1]); nxt.append(w)
            order.append(cur[i] if w == cur[i + 1] else cur[i + 1])
        if len(cur) % 2: nxt.append(cur[-1])
        cur = nxt
    return [cur[0]] + list(reversed(order))

def spearman(x, y):
    def rk(v):
        s = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v)
        for i, j in enumerate(s): r[j] = i
        return r
    a, b = rk(x), rk(y); n = len(x)
    return 1 - 6 * sum((a[i] - b[i]) ** 2 for i in range(n)) / (n * (n * n - 1))


def run(seed, cfg):
    """Один прогон на YEARS лет. Возвращает (true, R, N, drift_by_year)."""
    rng = random.Random(seed)
    true, att, R, N, T = {}, {}, {}, collections.Counter(), {}
    TOURN, CHANGES, DOWN = collections.Counter(), collections.Counter(), collections.Counter()
    nxt = 0
    def add():
        nonlocal nxt
        i = nxt; nxt += 1
        true[i] = rng.gauss(1000, TRUE_SD)
        u = rng.random()
        att[i] = (rng.uniform(.80, 1.0) if u < .25 else
                  rng.uniform(.35, .70) if u < .60 else
                  rng.uniform(.05, .30))
        R[i] = START
        T[i] = None
        return i
    START = cfg.get('START', 1000.0)
    per_year = cfg.get('PER_YEAR', PER_YEAR)
    # Приход и уход идут по ходу года, а не когортами: часть пула есть на старте,
    # остальные подтягиваются, каждый уходит в среднем через LIFE_YEARS.
    live = [add() for _ in range(int(POOL * START_SHARE))]
    p_leave = 1.0 / (LIFE_YEARS * per_year)
    arrivals = POOL * p_leave                      # чтобы пул держался около POOL
    drift = []

    for year in range(cfg['years']):
        for _ in range(per_year):
            live = [i for i in live if rng.random() > p_leave]
            k_new = int(arrivals) + (1 if rng.random() < arrivals % 1 else 0)
            if len(live) < POOL: live += [add() for _ in range(k_new)]
            u, c, cname = rng.random(), 0, 'main'
            for nm, p in CATS:
                c += p
                if u <= c: cname = nm; break
            field = [i for i in live if rng.random() < att[i]]
            if cname in ('main', 'major'):
                field = [i for i in field if rng.random() < 0.5 + 0.4 * (true[i] > 1000)]
            if len(field) < 8: continue
            size = 8
            while size * 2 <= len(field): size *= 2
            field = rng.sample(field, size)

            avg = sum(R[i] for i in field) / len(field)
            wf = 1 + FIELD_BETA * max(-1.0, min(1.0, (avg - START) / FIELD_SPAN))
            w = CATEGORY_W[cname] * wf

            def play(a, b):
                winner = a if rng.random() < p_true(true[a], true[b]) else b
                ra, rb = R[a], R[b]
                ka = cfg['K'](N[a]); kb = cfg['K'](N[b])
                e = 1 / (1 + 10 ** ((rb - ra) / cfg['SCALE']))
                sa = 1.0 if winner == a else 0.0
                R[a] = ra + ka * w * (sa - e)
                R[b] = rb - kb * w * (sa - e)
                N[a] += 1; N[b] += 1
                return winner

            before = {i: T[i] for i in field}
            places = (de if rng.random() < 0.7 else se)(field, play)
            for i in field:
                R[i] += cfg['PART']
                TOURN[i] += 1
            for pos, pid in enumerate(places, 1):
                R[pid] += cfg['PLACE'][cname].get(pos, 0)

            # тир пересчитывается один раз по итогам турнира, с окном на понижение.
            # GUARDS — окно для каждой границы отдельно (0 = защиты нет).
            bounds = cfg['BOUNDS']
            guards = cfg.get('GUARDS') or [cfg['GUARD']] * len(bounds)
            def tidx(r):
                t = 0
                for i2, x in enumerate(bounds):
                    if r >= x: t = i2 + 1
                return t
            for i in field:
                cur, prev = tidx(R[i]), before[i]
                if prev is None:
                    T[i] = tidx(START)
                    prev = T[i]
                new = cur if (cur >= prev or R[i] < bounds[prev - 1] - guards[prev - 1]) else prev
                if before[i] is not None and new != before[i]:
                    CHANGES[i] += 1
                    if new < before[i]: DOWN[i] += 1
                T[i] = new

        drift.append(statistics.mean(R[i] for i in live))

    return true, R, N, live, drift, CHANGES, DOWN, T


# выплаты кратны победе над равным (K/2 = 30 при K 60)
PLACE_FULL = {
    'fastcap': {1: 30, 2: 15},
    'main':    {1: 60, 2: 30, 3: 15},
    'major':   {1: 90, 2: 60, 3: 40, 4: 30, 5: 15, 6: 15},
}
def kconst(k):
    return lambda n: k

NAMES = ['C', 'B', 'A', 'S', 'S+']
BOUNDS = [900, 1100, 1300, 1500]
# окно понижения по каждой границе: на нижней его нет — защищать нечего
GUARDS = [0, 60, 60, 60]

def cfg_of(k=60, scale=800, part=5, pm=1, guard=60, years=1):
    return {'SCALE': scale, 'K': kconst(k), 'PART': part, 'START': 1000, 'years': years,
            'GUARD': guard, 'BOUNDS': BOUNDS, 'GUARDS': [0] + [guard] * (len(BOUNDS) - 1),
            'PLACE': {c: {q: v * pm for q, v in d.items()} for c, d in PLACE_FULL.items()}}

def tier_of(r):
    t = 0
    for i, x in enumerate(BOUNDS):
        if r >= x: t = i + 1
    return t

def measure(cfg, reps=12):
    """Населённость тиров, точность и частота смены тира.
    Тир берём присвоенный (с гистерезисом), а не пересчитанный по сырому рейтингу."""
    pop = collections.Counter(); vals = []; rhos = []; chg = []; dwn = []; climb = []
    for s in range(reps):
        true, R, N, live, _, CH, DW, T = run(s, cfg)
        act = [i for i in live if N[i] >= 4]
        if len(act) < 20: continue
        rhos.append(spearman([true[i] for i in act], [R[i] for i in act]))
        for i in act:
            pop[NAMES[T[i] if T[i] is not None else tier_of(R[i])]] += 1; vals.append(R[i])
        chg += [CH[i] / cfg['years'] for i in act]
        dwn += [DW[i] / cfg['years'] for i in act]
        weak = sorted(act, key=lambda i: true[i])[:max(1, len(act) // 4)]
        grind = [i for i in weak if N[i] >= 25]
        if grind: climb.append(sum((T[i] or 0) > 0 for i in grind) / len(grind))
    n = len(vals)
    return (dict((k, 100 * pop[k] / n) for k in NAMES), sorted(vals),
            statistics.mean(rhos), statistics.mean(chg), statistics.mean(dwn),
            statistics.mean(climb) if climb else float('nan'))

if __name__ == '__main__':
    print(f'пул {POOL}, {PER_YEAR} турниров в год, срок жизни игрока {LIFE_YEARS} г., '
          f'на старте {START_SHARE:.0%} пула')
    print(f'границы {BOUNDS}, старт 1000, SCALE 800, участие +5, места кратны K/2, окно = K\n')

    print('K задаёт ширину распределения (окно понижения едет за ним, окно = K):')
    print('  K     C     B     A     S     S+    rho    смен тира/год  вниз/год')
    for k in (30, 40, 50, 60, 70):
        p, vals, rho, ch, dw, cl = measure(cfg_of(k=k, guard=k))
        print(f'  {k:3}  ' + '  '.join(f'{p[x]:4.1f}' for x in NAMES) +
              f'   {rho:.3f}      {ch:.2f}        {dw:.2f}')

    for years in (1, 2):
        p, vals, rho, ch, dw, cl = measure(cfg_of(years=years), reps=25)
        q = lambda x: vals[int(x * len(vals))]
        print(f'\nчерез {years} г. при K=60, n={len(vals)}')
        h = collections.Counter(min(1700, max(800, int(v // 50 * 50))) for v in vals)
        for b in range(800, 1701, 50):
            pct = 100 * h[b] / len(vals)
            print(f'  {b:5}  {"#" * round(pct * 3):40} {pct:4.1f}%')
        print('  перцентили: ' + '  '.join(f'p{int(x*100)}={q(x):.0f}'
              for x in (.05, .10, .25, .50, .75, .90, .95, .99)))
        print('  тиры: ' + '  '.join(f'{x}={p[x]:.1f}%' for x in NAMES) +
              f'   rho={rho:.3f}  смен тира/год {ch:.2f} (вниз {dw:.2f})')
        print(f'  слабые, но много играющие, выбираются из C: {cl*100:.0f}%')

