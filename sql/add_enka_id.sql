-- Add enka_id (game character/weapon id from shiyu.darte.gg API) for robust
-- API->DB matching during draft-link import. Names are NOT 1:1 between the
-- API (name.en) and our DB, but enkaId is stable. See web/matches.js importer.
--
-- Variant agents (e.g. "Soldier 0 - Anby (Buffed)") use a suffixed enkaId like
-- "1381_1"; the importer normalizes by stripping the "_N" suffix, so the base
-- enka_id stored here ("1381") still matches.

alter table characters add column if not exists enka_id text;
alter table signatures add column if not exists enka_id text;

create index if not exists idx_characters_enka_id on characters(enka_id);
create index if not exists idx_signatures_enka_id on signatures(enka_id);

-- Then run sql/backfill_enka_id.sql to populate values.
