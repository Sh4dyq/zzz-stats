-- match_picks.sig_id — конкретный амплификатор (W-движок), который персонаж нёс в этом пике.
-- NULL = без амплификатора. Может ссылаться на сигнатуру ЛЮБОГО персонажа (нестандартный движок).
-- has_signature остаётся как «нёс ли амплификатор вообще» (= sig_id IS NOT NULL).
alter table match_picks
  add column if not exists sig_id uuid references signatures(id) on delete set null;

create index if not exists match_picks_sig_id_idx on match_picks(sig_id);
