-- Конфигурация спарринг-калибровки (админка «Аналитика → Спарринг → ⚙ Калибровка»).
-- На персонажа: калибровочный майндскейп (на каком M сравнивать) и флаг «в игре».
-- calib_ms = null → авто (самый частый M из реальных пиков match_picks; фолбэк A=6/S=0).
-- in_game = false → перса не показываем в спарринге (напр. ещё не вышел: Сигрид, Рамиэль).
create table if not exists public.sparring_config (
  character_id int primary key,
  calib_ms int,                          -- ручной оверрайд M (null = авто из пиков)
  in_game boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.sparring_config enable row level security;

drop policy if exists sparring_config_read on public.sparring_config;
create policy sparring_config_read on public.sparring_config for select using (true);

drop policy if exists sparring_config_write on public.sparring_config;
create policy sparring_config_write on public.sparring_config for all to authenticated using (true) with check (true);

-- GRANT'ы обязательны для таблиц из сырого SQL, иначе 42501 (не только RLS).
grant select on public.sparring_config to anon, authenticated;
grant insert, update, delete on public.sparring_config to authenticated;
