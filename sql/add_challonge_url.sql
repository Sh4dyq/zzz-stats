-- Challonge integration: store the per-tournament bracket source.
-- challonge_url    : full URL or slug (e.g. https://challonge.com/ru/NSPR6 or NSPR6)
-- bracket_type     : 'SE' single-elim | 'DE' double-elim | 'GROUPS' (informational, render hint)
alter table tournaments add column if not exists challonge_url text;
alter table tournaments add column if not exists bracket_type text;
-- event_date : дата ПРОВЕДЕНИЯ турнира (вписываем вручную), показывается в списке «Все сетки»
--              вместо created_at. game пока статичен (ZZZ), отдельной колонки не заводим.
alter table tournaments add column if not exists event_date date;

-- Backfill the one currently hardcoded on index.html
update tournaments set challonge_url = 'https://challonge.com/ru/NSPR6'
  where challonge_url is null and lower(name) like '%proxy rush 6%';
