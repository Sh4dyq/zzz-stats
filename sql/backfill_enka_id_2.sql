-- enka_id backfill (добор): персонажи и сигнатуры, которых не было в API на момент
-- backfill_enka_id.sql (там оставлены NULL). Теперь есть в shiyu API — проставляем.

-- characters
UPDATE characters SET enka_id='1571' WHERE id='a4efef3b-d744-43e3-a8d7-3a7a0424978f'; -- Norma
UPDATE characters SET enka_id='1551' WHERE id='502f5b02-f507-4955-852b-f3bb14be2d2c'; -- Pyrois
UPDATE characters SET enka_id='1561' WHERE id='4d77cc8c-81d7-46bb-909e-d3e0f58374aa'; -- Velina

-- signatures
UPDATE signatures SET enka_id='14155' WHERE id='31dee2c2-979b-4dd4-b740-6441f3a92dad'; -- Sol Exuvia
UPDATE signatures SET enka_id='14156' WHERE id='eaad2032-338c-43f9-976e-17109775cd4b'; -- Joyau Dore
UPDATE signatures SET enka_id='14157' WHERE id='e1beccf0-38ab-488b-a113-ce6a0ca1368d'; -- Chief Sidekick (ex-Head Lackey), сигна Нормы
