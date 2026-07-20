-- Мусорные составы (админка «Аналитика → Спарринг»): дуо/трио, которые не должны
-- предлагаться в спарринге и не попадают в автозаполнение дуо/трио.
-- key = отсортированные cid через "|" (без конст: мусор от майндскейпа не зависит).
-- Пара, помеченная мусором, штрафует и тройки, которые её содержат (проверка по подмножествам).
create table if not exists public.team_blacklist (
  key text primary key,
  size int not null check (size in (2,3)),
  cids jsonb not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.team_blacklist enable row level security;

drop policy if exists team_blacklist_read on public.team_blacklist;
create policy team_blacklist_read on public.team_blacklist for select using (true);

drop policy if exists team_blacklist_write on public.team_blacklist;
create policy team_blacklist_write on public.team_blacklist for all to authenticated using (true) with check (true);

-- GRANT'ы обязательны для таблиц из сырого SQL, иначе 42501 (не только RLS).
grant select on public.team_blacklist to anon, authenticated;
grant insert, update, delete on public.team_blacklist to authenticated;
