-- Реальное наложение (refinement R1–R5) сигнатурного движка на пикнутом персонаже.
-- Источник: draft init players[].teams[].engine.refinement, джойн pick.agent→teams[].agent.agent.
-- 1 = R1 (легаси-дефолт для ручных матчей и старых данных). Статистика индексирует
-- tournament_costs.sig_costs[refinement-1] вместо «всегда R1».
alter table match_picks add column if not exists refinement smallint not null default 1;
