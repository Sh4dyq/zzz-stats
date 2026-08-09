"""Проверка рейтинговой системы zzz-stats v2.0.

Воспроизводит все числа из docs/rating-system.md.
Модель: 80 игроков, 8-15 турниров за сезон, неравномерная явка,
полный сброс к 1000 каждый сезон.

    python3 verify.py
"""
import math, random, statistics, collections

# ---------------------------------------------------------------- конфигурация
START, SCALE, K = 1000.0, 600.0, 50.0
BOUND = [940, 1100, 1200, 1300]
NAMES = ['C', 'B', 'A', 'S', 'S+']
GUARD = 40
PARTICIPATION = 5   # разово за участие в турнире
CATEGORY_W = {'fastcap': 0.8, 'main': 1.0, 'major': 1.2}
FIELD_BETA, FIELD_SPAN = 0.10, 150.0
PLACE = {
    'fastcap': {1: 25, 2: 10},
    'main':    {1: 50, 2: 25, 3: 15},
    'major':   {1: 75, 2: 50, 3: 35, 4: 25, 5: 10, 6: 10},
}

# доля турниров каждой категории в сезоне
CATS = [('fastcap', .40), ('main', .50), ('major', .10)]

# ------------------------------------------------------------ параметры модели
TRUE_SD = 140.0        # оценка разброса силы пула (см. cv_spread.py)
POOL = 80
TOURN_RANGE = (8, 15)

def p_true(a, b):
    return 1 / (1 + 10 ** ((b - a) / 400))

def tier_idx(r):
    t = 0
    for i, x in enumerate(BOUND):
        if r >= x: t = i + 1
    return t

def tier(r):
    return NAMES[tier_idx(r)]

def settle(r, prev_idx):
    """Тир по итогам турнира. prev_idx — индекс тира до турнира, или None."""
    cur = tier_idx(r)
    if prev_idx is None or cur >= prev_idx:
        return cur
    return cur if r < BOUND[prev_idx - 1] - GUARD else prev_idx

# ------------------------------------------------------------------ сетки
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
    return list(reversed(order))          # 1-е место первым

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

# ------------------------------------------------------------------ симуляция
def make_pool(rng):
    true, att = {}, {}
    for i in range(POOL):
        true[i] = rng.gauss(1000, TRUE_SD)
        u = rng.random()
        att[i] = (rng.uniform(.80, 1.0) if u < .25 else
                  rng.uniform(.35, .70) if u < .60 else
                  rng.uniform(.05, .30))
    return true, att

def season(seed):
    """Один сезон. Возвращает (истинная сила, рейтинги, число встреч, статистика)."""
    rng = random.Random(seed)
    true, att = make_pool(rng)
    R = {i: START for i in range(POOL)}
    N = collections.Counter()
    T = {i: None for i in range(POOL)}
    stat = {'tier_changes': 0, 'intra_peaks': 0, 'tournaments': 0}

    for _ in range(rng.randint(*TOURN_RANGE)):
        u, c, cname = rng.random(), 0, 'main'
        for nm, p in CATS:
            c += p
            if u <= c: cname = nm; break
        field = [i for i in range(POOL) if rng.random() < att[i]]
        if cname in ('main', 'major'):
            field = [i for i in field if rng.random() < 0.5 + 0.4 * (true[i] > 1000)]
        if len(field) < 8: continue
        size = 8
        while size * 2 <= len(field): size *= 2
        field = rng.sample(field, size)
        stat['tournaments'] += 1

        avg = sum(R[i] for i in field) / len(field)
        wf = 1 + FIELD_BETA * max(-1.0, min(1.0, (avg - 1000) / FIELD_SPAN))
        w = CATEGORY_W[cname] * wf
        before = {i: tier_idx(R[i]) for i in field}
        peak = dict(before)

        def play(a, b):
            winner = a if rng.random() < p_true(true[a], true[b]) else b
            ra, rb = R[a], R[b]
            d = K * w * ((1.0 if winner == a else 0.0) - 1 / (1 + 10 ** ((rb - ra) / SCALE)))
            R[a] = ra + d; R[b] = rb - d
            N[a] += 1; N[b] += 1
            peak[a] = max(peak[a], tier_idx(R[a]))
            peak[b] = max(peak[b], tier_idx(R[b]))
            return winner

        places = (de if rng.random() < 0.7 else se)(field, play)
        for i in field:
            R[i] += PARTICIPATION   # в симуляции техлузов нет: играют все
        for pos, pid in enumerate(places, 1):
            R[pid] += PLACE[cname].get(pos, 0)

        for i in field:
            if peak[i] > before[i] and tier_idx(R[i]) <= before[i]:
                stat['intra_peaks'] += 1
            new = settle(R[i], T[i])
            if T[i] is not None and new != T[i]:
                stat['tier_changes'] += 1
            T[i] = new
    return true, R, N, stat

