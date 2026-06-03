-- Фаза 2: собственный движок турнирных сеток (независимо от Challonge).
-- brackets — одна сетка на турнир (SE/DE); bracket_nodes — узлы (матчи) с рёбрами
-- продвижения. Победитель ноды автоматически толкается в next_win_node[slot],
-- проигравший (для DE) — в next_lose_node[slot]. Узел может ссылаться на encounter
-- (встречу) для деталей матча. Каркас строится клиентским web/bracket-engine.js.

create table if not exists brackets (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  type          text not null default 'SE',            -- 'SE' | 'DE'
  size          int  not null,                         -- размер сетки (степень 2)
  settings      jsonb default '{}'::jsonb,             -- {third_place, gf_reset, ...}
  created_at    timestamptz default now(),
  unique (tournament_id)
);

create table if not exists bracket_nodes (
  id             uuid primary key default gen_random_uuid(),
  bracket_id     uuid not null references brackets(id) on delete cascade,
  part           text not null default 'W',            -- 'W' верхняя | 'L' нижняя | 'GF' гранд-финал
  round          int  not null,                        -- номер раунда внутри part (1..)
  slot           int  not null,                        -- позиция матча в раунде (0..)
  identifier     int,                                  -- сквозной номер встречи (отображение)
  player1_id     uuid references players(id) on delete set null,
  player2_id     uuid references players(id) on delete set null,
  seed1          int,
  seed2          int,
  is_bye         boolean not null default false,
  encounter_id   uuid references encounters(id) on delete set null,
  winner_id      uuid references players(id) on delete set null,
  next_win_node  uuid references bracket_nodes(id) on delete set null,
  next_win_slot  int,                                  -- 1|2 — в какой слот следующей ноды
  next_lose_node uuid references bracket_nodes(id) on delete set null,
  next_lose_slot int,
  created_at     timestamptz default now()
);
create index if not exists bracket_nodes_bracket_idx on bracket_nodes(bracket_id);

alter table brackets      enable row level security;
alter table bracket_nodes enable row level security;

-- ВАЖНО: RLS-политик недостаточно — нужны табличные GRANT'ы, иначе PostgREST
-- отдаёт 42501 «permission denied» даже авторизованному (см. supabase-grants-gotcha).
grant select on brackets, bracket_nodes to anon, authenticated;
grant insert, update, delete on brackets, bracket_nodes to authenticated;

drop policy if exists "brackets read"  on brackets;
drop policy if exists "brackets write" on brackets;
create policy "brackets read"  on brackets for select using (true);
create policy "brackets write" on brackets for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "bracket_nodes read"  on bracket_nodes;
drop policy if exists "bracket_nodes write" on bracket_nodes;
create policy "bracket_nodes read"  on bracket_nodes for select using (true);
create policy "bracket_nodes write" on bracket_nodes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
