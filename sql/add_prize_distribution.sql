-- Распределение призовых по местам (одно на турнир). Из него призовые игроков
-- проставляются АВТО — и при ручном вводе места, и при синке с Challonge.
-- Формат: массив [{place:1,prize:5000},{place:2,prize:3000},…]. По умолчанию 4 места.
-- Места без записи в распределении → приз не трогаем (остаётся как был / пусто).
alter table tournaments add column if not exists prize_distribution jsonb
  default '[{"place":1},{"place":2},{"place":3},{"place":4}]'::jsonb;