def spearman(x, y):
    def rk(v):
        s = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v)
        for i, j in enumerate(s): r[j] = i
        return r
    a, b = rk(x), rk(y); n = len(x)
    return 1 - 6 * sum((a[i] - b[i]) ** 2 for i in range(n)) / (n * (n * n - 1))

# ---------------------------------------------------------------- сценарии
def scenario(seq, opp_mu, place=0, reps=800):
    """Средний итог серии от старта 1000 против состава со средним opp_mu."""
    out = []
    for s_ in range(reps):
        rng = random.Random(s_)
        r = START
        field = [opp_mu - 40 + 12 * i for i in range(len(seq))]
        for s, mu in zip(seq, field):
            o = rng.gauss(mu, 60)
            r += K * (s - 1 / (1 + 10 ** ((o - r) / SCALE)))
        out.append(r + place)
    return statistics.mean(out)

# ------------------------------------------------------------------- вывод
def main(seeds=220):
    print(f"Конфигурация: SCALE={SCALE:.0f}, K={K:.0f}, лестница {BOUND}, окно {GUARD}\n")

    S32 = [1, 1, 1, 1, 0, 1, 1, 1, 1, 1]
    S16 = [1] * 5
    print("Сценарии от старта 1000:")
    for label, seq, mu, pts in [
        ('2-0',                 [1, 1],                   1000, 0),
        ('3-0',                 [1, 1, 1],                1000, 0),
        ('5-1',                 [1, 1, 1, 0, 1, 1],       1000, 0),
        ('2-е место фасткапа',  [1, 1, 1, 0],             1000, 10),
        ('чемпион фасткапа',    S16,                      1000, 25),
        ('2-е место обычного',  [1,1,1,1,0,1,1,1,0],      1010, 25),
        ('чемпион обычного',    S32,                      1010, 50),
        ('2-е место крупного',  [1,1,1,1,0,1,1,1,0],      1030, 50),
        ('чемпион крупного',    S32,                      1030, 75),
    ]:
        v = scenario(seq, mu, pts)
        print(f"  {label:<22}{v:7.0f}  {tier(v)}")

    vals, cors, ch, ip, tn = [], [], [], [], []
    for sd in range(seeds):
        true, R, N, st = season(sd)
        ids = [i for i in R if N[i] >= 3]
        if len(ids) < 10: continue
        vals += [R[i] for i in ids]
        cors.append(spearman([true[i] for i in ids], [R[i] for i in ids]))
        ch.append(st['tier_changes']); ip.append(st['intra_peaks']); tn.append(st['tournaments'])
    vals.sort(); n = len(vals)
    q = lambda p: vals[min(n - 1, int(p / 100 * n))]
    seg, prev = [], 0
    for x in BOUND:
        cur = 100 * sum(1 for v in vals if v < x) / n; seg.append(cur - prev); prev = cur
    seg.append(100 - prev)

    print(f"\nРаспределение ({seeds} сезонов, {statistics.mean(tn):.1f} турниров в среднем):")
    print("  " + "  ".join(f"{t}={x:.1f}%" for t, x in zip(NAMES, seg))
          + f"  | выше B = {sum(seg[2:]):.1f}%")
    print(f"  Spearman={statistics.mean(cors):.3f}  sd={statistics.pstdev(vals):.0f}")
    print(f"  p5={q(5):.0f} p25={q(25):.0f} медиана={q(50):.0f} p75={q(75):.0f} "
          f"p90={q(90):.0f} p95={q(95):.0f} max={vals[-1]:.0f}")
    print(f"\nСмен тира за сезон на весь пул: {statistics.mean(ch):.1f}")
    print(f"Заходов в тир выше по ходу турнира без закрепления: {statistics.mean(ip):.1f}")

    print("\nОбмен очками (середины тиров, множитель 1.0):")
    mids = [('C', 900), ('B', 1000), ('A', 1150), ('S', 1250), ('S+', 1400)]
    print("  победитель \\ проигр. |" + "".join(f"{nm:>8}" for nm, _ in mids))
    for na, ra in mids:
        row = "".join(f"{K * (1 - 1/(1 + 10**((rb - ra)/SCALE))):>+8.1f}" for _, rb in mids)
        print(f"  {na:>20} |{row}")

    print("\nСколько поражений до вылета (окно 40):")
    for label, gap in (('от игрока на тир ниже', -150), ('от равного', 0),
                       ('от игрока на тир выше', 150)):
        loss = K * (1 / (1 + 10 ** (gap / SCALE)))
        print(f"  {label:<24} теряешь {loss:.0f} за матч -> {math.ceil(GUARD / loss)} поражений")

if __name__ == '__main__':
    main()
