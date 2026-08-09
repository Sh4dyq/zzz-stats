/* Рейтинговая система zzz-stats v2.0
   Спецификация: docs/rating-system.md

   Единица рейтинга — встреча (Bo2), не отдельная карта.
   Полный сброс к 1000 каждый сезон. Тир присваивается только по итогам турнира. */
(function (g) {
  'use strict';

  const CFG = {
    START: 1000,
    SCALE: 600,
    K: 50,                 // константа, без затухания по числу игр

    // множитель категории турнира (только к приросту Эло)
    CATEGORY_W: {
      fastcap: 0.8,
      main: 1.0,           // сюда же квалификации
      major: 1.2,
      // зарезервировано под новые форматы: 0.9 и 1.1
    },

    // множитель по среднему рейтингу всех участников (только к приросту Эло)
    FIELD_BETA: 0.10,
    FIELD_SPAN: 150,

    // фиксированные очки за места; категория уже заложена, множители не применяются
    PLACE: {
      fastcap: { 1: 25, 2: 10 },
      main:    { 1: 50, 2: 25, 3: 15 },
      major:   { 1: 75, 2: 50, 3: 35, 4: 25, 5: 10, 6: 10 }
    },

    TIERS: [
      { name: 'C',  min: -Infinity },
      { name: 'B',  min: 900  },
      { name: 'A',  min: 1100 },
      { name: 'S',  min: 1200 },
      { name: 'S+', min: 1300 }
    ],
    GUARD: 40              // окно защиты от понижения
  };

  // Значения по умолчанию: к ним возвращает configure(null).
  const DEFAULTS = JSON.parse(JSON.stringify(CFG));

  /** Переопределить константы (из rating_config). Мелкий рекурсивный merge:
   *  ключи, которых нет в патче, остаются дефолтными. configure(null) — сброс. */
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

  /** Ожидание победы игрока с рейтингом ra против rb. */
  const expected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / CFG.SCALE));

  /** Множитель состава по среднему рейтингу участников. */
  function fieldWeight(avgRating) {
    if (avgRating == null) return 1;
    return 1 + CFG.FIELD_BETA * clamp((avgRating - CFG.START) / CFG.FIELD_SPAN, -1, 1);
  }

  /** Суммарный множитель прироста Эло. */
  function eloWeight(category, avgRating) {
    return (CFG.CATEGORY_W[category] ?? 1) * fieldWeight(avgRating);
  }

  /** Изменение рейтинга одного игрока за одну встречу. Целое — рейтинг всегда целый,
   *  обмен остаётся нулевым, т.к. проигравший теряет ровно эту же величину. */
  function delta(r, ropp, won, weight) {
    return Math.round(CFG.K * (weight == null ? 1 : weight) * ((won ? 1 : 0) - expected(r, ropp)));
  }

  /** Очки за место. place — 1-based, category — ключ CFG.PLACE. */
  function placePoints(category, place) {
    return (CFG.PLACE[category] || {})[place] || 0;
  }

  /** Применить встречу к state = { ratings }. Мутирует state. Обмен нулевой. */
  function applyEncounter(state, aId, bId, winnerId, weight) {
    const ra = state.ratings[aId] ?? CFG.START;
    const rb = state.ratings[bId] ?? CFG.START;
    const d = delta(ra, rb, winnerId === aId, weight);
    state.ratings[aId] = ra + d;
    state.ratings[bId] = rb - d;
    return state;
  }

  const tierIndex = name => CFG.TIERS.findIndex(t => t.name === name);

  /** Тир по рейтингу, без учёта истории. */
  function tierOf(r) {
    let t = CFG.TIERS[0];
    for (const x of CFG.TIERS) if (r >= x.min) t = x;
    return t.name;
  }

  /** Тир по итогам турнира. Вызывать ОДИН раз, после последней встречи
   *  и начисления очков за место.
   *  prevTier — тир игрока до этого турнира (или null для новичка). */
  function settleTier(r, prevTier) {
    const cur = tierIndex(tierOf(r));
    const prev = prevTier == null ? -1 : tierIndex(prevTier);
    if (prev < 0 || cur > prev) return CFG.TIERS[cur].name;      // повышение сразу
    if (cur === prev) return CFG.TIERS[cur].name;
    // понижение только при пробитии границы с запасом
    return r < CFG.TIERS[prev].min - CFG.GUARD
      ? CFG.TIERS[cur].name
      : CFG.TIERS[prev].name;
  }

  /** Обработать турнир целиком.
   *  state      — { ratings, tiers }, мутируется
   *  encounters — [{ player1_id, player2_id, winner_id }] в порядке проведения
   *  standings  — [{ player_id, place }] итоговые места (place 1-based)
   *  category   — 'fastcap' | 'main' | 'major'
   *  participants — список id всех участников (для среднего рейтинга) */
  function applyTournament(state, encounters, standings, category, participants) {
    state.ratings = state.ratings || {};
    state.tiers = state.tiers || {};
    const ids = participants || [...new Set(encounters.flatMap(e => [e.player1_id, e.player2_id]))];
    const avg = ids.reduce((s, id) => s + (state.ratings[id] ?? CFG.START), 0) / (ids.length || 1);
    const w = eloWeight(category, avg);

    for (const e of encounters) {
      if (!e.winner_id) continue;
      applyEncounter(state, e.player1_id, e.player2_id, e.winner_id, w);
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

  /** Полный пересчёт сезона.
   *  tournaments — [{ category, encounters, standings, participants }] в хронологии. */
  function buildSeason(tournaments) {
    const state = { ratings: {}, tiers: {} };
    for (const t of tournaments) {
      applyTournament(state, t.encounters, t.standings, t.category, t.participants);
    }
    return state;
  }

  g.Rating = {
    CFG, DEFAULTS, configure, expected, fieldWeight, eloWeight, delta, placePoints,
    applyEncounter, tierOf, settleTier, applyTournament, buildSeason
  };
})(typeof window !== 'undefined' ? window : globalThis);
