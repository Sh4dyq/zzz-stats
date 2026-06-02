-- Challonge integration: store the per-tournament bracket source.
-- challonge_url    : full URL or slug (e.g. https://challonge.com/ru/NSPR6 or NSPR6)
-- bracket_type     : 'SE' single-elim | 'DE' double-elim | 'GROUPS' (informational, render hint)
alter table tournaments add column if not exists challonge_url text;
alter table tournaments add column if not exists bracket_type text;
-- event_date : дата ПРОВЕДЕНИЯ турнира (вписываем вручную), показывается в списке «Все сетки»
--              вместо created_at. game пока статичен (ZZZ), отдельной колонки не заводим.
alter table tournaments add column if not exists event_date date;
-- event_date_end    : вторая дата диапазона проведения (напр. 02–03 июня). NULL = однодневный.
-- expected_players  : предполагаемое число участников — задаёт размер каркаса сетки до заполнения.
-- stages_count      : число этапов (напр. группы → плейофф). 1 = одна сетка.
alter table tournaments add column if not exists event_date_end date;
alter table tournaments add column if not exists expected_players int;
alter table tournaments add column if not exists stages_count int default 1;

-- Backfill the one currently hardcoded on index.html + параметры Proxy Rush 6
update tournaments set
    challonge_url    = coalesce(challonge_url,'https://challonge.com/ru/NSPR6'),
    bracket_type     = coalesce(bracket_type,'SE'),
    event_date       = coalesce(event_date,'2026-06-02'),
    event_date_end   = coalesce(event_date_end,'2026-06-03'),
    expected_players = coalesce(expected_players,30),
    stages_count     = coalesce(stages_count,1)
  where lower(name) like '%proxy rush 6%';
