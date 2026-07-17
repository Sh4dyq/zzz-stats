-- Теги синергии + мидскейп-слой, редактируемые прямо в админке (weights.js → Аналитика).
-- Источник правды для synergy.js (публичный predict читает отсюда, фолбэк — web/data/synergy_tags.json).
-- data jsonb = весь объект персонажа: {name,element,specialty,roles,gives,needs,note,passive_use,
--   ms:{gives_self,gives,dmg,note,a_rank}}. Базовые роли/gives/needs — шкала 0-4 (M0);
--   ms.* — мидскейпы, mag вне шкалы 0-4 допустим, at = порог M (1-6).
create table if not exists public.synergy_tags (
  character_id integer primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.synergy_tags enable row level security;

drop policy if exists synergy_tags_read on public.synergy_tags;
create policy synergy_tags_read on public.synergy_tags for select using (true);

drop policy if exists synergy_tags_write on public.synergy_tags;
create policy synergy_tags_write on public.synergy_tags for all to authenticated using (true) with check (true);

-- GRANT'ы обязательны для таблиц из сырого SQL, иначе 42501 (не только RLS).
grant select on public.synergy_tags to anon, authenticated;
grant insert, update, delete on public.synergy_tags to authenticated;
