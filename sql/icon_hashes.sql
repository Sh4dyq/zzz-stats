-- Этап 2 анализатора: база эталонных pHash иконок (баны, в перспективе пики/амплификаторы).
-- Выполнить в Supabase SQL Editor вручную. Растёт из подтверждений пользователя
-- (learnBanIcons в analyze.html) и опционального инструмента массового засева.

create extension if not exists "pgcrypto";

create table if not exists icon_hashes (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  kind         text not null default 'ban',   -- 'ban' | 'pick' | 'amplifier'
  hash         text not null,                  -- aHash 16x16 -> 64-символьный hex
  created_at   timestamptz not null default now()
);

create index if not exists icon_hashes_kind_idx on icon_hashes (kind);
create index if not exists icon_hashes_char_idx on icon_hashes (character_id);

alter table icon_hashes enable row level security;

-- Читать может кто угодно (anon), писать — только авторизованные (как и остальная админка).
create policy "icon_hashes read"  on icon_hashes for select using (true);
create policy "icon_hashes write" on icon_hashes for insert to authenticated with check (true);
create policy "icon_hashes del"   on icon_hashes for delete to authenticated using (true);
