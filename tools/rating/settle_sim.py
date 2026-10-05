"""Как быстро игроки расходятся по своим тирам.

Сцена: 120 игроков, по 24 на каждый уровень игры (C, B, A, S, S+), явка
неравномерная — как в global_sim. Состав закрытый: все существуют с первого
турнира, иначе «своё место» новичка нечем мерить. Смотрим, через сколько
турниров рейтинг разводит группы по нужным тирам.

Константы — из docs/rating-global.md. Запуск: py tools/rating/settle_sim.py
"""
import random, statistics, collections
from global_sim import de, se, p_true, CATEGORY_W, FIELD_BETA, FIELD_SPAN, PLACE_FULL

START, SCALE, K, PART, GUARD = 1000.0, 800.0, 60.0, 5, 60
BOUNDS = [900, 1100, 1300, 1500]
NAMES = ['C', 'B', 'A', 'S', 'S+']
CATS = [('fastcap', .40), ('main', .50), ('major', .10)]
PER_GROUP = 24           # 120 игроков на пять уровней
TOURNAMENTS = 40         # примерно год сцены
REPS = 40
GUARD_EARNED_ONLY = False   # True — окно понижения не действует на стартовый тир
GUARDS = [0, 60, 60, 60]    # окно по каждой границе; на нижней его нет

# Истинная сила под каждый тир. Эло на SCALE растягивает разницу в силе
# в SCALE/400 раз, поэтому центр тира переводим обратно делением на этот множитель.
CENTER = {'C': 850, 'B': 1000, 'A': 1200, 'S': 1400, 'S+': 1600}
TRUE = {g: 1000 + (CENTER[g] - 1000) / (SCALE / 400) for g in NAMES}


def tier_of(r):
    t = 0
    for i, x in enumerate(BOUNDS):
        if r >= x: t = i + 1
    return t


def run(seed):
    """Возвращает историю: по турнирам — рейтинги и присвоенные тиры каждой группы."""
    rng = random.Random(seed)
    ids = [(g, j) for g in NAMES for j in range(PER_GROUP)]
    true = {i: rng.gauss(TRUE[i[0]], 25) for i in ids}   # разброс внутри группы
    att = {}                                             # явка, как в global_sim
    for i in ids:
        u = rng.random()
        att[i] = (rng.uniform(.80, 1.0) if u < .25 else
                  rng.uniform(.35, .70) if u < .60 else
                  rng.uniform(.05, .30))
    R = {i: START for i in ids}
    T = {i: None for i in ids}
    earned = {i: False for i in ids}     # тир получен игрой, а не выдан на старте
    NM = collections.Counter()
    hist = []

    for _ in range(TOURNAMENTS):
        u, c, cname = rng.random(), 0, 'main'
        for nm, p in CATS:
            c += p
            if u <= c: cname = nm; break
        field = [i for i in ids if rng.random() < att[i]]
        if cname in ('main', 'major'):
            field = [i for i in field if rng.random() < 0.5 + 0.4 * (true[i] > 1000)]
        if len(field) < 8: continue
        size = 8
        while size * 2 <= len(field): size *= 2
        field = rng.sample(field, size)
        avg = sum(R[i] for i in field) / len(field)
        w = CATEGORY_W[cname] * (1 + FIELD_BETA * max(-1.0, min(1.0, (avg - START) / FIELD_SPAN)))

        def play(a, b):
            winner = a if rng.random() < p_true(true[a], true[b]) else b
            NM[a] += 1; NM[b] += 1
            ra, rb = R[a], R[b]
            e = 1 / (1 + 10 ** ((rb - ra) / SCALE))
            sa = 1.0 if winner == a else 0.0
            d = round(K * w * (sa - e))
            R[a] = ra + d; R[b] = rb - d
            return winner

        places = (de if rng.random() < 0.7 else se)(field, play)
        for i in field: R[i] += PART
        for pos, pid in enumerate(places, 1):
            R[pid] += PLACE_FULL[cname].get(pos, 0)

        for i in field:                      # тир — один раз по итогам турнира
            cur = tier_of(R[i])
            prev = T[i] if T[i] is not None else tier_of(START)
            # окно понижения защищает только заработанный тир; стартовый B — нет,
            # иначе слабому надо провалиться на 180 очков, чтобы попасть в C
            g = (GUARDS[prev - 1] if GUARDS else GUARD) if (earned[i] or not GUARD_EARNED_ONLY) else 0
            T[i] = cur if (cur >= prev or R[i] < BOUNDS[prev - 1] - g) else prev
            if T[i] != tier_of(START): earned[i] = True
        hist.append(({i: R[i] for i in ids}, {i: T[i] for i in ids}, dict(NM)))
    return hist


