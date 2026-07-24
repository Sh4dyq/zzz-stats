-- Слияние дублей игроков (Challonge/nexus-импорт создавал новую запись при
-- несовпадении ника: «Sambrero🎩» vs «Sambrero», «.DmiVob.» vs «Dmivob»).
-- Все ссылки переприсваиваются на выжившего, турнир-скоупные строки переносятся
-- (при конфликте по unique — строка дубля удаляется), дубль удаляется.

create or replace function merge_player(src uuid, dst uuid) returns void language plpgsql as $$
begin
  update encounters set player1_id=dst where player1_id=src;
  update encounters set player2_id=dst where player2_id=src;
  update encounters set winner_id=dst  where winner_id=src;
  update matches set fp_player_id=dst where fp_player_id=src;
  update matches set winner_id=dst    where winner_id=src;
  update match_picks set player_id=dst where player_id=src;
  update match_bans  set player_id=dst where player_id=src;
  update bracket_nodes set player1_id=dst where player1_id=src;
  update bracket_nodes set player2_id=dst where player2_id=src;
  update bracket_nodes set winner_id=dst  where winner_id=src;

  update player_rosters r set player_id=dst
    where r.player_id=src and not exists(select 1 from player_rosters x
      where x.tournament_id=r.tournament_id and x.player_id=dst and x.character_id=r.character_id);
  delete from player_rosters where player_id=src;

  update tournament_participants t set player_id=dst
    where t.player_id=src and not exists(select 1 from tournament_participants x
      where x.tournament_id=t.tournament_id and x.player_id=dst);
  delete from tournament_participants where player_id=src;

  update tournament_results t set player_id=dst
    where t.player_id=src and not exists(select 1 from tournament_results x
      where x.tournament_id=t.tournament_id and x.player_id=dst);
  delete from tournament_results where player_id=src;

  delete from players where id=src;
end $$;

-- Sambrero🎩 (создан 2026-07-24) → Sambrero (история с 2026-05-31)
select merge_player('f0273bc2-c780-4c44-a08d-c503b4e4cadf','e3bb0f57-fc26-4071-83e4-0769d235639c');
-- .DmiVob. (создан 2026-07-24) → Dmivob (участник турниров)
select merge_player('8e121635-8399-4ccf-9e80-a715b775744f','ce869626-3028-464a-84ef-1fa0a50a1a77');

drop function merge_player(uuid,uuid);

-- Проверка: дубликатов по нормализованному нику быть не должно
select lower(regexp_replace(nickname,'[^a-zA-Zа-яА-ЯёЁ0-9]','','g')) k, count(*), array_agg(nickname)
from players group by 1 having count(*)>1;
