-- Статус турнира — единый источник «ротации» для всего сайта.
-- Запусти в Supabase SQL Editor. Код везде defensive: без этой колонки сайт работает,
-- просто «текущим» считается самый свежий турнир, а «топ турнира» — следующий за ним.
--
-- Значения:
--   'live'      — идёт сейчас  → попадает в hero/баннер главной и во вкладку
--                 «ТЕКУЩИЙ ТУРНИР» статистики;
--   'upcoming'  — анонсирован, ещё не начался;
--   'finished'  — завершён     → самый свежий завершённый идёт в блок «Топ турнира».
--
-- Держи ровно ОДИН турнир в статусе 'live'. Когда Proxy Rush 6 закончится:
--   update tournaments set status='finished' where name ilike '%proxy rush 6%';
--   update tournaments set status='live'     where name ilike '%<следующий>%';

alter table tournaments add column if not exists status text not null default 'finished';

-- начальная расстановка (поправь имена под свою БД):
update tournaments set status='live'     where name ilike '%proxy rush 6%';
update tournaments set status='finished' where name ilike '%qualifiers%';
-- будущие турниры: добавляй через админку (по умолчанию станут 'upcoming') или
-- update tournaments set status='upcoming' where name ilike '%<анонсированный>%';
-- ПРИМ.: новые турниры из админки уже создаются со статусом 'upcoming'.
