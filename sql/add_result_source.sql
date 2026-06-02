-- ГИБРИД: разводим «синк из Challonge» и «ручной ввод», чтобы они не перетирали друг друга.
-- source : кто последним выставил МЕСТО (place) в строке результата.
--   'challonge' — место подтянул авто-синк (final_rank). Синк МОЖЕТ перезаписывать такие строки.
--   'manual'    — место выставлено вручную в админке. Синк такие строки НЕ ТРОГАЕТ.
-- prize  : ВСЕГДА ручной (в Challonge нет призовых) — синк его никогда не пишет.
alter table tournament_results add column if not exists source text not null default 'manual';
alter table tournament_results add column if not exists final_rank int;     -- сырой rank из Challonge (для аудита)
alter table tournament_results add column if not exists synced_at timestamptz;

-- На случай, если строки уже есть: всё, что не от синка, считаем ручным.
update tournament_results set source = coalesce(source,'manual') where source is null;
