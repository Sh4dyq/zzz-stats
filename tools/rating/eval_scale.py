"""Подбор SCALE по реальным встречам, а не по симуляции.

Идём по турнирам в хронологии, перед каждой встречей считаем предсказание
(ожидание победы по текущим рейтингам) и сверяем с фактом. Меряем log-loss
и долю угаданных. Начисления — как в docs/rating-global.md.

Данные тянутся из Supabase (те же, что видит админка).
Запуск: py tools/rating/eval_scale.py
"""
import json, math, urllib.request, collections

SB = 'https://zoavnckfbfiejxfjakue.supabase.co/rest/v1'
KEY = 'sb_publishable_37RZBsmdp3O1i795EuEfeg_vFpdPTFZ'

START, K, PART = 1000.0, 60.0, 5
CATEGORY_W = {'fastcap': 0.8, 'main': 1.0, 'major': 1.2}
FIELD_BETA, FIELD_SPAN = 0.10, 150.0
PLACE = {
    'fastcap': {1: 30, 2: 15},
    'main':    {1: 60, 2: 30, 3: 15},
    'major':   {1: 90, 2: 60, 3: 40, 4: 30, 5: 15, 6: 15},
}


def get(path):
    req = urllib.request.Request(f'{SB}/{path}',
                                 headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})
    return json.load(urllib.request.urlopen(req))


def load():
    tours = [t for t in get('tournaments?select=id,name,event_date,sort_order,rating_category')
             if t.get('rating_category')]
    tours.sort(key=lambda t: (t.get('event_date') or '9999', -(t.get('sort_order') or 0)))
    enc = get('encounters?select=tournament_id,player1_id,player2_id,winner_id,stage_key,'
              'sort_order,created_at&limit=5000')
    by_t = collections.defaultdict(list)
    for e in enc:
        if e.get('winner_id'):
            by_t[e['tournament_id']].append(e)
    for tid in by_t:
        by_t[tid].sort(key=lambda e: (e.get('stage_key') != 's1',
                                      str(e.get('created_at') or ''),
                                      -(e.get('sort_order') or 0)))
    return tours, by_t


def evaluate(scale, tours, by_t, k=K, warmup=2):
    """log-loss и точность. warmup — сколько встреч игрока не оцениваем (он ещё на старте)."""
    R = collections.defaultdict(lambda: START)
    N = collections.Counter()
    per = []                  # log-loss каждой оценённой встречи — для оценки шума
    hit = 0.0
    for t in tours:
        enc = by_t.get(t['id']) or []
        if not enc: continue
        ids = {p for e in enc for p in (e['player1_id'], e['player2_id'])}
        avg = sum(R[i] for i in ids) / len(ids)
        w = CATEGORY_W.get(t['rating_category'], 1.0) * (
            1 + FIELD_BETA * max(-1.0, min(1.0, (avg - START) / FIELD_SPAN)))
        for e in enc:
            a, b, win = e['player1_id'], e['player2_id'], e['winner_id']
            ea = 1 / (1 + 10 ** ((R[b] - R[a]) / scale))
            sa = 1.0 if win == a else 0.0
            if N[a] >= warmup and N[b] >= warmup:
                p = min(max(ea, 1e-6), 1 - 1e-6)
                per.append(-(sa * math.log(p) + (1 - sa) * math.log(1 - p)))
                # ничья предсказания (p ровно 0.5) — половина попадания, не целое
                hit += 0.5 if abs(p - .5) < 1e-9 else float((p > .5) == (sa == 1))
            d = round(k * w * (sa - ea))
            R[a] += d; R[b] -= d
            N[a] += 1; N[b] += 1
        for i in ids:
            R[i] += PART
    return per, hit / len(per), len(per)


if __name__ == '__main__':
    tours, by_t = load()
    total = sum(len(v) for v in by_t.values())
    print(f'турниров с категорией: {len(tours)}, встреч с победителем: {total}')
    print('(без очков за места: итоговые места берёт сетка, здесь они на предсказание не влияют)\n')
    import statistics
    base = None
    print('SCALE   log-loss   угадано   разница с 600 (± шум)')
    for scale in (300, 400, 500, 600, 800, 1000, 1600, 10 ** 6):
        per, acc, cnt = evaluate(scale, tours, by_t)
        if scale == 600: base = per
        name = 'без Эло' if scale == 10 ** 6 else str(scale)
        diff = ''
        if base is not None and scale != 600:
            d = [x - y for x, y in zip(per, base)]
            se = statistics.pstdev(d) / len(d) ** 0.5
            diff = f'{statistics.mean(d):+.4f} ± {1.96*se:.4f}'
        print(f'{name:>7}   {statistics.mean(per):.4f}     {acc*100:5.1f}%    {diff}')
    print(f'\nвстреч в оценке: {cnt} — на таком объёме разница ниже ±0.03 неразличима')

    print('\nто же при K 50 и K 70 — проверка, что выбор SCALE от K не зависит:')
    for k in (50, 60, 70):
        row = []
        for scale in (400, 600, 800, 1200):
            per, acc, cnt = evaluate(scale, tours, by_t, k=k)
            row.append(f'{scale}: {statistics.mean(per):.4f}')
        print(f'  K {k}:  ' + '   '.join(row))
