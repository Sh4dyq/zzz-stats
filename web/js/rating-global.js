/* Глобальный рейтинг zzz-stats v1.0 — спецификация: docs/rating-global.md

   Отличия от сезонного (web/js/rating.js):
   - сброса нет вообще, рейтинг копится по всей истории турниров;
   - широкие тиры 950 / 1100 / 1300 / 1500, тир держится;
   - всё, кроме участия, привязано к K: победа над равным = K/2, выплаты за места
     кратны ей, окно понижения = K (два поражения от равного).

   API совпадает с Rating, поэтому движок взаимозаменяем в web/js/rating-build.js. */
(function (g) {
  'use strict';

  const CFG = {
    START: 1000,
    SCALE: 800,            // шире сезонного: хвосты жирнее, апсет дешевле (docs §4)
    K: 60,                 // задаёт ширину распределения: при 30 ниже 900 почти не падают

    CATEGORY_W: {
      fastcap: 0.8,
      main: 1.0,
      major: 1.2
    },

    FIELD_BETA: 0.10,
    FIELD_SPAN: 150,

    PARTICIPATION: 5,

    // кратно победе над равным (K/2 = 30): 3× / 2× / 1.33× / 1× / 0.5×
    PLACE: {
      fastcap: { 1: 30, 2: 15 },
      main:    { 1: 60, 2: 30, 3: 15 },
      major:   { 1: 90, 2: 60, 3: 40, 4: 30, 5: 15, 6: 15 }
    },

    /* guard — окно понижения этой границы; окно защищает заработанный тир, поэтому
       на нижней его нет: упал ниже 900 — ты в C, поднялся выше 900 — вышел. */
    TIERS: [
      { name: 'C',  min: -Infinity },
      { name: 'B',  min: 900,  guard: 0 },
      { name: 'A',  min: 1100 },
      { name: 'S',  min: 1300 },
      { name: 'S+', min: 1500 }
    ],
    GUARD: 60              // окно понижения = K: два поражения от равного не отпускают
  };

  const DEFAULTS = JSON.parse(JSON.stringify(CFG));

  /** Переопределить константы. Мелкий рекурсивный merge, configure(null) — сброс. */
  function configure(patch) {
    const merge = (dst, src) => {
      for (const k of Object.keys(src || {})) {
        const v = src[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) merge(dst[k] = dst[k] || {}, v);
        else if (v !== undefined && v !== null) dst[k] = v;
      }
    };
    for (const k of Object.keys(CFG)) delete CFG[k];
    merge(CFG, DEFAULTS);
    if (patch) merge(CFG, patch);
    return CFG;
  }

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  const expected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / CFG.SCALE));

  function fieldWeight(avgRating) {
    if (avgRating == null) return 1;
    return 1 + CFG.FIELD_BETA * clamp((avgRating - CFG.START) / CFG.FIELD_SPAN, -1, 1);
  }

  function eloWeight(category, avgRating) {
    return (CFG.CATEGORY_W[category] ?? 1) * fieldWeight(avgRating);
  }

  function delta(r, ropp, won, weight) {
    return Math.round(CFG.K * (weight == null ? 1 : weight) * ((won ? 1 : 0) - expected(r, ropp)));
  }

  function placePoints(category, place) {
    return (CFG.PLACE[category] || {})[place] || 0;
  }

  function applyEncounter(state, aId, bId, winnerId, weight) {
    const ra = state.ratings[aId] ?? CFG.START;
    const rb = state.ratings[bId] ?? CFG.START;
    const d = delta(ra, rb, winnerId === aId, weight);
    state.ratings[aId] = ra + d;
    state.ratings[bId] = rb - d;
    return state;
  }

  const tierIndex = name => CFG.TIERS.findIndex(t => t.name === name);

  function tierOf(r) {
    let t = CFG.TIERS[0];
    for (const x of CFG.TIERS) if (r >= x.min) t = x;
    return t.name;
  }

  function settleTier(r, prevTier) {
    const cur = tierIndex(tierOf(r));
    const prev = tierIndex(prevTier == null ? tierOf(CFG.START) : prevTier);
    if (cur >= prev) return CFG.TIERS[cur].name;
    const guard = CFG.TIERS[prev].guard ?? CFG.GUARD;
    return r < CFG.TIERS[prev].min - guard
      ? CFG.TIERS[cur].name
      : CFG.TIERS[prev].name;
  }

  /** Турнир целиком. Аргументы — как у Rating.applyTournament. */
  function applyTournament(state, encounters, standings, category, participants) {
    state.ratings = state.ratings || {};
    state.tiers = state.tiers || {};
    const ids = participants || [...new Set(encounters.flatMap(e => [e.player1_id, e.player2_id]))];
    const avg = ids.reduce((s, id) => s + (state.ratings[id] ?? CFG.START), 0) / (ids.length || 1);
    const w = eloWeight(category, avg);

    const played = new Set();
    for (const e of encounters) {
      if (!e.winner_id) continue;
      applyEncounter(state, e.player1_id, e.player2_id, e.winner_id, w);
      played.add(e.player1_id); played.add(e.player2_id);
    }
    for (const id of played) {
      state.ratings[id] = (state.ratings[id] ?? CFG.START) + CFG.PARTICIPATION;
    }
    for (const s of (standings || [])) {
      const pts = placePoints(category, s.place);
      if (pts) state.ratings[s.player_id] = (state.ratings[s.player_id] ?? CFG.START) + pts;
    }
    for (const id of ids) {
      state.tiers[id] = settleTier(state.ratings[id] ?? CFG.START, state.tiers[id] ?? null);
    }
    return state;
  }

  /** Полный пересчёт по всей истории. tournaments — в хронологии. */
  function buildAll(tournaments) {
    const state = { ratings: {}, tiers: {} };
    for (const t of tournaments) {
      applyTournament(state, t.encounters, t.standings, t.category, t.participants);
    }
    return state;
  }

  g.RatingGlobal = {
    CFG, DEFAULTS, configure, expected, fieldWeight, eloWeight, delta, placePoints,
    applyEncounter, tierOf, settleTier, applyTournament,
    buildAll, buildSeason: buildAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
