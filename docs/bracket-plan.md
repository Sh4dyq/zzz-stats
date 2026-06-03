# План: страница сеток (`bracket.html`)

Цель: полноценная страница турнирных сеток в фирменном стиле сайта. Сначала
подтягиваем **реальные** сетки с Challonge, в перспективе — собственный движок
генерации/продвижения сеток, который делает Challonge ненужным.

Связано: косты/результаты турниров (`tournament_results` сейчас нет — сетки
закроют пробел с местами/призами, которые пока глобальные и ручные на `players`).

---

## Что уже есть в БД

- `tournaments` — **нет** колонки `challonge_url` (ссылка на Challonge сейчас
  захардкожена на главной: `challonge.com/ru/NSPR6`).
- `encounters` — Bo2: `winner_id`, `stage`, `sort_order`, `played_at`.
- `matches` — отдельные матчи внутри встречи.
- **Нет** таблицы результатов per-tournament (место/приз). Подиум на главной
  сейчас считается по числу побед во встречах последнего завершённого турнира.

Ограничения стека: статика + Supabase, без своего бэкенда. Прямые запросы к
внешним API из браузера упираются в CORS (как с draft API) → **нужен прокси**.

---

## Фаза 1 — рендер своей сетки из данных Challonge (рекомендуемый старт)

Новая страница `bracket.html` + пункт «Сетка» в навигации главной и статистики.

### 1.1 Прокси (обязателен)
API-ключ Challonge нельзя светить в статике.
- **Supabase Edge Function** `challonge-proxy`: хранит ключ в секретах, проксирует
  `GET /v1/tournaments/{id}.json?include_participants=1&include_matches=1`.
- Кэш в таблицу `bracket_cache(tournament_id, json, fetched_at)` — чтобы не бить
  API на каждый заход и иметь данные при недоступности Challonge.
- Опционально: периодический синк (по кнопке в админке или по расписанию).

### 1.2 Модель Challonge → наша
- `participants[]`: `id → name`, `seed`, `final_rank`.
- `matches[]`: `round`, `player1_id`, `player2_id`, `winner_id`, `scores_csv`,
  `state`, `identifier`/`group_id`. Для double-elimination `round < 0` = нижняя
  сетка.
- Маппинг challonge-участник → `players.id` по нику (как `resolvePlayerNick`).

### 1.3 Рендер
- Свой компонент в фирменном стиле (красно-розовый градиент, Saira Condensed).
- Колонки = раунды. Для DE — верхняя + нижняя сетки + гранд-финал.
- Победитель ветки подсвечен; счёт из `scores_csv`.
- Адаптив: на мобиле вертикальный layout / горизонтальный скролл.

### 1.4 Бонус-синк — точные места и призы
При синке писать `final_rank` участников в новую таблицу:

```
tournament_results(tournament_id, player_id, place, prize)
```

→ подиум главной и вкладка «Игроки → Разное» станут **точными per-tournament**
(сейчас место/приз — глобальные ручные поля на `players`). Это устраняет
дублирование ручного ввода в админке.

### Фолбэк без кода
Встроить `iframe` `challonge.com/ru/<slug>/module` — мгновенно, но чужой дизайн.
Держать как запасной вариант, пока прокси/рендер не готовы.

---

## Фаза 2 — собственный движок сеток (на будущее, без Challonge)

Таблицы:
```
brackets(tournament_id, type 'SE'|'DE', settings)
bracket_nodes(bracket_id, round, slot, match_id?, player_id?,
              next_win_node, next_lose_node)
```

- Генератор сеяния: seeds → bye, расстановка по сетке.
- Узел сетки ссылается на `encounter`; сохранение результата встречи
  автоматически двигает игрока по рёбрам `next_win_node` / `next_lose_node`.
- Админка: создать сетку из участников турнира, drag-seed, авто-продвижение по
  мере сохранения встреч. Это делает Challonge ненужным.
- Большой объём — делать только когда Фаза 1 устаканится.

---

## Рекомендуемый порядок работ

1. Edge Function `challonge-proxy` + секрет с ключом.
2. Таблицы `bracket_cache`, `tournament_results`; колонка `tournaments.challonge_url`.
3. `bracket.html` + рендер из реальных `matches`/`participants` (Фаза 1).
4. Кнопка синка в админке → запись `tournament_results`; переключить подиум
   главной и «Игроки → Разное» на эти точные данные.
5. (Потом) Фаза 2 — свой движок.

---

## Фаза 2 — СОБСТВЕННЫЙ ДВИЖОК СЕТОК (детальный план, начато 2026-06-03)

Цель: создавать и вести полностью рабочую сетку независимо от Challonge.
Challonge остаётся как основной/референс; наш движок дублирует его функции.

### Шаг 1 — Схема БД (`sql/add_bracket_engine.sql`)
- `brackets(id uuid pk, tournament_id uuid fk, type text SE|DE, size int,
  settings jsonb, created_at)`. settings: {third_place, gf_reset,...}.
- `bracket_nodes(id uuid pk, bracket_id uuid fk, part text W|L|GF, round int,
  slot int, identifier int, player1_id uuid?, player2_id uuid?, seed1 int?,
  seed2 int?, is_bye bool, encounter_id uuid?, winner_id uuid?,
  next_win_node uuid?, next_win_slot int, next_lose_node uuid?,
  next_lose_slot int, created_at)`.
- RLS read-all/write-auth + ОБЯЗАТЕЛЬНО GRANT'ы (иначе 42501).

### Шаг 2 — Движок `web/bracket-engine.js` (window.BracketEngine, чистые функции)
- `generate(type, size)` → массив node-объектов с рёбрами (next_win/lose +
  slot). SE: round1 = size/2 матчей, далее /2. DE: верхняя (как SE) +
  нижняя (2(k-1) раундов: c,c,c/2,c/2,…,1,1) + гранд-финал.
- `seedPlayers(nodes, participants)` — расставляет seed1/2 по seedSlots,
  BYE если seed>N → авто-победа (winner предзаполнен, is_bye).
- `advance(nodes, nodeId, winnerId)` — ставит winner, толкает победителя в
  next_win_node[slot], проигравшего (DE) в next_lose_node[slot]; каскад по BYE.
- Экспорт и для браузера, и для node (юнит-тест генератора).

### Шаг 3 — Админка (web/tournaments.js, openBracketEditor)
- Кнопка «⚙ Сгенерировать сетку» (из участников турнира) → generate+seed →
  bulk-insert bracket_nodes. Предупреждение о перезаписи.
- Рендер нод-сетки (переиспользовать .sk-* стили) с выбором победителя в ноде →
  advance() → обновить изменённые ноды в БД. Привязка ноды к encounter
  (опц.) для деталей матча.

### Шаг 4 — Публичная bracket.html
- Грузить bracket_nodes; приоритет источника: свой движок (если есть bracket) →
  Challonge-кэш → encounters-фолбэк → каркас. Бейдж источника «Своя сетка».
- nodesToModel(nodes) → та же {rounds:[{name,matches}]} → renderRounds без правок.

### Порядок: Шаг1+2 (фундамент, тестируемо) → Шаг3 → Шаг4.
