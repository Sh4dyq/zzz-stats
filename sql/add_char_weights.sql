-- Ручные веса силы персонажей для «Аналитики» predict.html.
-- manual_weight — шкала 0..100 (50 = средний перс), приор поверх авто (кост+винрейт).
-- Читается моделью предиктов; средний кост/винрейт для справки считаются на лету, тут не хранятся.
create table if not exists char_weights (
  character_id uuid primary key references characters(id) on delete cascade,
  manual_weight smallint not null default 50 check (manual_weight between 0 and 100),
  updated_at timestamptz not null default now()
);

alter table char_weights enable row level security;

-- Политики создаём идемпотентно без DROP (иначе Supabase помечает запрос как destructive).
-- read=anon (нужно публичной predict.html), write=auth (админка).
do $$
begin
  if not exists (select 1 from pg_policies where tablename='char_weights' and policyname='char_weights_read') then
    create policy char_weights_read on char_weights for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='char_weights' and policyname='char_weights_write') then
    create policy char_weights_write on char_weights for all to authenticated using (true) with check (true);
  end if;
end $$;

-- GRANT'ы обязательны для таблиц из сырого SQL, иначе 42501 при вставке.
grant select on char_weights to anon, authenticated;
grant insert, update, delete on char_weights to authenticated;

-- Веса силы отдельных констелляций (майндскейпов) персонажа — разворот в разделе весов.
create table if not exists char_const_weights (
  character_id uuid not null references characters(id) on delete cascade,
  mindscape smallint not null check (mindscape between 0 and 6),
  manual_weight smallint not null default 50 check (manual_weight between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (character_id, mindscape)
);
alter table char_const_weights enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename='char_const_weights' and policyname='ccw_read') then
    create policy ccw_read on char_const_weights for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='char_const_weights' and policyname='ccw_write') then
    create policy ccw_write on char_const_weights for all to authenticated using (true) with check (true);
  end if;
end $$;
grant select on char_const_weights to anon, authenticated;
grant insert, update, delete on char_const_weights to authenticated;
