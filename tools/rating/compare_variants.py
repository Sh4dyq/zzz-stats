"""Сравнение вариантов глобального рейтинга.

Участие +5 за сыгранный турнир — константа, в вариантах не участвует.

  I    K 50, граница C 950, окно 50, выплаты как в сезонной
  II   K 60, граница C 900, окно 60, выплаты как в сезонной
  III  K 60, выплаты кратные победе над равным (при K 60 это 30 очков):
       фасткап 30/15, обычный 60/30/15, крупный 90/60/40/30/15
       — считаем при обеих нарезках низа

Запуск: py tools/rating/compare_variants.py
"""
import collections, statistics
import global_sim as g
import settle_sim as s

PLACE_SEASON = g.PLACE_FULL
PLACE_MATCHED = {                      # кратно 30 = победа над равным при K 60
    'fastcap': {1: 30, 2: 15},                          # 1× / 0.5×
    'main':    {1: 60, 2: 30, 3: 15},                   # 2× / 1× / 0.5×
    'major':   {1: 90, 2: 60, 3: 40, 4: 30, 5: 15},     # 3× / 2× / 1.33× / 1× / 0.5×
}

# Окно понижения = K, один к одному: это ровно два поражения от равного (2 × K/2).
# Выплаты за места тоже кратны победе над равным (K/2) — вся шкала масштабируется вместе с K.
VARIANTS = [
    ('K60 окно60  C<950 (порог 890)  места кратные', 60, [950, 1100, 1300, 1500], 60, PLACE_MATCHED),
    ('K60 окно60  C<960 (порог 900)  места кратные', 60, [960, 1100, 1300, 1500], 60, PLACE_MATCHED),
    ('K50 окно50  C<950 (порог 900)  места сезонные', 50, [950, 1100, 1300, 1500], 50, PLACE_SEASON),
]


def pop_run(k, bounds, guard, place, years, reps=20):
    g.BOUNDS = bounds
    cfg = g.cfg_of(k=k, guard=guard, years=years)
    cfg['BOUNDS'] = bounds
    cfg['PLACE'] = place
    return g.measure(cfg, reps=reps)


def settle_run(k, bounds, guard, place, reps=40):
    s.K, s.BOUNDS, s.GUARD = float(k), bounds, guard
    s.PLACE_FULL = place
    return s.settled(reps=reps)


if __name__ == '__main__':
    print(f'пул {g.POOL}, {g.PER_YEAR} турниров в год, участие +5 везде\n')
    print('населённость тиров, точность и частота смены тира')
    print('вариант                                    гор.     C     B     A     S    S+    rho    смен/год  вниз/год')
    for name, k, b, guard, place in VARIANTS:
        for years in (1, 2):
            p, vals, rho, ch, dw, cl = pop_run(k, b, guard, place, years)
            print(f'{name:42} {years} г.  ' + '  '.join(f'{p[x]:4.1f}' for x in g.NAMES) +
                  f'   {rho:.3f}     {ch:.2f}      {dw:.2f}')

    print('\nмедиана и хвост рейтинга через год (сколько «стоит» верх)')
    for name, k, b, guard, place in VARIANTS:
        p, vals, rho, ch, dw, cl = pop_run(k, b, guard, place, 1)
        q = lambda x: vals[int(x * len(vals))]
        print(f'{name:42} med={q(.5):4.0f}  p90={q(.9):4.0f}  p99={q(.99):4.0f}  max={vals[-1]:4.0f}')

    print(f'\nдоля группы, стоящей в своём тире ({s.PER_GROUP * 5} игроков, по {s.PER_GROUP} на уровень)')
    for name, k, b, guard, place in VARIANTS:
        h = settle_run(k, b, guard, place)
        print(f'\n{name}')
        print('  турнир    ' + '     '.join(f'{x:>3}' for x in s.NAMES))
        for t in (4, 9, 14, 19, 29, 39):
            print(f'  {t+1:>5}     ' + '    '.join(f'{h[t][x]:4.0f}%' for x in s.NAMES))
