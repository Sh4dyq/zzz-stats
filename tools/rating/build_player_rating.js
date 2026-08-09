/* Проверочный пересчёт таблицы Elo (docs/rating-system.md) — печатает результат, ничего не пишет.
   Боевой пересчёт делает админка: «Турниры → Пересчитать рейтинг» (пишет в player_ratings).
   Запуск: node tools/rating/build_player_rating.js

   Логика расчёта общая с админкой — web/js/rating-build.js. */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
require(ROOT + '/web/js/rating.js');
require(ROOT + '/web/js/rating-build.js');

const SB = 'https://zoavnckfbfiejxfjakue.supabase.co/rest/v1';
const KEY = 'sb_publishable_37RZBsmdp3O1i795EuEfeg_vFpdPTFZ';
const get = p => fetch(`${SB}/${p}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }).then(r => r.json());

(async () => {
  const [tournaments, players, encounters, cache] = await Promise.all([
    get('tournaments?select=id,name,event_date,sort_order,rating_category'),
    get('players?select=id,nickname&limit=2000'),
    get('encounters?select=tournament_id,player1_id,player2_id,winner_id,stage_key,sort_order,created_at&limit=5000'),
    get('bracket_cache?select=tournament_id,json')
  ]);
  if (tournaments.message) {
    console.error('Ошибка запроса:', tournaments.message);
    if (/rating_category/.test(tournaments.message)) console.error('Прогони sql/add_rating.sql в Supabase.');
    return;
  }

  const { rows, season } = RatingBuild.compute({ tournaments, players, encounters, cache });
  if (!season.length) {
    console.log('Ни одного турнира с категорией (tournaments.rating_category). Проставь её в админке.');
    return;
  }
  for (const t of season) console.log(`${t.name} [${t.category}] — встреч ${t.encounters}, участников ${t.participants}`);
  console.log('\n #  тир  рейт   игрок                   В-П  тур.');
  rows.forEach((r, i) => console.log(
    String(i + 1).padStart(2) + '  ' + r.tier.padEnd(3) + ' ' + String(r.rating).padStart(5) + '   ' +
    r.nickname.padEnd(23) + `${r.wins}-${r.losses}`.padEnd(6) + r.tours));
  const cnt = {}; rows.forEach(r => cnt[r.tier] = (cnt[r.tier] || 0) + 1);
  console.log('\nтиры:', JSON.stringify(cnt), '| игроков:', rows.length);
})();
