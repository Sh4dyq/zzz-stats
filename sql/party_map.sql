-- Редактор карты Nexus Party (админка → «Карта Party»).
-- Доступ как у остальных таблиц админки: любой залогиненный пользователь.
-- Выполни этот файл в Supabase → SQL Editor.

create table if not exists public.party_maps (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Новая карта',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.party_map_versions (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.party_maps(id) on delete cascade,
  label text not null default '',
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.party_maps enable row level security;
alter table public.party_map_versions enable row level security;
drop policy if exists party_maps_admin on public.party_maps;
drop policy if exists party_maps_auth on public.party_maps;
create policy party_maps_auth on public.party_maps for all to authenticated using (true) with check (true);
drop policy if exists party_map_versions_admin on public.party_map_versions;
drop policy if exists party_map_versions_auth on public.party_map_versions;
create policy party_map_versions_auth on public.party_map_versions for all to authenticated using (true) with check (true);

-- GRANT'ы обязательны для таблиц из сырого SQL, иначе 42501.
grant select, insert, update, delete on public.party_maps, public.party_map_versions to authenticated;