def settled(reps=REPS, min_games=4):
    """Доля группы, стоящей в своём тире, по номеру турнира. Только сыгравшие."""
    want = {g: NAMES.index(g) for g in NAMES}
    hit = [collections.Counter() for _ in range(TOURNAMENTS)]
    tot = [collections.Counter() for _ in range(TOURNAMENTS)]
    for seed in range(reps):
        for t, (R, T, NM) in enumerate(run(seed)):
            for g in NAMES:
                for j in range(PER_GROUP):
                    if NM.get((g, j), 0) < min_games: continue
                    tot[t][g] += 1
                    hit[t][g] += T[(g, j)] == want[g]
    return [{g: (100 * hit[t][g] / tot[t][g] if tot[t][g] else float('nan')) for g in NAMES}
            for t in range(TOURNAMENTS)]


if __name__ == '__main__':
    h = settled()
    print(f'{PER_GROUP * 5} игроков, по {PER_GROUP} на уровень, неравномерная явка, {REPS} прогонов')
    print('истинная сила групп:', ', '.join(f'{g}={TRUE[g]:.0f}' for g in NAMES))
    print('\nдоля группы, стоящей в СВОЁМ тире:')
    print('  турнир    ' + '     '.join(f'{g:>3}' for g in NAMES))
    for t in (4, 9, 14, 19, 29, 39):
        print(f'  {t+1:>5}     ' + '    '.join(f'{h[t][g]:4.0f}%' for g in NAMES))
    raise SystemExit

    want = {g: NAMES.index(g) for g in NAMES}
    # доля игроков группы, попавших в свой тир, по номеру турнира
    hit = [collections.Counter() for _ in range(TOURNAMENTS)]
    rate = [collections.defaultdict(list) for _ in range(TOURNAMENTS)]
    first_ok, stable_ok = collections.defaultdict(list), collections.defaultdict(list)

    for s in range(REPS):
        h = run(s)
        ok_since = {g: None for g in NAMES}
        for t, (R, T) in enumerate(h):
            for g in NAMES:
                grp = [(g, j) for j in range(PER_GROUP)]
                k = sum(T[i] == want[g] for i in grp)
                hit[t][g] += k
                rate[t][g] += [R[i] for i in grp]
                if k == PER_GROUP:
                    if ok_since[g] is None: ok_since[g] = t
                else:
                    ok_since[g] = None
        for g in NAMES:
            fo = next((t for t, (R, T) in enumerate(h)
                       if all(T[(g, j)] == want[g] for j in range(PER_GROUP))), None)
            if fo is not None: first_ok[g].append(fo + 1)
            if ok_since[g] is not None: stable_ok[g].append(ok_since[g] + 1)

    print(f'25 игроков (по {PER_GROUP} на уровень), все ходят на все турниры, {REPS} прогонов')
    print('истинная сила групп:', ', '.join(f'{g}={TRUE[g]:.0f}' for g in NAMES))
    print('\nдоля игроков группы, стоящих в СВОЁМ тире, по номеру турнира:')
    print('  турнир   ' + '     '.join(f'{g:>3}' for g in NAMES))
    for t in (0, 1, 2, 3, 4, 5, 7, 9, 14, 19, 29, 39):
        print(f'  {t+1:>5}    ' + '    '.join(
            f'{100*hit[t][g]/(REPS*PER_GROUP):4.0f}%' for g in NAMES))

    print('\nмедианный рейтинг группы:')
    print('  турнир   ' + '     '.join(f'{g:>4}' for g in NAMES))
    for t in (0, 2, 4, 9, 19, 39):
        print(f'  {t+1:>5}    ' + '   '.join(
            f'{statistics.median(rate[t][g]):5.0f}' for g in NAMES))

    print('\nсколько турниров до того, как ВСЯ группа впервые оказалась в своём тире:')
    for g in NAMES:
        v = first_ok[g]
        print(f'  {g:>3}: медиана {statistics.median(v):.0f}   '
              f'(получилось в {100*len(v)/REPS:.0f}% прогонов)' if v else f'  {g:>3}: не случилось')
    print('\nи после какого турнира это уже не разваливалось до конца:')
    for g in NAMES:
        v = stable_ok[g]
        print(f'  {g:>3}: медиана {statistics.median(v):.0f}   '
              f'(устоялось в {100*len(v)/REPS:.0f}% прогонов)' if v else f'  {g:>3}: не устоялось')
