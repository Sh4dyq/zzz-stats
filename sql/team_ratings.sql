-- Ручные рейтинги дуо/трио (админка «Аналитика → Калибровка силы → Дуо/Трио»).
-- key = канонический состав "cid:ms|cid:ms[|cid:ms]" (cid из characters, сортировка по cid).
-- Шкалы 0-5 звёзд: stars_synergy (насколько синергичны) и stars_power (насколько сильны).
create table if not exists public.team_ratings (
  key text primary key,
  size int not null check (size in (2,3)),
  members jsonb not null,                 -- [{cid,ms}] ; A-ранги всегда ms=6
  stars_synergy int not null default 0 check (stars_synergy between 0 and 5),
  stars_power int not null default 0 check (stars_power between 0 and 5),
  note text not null default '',
  reviewed boolean not null default false,   -- проверено вручную: сбрасывает спорность, вне очереди
  updated_at timestamptz not null default now()
);

-- миграция для уже существующей таблицы
alter table public.team_ratings add column if not exists reviewed boolean not null default false;

alter table public.team_ratings enable row level security;

drop policy if exists team_ratings_read on public.team_ratings;
create policy team_ratings_read on public.team_ratings for select using (true);

drop policy if exists team_ratings_write on public.team_ratings;
create policy team_ratings_write on public.team_ratings for all to authenticated using (true) with check (true);

-- GRANT'ы обязательны для таблиц из сырого SQL, иначе 42501 (не только RLS).
grant select on public.team_ratings to anon, authenticated;
grant insert, update, delete on public.team_ratings to authenticated;
