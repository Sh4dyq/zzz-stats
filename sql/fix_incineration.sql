-- Incineration: разметка этапов + склейка суперфинала.
-- Прогонять ПОСЛЕ sql/add_encounter_stage_key.sql и sql/allow_long_series.sql
-- (без второго упрётся в matches_match_number_check: игр 3–5 во встрече не бывало).
-- Скрипт идемпотентный — можно перезапускать.

-- 1) Этапы. Группы вносили 2026-07-24 (включая тайбрейки группы A),
--    плей-офф — 2026-08-06. Без этого Alou vs Rene из плей-офф падал в «Группы»
--    (оба из группы B), а тайбрейки — наоборот. Было 27/17, стало 26/18.
update encounters set stage_key = case
    when created_at::date = date '2026-07-24' then 's1' else 's2' end
where tournament_id = 'bbb8600a-a34a-4852-b522-f3fcb9eef4f8';

-- 2) Суперфинал SkeeeND — tetsuyabtw шёл как три отдельные встречи (Bo2 + Bo2 + Bo1).
--    По регламенту это одна серия из 5 игр, которую выиграл SkeeeND: 7-0 по встречам.
--    Игры второй и третьей встречи переезжают в первую номерами 3..5.
update matches set encounter_id = '810455e8-cd19-45e1-94f6-5f31d0392c21', match_number = 3
where id = 'd87adfb4-a6d8-4503-a684-1a58c0a07c23';
update matches set encounter_id = '810455e8-cd19-45e1-94f6-5f31d0392c21', match_number = 4
where id = 'ea2ffb8d-24f6-465d-b8f6-0e3c863ab492';
update matches set encounter_id = '810455e8-cd19-45e1-94f6-5f31d0392c21', match_number = 5
where id = 'e76bfd79-1682-4510-854f-c29fe17cb7fb';

delete from encounters
where id in ('0944f490-a7b1-4bc1-8d66-c81a0ed2214f','7fe19bbf-c4db-44f0-8ad2-8dedbc69954d');

update encounters
set winner_id = '9259d6b3-7670-46bb-9a48-b14e147b8d23',  -- SkeeeND
    stage     = 'Гранд-финал',
    stage_key = 's2'
where id = '810455e8-cd19-45e1-94f6-5f31d0392c21';

-- Проверка: 26 / 17 встреч по этапам (плей-офф на одну меньше после склейки).
-- select stage_key, count(*) from encounters
--   where tournament_id='bbb8600a-a34a-4852-b522-f3fcb9eef4f8' group by 1;
