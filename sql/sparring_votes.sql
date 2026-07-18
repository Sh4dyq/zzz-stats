-- Голоса спарринг-калибровки (админка «Аналитика → Спарринг»): парные сравнения
-- рандомных вариантов (соло/дуо/трио), подобранных по ролям. Обработка — отдельно.
create table if not exists public.sparring_votes (
  id uuid primary key default gen_random_uuid(),
  size int not null check (size in (1,2,3)),
  left_team jsonb not null,              -- [{cid,ms}]
  right_team jsonb not null,
  winner text not null check (winner in ('left','right')),
  created_at timestamptz not null default now()
);

alter table public.sparring_votes enable row level security;

drop policy if exists sparring_votes_read on public.sparring_votes;
create policy sparring_votes_read on public.sparring_votes for select using (true);

drop policy if exists sparring_votes_write on public.sparring_votes;
create policy sparring_votes_write on public.sparring_votes for all to authenticated using (true) with check (true);

-- GRANT'ы обязательны для таблиц из сырого SQL, иначе 42501 (не только RLS).
grant select on public.sparring_votes to anon, authenticated;
grant insert, update, delete on public.sparring_votes to authenticated;
