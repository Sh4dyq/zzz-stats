-- Per-tournament restart time penalties.
-- Array of INCREMENTAL seconds per restart: restart_penalties[i] = seconds added
-- by the (i+1)-th restart. Effective penalty for N restarts = sum of first N.
-- Example [0,0,2,3]: 1st=+0, 2nd=+0, 3rd=+2, 4th=+3 → at 4 restarts total +5s.
alter table tournaments add column if not exists restart_penalties jsonb default '[]'::jsonb;
