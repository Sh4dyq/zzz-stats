-- Валидные комбинации (админка «Аналитика → Калибровка силы → Валидные комбинации»).
-- Опора-справочник шаблонов состава. slots = [[tok,...],...], tok = "arch:<role>" | "char:<cid>".
-- Слот = ИЛИ-набор опций; шаблон засчитывается, если членов состава можно разложить по слотам 1:1.
create table if not exists public.team_templates (
  id uuid primary key default gen_random_uuid(),
  size int not null check (size in (2,3)),
  slots jsonb not null,
  note text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.team_templates enable row level security;

drop policy if exists team_templates_read on public.team_templates;
create policy team_templates_read on public.team_templates for select using (true);

drop policy if exists team_templates_write on public.team_templates;
create policy team_templates_write on public.team_templates for all to authenticated using (true) with check (true);

-- GRANT'ы обязательны для таблиц из сырого SQL, иначе 42501 (не только RLS).
grant select on public.team_templates to anon, authenticated;
grant insert, update, delete on public.team_templates to authenticated;
