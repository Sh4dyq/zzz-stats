-- Связь участника турнира с Challonge: challonge_pid (id участника в Challonge) +
-- challonge_name (его ник там, для трассировки/ревью). Заполняется синком challonge-proxy.
-- Нужно, чтобы аналитика (predict.html) точно привязывала встречи к позиции в сетке
-- по player_id, а не по нечёткому матчингу ников (наш ник и ник в Challonge расходятся).
alter table tournament_participants add column if not exists challonge_pid  text;
alter table tournament_participants add column if not exists challonge_name text;

-- Поиск по challonge_pid внутри турнира (используется при резолве мест сетки).
create index if not exists tp_challonge_pid_idx on tournament_participants (tournament_id, challonge_pid);
