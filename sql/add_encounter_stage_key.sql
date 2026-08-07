-- Явная привязка встречи к этапу многоэтапного турнира ('s1' | 's2' | …).
-- Раньше этап выводился по составу групп из bracket_cache: встреча двух игроков
-- из одной группы всегда считалась групповой, даже если они пересеклись в плей-офф
-- (Incineration: Alou vs Rene). Колонка — приоритетный источник, эвристика остаётся
-- фолбэком для встреч без stage_key.
-- encounters.stage — это ПОДПИСЬ («Гранд-финал»), не путать.
alter table encounters add column if not exists stage_key text;
comment on column encounters.stage_key is 'Ключ этапа: s1/s2/… (Phase.stagesOf). null = определять эвристикой.';
