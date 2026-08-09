-- Рейтинг игроков (docs/rating-system.md): категория турнира + снимок таблицы Elo.
-- Пересчёт делает админка кнопкой «Пересчитать рейтинг» (web/js/rating-build.js).

-- Категория турнира: множитель к приросту Эло. NULL = турнир в рейтинг не идёт.
alter table tournaments add column if not exists rating_category text
  check (rating_category in ('fastcap','main','major'));

comment on column tournaments.rating_category is
  'fastcap ×0.8 / main ×1.0 (сюда же квалификации) / major ×1.2; NULL — не учитывать в рейтинге';

-- Снимок рейтинга. Ключ — ник, потому что часть участников сеток challonge
-- в players отсутствует (играли раз и не заводились).
create table if not exists player_ratings (
  nickname    text primary key,
  player_id   uuid references players(id) on delete set null,
  rating      int  not null,          -- итог: base_rating + adjust
  base_rating int  not null default 0,-- чистая формула, без ручных правок
  adjust      int  not null default 0,-- сумма ручных правок
  reason      text,                   -- причины правок через «;» (для показа на сайте)
  tier        text not null,
  wins        int  not null default 0,
  losses      int  not null default 0,
  tours       int  not null default 0,
  updated_at  timestamptz not null default now()
);

-- Ручные правки рейтинга. Формула их не знает: они прибавляются поверх и всегда
-- видны отдельной колонкой с причиной (docs/rating-system.md §6).
create table if not exists rating_adjustments (
  id         bigserial primary key,
  nickname   text not null,
  delta      int  not null,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index if not exists rating_adjustments_nick on rating_adjustments(nickname);

-- Константы системы одной строкой: правятся в админке, читаются при пересчёте.
-- Пусто/NULL по ключу = берётся значение по умолчанию из web/js/rating.js.
create table if not exists rating_config (
  id         int primary key default 1 check (id = 1),
  cfg        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into rating_config (id, cfg) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- read = всем, write = только авторизованным. GRANT'ы обязательны:
-- без них RLS не спасёт, PostgREST вернёт 42501.
do $$
declare t text;
begin
  foreach t in array array['player_ratings','rating_adjustments','rating_config'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "%s read" on %I', t, t);
    execute format('create policy "%s read" on %I for select to anon, authenticated using (true)', t, t);
    execute format('drop policy if exists "%s write" on %I', t, t);
    execute format('create policy "%s write" on %I for all to authenticated using (true) with check (true)', t, t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

grant usage, select on sequence rating_adjustments_id_seq to authenticated;
