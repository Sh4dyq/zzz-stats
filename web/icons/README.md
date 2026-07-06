# Иконки zzz-stats

Helper-модуль: `web/icons.js`. Все функции имеют graceful fallback —
если файл отсутствует, показывается прежний текст/цвет. Поэтому можно
докладывать файлы постепенно, сайт не сломается.

## Статические иконки (положить файлы сюда)

Формат: **WebP** (текущий) или PNG, квадратные, ~64px (отображаются 20×32px).
Расширение задаётся `IC_EXT` в `web/icons.js`. Имена строго как ниже (регистр важен).

### rarity/ — редкость (2 файла)
- `S.png`
- `A.png`

### role/ — роли (6 файлов)
- `atk.png`   (Attack)
- `stun.png`  (Stun)
- `rupt.png`  (Rupture)
- `sup.png`   (Support)
- `def.png`   (Defense)
- `ano.png`   (Anomaly)

### element/ — атрибуты (6 файлов)
- `ice.png`       (Лёд)
- `fire.png`      (Огонь)
- `electric.png`  (Электро)
- `physical.png`  (Физический)
- `ether.png`     (Эфир)
- `wind.png`      (Ветер)

## Динамические картинки (через Supabase Storage, не сюда)

`characters/` и `amplifiers/` здесь — заглушки. Портреты/иконки
персонажей и картинки амплификаторов грузятся в Supabase Storage (бакет `icons`)
через админку и пишутся в колонки БД (characters.portrait_url / icon_url,
signatures.image_url). В репо их не кладём.
