/* Сборка таблицы Elo из данных турниров. Чистая функция над уже загруженными массивами —
   одинаково работает в админке (supabase-js) и в tools/rating/build_player_rating.js (REST).
   Формула и тиры — web/js/rating.js, спецификация — docs/rating-system.md. */
(function (g) {
  'use strict';
  const Rating = g.Rating;

  const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');

  /* Ники в сетках challonge, не совпадающие с players.nickname.
     Сведены по совпадению соперника и исхода встречи, не по похожести написания. */
  const ALIAS = {
    'tetsuya': 'tetsuyabtw', 'tainodernul': 'Kykan', 'kykanvelikana': 'Kykan',
    'damikuro047': 'DaMikuro', 'ruina': 'RuinaXD', 'shio': 'Shiofeer', 'денчик': 'Denchik',
    'likebtrfly': 'likebutterfly', 'likebutrfly': 'likebutterfly',
    'shu67kkkzxcghouldeadinside': 'shudikkk', 'нищетадестроер666': 'nisheta destroyer 666',
    '4покер': '4_poker_', 'dreamfish': 'DreamFish',
    'фынфьюхи': 'iKannaTense', 'tilted': 'akm', 'maxel': 'miron',
    'donaldtrump200': 'shizo', 'макарошек': 'hal98'
  };

  /* Точечные правки сеток: ключ — название турнира, внутри play_order → верная пара.
     Incineration: в кэше challonge у двух встреч нижней сетки перепутаны пары
     (прошедшие дальше при этом те же). */
  const FIX = {
    'Nexus Shiyu Incineration': {
      13: { a: 'Kykan', b: 'Sambrero', w: 'Sambrero' },
      14: { a: 'Alou', b: 'tetsuyabtw', w: 'tetsuyabtw' }
    }
  };

  /** Хронология сезона: по дате, при её отсутствии — по sort_order (он убывает со временем). */
  function chronology(tournaments) {
    return tournaments.filter(t => t.rating_category).slice().sort((a, b) => {
      const da = a.event_date || '', db = b.event_date || '';
      if (da && db && da !== db) return da < db ? -1 : 1;
      return (b.sort_order ?? -1) - (a.sort_order ?? -1);
    });
  }

  /** Встречи одного турнира в порядке проведения.
   *  Плейофф берём из сетки challonge (там полнее и есть play_order),
   *  групповой этап — из encounters (в сетке групп нет), он идёт первым. */
  function tournamentEncounters(t, cacheJson, encounters, nickOf, canon) {
    const fix = FIX[t.name] || {};
    const playoff = [];
    const j = cacheJson || {};
    for (const r of [...(j.groups || []), ...(j.rounds || [])])
      for (const m of (r.matches || [])) {
        if (!m.played || !m.a || !m.b || !m.a.name || !m.b.name) continue;
        const f = fix[m.play_order];
        const a = f ? f.a : canon(m.a.name), b = f ? f.b : canon(m.b.name);
        playoff.push({ player1_id: a, player2_id: b, winner_id: f ? f.w : (m.a.win ? a : b), po: m.play_order ?? 0 });
      }
    playoff.sort((x, y) => x.po - y.po);

    const own = encounters.filter(e => e.tournament_id === t.id && e.winner_id);
    const groups = own.filter(e => e.stage_key === 's1')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(e => ({ player1_id: nickOf(e.player1_id), player2_id: nickOf(e.player2_id), winner_id: nickOf(e.winner_id) }));

    // нет сетки — считаем по encounters (sort_order убывает со временем)
    if (!playoff.length) {
      const rest = own.filter(e => e.stage_key !== 's1')
        .sort((a, b) => (b.sort_order ?? -1) - (a.sort_order ?? -1))
        .map(e => ({ player1_id: nickOf(e.player1_id), player2_id: nickOf(e.player2_id), winner_id: nickOf(e.winner_id) }));
      return [...groups, ...rest].filter(e => e.player1_id && e.player2_id && e.winner_id);
    }
    return [...groups, ...playoff].filter(e => e.player1_id && e.player2_id && e.winner_id);
  }

  /** Полный пересчёт сезона.
   *  Вход: tournaments (с rating_category), players, encounters, cache = [{tournament_id, json}],
   *        config — патч констант из rating_config, adjustments — ручные правки [{nickname,delta,reason}]
   *  Выход: { rows, season } — rows готовы для записи в player_ratings. */
  function compute({ tournaments, players, encounters, cache, config, adjustments }) {
    Rating.configure(config || null);
    const nickOf = id => (players.find(p => p.id === id) || {}).nickname || null;
    const dbNick = {}, idOf = {};
    players.forEach(p => { dbNick[norm(p.nickname)] = p.nickname; idOf[norm(p.nickname)] = p.id; });
    const canon = n => ALIAS[norm(n)] || dbNick[norm(n)] || n;
    const cacheOf = Object.fromEntries((cache || []).map(r => [r.tournament_id, r.json]));

    const state = { ratings: {}, tiers: {} };
    const stat = {}, season = [];

    for (const t of chronology(tournaments)) {
      const enc = tournamentEncounters(t, cacheOf[t.id], encounters, nickOf, canon);
      if (!enc.length) continue;
      for (const e of enc) {
        const l = e.winner_id === e.player1_id ? e.player2_id : e.player1_id;
        (stat[e.winner_id] ||= { w: 0, l: 0, t: 0 }).w++;
        (stat[l] ||= { w: 0, l: 0, t: 0 }).l++;
      }
      const standings = ((cacheOf[t.id] || {}).results || []).map(r => ({ player_id: canon(r.name), place: r.place }));
      const parts = [...new Set([...enc.flatMap(e => [e.player1_id, e.player2_id]), ...standings.map(s => s.player_id)])];
      parts.forEach(n => (stat[n] ||= { w: 0, l: 0, t: 0 }).t++);

      Rating.applyTournament(state, enc, standings, t.rating_category, parts);
      season.push({ name: t.name, category: t.rating_category, encounters: enc.length, participants: parts.length });
    }

    /* Ручные правки. Начисляются поверх формулы, после всех турниров: в саму формулу
       они не входят и хранятся отдельным полем с причиной. Тир пересчитывается с ними,
       иначе правка не могла бы ни поднять, ни опустить игрока. */
    const adj = {}, why = {};
    for (const a of (adjustments || [])) {
      const n = canon(a.nickname);
      adj[n] = (adj[n] || 0) + (+a.delta || 0);
      if (a.reason) (why[n] ||= []).push(a.reason);
    }
    for (const n of Object.keys(adj)) {
      if (!(n in state.ratings)) { state.ratings[n] = Rating.CFG.START; state.tiers[n] = null; }
      const base = state.ratings[n];
      state.ratings[n] = base + adj[n];
      state.tiers[n] = Rating.settleTier(state.ratings[n], state.tiers[n]);
    }

    const rows = Object.keys(state.ratings).map(n => ({
      nickname: n,
      player_id: idOf[norm(n)] || null,
      rating: state.ratings[n],
      base_rating: state.ratings[n] - (adj[n] || 0),
      adjust: adj[n] || 0,
      reason: (why[n] || []).join('; ') || null,
      tier: state.tiers[n],
      wins: stat[n] ? stat[n].w : 0,
      losses: stat[n] ? stat[n].l : 0,
      tours: stat[n] ? stat[n].t : 0
    })).sort((a, b) => b.rating - a.rating || a.nickname.localeCompare(b.nickname));

    return { rows, season };
  }

  g.RatingBuild = { compute, chronology, ALIAS, FIX, CATEGORY_LABEL: { fastcap: 'фасткап ×0.8', main: 'обычный ×1.0', major: 'крупный ×1.2' } };
})(typeof window !== 'undefined' ? window : globalThis);
