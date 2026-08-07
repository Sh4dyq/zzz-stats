-- add_stage_split.sql — разделение данных турнира по этапам (группы / плей-офф).
-- Причина: между этапами игроки пересобирают ростеры, и Шиюй в плей-оффе может быть другой.
-- Ключи стадий совпадают с web/phase.js: 's1' — первый этап (bracket_type «GROUPS->DE»),
-- 's2' — второй и т.д. NULL/отсутствие = данные на весь турнир (старое поведение).
-- Применять в Supabase SQL editor. Идемпотентно.

-- Ростер игрока на конкретном этапе. NULL = ростер на весь турнир (фолбэк, если этапного нет).
alter table player_rosters add column if not exists stage text;

-- Ротации Шиюй по этапам: {"s1":{...},"s2":{...}} в формате shiyu_data.
-- shiyu_data остаётся общей ротацией/фолбэком (и совместимостью со старыми турнирами).
alter table tournaments add column if not exists shiyu_stages jsonb;

-- Старый уникальный ключ (tournament_id,player_id,character_id) не даёт держать одного
-- персонажа на двух этапах — заменяем на ключ с этапом. NULL в уникальном индексе не
-- дедуплицируется, поэтому вместо колонки берём coalesce(stage,'') .
alter table player_rosters drop constraint if exists player_rosters_tournament_id_player_id_character_id_key;
create unique index if not exists player_rosters_tour_player_char_stage_key
  on player_rosters (tournament_id, player_id, character_id, coalesce(stage,''));

-- RLS/GRANT: обе таблицы уже открыты на чтение anon и запись authenticated —
-- новые колонки наследуют политики таблицы.
