-- add_shiyu_rotation.sql — ротация Shiyu Defense на турнир.
-- shiyu_url  = вставленная админом ссылка zzz.nanoka.cc/shiyu/<id> (источник).
-- shiyu_data = нормализованная ротация (Frontier 4): {id,name,frontier,level,buff,rooms,...} jsonb.
--   Картинки мобов НЕ хранятся: в данных только basename (поле img), URL строится на CDN nanoka.
-- Применять в Supabase SQL editor. Идемпотентно.

alter table tournaments add column if not exists shiyu_url  text;
alter table tournaments add column if not exists shiyu_data jsonb;

-- RLS/GRANT: tournaments уже доступна на чтение всем и на запись authenticated —
-- новые колонки наследуют политики таблицы, отдельных грантов не требуют.
