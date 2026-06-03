-- Полная модель коста сигнатурного амплификатора (на строке владельца в tournament_costs):
--   sig_costs        — R1–R5 для СВОЕЙ роли/специальности (own role base[0..4]); применяется
--                      к владельцу и любому агенту той же роли (если нет bis-переопределения).
--   sig_offrole_cost — ОФФРОЛЬ флэт (base[5]): агент другой роли, единый кост без наложения.
--   sig_bis          — {character_id: [R1..R5]} переопределения для конкретных не-владельцев (BIS).
-- Резолв коста пика (statistics.html sigCostOf): bis → своя роль(own) → оффроль(off).
alter table tournament_costs add column if not exists sig_offrole_cost integer;
alter table tournament_costs add column if not exists sig_bis jsonb default '{}'::jsonb;
