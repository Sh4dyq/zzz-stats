-- АВТО-СИНК С CHALLONGE БЕЗ КЛИКОВ (опционально).
-- Раз в N минут дёргает edge-функцию challonge-proxy для ТЕКУЩЕГО (live) турнира,
-- у которого задан challonge_url. Та сама обновит сетку, места и авто-призовые.
--
-- Нужны расширения pg_cron и pg_net (Supabase → Database → Extensions → включить оба).
-- Подставь свой PROJECT_REF и SERVICE_ROLE_KEY (Settings → API). Ключ сервисный —
-- он в БД, в браузер не попадает.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Снять старую задачу, если перезапускаешь
select cron.unschedule('challonge-autosync') where exists (select 1 from cron.job where jobname='challonge-autosync');

-- Каждые 3 минуты: для каждого live-турнира с challonge_url зовём функцию
select cron.schedule('challonge-autosync', '*/3 * * * *', $$
  select net.http_post(
    url     := 'https://PROJECT_REF.supabase.co/functions/v1/challonge-proxy',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer SERVICE_ROLE_KEY'),
    body    := jsonb_build_object(
                 'db_id', t.id,
                 'challonge', regexp_replace(t.challonge_url, '^.*/', ''))
  )
  from tournaments t
  where t.status = 'live' and coalesce(t.challonge_url,'') <> '';
$$);

-- Проверить:   select * from cron.job;
-- Логи вызовов: select * from net._http_response order by created desc limit 10;
-- Выключить:   select cron.unschedule('challonge-autosync');
