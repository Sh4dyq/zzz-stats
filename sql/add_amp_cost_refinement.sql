-- R1–R5 наложения (refinement) для коста сигнатурного амплификатора (на его персонаже).
-- sig_costs[i] = кост на наложении R(i+1). Нули хранятся как есть (0 = «0», а не прочерк);
-- прочерк = отсутствие значения (null/конец массива).
-- Существующее поле sig_cost остаётся = R1 (sig_costs[0]) для обратной совместимости:
-- статистика (index.html) читает sig_cost, поэтому «в выходную стату пока только P1».
alter table tournament_costs add column if not exists sig_costs jsonb default '[]'::jsonb;
