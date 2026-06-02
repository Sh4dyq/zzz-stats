-- Cache of the proxied Challonge payload so the page doesn't hit the API on every
-- visit and still renders if Challonge is down. Written by the challonge-proxy
-- Edge Function / admin sync; read freely by bracket.html.
create table if not exists bracket_cache (
  tournament_id uuid primary key references tournaments(id) on delete cascade,
  json          jsonb not null,
  fetched_at    timestamptz default now()
);
alter table bracket_cache enable row level security;
drop policy if exists "bracket read"  on bracket_cache;
drop policy if exists "bracket write" on bracket_cache;
create policy "bracket read"  on bracket_cache for select using (true);
create policy "bracket write" on bracket_cache for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select on bracket_cache to anon, authenticated;
grant insert, update, delete on bracket_cache to authenticated;
