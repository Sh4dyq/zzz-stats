-- Наивысшее место игрока на турнире (вводится вручную в админке).
-- 1/2/3 стилизуются золотом/серебром/бронзой на statistics.html (вкладка Игроки → Разное).
-- Возможно позже заменим автоматическим расчётом из турнирной сетки.

alter table players add column if not exists highest_place int;
-- Сколько раз игрок занимал это место (вручную). 1 или null → без серых скобок.
alter table players add column if not exists highest_place_count int;
