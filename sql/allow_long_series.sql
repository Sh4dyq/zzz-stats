-- Снятие Bo2-ограничения на номер игры во встрече.
-- matches_match_number_check разрешал только 1–2: встреча == ровно один Bo2.
-- Суперфинал регламентно бывает длиннее (Bo2+Bo2+Bo1 = одна серия из 5 игр),
-- и админка теперь умеет её собирать («⤵ Слить в серию»).
-- Верхнюю границу оставляем как защиту от опечатки в номере.
alter table matches drop constraint if exists matches_match_number_check;
alter table matches add constraint matches_match_number_check
  check (match_number between 1 and 9);
