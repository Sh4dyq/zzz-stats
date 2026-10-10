"""Собирает js/data/events.js из выгрузки листа «События» (JSON ответа Sheets API values.get: {"range":..., "values":[[...]]}).
Использование: python tools/sheet-to-events.py part1.json [part2.json ...]
Строки L-xx: Id, Название, Регион, Триггер, Описание, Выбор A, Выбор Б/В, Статус, Доп. вариант.
Строки R-xx: Id, Название, Тип, Цель, Эффект, Сила, Редкость, Статус, Примечания."""
import json, re, sys, os
REG = {'Шестая улица': 'Ш', 'Блейзвуд': 'Б', 'Вейфей': 'В', 'Розкелифер': 'Р', 'Любой': '*'}
SIGN = {'Положительный': '+', 'Отрицательный': '-', 'Случайный': '±'}
RAR = {'Обычное': 60, 'Редкое': 30, 'Очень редкое': 10}
rows = []
for f in sys.argv[1:]:
    rows += json.load(open(f, encoding='utf-8'))['values']
L, R = [], []
def hard(s):
    m = re.search(r'Сложность:\s*(.+)$', s or '')
    return m.group(1).strip() if m else ''
for r in rows:
    r = (r + [''] * 9)[:9]
    if re.match(r'^L-\d+', r[0]):
        extra = re.sub(r';?\s*(Сложность|Нужен статус):.*$', '', r[8]).strip()
        e = dict(id=r[0], name=r[1], region=REG.get(r[2], '*'), trig=r[3], desc=r[4], a=r[5], b=r[6], hard=hard(r[8]))
        m = re.match(r'^\[(.+?)\]\s*(.+)$', extra)
        if m: e['cond'] = m.group(1); e['c'] = m.group(2)
        if 'только лидер' in r[3]: e['only'] = 'leader'
        if 'только последний' in r[3]: e['only'] = 'last'
        L.append(e)
    elif re.match(r'^R-\d+', r[0]):
        e = dict(id=r[0], name=r[1], sign=SIGN.get(r[2], '±'), target=r[3], desc=r[4], power=r[5], w=RAR.get(r[6], 30), note=re.sub(r';?\s*Сложность:.*$', '', r[8]).strip(), hard=hard(r[8]))
        n = r[8]
        if 'только лидеру' in n: e['only'] = 'leader'
        if 'только последнему' in n: e['only'] = 'last'
        if re.search(r'Нет предметов[^.]*не выпадает', n): e['need'] = 'items'
        if 'У соперников нет предметов' in n: e['need'] = 'oppItems'
        if 'Нет аномальных предметов' in n: e['need'] = 'anomItems'
        R.append(e)
out = '/* События из листа «События» Google-таблицы. Сгенерировано tools/sheet-to-events.py — не править руками. */\n'
out += 'window.NP = window.NP || {};\nNP.EVENTS = ' + json.dumps({'L': L, 'R': R}, ensure_ascii=False, indent=0) + ';\n'
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'data', 'events.js')
open(dst, 'w', encoding='utf-8').write(out)
print('L:', len(L), 'R:', len(R))
