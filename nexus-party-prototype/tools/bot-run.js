/* Прогон партий ботами в Node для поиска ошибок движка: node tools/bot-run.js [партий] [игроков] */
globalThis.window = globalThis;
const path = require('path'), root = path.join(__dirname, '..');
for (const f of ['js/data/map.js', 'js/data/rules.js', 'js/data/events.js', 'js/engine/game.js', 'js/engine/events.js', 'js/engine/globals.js']) {
  try { require(path.join(root, f)); } catch (e) { if (!/events\.js$/.test(f) || !/Cannot find/.test(e.message)) throw e; }
}
const NP = globalThis.NP;
const N = +process.argv[2] || 50, PL = +process.argv[3] || 4, MODE = process.argv[4] || 'full';
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => a.map(x => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
let stats = { games: 0, rounds: 0, th: 0, pts: [], choices: 0, events: 0 };
async function one(seed) {
  const names = Array.from({ length: PL }, (_, i) => 'P' + (i + 1));
  const S = NP.Game.create({ seed, threshold: 100, mode: MODE }, names);
  let g;
  const io = {
    choose: async s => { stats.choices++; const o = s.options.filter(x => !x.disabled); return pick(o).value; },
    fight: async s => {
      const val = () => Math.random() < .05 ? null : Math.floor(Math.random() * 600); // иногда игрок не вводит результат
      if (s.kind === 'duels') return { results: s.pairs.map(p => ({ [p[0]]: val(), [p[1]]: val() })) };
      const results = {}; for (const i of s.players) results[i] = val();
      if (s.kind === 'hunt') return { results, bonus: {} };
      const bonus = {}; for (const i of s.players) if (Math.random() < .3) bonus[i] = pick(s.mods.length ? s.mods : [{ pts: 0 }]).pts;
      return { results, bonus };
    },
    eventCard: async s => { stats.events++; const c = s.card; const k = Math.floor(Math.random() * c.options.length); const o = c.options[k]; for (const ch of (o ? o.chips : []).filter(x => x.k !== 'roll').slice(0, 1)) g.gm(() => NP.Events.applyChip(g, g.P[s.player], ch)); return k; },
    notice: async () => { }, log: () => { }, update: () => { }
  };
  g = new NP.Game(io, S);
  await g.run();
  stats.games++; stats.rounds += S.log.filter(l => /^— Раунд/.test(l.m)).length; if (S.endReason === 'threshold') stats.th++;
  stats.pts.push(Math.max(...S.players.map(p => p.pts)));
  for (const p of S.players) if (p.pts < 0 || p.items.length > S.cfg.slots) throw new Error('инвариант нарушен');
}
(async () => {
  for (let k = 0; k < N; k++) await one(1000 + k);
  console.log(JSON.stringify({ games: stats.games, avgRounds: (stats.rounds / N).toFixed(1), thresholdWins: stats.th, avgWinPts: (stats.pts.reduce((a, b) => a + b, 0) / N).toFixed(1), events: stats.events, choicesPerGame: Math.round(stats.choices / N) }));
})().catch(e => { console.error(e); process.exit(1); });
