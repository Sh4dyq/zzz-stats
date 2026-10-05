/* Админка → «Карта Party»: визуальный редактор карты Nexus Party.
   Клетки, связи (кривые, изломы, направление по кругу), зоны-регионы, маркеры, слои,
   поиск, буфер обмена, выравнивание, миникарта и закладки вида, симуляция прохода,
   метрики веток, цели по типам, свои поля клеток, undo/redo, автосохранение, версии,
   несколько карт, импорт/экспорт (JSON, TSV для листа «Клетки карты», SVG, PNG).
   Хранение: Supabase party_maps / party_map_versions (см. sql/party_map.sql). В dev — localStorage.
   Идеи на будущее — docs/party-map.md. */

const PM = {
  maps: [], mapId: null, name: '', data: null,
  tool: 'select', sel: new Set(), hist: [], fut: [],
  view: { x: 0, y: 0, k: 1 }, dirty: false, saveT: null, status: '',
  drag: null, linkFrom: null, zoneDraft: null, overlay: 'none', filter: '', findIdx: 0, sim: null,
  opt: {
    ids: true, types: true, labels: true, grid: true, snap: true, autoRegion: true, autosave: true, smooth: true, arrows: true, minimap: true,
    layers: { zones: { v: true, l: false }, edges: { v: true, l: false }, cells: { v: true, l: false }, markers: { v: true, l: false } }
  }
};
try { const o = JSON.parse(localStorage.getItem('pm_opt') || 'null'); if (o) PM.opt = Object.assign(PM.opt, o, { layers: Object.assign(PM.opt.layers, o.layers || {}) }); } catch (e) { }
const pmSaveOpt = () => { try { localStorage.setItem('pm_opt', JSON.stringify(PM.opt)); } catch (e) { } };

const PM_TYPES = [
  ['Start', '#f5c842', 'S'], ['Общий бой', '#ff1f44', '⚔'], ['Дуэль', '#ec1862', '1v1'], ['Охота', '#b0003a', '◎'],
  ['Сундук', '#c88a2c', '▣'], ['Событие', '#a970ff', '?'], ['Казино', '#46d369', '$'], ['Гача', '#2dd4bf', 'G'],
  ['Ломбард', '#94a3b8', '₽'], ['Телепорт', '#38bdf8', '⇄'], ['Тайник', '#facc15', '★'], ['Жнец', '#64748b', '☠'],
  ['Очки', '#c4f500', '+'], ['Опасность', '#f97316', '!'], ['Гибрид', '#e879f9', '◐']
];
const PM_TARGETS = { 'Start': 1, 'Общий бой': 6, 'Дуэль': 2, 'Охота': 2, 'Сундук': 8, 'Событие': 11, 'Казино': 3, 'Гача': 2, 'Ломбард': 1, 'Телепорт': 4, 'Тайник': 1, 'Жнец': 3, 'Очки': 4, 'Опасность': 4, 'Гибрид': 8 };
const PM_REGIONS = [
  ['Шестая улица', '#38bdf8', 'Ш', 520, 150], ['Блейзвуд', '#ff3b5c', 'Б', 1180, 380],
  ['Вейфей', '#46d369', 'В', 620, 680], ['Розкелифер', '#b79cff', 'Р', 330, 360]
];
const PM_ICONS = ['★', '⬇', '➜', '⚑', '⚠', '🔒', '🚚', '⛩', '☁', '◆', '●', '▲', '✚', '♛', '⚡', '💀', '🎰', '📦', 'T'];
const PM_SEED = 'S|Start|Ш01,Р01;Ш01|Очки|S,Ш02,Ш08;Ш02|Сундук|Ш01,Ш03,Ш06;Ш03|Жнец|Ш02,Ш04;Ш04|Гибрид|Ш03,Ш05;Ш05|Гача|Ш04,Ш13;Ш06|Событие|Ш02,Ш07;Ш07|Гибрид|Ш06,Ш11;Ш08|Общий бой|Ш01,Ш09;Ш09|Гибрид|Ш08,Ш10;Ш10|Сундук|Ш09,Ш11,Ш12;Ш11|Казино|Ш07,Ш10,Ш12;Ш12|Событие|Ш10,Ш11,Ш13,Ш15;Ш13|Очки|Ш05,Ш12,Ш14;Ш14|Сундук|Ш13,Ш15,Б01;Ш15|Опасность|Ш12,Ш14,Б01;Б01|Телепорт|Ш14,Ш15,Б02,Б06;Б02|Событие|Б01,Б03,Б06;Б03|Сундук|Б02,Б04;Б04|Очки|Б03,Б05;Б05|Общий бой|Б04,Б10,Б12;Б06|Общий бой|Б01,Б02,Б07,Б09,Б11;Б07|Гибрид|Б06,Б08;Б08|Событие|Б07,Б10;Б09|Жнец|Б06,Б10;Б10|Опасность|Б05,Б08,Б09,Б11,Б12;Б11|Гибрид|Б06,Б10,Б12;Б12|Охота|Б05,Б10,Б11,Б14;Б13|Казино|Б14,Б15;Б14|Гибрид|Б12,Б13,Б16;Б15|Телепорт|Б13,Б16,В05,В07;Б16|Сундук|Б14,Б15;В01|Общий бой|В02,В03,Р16;В02|Событие|В01,В03,В04;В03|Событие|В01,В02,В08,В09;В04|Телепорт|В02,В09;В05|Гибрид|Б15,В06;В06|Событие|В05,В07,В08,В10;В07|Гибрид|Б15,В06,В11;В08|Опасность|В03,В06,В09,В11;В09|Дуэль|В03,В04,В08,В10;В10|Гача|В06,В09,В11,В12;В11|Тайник|В07,В08,В10,В12;В12|Сундук|В10,В11;Р01|Ломбард|S,Р02,Р03;Р02|Очки|Р01,Р07;Р03|Общий бой|Р01,Р04,Р06;Р04|Сундук|Р03,Р05;Р05|Событие|Р04,Р06,Р12;Р06|Опасность|Р03,Р05,Р09,Р11;Р07|Событие|Р02,Р08;Р08|Дуэль|Р07,Р09,Р10;Р09|Событие|Р06,Р08,Р11;Р10|Жнец|Р08,Р15;Р11|Казино|Р06,Р09,Р12,Р15;Р12|Охота|Р05,Р11,Р13;Р13|Общий бой|Р12,Р14;Р14|Телепорт|Р13,Р15,Р16;Р15|Событие|Р10,Р11,Р14;Р16|Сундук|В01,Р14';

/* ---------- utils ---------- */
const pmUid = () => Math.random().toString(36).slice(2, 10);
const pmClone = o => JSON.parse(JSON.stringify(o));
const pmEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pmJs = s => pmEsc(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const pmCell = uid => PM.data.cells.find(c => c.uid === uid);
const pmType = key => PM.data.types.find(t => t.key === key) || { key, color: '#666', short: '·' };
const pmRegion = name => PM.data.regions.find(r => r.name === name);
const pmIsDev = () => !!window.DEV_PREVIEW;
const pmLayer = n => PM.opt.layers[n] || { v: true, l: false };

function pmEmpty(name) {
  return {
    v: 2, name: name || 'Новая карта',
    types: PM_TYPES.map(([key, color, short]) => ({ key, color, short })),
    regions: PM_REGIONS.map(([name, color, prefix]) => ({ id: pmUid(), name, color, prefix, points: [] })),
    cells: [], edges: [], markers: [], grid: 20, views: [], targets: Object.assign({}, PM_TARGETS), fields: [],
    flow: { on: true, exits: [], neg: ['Опасность', 'Жнец'], pos: ['Очки', 'Сундук', 'Тайник'] }
  };
}

/* Сид из листа «Клетки карты»: id|тип|соседи; позиции — кластеры регионов + раскладка сил. */
function pmSeed() {
  const d = pmEmpty('Nexus Party — из таблицы');
  const byId = {};
  PM_SEED.split(';').forEach(row => {
    const [id, type] = row.split('|');
    const reg = PM_REGIONS.find(r => r[2] === id[0]);
    const cx = reg ? reg[3] : 170, cy = reg ? reg[4] : 90;
    const c = { uid: pmUid(), id, type, region: reg ? reg[0] : '', x: cx + (Math.random() - .5) * 200, y: cy + (Math.random() - .5) * 160, label: '', note: '', variants: type === 'Гибрид' ? 'Все, кроме Тайника' : '', branch: '', gimmick: '', status: '🟡 Предложено', props: {} };
    if (id === 'S') { c.x = 170; c.y = 90; }
    byId[id] = c; d.cells.push(c);
  });
  const seen = new Set();
  PM_SEED.split(';').forEach(row => {
    const [id, , nb] = row.split('|');
    (nb || '').split(',').filter(Boolean).forEach(n => {
      const a = byId[id], b = byId[n.trim()];
      if (!a || !b) return;
      const k = [a.uid, b.uid].sort().join('-');
      if (seen.has(k)) return; seen.add(k);
      d.edges.push({ id: pmUid(), a: a.uid, b: b.uid, mode: 'auto', pts: [], curve: 0 });
    });
  });
  if (byId['Ш01']) d.flow.exits = [byId['Ш01'].uid];
  pmLayout(d, 400, true);
  pmHulls(d);
  return d;
}

/* ---------- геометрия ---------- */
function pmInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pmHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function pmHulls(d, onlyEmpty) {
  d.regions.forEach(r => {
    if (onlyEmpty && r.points.length) return;
    const cs = d.cells.filter(c => c.region === r.name);
    if (!cs.length) return;
    const pad = 46, pts = [];
    cs.forEach(c => { for (let a = 0; a < 8; a++) pts.push([c.x + Math.cos(a * Math.PI / 4) * pad, c.y + Math.sin(a * Math.PI / 4) * pad]); });
    r.points = pmHull(pts).map(([x, y]) => [Math.round(x), Math.round(y)]);
  });
}
function pmLayout(d, iters, cluster) {
  const cs = d.cells, idx = new Map(cs.map((c, i) => [c.uid, i]));
  const centers = {};
  if (cluster) PM_REGIONS.forEach(r => centers[r[0]] = [r[3], r[4]]);
  else d.regions.forEach(r => {
    const m = cs.filter(c => c.region === r.name);
    if (m.length) centers[r.name] = [m.reduce((s, c) => s + c.x, 0) / m.length, m.reduce((s, c) => s + c.y, 0) / m.length];
  });
  for (let it = 0; it < iters; it++) {
    const t = 1 - it / iters, fx = new Float64Array(cs.length), fy = new Float64Array(cs.length);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const dx = cs[i].x - cs[j].x, dy = cs[i].y - cs[j].y, dd = dx * dx + dy * dy + .01;
      if (dd > 90000) continue;
      const f = 2600 / dd, dist = Math.sqrt(dd);
      fx[i] += dx / dist * f; fy[i] += dy / dist * f; fx[j] -= dx / dist * f; fy[j] -= dy / dist * f;
    }
    d.edges.forEach(e => {
      const i = idx.get(e.a), j = idx.get(e.b); if (i == null || j == null) return;
      const dx = cs[j].x - cs[i].x, dy = cs[j].y - cs[i].y, dist = Math.sqrt(dx * dx + dy * dy) + .01;
      const L = cs[i].region === cs[j].region ? 70 : 160, f = (dist - L) * .06;
      fx[i] += dx / dist * f; fy[i] += dy / dist * f; fx[j] -= dx / dist * f; fy[j] -= dy / dist * f;
    });
    cs.forEach((c, i) => {
      const ce = centers[c.region];
      if (ce) { fx[i] += (ce[0] - c.x) * .02; fy[i] += (ce[1] - c.y) * .02; }
      if (c.pin) return;
      const m = Math.min(12, Math.hypot(fx[i], fy[i])) * t, a = Math.atan2(fy[i], fx[i]);
      if (isFinite(a)) { c.x += Math.cos(a) * m; c.y += Math.sin(a) * m; }
    });
  }
  cs.forEach(c => { c.x = Math.round(c.x); c.y = Math.round(c.y); });
}

/* ---------- направление движения ----------
   mode: auto (по кругу от Start) | both | ab (a→b) | ba (b→a).
   Авто: из Start выходим только в flow.exits, остальные соседи Start — входы (→Start);
   дальше направление «от меньшего расстояния от Start к большему», равные — в обе стороны. */
function pmDirs() {
  const d = PM.data, out = {}, start = d.cells.find(c => c.type === 'Start');
  let pot = {};
  if (d.flow && d.flow.on && start) {
    const exits = new Set(d.flow.exits || []), fw = {}, bw = {};
    const add = (m, u, v) => (m[u] = m[u] || []).push(v);
    d.edges.forEach(e => {
      if (e.mode === 'ab' || e.mode === 'ba') {
        const [f, t] = e.mode === 'ab' ? [e.a, e.b] : [e.b, e.a];
        if (t !== start.uid) add(fw, f, t);
        if (f !== start.uid) add(bw, t, f);
        return;
      }
      [[e.a, e.b], [e.b, e.a]].forEach(([u, v]) => {
        // вперёд от Start: только через выходы; назад к Start: только через входы
        if (v !== start.uid && !(u === start.uid && !exits.has(v))) add(fw, u, v);
        if (v !== start.uid && !(u === start.uid && exits.has(v))) add(bw, u, v);
      });
    });
    const bfs = m => { const dist = { [start.uid]: 0 }, q = [start.uid]; while (q.length) { const u = q.shift(); (m[u] || []).forEach(v => { if (dist[v] == null) { dist[v] = dist[u] + 1; q.push(v); } }); } return dist; };
    const dF = bfs(fw), dB = bfs(bw);
    // потенциал: «сколько прошли» минус «сколько осталось» — растёт по ходу движения и не даёт тупиков на внутренних кольцах
    d.cells.forEach(c => { if (dF[c.uid] != null && dB[c.uid] != null) pot[c.uid] = dF[c.uid] - dB[c.uid]; else if (dF[c.uid] != null) pot[c.uid] = dF[c.uid] * 2; });
  }
  d.edges.forEach(e => {
    let r;
    if (e.mode === 'ab') r = { f: e.a, t: e.b };
    else if (e.mode === 'ba') r = { f: e.b, t: e.a };
    else if (e.mode === 'both' || !(d.flow && d.flow.on && start)) r = { both: true };
    else if (e.a === start.uid || e.b === start.uid) {
      const o = e.a === start.uid ? e.b : e.a;
      r = (d.flow.exits || []).includes(o) ? { f: start.uid, t: o } : { f: o, t: start.uid };
    } else {
      const pa = pot[e.a], pb = pot[e.b];
      r = pa == null || pb == null || pa === pb ? { both: true } : pa < pb ? { f: e.a, t: e.b } : { f: e.b, t: e.a };
    }
    r.auto = !e.mode || e.mode === 'auto';
    out[e.id] = r;
  });
  return out;
}
/* Смежность для движения: strict=true — только однозначные направления (для веток/длиннейшего круга). */
function pmAdj(strict) {
  const dirs = pmDirs(), adj = {};
  PM.data.edges.forEach(e => {
    const r = dirs[e.id];
    if (r.both) { if (strict) return; (adj[e.a] = adj[e.a] || []).push(e.b); (adj[e.b] = adj[e.b] || []).push(e.a); }
    else (adj[r.f] = adj[r.f] || []).push(r.t);
  });
  return adj;
}
function pmDistMap() {
  const start = PM.data.cells.find(c => c.type === 'Start'); if (!start) return {};
  const adj = pmAdj(), dist = { [start.uid]: 0 }, q = [start.uid];
  while (q.length) { const u = q.shift(); (adj[u] || []).forEach(v => { if (dist[v] == null) { dist[v] = dist[u] + 1; q.push(v); } }); }
  return dist;
}
/* Сколько шагов осталось до Start по направлению движения. */
function pmToStart(adj) {
  const start = PM.data.cells.find(c => c.type === 'Start'); if (!start) return {};
  const rev = {}; Object.entries(adj).forEach(([u, vs]) => vs.forEach(v => (rev[v] = rev[v] || []).push(u)));
  const dist = { [start.uid]: 0 }, q = [start.uid];
  while (q.length) { const u = q.shift(); (rev[u] || []).forEach(v => { if (dist[v] == null) { dist[v] = dist[u] + 1; q.push(v); } }); }
  return dist;
}

/* ---------- история ---------- */
function pmPush() {
  PM.hist.push(JSON.stringify(PM.data));
  if (PM.hist.length > 120) PM.hist.shift();
  PM.fut = [];
  pmTouch();
}
function pmUndo() { if (!PM.hist.length) return; PM.fut.push(JSON.stringify(PM.data)); PM.data = JSON.parse(PM.hist.pop()); PM.sel.clear(); pmTouch(); pmRender(); }
function pmRedo() { if (!PM.fut.length) return; PM.hist.push(JSON.stringify(PM.data)); PM.data = JSON.parse(PM.fut.pop()); PM.sel.clear(); pmTouch(); pmRender(); }
function pmTouch() {
  PM.dirty = true; PM.sim = null; pmSetStatus('Изменено');
  try { localStorage.setItem('pm_draft_' + (PM.mapId || 'local'), JSON.stringify(PM.data)); } catch (e) { }
  if (PM.opt.autosave) { clearTimeout(PM.saveT); PM.saveT = setTimeout(() => pmSave(true), 1800); }
}
function pmSetStatus(s) { PM.status = s; const el = document.getElementById('pm-status'); if (el) el.textContent = s; }

/* ---------- хранилище ---------- */
async function pmLoadList() {
  if (pmIsDev()) {
    try { PM.maps = JSON.parse(localStorage.getItem('pm_dev_maps') || '[]'); } catch (e) { PM.maps = []; }
    return true;
  }
  const { data, error } = await sb.from('party_maps').select('id,name,updated_at').order('updated_at', { ascending: false });
  if (error) { PM.err = error; return false; }
  PM.maps = data || []; return true;
}
async function pmOpen(id) {
  if (pmIsDev()) {
    const m = PM.maps.find(x => x.id === id); if (!m) return;
    PM.mapId = id; PM.name = m.name; PM.data = m.data;
  } else {
    const { data, error } = await sb.from('party_maps').select('*').eq('id', id).maybeSingle();
    if (dbErr(error, 'загрузка карты') || !data) return;
    PM.mapId = id; PM.name = data.name; PM.data = data.data && data.data.cells ? data.data : pmEmpty(data.name);
  }
  pmNormalize(PM.data);
  PM.hist = []; PM.fut = []; PM.sel.clear(); PM.dirty = false; PM.sim = null; PM.filter = '';
  localStorage.setItem('pm_last', id);
  pmShell(); pmFit(); pmSetStatus('Загружено');
}
function pmNormalize(d) {
  const e0 = pmEmpty();
  ['types', 'regions', 'cells', 'edges', 'markers', 'views', 'fields'].forEach(k => d[k] = d[k] || []);
  d.targets = d.targets || e0.targets;
  d.flow = Object.assign(e0.flow, d.flow || {});
  d.cells.forEach(c => { c.uid = c.uid || pmUid(); c.props = c.props || {}; });
  d.edges.forEach(e => { e.id = e.id || pmUid(); if (!e.mode) e.mode = e.dir ? 'ab' : 'auto'; delete e.dir; e.pts = e.pts || []; e.curve = e.curve || 0; });
  d.regions.forEach(r => { r.id = r.id || pmUid(); r.points = r.points || []; });
  const s = d.cells.find(c => c.type === 'Start');
  if (s && !d.flow.exits.length) { const e = d.edges.find(x => x.a === s.uid || x.b === s.uid); if (e) d.flow.exits = [e.a === s.uid ? e.b : e.a]; }
  d.v = 2;
}
async function pmInsertMap(name, data) {
  if (pmIsDev()) {
    const id = pmUid(); PM.maps.unshift({ id, name, data, updated_at: new Date().toISOString() });
    localStorage.setItem('pm_dev_maps', JSON.stringify(PM.maps)); return id;
  }
  const { data: row, error } = await sb.from('party_maps').insert({ name, data }).select('id').single();
  if (dbErr(error, 'создание карты')) return null;
  await pmLoadList(); return row.id;
}
async function pmCreate(fromSeed) {
  const name = prompt('Название карты', fromSeed ? 'Nexus Party — из таблицы' : 'Новая карта'); if (name == null) return;
  const data = fromSeed ? pmSeed() : pmEmpty(name); data.name = name;
  const id = await pmInsertMap(name, data); if (id) pmOpen(id);
}
async function pmSaveAs() {
  const name = prompt('Название копии', PM.name + ' (копия)'); if (!name) return;
  await pmSave();
  const data = pmClone(PM.data); data.name = name;
  const id = await pmInsertMap(name, data); if (id) { toast('Копия создана'); pmOpen(id); }
}
async function pmSave(auto) {
  if (!PM.data || !PM.dirty) return;
  clearTimeout(PM.saveT);
  pmSetStatus('Сохраняю…');
  PM.data.name = PM.name;
  if (pmIsDev()) {
    const m = PM.maps.find(x => x.id === PM.mapId);
    if (m) { m.data = PM.data; m.name = PM.name; m.updated_at = new Date().toISOString(); }
    localStorage.setItem('pm_dev_maps', JSON.stringify(PM.maps));
  } else {
    const { error } = await sb.from('party_maps').update({ name: PM.name, data: PM.data, updated_at: new Date().toISOString() }).eq('id', PM.mapId);
    if (error) { pmSetStatus('Ошибка сохранения'); if (!auto) dbErr(error, 'сохранение карты'); return; }
    const m = PM.maps.find(x => x.id === PM.mapId); if (m) m.name = PM.name;
  }
  PM.dirty = false; pmSetStatus('Сохранено ' + new Date().toLocaleTimeString().slice(0, 5));
}
async function pmSnapshot() {
  const label = prompt('Название версии', new Date().toLocaleString()); if (label == null) return;
  PM.dirty = true; await pmSave();
  if (pmIsDev()) {
    const all = JSON.parse(localStorage.getItem('pm_dev_ver') || '[]');
    all.unshift({ id: pmUid(), map_id: PM.mapId, label, data: pmClone(PM.data), created_at: new Date().toISOString() });
    localStorage.setItem('pm_dev_ver', JSON.stringify(all.slice(0, 50)));
  } else {
    const { error } = await sb.from('party_map_versions').insert({ map_id: PM.mapId, label, data: PM.data });
    if (dbErr(error, 'сохранение версии')) return;
  }
  toast('Версия сохранена'); if (PM.panel === 'versions') pmPanel('versions');
}
async function pmVersions() {
  if (pmIsDev()) return JSON.parse(localStorage.getItem('pm_dev_ver') || '[]').filter(v => v.map_id === PM.mapId);
  const { data, error } = await sb.from('party_map_versions').select('id,label,created_at').eq('map_id', PM.mapId).order('created_at', { ascending: false }).limit(50);
  if (dbErr(error, 'список версий')) return [];
  return data || [];
}
async function pmRestore(vid) {
  if (!confirm('Восстановить эту версию? Текущее состояние уйдёт в историю отмены.')) return;
  let data;
  if (pmIsDev()) data = (JSON.parse(localStorage.getItem('pm_dev_ver') || '[]').find(v => v.id === vid) || {}).data;
  else { const r = await sb.from('party_map_versions').select('data').eq('id', vid).single(); if (dbErr(r.error, 'версия')) return; data = r.data.data; }
  if (!data) return;
  pmPush(); PM.data = pmClone(data); pmNormalize(PM.data); PM.sel.clear(); pmRender(); toast('Версия восстановлена');
}
async function pmDeleteMap() {
  if (!confirm('Удалить карту «' + PM.name + '» и все её версии?')) return;
  if (pmIsDev()) { PM.maps = PM.maps.filter(m => m.id !== PM.mapId); localStorage.setItem('pm_dev_maps', JSON.stringify(PM.maps)); }
  else { const { error } = await sb.from('party_maps').delete().eq('id', PM.mapId); if (dbErr(error, 'удаление карты')) return; }
  PM.mapId = null; PM.data = null; localStorage.removeItem('pm_last'); await pmLoadList(); pmPicker();
}

/* ---------- вход на страницу ---------- */
async function pgPartyMap() {
  if (!(await pmLoadList())) { html(`<div class="card"><h3>Ошибка</h3><div style="color:#f87171">${pmEsc(PM.err && PM.err.message)}</div><div class="pm-mini" style="margin-top:8px">Если таблиц нет — выполни <code>sql/party_map.sql</code> в Supabase.</div></div>`); return; }
  const last = localStorage.getItem('pm_last');
  if (PM.data && PM.mapId) { pmShell(); return; }
  if (last && PM.maps.find(m => m.id === last)) return pmOpen(last);
  pmPicker();
}
function pmPicker() {
  html(`<div class="card" style="max-width:720px">
    <h3>Карты Nexus Party</h3>
    <div class="space-y" style="margin-bottom:16px">${PM.maps.length ? PM.maps.map(m => `
      <div class="row-item"><div><b>${pmEsc(m.name)}</b><div style="font-size:12px;color:var(--sub)">${m.updated_at ? new Date(m.updated_at).toLocaleString() : ''}</div></div>
      <button class="btn btn-g" onclick="pmOpen('${m.id}')">Открыть</button></div>`).join('') : '<div style="color:var(--sub)">Карт пока нет.</div>'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-y" onclick="pmCreate(true)">Создать из таблицы (60 клеток)</button>
      <button class="btn btn-g" onclick="pmCreate(false)">Пустая карта</button>
    </div></div>`);
}

/* ---------- каркас редактора ---------- */
function pmShell() {
  const pc = document.getElementById('page-content');
  pc.style.maxWidth = 'none'; pc.style.padding = '0';
  const tools = [['select', 'V', 'Выбор', '<path d="M5 3l14 8-6 2-2 6z"/>'], ['cell', 'C', 'Клетка', '<circle cx="12" cy="12" r="7"/>'], ['link', 'L', 'Связь', '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 16l8-8"/>'],
    ['zone', 'Z', 'Зона', '<path d="M4 8l6-4 10 5-3 10-11-2z"/>'], ['marker', 'M', 'Маркер', '<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>'], ['pan', 'H', 'Рука', '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.3-2L8 14"/>']];
  html(`<style>
    .pm-wrap{display:flex;height:calc(100vh - 74px);min-height:520px}
    .pm-tools{width:52px;border-right:1px solid var(--border);display:flex;flex-direction:column;gap:4px;padding:8px 6px;background:#0d0d10}
    .pm-tb{width:40px;height:40px;border-radius:9px;border:1px solid transparent;background:none;color:var(--sub);cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative}
    .pm-tb svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .pm-tb:hover{background:var(--panel-2);color:var(--text)} .pm-tb.on{background:rgba(255,31,68,.15);color:#fff;border-color:rgba(255,31,68,.4)}
    .pm-tb i{position:absolute;right:3px;bottom:1px;font-size:9px;font-style:normal;font-family:'JetBrains Mono',monospace;opacity:.6}
    .pm-mid{flex:1;display:flex;flex-direction:column;min-width:0}
    .pm-top{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--border);flex-wrap:wrap;background:#0d0d10}
    .pm-top .btn{padding:6px 11px;font-size:13px} .pm-top select,.pm-top input[type=text],.pm-top input[type=search]{width:auto;padding:6px 9px;font-size:13px}
    .pm-canvas{flex:1;position:relative;overflow:hidden;background:#09090b}
    .pm-canvas>svg{width:100%;height:100%;display:block;user-select:none}
    .pm-side{width:330px;border-left:1px solid var(--border);overflow:auto;background:#0d0d10;padding:12px}
    .pm-tabs{display:flex;gap:3px;margin-bottom:12px;flex-wrap:wrap}
    .pm-tab{flex:1;font-size:12px;padding:6px 4px;border-radius:7px;border:1px solid var(--border);background:var(--panel-2);color:var(--sub);cursor:pointer;font-family:'Rajdhani';font-weight:600;min-width:62px}
    .pm-tab.on{color:#fff;border-color:var(--accent)}
    .pm-f{margin-bottom:10px} .pm-f input,.pm-f select,.pm-f textarea{padding:7px 9px;font-size:13px}
    .pm-row{display:flex;gap:6px;align-items:center} .pm-row>*{flex:1}
    .pm-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:7px;background:var(--panel-2);border:1px solid var(--border);font-size:12px;margin:0 4px 4px 0;cursor:pointer}
    .pm-chip.bad{border-color:#7a4a10}.pm-chip.good{border-color:#14532d}
    .pm-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0}
    .pm-warn{font-size:12px;padding:6px 8px;border-radius:7px;background:#1d1408;border:1px solid #4a3410;color:#f5c842;margin-bottom:5px;cursor:pointer}
    .pm-ok{font-size:12px;padding:6px 8px;border-radius:7px;background:#052e16;border:1px solid #14532d;color:#4ade80}
    .pm-hint{position:absolute;left:10px;bottom:8px;font-size:12px;color:var(--sub);background:rgba(13,13,16,.85);border:1px solid var(--border);border-radius:7px;padding:4px 9px;pointer-events:none;font-family:'JetBrains Mono',monospace;max-width:calc(100% - 240px)}
    .pm-mini{font-size:11px;color:var(--sub)}
    .pm-icons{display:flex;flex-wrap:wrap;gap:4px}.pm-icons button{width:32px;height:32px;border-radius:7px;border:1px solid var(--border);background:var(--panel-2);color:#fff;cursor:pointer;font-size:15px}
    .pm-icons button.on{border-color:var(--accent)}
    .pm-menu{position:relative}.pm-menu>div{position:absolute;top:100%;left:0;z-index:30;background:var(--field-2);border:1px solid var(--border);border-radius:8px;padding:4px;display:none;min-width:260px;box-shadow:0 12px 32px rgba(0,0,0,.5)}
    .pm-menu.open>div{display:block}.pm-menu>div a{display:block;padding:7px 9px;border-radius:6px;cursor:pointer;font-size:13px;color:var(--text)}.pm-menu>div a:hover{background:var(--panel-3)}
    .pm-menu>div hr{border:none;border-top:1px solid var(--border);margin:4px 0}
    .pm-mm{position:absolute;right:10px;bottom:10px;width:210px;height:150px;background:rgba(13,13,16,.92);border:1px solid var(--border);border-radius:9px;overflow:hidden;cursor:pointer}
    .pm-mm svg{width:100%;height:100%;display:block}
    .pm-al{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:10px}.pm-al button{height:30px;border-radius:7px;border:1px solid var(--border);background:var(--panel-2);color:var(--text);cursor:pointer;font-size:12px}
    .pm-al button:hover{background:var(--panel-3)}
    .pm-tbl{width:100%;border-collapse:collapse;font-size:12px}.pm-tbl td{padding:4px 5px;border-bottom:1px solid var(--border)}.pm-tbl tr{cursor:pointer}.pm-tbl tr:hover{background:var(--panel-2)}
    .pm-bar{height:6px;border-radius:3px;background:var(--grad)}
    .pm-lay{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;font-size:13px;margin-bottom:6px}
  </style>
  <div class="pm-wrap">
    <div class="pm-tools">${tools.map(([k, key, t, svg]) => `<button class="pm-tb" data-tool="${k}" title="${t} (${key})" onclick="pmTool('${k}')"><svg viewBox="0 0 24 24">${svg}</svg><i>${key}</i></button>`).join('')}
      <div style="flex:1"></div>
      <button class="pm-tb" title="Отменить (Ctrl+Z)" onclick="pmUndo()"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>
      <button class="pm-tb" title="Повторить (Ctrl+Y)" onclick="pmRedo()"><svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg></button>
      <button class="pm-tb" title="Показать всё (F)" onclick="pmFit()"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
    </div>
    <div class="pm-mid">
      <div class="pm-top">
        <select id="pm-mapsel" onchange="pmSwitch(this.value)" title="Карта">${PM.maps.map(m => `<option value="${m.id}" ${m.id === PM.mapId ? 'selected' : ''}>${pmEsc(m.name)}</option>`).join('')}<option value="__new">+ новая карта…</option></select>
        <input type="text" id="pm-name" value="${pmEsc(PM.name)}" style="width:170px" title="Название карты" onchange="PM.name=this.value;pmTouch()">
        <button class="btn btn-y" onclick="pmSave()">Сохранить</button>
        <div class="pm-menu" id="pm-m-file"><button class="btn btn-g" onclick="pmMenu('pm-m-file')">Файл ▾</button><div>
          <a onclick="pmSaveAs()">Сохранить как копию…</a><a onclick="pmSnapshot()">Сохранить версию…</a><a onclick="pmPicker()">Список карт</a><hr>
          <a onclick="pmExportJSON()">Скачать JSON</a><a onclick="pmImportJSON()">Загрузить JSON…</a>
          <a onclick="pmExportTSV()">Копировать TSV для листа «Клетки карты»</a><a onclick="pmImportTSV()">Вставить TSV из листа…</a>
          <a onclick="pmExportSVG()">Скачать SVG</a><a onclick="pmExportPNG()">Скачать PNG</a><hr>
          <a onclick="pmDeleteMap()" style="color:#f87171">Удалить карту</a></div></div>
        <div class="pm-menu" id="pm-m-edit"><button class="btn btn-g" onclick="pmMenu('pm-m-edit')">Правка ▾</button><div>
          <a onclick="pmCopy()">Копировать (Ctrl+C)</a><a onclick="pmCopy(true)">Вырезать (Ctrl+X)</a><a onclick="pmPaste()">Вставить (Ctrl+V)</a><a onclick="pmDuplicate()">Дублировать (Ctrl+D)</a><hr>
          <a onclick="pmAlign('left')">Выровнять по левому краю</a><a onclick="pmAlign('cx')">Выровнять по центру (вертикаль)</a><a onclick="pmAlign('top')">Выровнять по верху</a><a onclick="pmAlign('cy')">Выровнять по центру (горизонталь)</a>
          <a onclick="pmAlign('dh')">Распределить по горизонтали</a><a onclick="pmAlign('dv')">Распределить по вертикали</a><a onclick="pmAlign('line')">Выстроить в линию (по крайним)</a><a onclick="pmAlign('circle')">Расставить по кругу</a></div></div>
        <div class="pm-menu" id="pm-m-tools"><button class="btn btn-g" onclick="pmMenu('pm-m-tools')">Инструменты ▾</button><div>
          <a onclick="pmAutoLayout(false)">Авто-раскладка (сохраняя регионы)</a><a onclick="pmAutoLayout(true)">Авто-раскладка выделенных</a>
          <a onclick="pmHullsCmd()">Перестроить контуры зон по клеткам</a><a onclick="pmAssignRegions()">Назначить регионы по зонам</a>
          <a onclick="pmRenumber()">Перенумеровать Id по регионам</a><a onclick="pmSnapAll()">Выровнять всё по сетке</a><hr>
          <a onclick="pmPanel('sim')">Симуляция прохода…</a><a onclick="pmPanel('check')">Проверка и метрики…</a></div></div>
        <input type="search" id="pm-q" placeholder="Поиск: Б07, тип:Событие регион:Вейфей" style="width:240px" value="${pmEsc(PM.filter)}" oninput="pmSearch(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();pmFindNext(event.shiftKey?-1:1)}if(event.key==='Escape'){this.value='';pmSearch('');this.blur()}">
        <span class="pm-mini" id="pm-qn"></span>
        <div style="flex:1"></div>
        <select id="pm-overlay" onchange="PM.overlay=this.value;pmRender()" title="Наложение">
          <option value="none">Без наложения</option><option value="dist">Шаги от Start</option><option value="deg">Число связей</option><option value="heat">Тепловая карта (симуляция)</option></select>
        <span class="pm-mini" id="pm-status">${PM.status}</span>
      </div>
      <div class="pm-canvas" id="pm-canvas"><svg id="pm-svg"></svg><div class="pm-hint" id="pm-hint"></div><div class="pm-mm" id="pm-mm" style="display:${PM.opt.minimap ? 'block' : 'none'}"><svg id="pm-mmsvg"></svg></div></div>
    </div>
    <div class="pm-side" id="pm-side"></div>
  </div>`);
  document.getElementById('pm-overlay').value = PM.overlay;
  pmBind(); pmTool(PM.tool); pmPanel(PM.panel || 'props'); pmRender();
}
function pmMenu(id) { document.querySelectorAll('.pm-menu').forEach(m => m.id !== id && m.classList.remove('open')); document.getElementById(id).classList.toggle('open'); }
document.addEventListener('click', e => {
  if (!e.target.closest) return;
  if (!e.target.closest('.pm-menu') || e.target.closest('.pm-menu>div a')) document.querySelectorAll('.pm-menu.open').forEach(m => m.classList.remove('open'));
});
async function pmSwitch(id) {
  if (id === '__new') { document.getElementById('pm-mapsel').value = PM.mapId; return pmCreate(confirm('Создать из таблицы (60 клеток)? «Отмена» — пустая карта.')); }
  if (PM.dirty) await pmSave();
  pmOpen(id);
}
function pmTool(t) {
  PM.tool = t; PM.linkFrom = null;
  if (t !== 'zone') PM.zoneDraft = null;
  document.querySelectorAll('.pm-tb[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  const hints = {
    select: 'Клик — выбрать · Shift — добавить · рамка по пустому · Пробел/правая кнопка — двигать холст · колесо — зум · двойной клик по связи — излом',
    cell: 'Клик по пустому — новая клетка выбранного типа (панель «Типы»)',
    link: 'Клик A, затем B · Shift — односторонняя A→B · Ctrl — цепочка · клик по связи — удалить',
    zone: 'Клики — точки контура · Enter/двойной клик — завершить · Esc — отмена',
    marker: 'Клик — маркер (по клетке — привязанный к ней)', pan: 'Перетаскивай холст'
  };
  const h = document.getElementById('pm-hint'); if (h) h.textContent = hints[t] || '';
  pmRender();
}

/* ---------- координаты ---------- */
function pmPt(e) {
  const r = document.getElementById('pm-svg').getBoundingClientRect();
  return { x: (e.clientX - r.left - PM.view.x) / PM.view.k, y: (e.clientY - r.top - PM.view.y) / PM.view.k };
}
const pmSnap = v => PM.opt.snap ? Math.round(v / (PM.data.grid || 20)) * (PM.data.grid || 20) : Math.round(v);
function pmBounds(cellsOnly) {
  const xs = [], ys = [];
  PM.data.cells.forEach(c => { xs.push(c.x); ys.push(c.y); });
  if (!cellsOnly) { PM.data.regions.forEach(r => r.points.forEach(([x, y]) => { xs.push(x); ys.push(y); })); PM.data.markers.forEach(m => { if (!m.cell) { xs.push(m.x); ys.push(m.y); } }); }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
function pmFitBox(b, maxK) {
  const svg = document.getElementById('pm-svg'); if (!svg) return;
  const W = svg.clientWidth || 900, H = svg.clientHeight || 600;
  const x0 = b.x0 - 60, x1 = b.x1 + 60, y0 = b.y0 - 60, y1 = b.y1 + 60;
  const k = Math.min(W / (x1 - x0), H / (y1 - y0), maxK || 2.5);
  PM.view = { k, x: (W - (x1 - x0) * k) / 2 - x0 * k, y: (H - (y1 - y0) * k) / 2 - y0 * k };
  pmRender();
}
function pmFit() {
  const svg = document.getElementById('pm-svg'); if (!svg || !PM.data) return;
  const b = pmBounds();
  if (!b) { PM.view = { x: (svg.clientWidth || 900) / 2, y: (svg.clientHeight || 600) / 2, k: 1 }; return pmRender(); }
  pmFitBox(b);
}
function pmCenterOn(x, y) {
  const svg = document.getElementById('pm-svg'); if (!svg) return;
  PM.view.x = (svg.clientWidth || 900) / 2 - x * PM.view.k; PM.view.y = (svg.clientHeight || 600) / 2 - y * PM.view.k; pmRender();
}

/* ---------- связи: геометрия ---------- */
function pmEdgePts(e) {
  const a = pmCell(e.a), b = pmCell(e.b); if (!a || !b) return null;
  return [[a.x, a.y], ...(e.pts || []), [b.x, b.y]];
}
function pmCatmull(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}
/* Возвращает {d, mid:[x,y], ang} — путь и точку/угол для стрелки. */
function pmEdgeGeom(e) {
  const P = pmEdgePts(e); if (!P) return null;
  if (P.length === 2 && e.curve) {
    const [a, b] = P, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const cx = mx - (b[1] - a[1]) / L * e.curve * L * .5, cy = my + (b[0] - a[0]) / L * e.curve * L * .5;
    const tx = (cx - a[0]) + (b[0] - cx), ty = (cy - a[1]) + (b[1] - cy);
    return { d: `M${a[0]},${a[1]}Q${cx},${cy} ${b[0]},${b[1]}`, mid: [(a[0] + 2 * cx + b[0]) / 4, (a[1] + 2 * cy + b[1]) / 4], ang: Math.atan2(ty, tx) };
  }
  let total = 0; const segs = [];
  for (let i = 0; i < P.length - 1; i++) { const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); segs.push(L); total += L; }
  let acc = 0, mid = P[0], ang = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= total / 2) { const t = (total / 2 - acc) / (segs[i] || 1); mid = [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t]; ang = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]); break; }
    acc += segs[i];
  }
  const d = P.length > 2 && PM.opt.smooth ? pmCatmull(P) : 'M' + P.map(p => p.join(',')).join('L');
  return { d, mid, ang };
}

/* ---------- отрисовка ---------- */
function pmSmooth(pts) {
  if (pts.length < 3 || !PM.opt.smooth) return 'M' + pts.map(p => p.join(',')).join('L') + 'Z';
  const n = pts.length, P = i => pts[(i + n) % n];
  let d = `M${P(0)[0]},${P(0)[1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d + 'Z';
}
function pmMatch(c, q) {
  if (!q) return true;
  if (!c) return false;
  const hay = (k) => ({ id: c.id, тип: c.type, type: c.type, регион: c.region, region: c.region, статус: c.status, гиммик: c.gimmick }[k]);
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(tok => {
    const m = tok.match(/^([^:]+):(.+)$/);
    if (m) { const v = hay(m[1]); if (v != null) return String(v).toLowerCase().includes(m[2]); const pv = (c.props || {})[m[1]]; return pv != null && String(pv).toLowerCase().includes(m[2]); }
    return [c.id, c.type, c.region, c.label, c.note, c.gimmick, c.variants, ...Object.values(c.props || {})].join(' ').toLowerCase().includes(tok);
  });
}
function pmRender() {
  const svg = document.getElementById('pm-svg'); if (!svg || !PM.data) return;
  const d = PM.data, k = PM.view.k, g = d.grid || 20, L = PM.opt.layers;
  const dist = PM.overlay === 'dist' ? pmDistMap() : null;
  const heat = PM.overlay === 'heat' && PM.sim ? PM.sim.land : null;
  const deg = {}; d.edges.forEach(e => { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
  const maxDist = dist ? Math.max(1, ...Object.values(dist)) : 1;
  const maxHeat = heat ? Math.max(1e-9, ...Object.values(heat)) : 1;
  const q = PM.filter.trim(), dirs = pmDirs();
  const pe = n => L[n].l ? 'pointer-events="none"' : '';
  let s = `<defs><pattern id="pm-grid" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path d="M${g} 0H0V${g}" fill="none" stroke="rgba(255,255,255,.045)" stroke-width="${1 / k}"/></pattern></defs>
    <rect x="-1e5" y="-1e5" width="2e5" height="2e5" fill="${PM.opt.grid ? 'url(#pm-grid)' : 'none'}" transform="translate(${PM.view.x},${PM.view.y}) scale(${k})"/>
    <g transform="translate(${PM.view.x},${PM.view.y}) scale(${k})">`;
  if (L.zones.v) d.regions.forEach(r => {
    if (r.points.length < 2) return;
    const on = PM.sel.has('z:' + r.id);
    s += `<path d="${pmSmooth(r.points)}" fill="${r.color}" fill-opacity="${r.hidden ? 0 : .06}" stroke="${r.color}" stroke-width="${on ? 3.5 : 2.2}" stroke-opacity="${r.hidden ? .15 : .9}" data-zone="${r.id}" style="cursor:pointer" ${pe('zones')}/>`;
    const lx = Math.min(...r.points.map(p => p[0])), ly = Math.min(...r.points.map(p => p[1]));
    s += `<text x="${lx + 10}" y="${ly + 18}" fill="${r.color}" font-size="15" font-weight="700" font-family="Rajdhani" opacity=".8" pointer-events="none">${pmEsc(r.name)}</text>`;
    if (on && !L.zones.l) r.points.forEach((p, i) => s += `<circle cx="${p[0]}" cy="${p[1]}" r="${6 / k}" fill="#fff" stroke="${r.color}" stroke-width="${2 / k}" data-vtx="${r.id}:${i}" style="cursor:move"/>`);
  });
  if (PM.zoneDraft && PM.zoneDraft.length) {
    s += `<polyline points="${PM.zoneDraft.map(p => p.join(',')).join(' ')}" fill="none" stroke="#fff" stroke-dasharray="6 4" stroke-width="${2 / k}"/>`;
    PM.zoneDraft.forEach(p => s += `<circle cx="${p[0]}" cy="${p[1]}" r="${4 / k}" fill="#fff"/>`);
  }
  const path = PM.pathCells || null;
  if (L.edges.v) d.edges.forEach(e => {
    const G = pmEdgeGeom(e); if (!G) return;
    const on = PM.sel.has('e:' + e.id), dr = dirs[e.id];
    const inPath = path && path.includes(e.a) && path.includes(e.b) && Math.abs(path.indexOf(e.a) - path.indexOf(e.b)) === 1;
    const dim = q && !(pmMatch(pmCell(e.a), q) && pmMatch(pmCell(e.b), q));
    s += `<path d="${G.d}" fill="none" stroke="transparent" stroke-width="12" data-edge="${e.id}" style="cursor:pointer" ${pe('edges')}/>`;
    s += `<path d="${G.d}" fill="none" stroke="${inPath ? '#facc15' : on ? '#ff1f44' : e.color || '#6b6b75'}" stroke-width="${inPath || on ? 3 : 1.6}" ${e.dash ? 'stroke-dasharray="6 5"' : ''} opacity="${dim ? .15 : 1}" pointer-events="none"/>`;
    if (!dr.both && (PM.opt.arrows || !dr.auto)) {
      let ang = G.ang; if (dr.f !== e.a) ang += Math.PI;
      const [mx, my] = G.mid, sz = dr.auto ? 5 : 7, col = dr.auto ? '#8a8a93' : '#e5e5ea';
      s += `<path d="M${mx + Math.cos(ang) * sz},${my + Math.sin(ang) * sz}L${mx + Math.cos(ang + 2.5) * sz},${my + Math.sin(ang + 2.5) * sz}L${mx + Math.cos(ang - 2.5) * sz},${my + Math.sin(ang - 2.5) * sz}Z" fill="${col}" opacity="${dim ? .15 : .9}" pointer-events="none"/>`;
    }
    if (on && !L.edges.l) (e.pts || []).forEach((p, i) => s += `<circle cx="${p[0]}" cy="${p[1]}" r="${5 / k}" fill="#ff1f44" stroke="#fff" stroke-width="${1.5 / k}" data-ept="${e.id}:${i}" style="cursor:move"/>`);
  });
  if (PM.linkFrom && PM.mouse) { const a = pmCell(PM.linkFrom); if (a) s += `<line x1="${a.x}" y1="${a.y}" x2="${PM.mouse.x}" y2="${PM.mouse.y}" stroke="#ff1f44" stroke-dasharray="5 4" stroke-width="${2 / k}" pointer-events="none"/>`; }
  if (L.cells.v) d.cells.forEach(c => {
    const t = pmType(c.type), on = PM.sel.has('c:' + c.uid), hit = q && pmMatch(c, q), dim = q && !hit;
    let fill = t.color;
    if (dist) { const v = dist[c.uid]; fill = v == null ? '#333' : `hsl(${120 - 120 * v / maxDist},75%,50%)`; }
    if (heat) { const v = (heat[c.uid] || 0) / maxHeat; fill = `hsl(${240 - 240 * v},85%,${30 + 30 * v}%)`; }
    if (PM.overlay === 'deg') { const v = deg[c.uid] || 0; fill = v <= 1 ? '#ef4444' : v === 2 ? '#64748b' : v === 3 ? '#38bdf8' : '#a970ff'; }
    const r = c.type === 'Start' || c.type === 'Тайник' ? 17 : 13;
    s += `<g data-cell="${c.uid}" style="cursor:${PM.tool === 'link' ? 'crosshair' : 'pointer'}" opacity="${dim ? .18 : 1}" ${pe('cells')}><title>${pmEsc(c.id + ' · ' + c.type + (c.region ? ' · ' + c.region : '') + (c.note ? '\n' + c.note : ''))}</title>`;
    if (hit) s += `<circle cx="${c.x}" cy="${c.y}" r="${r + 9}" fill="none" stroke="#facc15" stroke-width="2"/>`;
    if (on) s += `<circle cx="${c.x}" cy="${c.y}" r="${r + 6}" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/>`;
    if (PM.linkFrom === c.uid) s += `<circle cx="${c.x}" cy="${c.y}" r="${r + 6}" fill="none" stroke="#ff1f44" stroke-width="2.5"/>`;
    if (c.anomaly) s += `<circle cx="${c.x}" cy="${c.y}" r="${r + 3}" fill="none" stroke="#a970ff" stroke-width="2"/>`;
    s += `<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="${fill}" stroke="#0b0b0d" stroke-width="2.5"/>`;
    const inner = dist ? (dist[c.uid] ?? '∞') : heat ? Math.round((heat[c.uid] || 0) * 100) : PM.overlay === 'deg' ? (deg[c.uid] || 0) : t.short;
    s += `<text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="${String(inner).length > 2 ? 8 : 11}" font-weight="700" fill="${heat ? '#fff' : '#0b0b0d'}" font-family="JetBrains Mono" pointer-events="none">${pmEsc(inner)}</text>`;
    const sub = [PM.opt.labels && c.label ? c.label : PM.opt.types ? c.type : '', PM.opt.ids ? c.id : ''].filter(Boolean);
    sub.forEach((txt, i) => s += `<text x="${c.x}" y="${c.y + r + 13 + i * 12}" text-anchor="middle" font-size="${i ? 9 : 11}" fill="${i ? '#7a7a85' : t.color}" font-family="${i ? 'JetBrains Mono' : 'Rajdhani'}" font-weight="700" pointer-events="none" paint-order="stroke" stroke="#09090b" stroke-width="3">${pmEsc(txt)}</text>`);
    if (c.gimmick) s += `<text x="${c.x + r}" y="${c.y - r + 2}" font-size="11" pointer-events="none">⚙</text>`;
    s += `</g>`;
  });
  if (L.markers.v) d.markers.forEach(m => {
    const c = m.cell ? pmCell(m.cell) : null; if (m.cell && !c) return;
    const x = c ? c.x + (m.dx || 0) : m.x, y = c ? c.y + (m.dy || 0) : m.y, on = PM.sel.has('m:' + m.id);
    s += `<g data-marker="${m.id}" style="cursor:pointer" transform="translate(${x},${y}) rotate(${m.rot || 0})" ${pe('markers')}>`;
    if (on) s += `<circle r="${(m.size || 20) * .8}" fill="none" stroke="#fff" stroke-dasharray="4 3"/>`;
    s += `<text text-anchor="middle" y="${(m.size || 20) * .35}" font-size="${m.size || 20}" fill="${m.color || '#38bdf8'}">${pmEsc(m.icon || '★')}</text>`;
    if (m.text) s += `<text text-anchor="middle" y="${(m.size || 20) * .35 + 15}" font-size="12" fill="${m.color || '#38bdf8'}" font-family="Rajdhani" font-weight="700" paint-order="stroke" stroke="#09090b" stroke-width="3">${pmEsc(m.text)}</text>`;
    s += `</g>`;
  });
  if (PM.box) { const b = PM.box; s += `<rect x="${Math.min(b.x0, b.x1)}" y="${Math.min(b.y0, b.y1)}" width="${Math.abs(b.x1 - b.x0)}" height="${Math.abs(b.y1 - b.y0)}" fill="rgba(255,31,68,.08)" stroke="#ff1f44" stroke-dasharray="5 4" stroke-width="${1 / k}"/>`; }
  s += `</g>`;
  svg.innerHTML = s;
  pmMinimap();
  const qn = document.getElementById('pm-qn'); if (qn) qn.textContent = q ? d.cells.filter(c => pmMatch(c, q)).length + ' найдено' : '';
  if (PM.panel === 'props' || PM.panel === 'check') pmPanelRefresh();
}
/* Миникарта: клетки, зоны и рамка текущего вида; клик/перетаскивание — перейти. */
function pmMinimap() {
  const box = document.getElementById('pm-mm'), mm = document.getElementById('pm-mmsvg'), svg = document.getElementById('pm-svg');
  if (!box || !mm) return;
  box.style.display = PM.opt.minimap ? 'block' : 'none';
  if (!PM.opt.minimap) return;
  const b = pmBounds(); if (!b) { mm.innerHTML = ''; return; }
  const pad = 40, x0 = b.x0 - pad, y0 = b.y0 - pad, w = b.x1 - b.x0 + 2 * pad, h = b.y1 - b.y0 + 2 * pad;
  const W = svg.clientWidth || 900, H = svg.clientHeight || 600, k = PM.view.k;
  let s = '';
  PM.data.regions.forEach(r => { if (r.points.length > 2) s += `<path d="${pmSmooth(r.points)}" fill="${r.color}" fill-opacity=".12" stroke="${r.color}" stroke-width="${w / 120}"/>`; });
  PM.data.cells.forEach(c => s += `<circle cx="${c.x}" cy="${c.y}" r="${w / 70}" fill="${pmType(c.type).color}"/>`);
  s += `<rect x="${-PM.view.x / k}" y="${-PM.view.y / k}" width="${W / k}" height="${H / k}" fill="rgba(255,255,255,.06)" stroke="#fff" stroke-width="${w / 110}"/>`;
  mm.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`); mm.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  mm.innerHTML = s; PM.mmBox = { x0, y0, w, h };
}
function pmMMGo(e) {
  const mm = document.getElementById('pm-mmsvg'), B = PM.mmBox; if (!mm || !B) return;
  const r = mm.getBoundingClientRect();
  const sc = Math.min(r.width / B.w, r.height / B.h), ox = (r.width - B.w * sc) / 2, oy = (r.height - B.h * sc) / 2;
  pmCenterOn(B.x0 + (e.clientX - r.left - ox) / sc, B.y0 + (e.clientY - r.top - oy) / sc);
}

/* ---------- мышь и клавиатура ---------- */
function pmBind() {
  const svg = document.getElementById('pm-svg');
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * .0015), k = Math.max(.15, Math.min(5, PM.view.k * f));
    PM.view.x = mx - (mx - PM.view.x) * k / PM.view.k; PM.view.y = my - (my - PM.view.y) * k / PM.view.k; PM.view.k = k;
    pmRender();
  }, { passive: false });
  svg.addEventListener('mousedown', pmDown);
  svg.addEventListener('contextmenu', e => e.preventDefault());
  const mm = document.getElementById('pm-mm');
  mm.addEventListener('mousedown', e => { e.stopPropagation(); PM.mmDrag = true; pmMMGo(e); });
  if (!PM.keysBound) {
    window.addEventListener('mousemove', e => { if (PM.mmDrag) return pmMMGo(e); pmMove(e); });
    window.addEventListener('mouseup', e => { PM.mmDrag = false; pmUp(e); });
    window.addEventListener('keydown', pmKey); window.addEventListener('keyup', e => { if (e.code === 'Space') PM.space = false; });
    window.addEventListener('resize', () => pmRender());
    PM.keysBound = true;
  }
}
function pmHit(e) {
  // после перерисовки между кликами e.target у dblclick может указывать на старый/общий узел — берём элемент под курсором
  const el = document.elementFromPoint(e.clientX, e.clientY) || e.target;
  const t = el && el.closest ? el : null;
  const g = t && (t.closest('[data-ept]') || t.closest('[data-vtx]') || t.closest('[data-cell]') || t.closest('[data-marker]') || t.closest('[data-edge]') || t.closest('[data-zone]'));
  if (!g) return null;
  if (g.dataset.ept) { const [id, i] = g.dataset.ept.split(':'); return { kind: 'p', id, i: +i }; }
  if (g.dataset.vtx) { const [z, i] = g.dataset.vtx.split(':'); return { kind: 'v', id: z, i: +i }; }
  if (g.dataset.cell) return { kind: 'c', id: g.dataset.cell };
  if (g.dataset.marker) return { kind: 'm', id: g.dataset.marker };
  if (g.dataset.edge) return { kind: 'e', id: g.dataset.edge };
  if (g.dataset.zone) return { kind: 'z', id: g.dataset.zone };
  return null;
}
function pmDown(e) {
  if (!document.getElementById('pm-svg')) return;
  // свой двойной клик: холст перерисовывается между кликами, и штатный dblclick браузера теряется
  const now = Date.now(), ld = PM.lastDown;
  if (e.button === 0 && ld && now - ld.t < 380 && Math.hypot(e.clientX - ld.x, e.clientY - ld.y) < 6) { PM.lastDown = null; PM.drag = null; PM.box = null; return pmDbl(e); }
  PM.lastDown = { t: now, x: e.clientX, y: e.clientY };
  const p = pmPt(e), hit = pmHit(e);
  if (e.button === 1 || e.button === 2 || PM.space || PM.tool === 'pan') { PM.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: PM.view.x, vy: PM.view.y }; return; }
  const t = PM.tool;
  if (t === 'cell') {
    if (hit && hit.kind === 'c') { pmSelect('c:' + hit.id, e.shiftKey); return pmStartMove(p); }
    pmPush(); const c = pmNewCell(pmSnap(p.x), pmSnap(p.y)); PM.sel = new Set(['c:' + c.uid]); pmPanel('props'); return pmRender();
  }
  if (t === 'link') {
    if (hit && hit.kind === 'e') { pmPush(); PM.data.edges = PM.data.edges.filter(x => x.id !== hit.id); return pmRender(); }
    if (hit && hit.kind === 'c') {
      if (!PM.linkFrom) { PM.linkFrom = hit.id; return pmRender(); }
      if (PM.linkFrom !== hit.id) pmLink(PM.linkFrom, hit.id, e.shiftKey);
      PM.linkFrom = e.ctrlKey ? hit.id : null; return pmRender();
    }
    PM.linkFrom = null; return pmRender();
  }
  if (t === 'zone') { PM.zoneDraft = PM.zoneDraft || []; PM.zoneDraft.push([pmSnap(p.x), pmSnap(p.y)]); return pmRender(); }
  if (t === 'marker') {
    if (hit && hit.kind === 'm') { pmSelect('m:' + hit.id, e.shiftKey); return pmStartMove(p); }
    pmPush(); const m = { id: pmUid(), x: pmSnap(p.x), y: pmSnap(p.y), icon: PM.icon || '★', color: PM.iconColor || '#38bdf8', size: 22, text: '', rot: 0 };
    if (hit && hit.kind === 'c') { const c = pmCell(hit.id); m.cell = c.uid; m.dx = 0; m.dy = -26; }
    PM.data.markers.push(m); PM.sel = new Set(['m:' + m.id]); pmPanel('props'); return pmRender();
  }
  if (hit) {
    if (hit.kind === 'v' || hit.kind === 'p') { pmPush(); PM.drag = { handle: hit }; return; }
    const key = hit.kind + ':' + hit.id;
    if (e.altKey && hit.kind === 'c') { pmPush(); const src = pmCell(hit.id), c = pmNewCell(src.x, src.y, src); PM.sel = new Set(['c:' + c.uid]); return pmStartMove(p, true); }
    if (!PM.sel.has(key) || e.shiftKey) pmSelect(key, e.shiftKey);
    if (hit.kind === 'c' || hit.kind === 'm' || hit.kind === 'z') return pmStartMove(p);
    return pmRender();
  }
  if (!e.shiftKey) PM.sel.clear();
  PM.pathCells = null;
  PM.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; PM.drag = { box: true };
  pmRender();
}
function pmSelect(key, add) {
  if (add) PM.sel.has(key) ? PM.sel.delete(key) : PM.sel.add(key); else PM.sel = new Set([key]);
  if (PM.panel !== 'props') pmPanel('props');
}
function pmSelCells() { return [...PM.sel].filter(k => k[0] === 'c').map(k => pmCell(k.slice(2))).filter(Boolean); }
function pmStartMove(p, pushed) {
  const items = [], moved = new Set();
  PM.sel.forEach(k => {
    const t = k[0], id = k.slice(2);
    if (t === 'c' && !pmLayer('cells').l) { const c = pmCell(id); if (c) { items.push({ o: c, x: c.x, y: c.y }); moved.add(c.uid); } }
    if (t === 'm' && !pmLayer('markers').l) { const m = PM.data.markers.find(x => x.id === id); if (m && !m.cell) items.push({ o: m, x: m.x, y: m.y }); if (m && m.cell) items.push({ o: m, rel: true, x: m.dx || 0, y: m.dy || 0 }); }
    if (t === 'z' && !pmLayer('zones').l) { const z = PM.data.regions.find(x => x.id === id); if (z) items.push({ zone: z, pts: pmClone(z.points) }); }
  });
  // точки излома связей, у которых оба конца двигаются, едут вместе с ними
  PM.data.edges.forEach(e => { if (e.pts && e.pts.length && moved.has(e.a) && moved.has(e.b)) items.push({ edge: e, pts: pmClone(e.pts) }); });
  PM.drag = { move: true, p0: p, items, pushed: !!pushed, moved: false };
}
function pmMove(e) {
  if (!document.getElementById('pm-svg')) return;
  const p = pmPt(e); PM.mouse = p;
  const dr = PM.drag;
  if (!dr) { if (PM.linkFrom) pmRender(); return; }
  if (dr.pan) { PM.view.x = dr.vx + e.clientX - dr.sx; PM.view.y = dr.vy + e.clientY - dr.sy; return pmRender(); }
  if (dr.box) { PM.box.x1 = p.x; PM.box.y1 = p.y; return pmRender(); }
  if (dr.handle) {
    const h = dr.handle, pt = [pmSnap(p.x), pmSnap(p.y)];
    if (h.kind === 'v') { const z = PM.data.regions.find(x => x.id === h.id); if (z) z.points[h.i] = pt; }
    else { const ed = PM.data.edges.find(x => x.id === h.id); if (ed) ed.pts[h.i] = pt; }
    return pmRender();
  }
  if (dr.move) {
    const dx = p.x - dr.p0.x, dy = p.y - dr.p0.y;
    if (!dr.moved && Math.hypot(dx, dy) * PM.view.k < 3) return;
    if (!dr.moved && !dr.pushed) pmPush();
    dr.moved = true;
    dr.items.forEach(it => {
      if (it.zone) { it.zone.points = it.pts.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]); return; }
      if (it.edge) { it.edge.pts = it.pts.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]); return; }
      if (it.rel) { it.o.dx = Math.round(it.x + dx); it.o.dy = Math.round(it.y + dy); return; }
      it.o.x = pmSnap(it.x + dx); it.o.y = pmSnap(it.y + dy);
    });
    pmRender();
  }
}
function pmUp() {
  const dr = PM.drag; PM.drag = null;
  if (!dr || !document.getElementById('pm-svg')) return;
  if (dr.box) {
    const b = PM.box, x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    if (pmLayer('cells').v && !pmLayer('cells').l) PM.data.cells.forEach(c => { if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) PM.sel.add('c:' + c.uid); });
    if (pmLayer('markers').v && !pmLayer('markers').l) PM.data.markers.forEach(m => { if (!m.cell && m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1) PM.sel.add('m:' + m.id); });
    PM.box = null; pmRender(); pmPanel('props');
  }
  if (dr.move && dr.moved) { if (PM.opt.autoRegion) pmAssignRegions(true); pmTouch(); pmRender(); }
  if (dr.handle) { pmTouch(); if (PM.opt.autoRegion) pmAssignRegions(true); pmRender(); }
}
function pmDbl(e) {
  const hit = pmHit(e), p = pmPt(e);
  if (PM.tool === 'zone' && PM.zoneDraft) return pmFinishZone();
  if (hit && hit.kind === 'v') { const z = PM.data.regions.find(x => x.id === hit.id); if (z && z.points.length > 3) { pmPush(); z.points.splice(hit.i, 1); pmRender(); } return; }
  if (hit && hit.kind === 'p') { const ed = PM.data.edges.find(x => x.id === hit.id); if (ed) { pmPush(); ed.pts.splice(hit.i, 1); pmRender(); } return; }
  if (hit && hit.kind === 'e') { // точка излома на ближайший отрезок
    const ed = PM.data.edges.find(x => x.id === hit.id), P = pmEdgePts(ed); if (!P) return;
    let best = 0, bd = 1e18;
    for (let i = 0; i < P.length - 1; i++) { const dd = pmSegDist(p, P[i], P[i + 1]); if (dd < bd) { bd = dd; best = i; } }
    pmPush(); ed.curve = 0; ed.pts.splice(best, 0, [Math.round(p.x), Math.round(p.y)]); PM.sel = new Set(['e:' + ed.id]); pmPanel('props'); return pmRender();
  }
  if (hit && hit.kind === 'z' && PM.sel.has('z:' + hit.id)) {
    const z = PM.data.regions.find(x => x.id === hit.id); let best = 0, bd = 1e18;
    z.points.forEach((a, i) => { const b = z.points[(i + 1) % z.points.length]; const dd = pmSegDist(p, a, b); if (dd < bd) { bd = dd; best = i; } });
    pmPush(); z.points.splice(best + 1, 0, [Math.round(p.x), Math.round(p.y)]); return pmRender();
  }
  if (!hit && PM.tool === 'select') { pmPush(); const c = pmNewCell(pmSnap(p.x), pmSnap(p.y)); PM.sel = new Set(['c:' + c.uid]); pmPanel('props'); pmRender(); }
}
function pmSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L));
  return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy);
}
function pmKey(e) {
  if (!document.getElementById('pm-svg')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const ctrl = e.ctrlKey || e.metaKey, code = e.code;
  if (code === 'Space') { PM.space = true; e.preventDefault(); return; }
  if (ctrl && code === 'KeyZ') { e.preventDefault(); return e.shiftKey ? pmRedo() : pmUndo(); }
  if (ctrl && code === 'KeyY') { e.preventDefault(); return pmRedo(); }
  if (ctrl && code === 'KeyS') { e.preventDefault(); return pmSave(); }
  if (ctrl && code === 'KeyD') { e.preventDefault(); return pmDuplicate(); }
  if (ctrl && code === 'KeyC') { e.preventDefault(); return pmCopy(); }
  if (ctrl && code === 'KeyX') { e.preventDefault(); return pmCopy(true); }
  if (ctrl && code === 'KeyV') { e.preventDefault(); return pmPaste(); }
  if (ctrl && code === 'KeyF') { e.preventDefault(); return document.getElementById('pm-q').focus(); }
  if (ctrl && code === 'KeyA') { e.preventDefault(); PM.sel = new Set(PM.data.cells.map(c => 'c:' + c.uid)); pmPanel('props'); return pmRender(); }
  if (e.altKey && /^Digit[1-9]$/.test(code)) { e.preventDefault(); return pmGoView(+code.slice(5) - 1); }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return pmDelete(); }
  if (e.key === 'Escape') { PM.zoneDraft = null; PM.linkFrom = null; PM.sel.clear(); PM.pathCells = null; return pmRender(); }
  if (e.key === 'Enter' && PM.zoneDraft) return pmFinishZone();
  if (e.key === '/') { e.preventDefault(); return document.getElementById('pm-q').focus(); }
  if (e.key.startsWith('Arrow') && PM.sel.size) {
    e.preventDefault(); pmPush(); const st = e.shiftKey ? (PM.data.grid || 20) : 1;
    const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
    PM.sel.forEach(k => { const c = k[0] === 'c' ? pmCell(k.slice(2)) : k[0] === 'm' ? PM.data.markers.find(m => m.id === k.slice(2)) : null; if (c && !c.cell) { c.x += dx; c.y += dy; } });
    return pmRender();
  }
  const map = { KeyV: 'select', KeyC: 'cell', KeyL: 'link', KeyZ: 'zone', KeyM: 'marker', KeyH: 'pan' };
  if (!ctrl && !e.altKey && map[code]) return pmTool(map[code]);
  if (!ctrl && code === 'KeyF') return pmFit();
  if (!ctrl && code === 'KeyG') { PM.opt.grid = !PM.opt.grid; pmSaveOpt(); return pmRender(); }
}

/* ---------- операции ---------- */
function pmNextId(region, taken) {
  const r = pmRegion(region), pre = r ? (r.prefix || r.name[0]) : 'X';
  let n = 1; const ids = taken || new Set(PM.data.cells.map(c => c.id));
  while (ids.has(pre + String(n).padStart(2, '0'))) n++;
  return pre + String(n).padStart(2, '0');
}
function pmRegionAt(x, y) { const z = PM.data.regions.find(r => r.points.length >= 3 && pmInPoly(x, y, r.points)); return z ? z.name : ''; }
function pmNewCell(x, y, src) {
  const region = pmRegionAt(x, y) || (src && src.region) || '';
  const c = Object.assign({ type: PM.newType || 'Событие', label: '', note: '', variants: '', branch: '', gimmick: '', status: '🟡 Предложено', props: {} }, src ? pmClone(src) : {}, { uid: pmUid(), x, y, region });
  c.id = pmNextId(region);
  PM.data.cells.push(c); return c;
}
function pmLink(a, b, oneway) {
  if (PM.data.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return toast('Связь уже есть', 'err');
  pmPush(); PM.data.edges.push({ id: pmUid(), a, b, mode: oneway ? 'ab' : 'auto', pts: [], curve: 0 });
}
function pmDelete() {
  if (!PM.sel.size) return;
  pmPush();
  const cells = new Set(), edges = new Set(), marks = new Set(), zones = new Set();
  PM.sel.forEach(k => { const id = k.slice(2); ({ c: cells, e: edges, m: marks, z: zones })[k[0]]?.add(id); });
  PM.data.cells = PM.data.cells.filter(c => !cells.has(c.uid));
  PM.data.edges = PM.data.edges.filter(e => !edges.has(e.id) && !cells.has(e.a) && !cells.has(e.b));
  PM.data.markers = PM.data.markers.filter(m => !marks.has(m.id) && !(m.cell && cells.has(m.cell)));
  PM.data.regions = PM.data.regions.filter(r => !zones.has(r.id));
  PM.data.flow.exits = PM.data.flow.exits.filter(u => !cells.has(u));
  PM.sel.clear(); pmRender();
}
/* Буфер обмена: клетки + связи между ними + привязанные маркеры + свободные маркеры. Работает между картами. */
function pmCopy(cut) {
  const cs = pmSelCells(), uids = new Set(cs.map(c => c.uid));
  const ms = PM.data.markers.filter(m => PM.sel.has('m:' + m.id) || (m.cell && uids.has(m.cell)));
  if (!cs.length && !ms.length) return toast('Нечего копировать', 'err');
  const es = PM.data.edges.filter(e => uids.has(e.a) && uids.has(e.b));
  const pts = cs.map(c => [c.x, c.y]).concat(ms.filter(m => !m.cell).map(m => [m.x, m.y]));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const clip = { cells: pmClone(cs), edges: pmClone(es), markers: pmClone(ms), cx, cy, types: PM.data.types.filter(t => cs.some(c => c.type === t.key)) };
  try { localStorage.setItem('pm_clip', JSON.stringify(clip)); } catch (e) { }
  PM.clip = clip;
  if (!PM.quiet) toast((cut ? 'Вырезано: ' : 'Скопировано: ') + cs.length + ' клеток, ' + es.length + ' связей, ' + ms.length + ' маркеров');
  if (cut) pmDelete();
}
function pmPaste(at) {
  let clip = PM.clip; try { clip = JSON.parse(localStorage.getItem('pm_clip')) || clip; } catch (e) { }
  if (!clip) return toast('Буфер пуст', 'err');
  pmPush();
  const pos = at || PM.mouse || { x: clip.cx + 40, y: clip.cy + 40 }, dx = pos.x - clip.cx, dy = pos.y - clip.cy;
  const map = {}, sel = new Set(), taken = new Set(PM.data.cells.map(c => c.id));
  (clip.types || []).forEach(t => { if (!PM.data.types.find(x => x.key === t.key)) PM.data.types.push(pmClone(t)); });
  clip.cells.forEach(c0 => {
    const c = pmClone(c0); c.uid = pmUid(); c.x = pmSnap(c0.x + dx); c.y = pmSnap(c0.y + dy);
    c.region = pmRegionAt(c.x, c.y) || c.region;
    if (taken.has(c.id)) c.id = pmNextId(c.region, taken);
    taken.add(c.id); map[c0.uid] = c.uid; PM.data.cells.push(c); sel.add('c:' + c.uid);
  });
  clip.edges.forEach(e0 => PM.data.edges.push(Object.assign(pmClone(e0), { id: pmUid(), a: map[e0.a], b: map[e0.b], pts: (e0.pts || []).map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]) })));
  clip.markers.forEach(m0 => {
    const m = pmClone(m0); m.id = pmUid();
    if (m.cell) { if (!map[m.cell]) return; m.cell = map[m.cell]; } else { m.x = Math.round(m.x + dx); m.y = Math.round(m.y + dy); sel.add('m:' + m.id); }
    PM.data.markers.push(m);
  });
  PM.sel = sel; pmPanel('props'); pmRender();
}
/* Дубль: копия рядом, не трогая буфер обмена. */
function pmDuplicate() {
  if (!pmSelCells().length) return;
  const keepClip = PM.clip; let keepLS = null; try { keepLS = localStorage.getItem('pm_clip'); } catch (e) { }
  PM.quiet = true; pmCopy(); PM.quiet = false;
  const c = PM.clip; pmPaste({ x: c.cx + 40, y: c.cy + 40 });
  PM.clip = keepClip; try { if (keepLS != null) localStorage.setItem('pm_clip', keepLS); else localStorage.removeItem('pm_clip'); } catch (e) { }
}
/* Выравнивание/распределение выделенных клеток и свободных маркеров. */
function pmAlign(mode) {
  const items = pmSelCells().concat(PM.data.markers.filter(m => !m.cell && PM.sel.has('m:' + m.id)));
  if (items.length < 2) return toast('Выдели минимум 2 объекта', 'err');
  pmPush();
  const xs = items.map(o => o.x), ys = items.map(o => o.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  if (mode === 'left') items.forEach(o => o.x = minX);
  if (mode === 'right') items.forEach(o => o.x = maxX);
  if (mode === 'top') items.forEach(o => o.y = minY);
  if (mode === 'bottom') items.forEach(o => o.y = maxY);
  if (mode === 'cx') items.forEach(o => o.x = Math.round(cx));
  if (mode === 'cy') items.forEach(o => o.y = Math.round(cy));
  if (mode === 'dh') { const s = items.slice().sort((a, b) => a.x - b.x), st = (maxX - minX) / (s.length - 1); s.forEach((o, i) => o.x = Math.round(minX + st * i)); }
  if (mode === 'dv') { const s = items.slice().sort((a, b) => a.y - b.y), st = (maxY - minY) / (s.length - 1); s.forEach((o, i) => o.y = Math.round(minY + st * i)); }
  if (mode === 'line') {
    const s = (maxX - minX >= maxY - minY) ? items.slice().sort((a, b) => a.x - b.x) : items.slice().sort((a, b) => a.y - b.y);
    const a = { x: s[0].x, y: s[0].y }, b = { x: s[s.length - 1].x, y: s[s.length - 1].y };
    s.forEach((o, i) => { const t = i / (s.length - 1); o.x = Math.round(a.x + (b.x - a.x) * t); o.y = Math.round(a.y + (b.y - a.y) * t); });
  }
  if (mode === 'circle') {
    const R = Math.max(40, Math.max(maxX - minX, maxY - minY) / 2);
    const s = items.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    s.forEach((o, i) => { const an = -Math.PI / 2 + i * 2 * Math.PI / s.length; o.x = Math.round(cx + Math.cos(an) * R); o.y = Math.round(cy + Math.sin(an) * R); });
  }
  if (PM.opt.autoRegion) pmAssignRegions(true);
  pmRender();
}
function pmFinishZone() {
  const pts = (PM.zoneDraft || []).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]); PM.zoneDraft = null;
  if (!pts || pts.length < 3) { pmRender(); return toast('Нужно минимум 3 точки', 'err'); }
  const name = prompt('Название зоны / региона', 'Новый регион'); if (!name) return pmRender();
  pmPush();
  const ex = pmRegion(name);
  if (ex) ex.points = pts; else PM.data.regions.push({ id: pmUid(), name, color: ['#f59e0b', '#22d3ee', '#f472b6', '#84cc16'][PM.data.regions.length % 4], prefix: name[0].toUpperCase(), points: pts });
  if (PM.opt.autoRegion) pmAssignRegions(true);
  pmTool('select'); pmRender();
}
function pmAssignRegions(silent) {
  if (!silent) pmPush();
  let n = 0;
  PM.data.cells.forEach(c => { if (c.type === 'Start') return; const r = pmRegionAt(c.x, c.y); if (r && r !== c.region) { c.region = r; n++; } });
  if (!silent) { toast('Регион обновлён у ' + n + ' клеток'); pmRender(); }
}
function pmHullsCmd() { if (!confirm('Перестроить контуры всех зон по их клеткам? Ручные контуры заменятся.')) return; pmPush(); pmHulls(PM.data); pmRender(); }
function pmAutoLayout(onlySel) {
  const sel = new Set(pmSelCells().map(c => c.uid));
  if (onlySel && !sel.size) return toast('Выдели клетки', 'err');
  pmPush();
  PM.data.cells.forEach(c => c.pin = onlySel ? !sel.has(c.uid) : c.type === 'Start');
  pmLayout(PM.data, 300, false);
  PM.data.cells.forEach(c => delete c.pin);
  pmRender();
}
function pmRenumber() {
  if (!confirm('Перенумеровать Id всех клеток по регионам (сверху вниз, слева направо)? Связи сохранятся.')) return;
  pmPush();
  PM.data.regions.forEach(r => {
    const cs = PM.data.cells.filter(c => c.region === r.name && c.type !== 'Start').sort((a, b) => (a.y - b.y) || (a.x - b.x));
    cs.forEach((c, i) => c.id = (r.prefix || r.name[0]) + String(i + 1).padStart(2, '0'));
  });
  pmRender();
}
function pmSnapAll() { pmPush(); const o = PM.opt.snap; PM.opt.snap = true; PM.data.cells.forEach(c => { c.x = pmSnap(c.x); c.y = pmSnap(c.y); }); PM.opt.snap = o; pmRender(); }
function pmShortest(a, b) {
  const adj = pmAdj(), prev = { [a]: null }, q = [a];
  while (q.length) { const u = q.shift(); if (u === b) break; (adj[u] || []).forEach(v => { if (!(v in prev)) { prev[v] = u; q.push(v); } }); }
  if (!(b in prev)) return null;
  const path = []; for (let u = b; u != null; u = prev[u]) path.unshift(u); return path;
}

/* ---------- поиск ---------- */
function pmSearch(v) { PM.filter = v || ''; PM.findIdx = -1; pmRender(); }
function pmFound() { return PM.filter.trim() ? PM.data.cells.filter(c => pmMatch(c, PM.filter.trim())) : []; }
function pmFindNext(dir) {
  const f = pmFound(); if (!f.length) return;
  PM.findIdx = (((PM.findIdx ?? -1) + (dir || 1)) % f.length + f.length) % f.length;
  const c = f[PM.findIdx]; PM.sel = new Set(['c:' + c.uid]);
  if (PM.view.k < 1) PM.view.k = 1.2;
  pmCenterOn(c.x, c.y); pmPanel('props');
}
function pmSelectFound() { const f = pmFound(); if (!f.length) return; PM.sel = new Set(f.map(c => 'c:' + c.uid)); pmFitBox({ x0: Math.min(...f.map(c => c.x)), x1: Math.max(...f.map(c => c.x)), y0: Math.min(...f.map(c => c.y)), y1: Math.max(...f.map(c => c.y)) }, 1.6); pmPanel('props'); }

/* ---------- закладки вида ---------- */
function pmAddView() { const n = prompt('Название закладки', 'Вид ' + (PM.data.views.length + 1)); if (!n) return; pmPush(); PM.data.views.push({ name: n, x: PM.view.x, y: PM.view.y, k: PM.view.k }); pmPanelRefresh(true); }
function pmGoView(i) { const v = PM.data.views[i]; if (!v) return; PM.view = { x: v.x, y: v.y, k: v.k }; pmRender(); }
function pmDelView(i) { pmPush(); PM.data.views.splice(i, 1); pmPanelRefresh(true); }

/* ---------- симуляция прохода ----------
   Все игроки стартуют на Start, ходят по очереди, бросок 1..кубик, шаги по направлению движения.
   На развилке — стратегия. Этап заканчивается, когда кто-то проходит Start (как в правилах).
   Считаем: раунды до конца этапа, остановки на клетках (тепловая карта), долю по типам. */
function pmRunSim(o) {
  const d = PM.data, start = d.cells.find(c => c.type === 'Start');
  if (!start) return { err: 'Нет клетки Start' };
  const adj = pmAdj(), und = {}, toS = pmToStart(adj), neg = new Set(d.flow.neg || []), cellById = Object.fromEntries(d.cells.map(c => [c.uid, c]));
  d.edges.forEach(e => { (und[e.a] = und[e.a] || []).push(e.b); (und[e.b] = und[e.b] || []).push(e.a); });
  if (!(adj[start.uid] || []).length) return { err: 'Из Start нет выхода по направлению движения' };
  const land = {}, rounds = [], R = Math.random;
  const pick = (opts, prev) => {
    let o2 = opts.length > 1 && prev ? opts.filter(v => v !== prev) : opts; if (!o2.length) o2 = opts; // не разворачиваться назад на двусторонних
    if (o2.length === 1) return o2[0];
    const st = o.strategy === 'mix' ? (R() < .5 ? 'short' : 'random') : o.strategy;
    if (st === 'short') { const best = Math.min(...o2.map(v => toS[v] ?? 1e9)); const b = o2.filter(v => (toS[v] ?? 1e9) === best); return b[Math.floor(R() * b.length)]; }
    if (st === 'safe') { const s = o2.filter(v => !neg.has(cellById[v].type)); const pool = s.length ? s : o2; return pool[Math.floor(R() * pool.length)]; }
    return o2[Math.floor(R() * o2.length)];
  };
  let stuck = 0, totalLand = 0;
  for (let t = 0; t < o.trials; t++) {
    const pos = Array(o.players).fill(start.uid), prevs = Array(o.players).fill(null); let done = 0;
    for (let r = 1; r <= 80 && !done; r++) {
      for (let pl = 0; pl < o.players && !done; pl++) {
        let steps = 1 + Math.floor(R() * o.die), u = pos[pl], prev = prevs[pl], left = false;
        while (steps-- > 0) {
          let opts = (adj[u] || []);
          if (!opts.length) { stuck++; opts = (und[u] || []).filter(v => v !== prev); if (!opts.length) break; } // тупик по направлению — идём по любой связи
          const nx = pick(opts, prev); prev = u; u = nx; left = true;
          if (u === start.uid) { done = r; break; }
        }
        pos[pl] = u; prevs[pl] = prev;
        if (!done && left) { land[u] = (land[u] || 0) + 1; totalLand++; }
      }
    }
    rounds.push(done || 80);
  }
  rounds.sort((a, b) => a - b);
  const q = p => rounds[Math.min(rounds.length - 1, Math.floor(rounds.length * p))];
  const byType = {}; Object.entries(land).forEach(([u, n]) => { const c = cellById[u]; if (c) byType[c.type] = (byType[c.type] || 0) + n; });
  Object.keys(land).forEach(u => land[u] /= totalLand || 1);
  return { avg: rounds.reduce((s, x) => s + x, 0) / rounds.length, p10: q(.1), p50: q(.5), p90: q(.9), land, byType, totalLand, stuck, o };
}
function pmSimRun() {
  const o = { players: +document.getElementById('pm-s-pl').value || 6, die: +document.getElementById('pm-s-die').value || 8, strategy: document.getElementById('pm-s-st').value, trials: Math.min(20000, +document.getElementById('pm-s-tr').value || 2000) };
  PM.simOpt = o;
  const r = pmRunSim(o);
  if (r.err) return toast(r.err, 'err');
  PM.sim = r; PM.overlay = 'heat'; const ov = document.getElementById('pm-overlay'); if (ov) ov.value = 'heat';
  pmRender(); pmPanelRefresh(true);
}

/* ---------- метрики веток и кругов ---------- */
function pmLoops() {
  const s = PM.data.cells.find(c => c.type === 'Start'); if (!s) return null;
  const adj = pmAdj();
  let shortest = null; const dist = { [s.uid]: 0 }, q = [s.uid];
  while (q.length && shortest == null) { const u = q.shift(); for (const v of adj[u] || []) { if (v === s.uid) { if (shortest == null || dist[u] + 1 < shortest) shortest = dist[u] + 1; continue; } if (dist[v] == null) { dist[v] = dist[u] + 1; q.push(v); } } }
  // длиннейший круг: самый длинный путь по однозначным направлениям от Start до возврата в Start
  const sadj = pmAdj(true), memo = {}, onStack = new Set(); let cyc = false;
  const longest = u => {
    if (u === s.uid && onStack.size) return 0;
    if (memo[u] != null) return memo[u];
    if (onStack.has(u)) { cyc = true; return -1e9; }
    onStack.add(u); let best = -1e9;
    for (const v of sadj[u] || []) { const L = longest(v); if (L > -1e8) best = Math.max(best, L + 1); }
    onStack.delete(u); if (u !== s.uid) memo[u] = best; return best;
  };
  const lg = longest(s.uid);
  const dm = pmDistMap(), far = Math.max(0, ...Object.values(dm));
  return { shortest, longest: lg > -1e8 ? lg : null, farthest: far, cyc };
}
/* Ветки: участки между развилками/слияниями по однозначному направлению. */
function pmBranches() {
  const d = PM.data, adj = pmAdj(true), indeg = {}, neg = new Set(d.flow.neg || []), pos = new Set(d.flow.pos || []);
  Object.values(adj).forEach(vs => vs.forEach(v => indeg[v] = (indeg[v] || 0) + 1));
  const start = d.cells.find(c => c.type === 'Start');
  const isJ = u => (start && u === start.uid) || (adj[u] || []).length !== 1 || (indeg[u] || 0) !== 1;
  const out = [];
  d.cells.forEach(c => {
    if (!isJ(c.uid)) return;
    (adj[c.uid] || []).forEach(n => {
      const cells = []; let u = n, guard = 0;
      while (guard++ < 500) { cells.push(u); if (isJ(u)) break; u = adj[u][0]; }
      const last = cells[cells.length - 1], all = cells.map(pmCell).filter(Boolean);
      out.push({ from: c.uid, to: last, cells, len: cells.length, neg: all.filter(x => neg.has(x.type)).length, pos: all.filter(x => pos.has(x.type)).length, ev: all.filter(x => x.type === 'Событие').length, battles: all.filter(x => ['Общий бой', 'Дуэль', 'Охота'].includes(x.type)).length });
    });
  });
  return out.sort((a, b) => ((pmCell(a.from) || {}).id || '').localeCompare((pmCell(b.from) || {}).id || '', 'ru', { numeric: true }));
}

/* ---------- боковая панель ---------- */
function pmPanel(name) {
  PM.panel = name;
  const side = document.getElementById('pm-side'); if (!side) return;
  const tabs = [['props', 'Свойства'], ['types', 'Типы'], ['fields', 'Поля'], ['regions', 'Зоны'], ['marker', 'Маркер'], ['check', 'Проверка'], ['sim', 'Симуляция'], ['view', 'Вид'], ['versions', 'Версии']];
  side.innerHTML = `<div class="pm-tabs">${tabs.map(([k, t]) => `<button class="pm-tab ${k === name ? 'on' : ''}" onclick="pmPanel('${k}')">${t}</button>`).join('')}</div><div id="pm-pbody"></div>`;
  pmPanelRefresh(true);
}
function pmPanelRefresh(force) {
  const box = document.getElementById('pm-pbody'); if (!box) return;
  if (!force && document.activeElement && box.contains(document.activeElement)) return;
  if (!force && PM.drag) return;
  const f = { props: pmPProps, types: pmPTypes, fields: pmPFields, regions: pmPRegions, marker: pmPMarker, check: pmPCheck, sim: pmPSim, view: pmPView, versions: pmPVersions }[PM.panel];
  if (f) f(box);
}
const pmInp = (label, val, onch, type = 'text') => `<div class="pm-f"><label>${label}</label><input type="${type}" value="${pmEsc(val)}" onchange="${onch}"></div>`;
function pmSetCells(field, value) {
  pmPush();
  pmSelCells().forEach(c => c[field] = value);
  pmRender(); pmPanelRefresh(true);
}
function pmSetProp(key, value) { pmPush(); pmSelCells().forEach(c => { c.props = c.props || {}; c.props[key] = value; }); pmRender(); pmPanelRefresh(true); }
function pmSetObj(kind, id, field, value) {
  pmPush();
  const o = kind === 'm' ? PM.data.markers.find(x => x.id === id) : kind === 'z' ? PM.data.regions.find(x => x.id === id) : kind === 'e' ? PM.data.edges.find(x => x.id === id) : pmCell(id);
  if (o) o[field] = value;
  pmRender(); pmPanelRefresh(true);
}
function pmRenameRegion(id, name) {
  const z = PM.data.regions.find(x => x.id === id); if (!z || !name) return;
  pmPush(); PM.data.cells.forEach(c => { if (c.region === z.name) c.region = name; }); z.name = name; pmRender(); pmPanelRefresh(true);
}
const pmAlignBar = () => `<h4>Выравнивание</h4><div class="pm-al">
  <button title="По левому краю" onclick="pmAlign('left')">⇤</button><button title="По центру (вертикаль)" onclick="pmAlign('cx')">⇹</button><button title="По правому краю" onclick="pmAlign('right')">⇥</button><button title="Распределить по горизонтали" onclick="pmAlign('dh')">↔</button><button title="В линию по крайним" onclick="pmAlign('line')">⟋</button>
  <button title="По верху" onclick="pmAlign('top')">⤒</button><button title="По центру (горизонталь)" onclick="pmAlign('cy')">≡</button><button title="По низу" onclick="pmAlign('bottom')">⤓</button><button title="Распределить по вертикали" onclick="pmAlign('dv')">↕</button><button title="По кругу" onclick="pmAlign('circle')">◯</button></div>`;
function pmFieldInput(f, cells) {
  const vals = cells.map(c => (c.props || {})[f.key]), same = vals.every(v => v === vals[0]) ? vals[0] : '';
  const on = `pmSetProp('${pmJs(f.key)}',`;
  if (f.type === 'bool') return `<div class="pm-f"><label class="cb-label"><input type="checkbox" ${same ? 'checked' : ''} onchange="${on}this.checked)"> ${pmEsc(f.label || f.key)}</label></div>`;
  if (f.type === 'select') return `<div class="pm-f"><label>${pmEsc(f.label || f.key)}</label><select onchange="${on}this.value)"><option value="">—</option>${(f.options || '').split(',').map(s => s.trim()).filter(Boolean).map(o => `<option ${same === o ? 'selected' : ''}>${pmEsc(o)}</option>`).join('')}</select></div>`;
  return pmInp(pmEsc(f.label || f.key), same ?? '', `${on}${f.type === 'number' ? '+this.value' : 'this.value'})`, f.type === 'number' ? 'number' : 'text');
}
function pmPProps(box) {
  const sel = [...PM.sel];
  if (!sel.length) {
    const d = PM.data;
    box.innerHTML = `<div class="pm-mini" style="margin-bottom:10px">Ничего не выбрано. Клеток: <b>${d.cells.length}</b>, связей: <b>${d.edges.length}</b>, зон: <b>${d.regions.length}</b>, маркеров: <b>${d.markers.length}</b>.</div>
      <h4>Количество по типам (факт / цель)</h4>${pmTypeCounts()}
      <h4>Горячие клавиши</h4><div class="pm-mini" style="line-height:1.7">V выбор · C клетка · L связь · Z зона · M маркер · H рука<br>Двойной клик: по пустому — клетка, по связи — излом<br>Alt+перетаскивание — копия · Ctrl+C/X/V · Ctrl+D дубль · Del<br>Стрелки двигают (Shift — шаг сетки) · Ctrl+Z/Y · Ctrl+S<br>/ или Ctrl+F — поиск, Enter — следующий · F всё · G сетка<br>Alt+1…9 — закладки вида · Esc снять</div>`;
    return;
  }
  const cells = pmSelCells();
  if (cells.length && cells.length === sel.length) {
    const c = cells[0], multi = cells.length > 1, same = f => cells.every(x => x[f] === c[f]) ? c[f] : '';
    const typeOpts = PM.data.types.map(t => `<option ${same('type') === t.key ? 'selected' : ''}>${pmEsc(t.key)}</option>`).join('');
    const regOpts = ['<option value="">—</option>'].concat(PM.data.regions.map(r => `<option ${same('region') === r.name ? 'selected' : ''}>${pmEsc(r.name)}</option>`)).join('');
    const dirs = pmDirs();
    const nbrs = !multi ? PM.data.edges.filter(e => e.a === c.uid || e.b === c.uid).map(e => { const o = pmCell(e.a === c.uid ? e.b : e.a), r = dirs[e.id]; return o ? `<span class="pm-chip" onclick="PM.sel=new Set(['c:${o.uid}']);pmRender();pmPanelRefresh(true)">${pmEsc(o.id)}${r.both ? ' ↔' : r.f === c.uid ? ' →' : ' ←'}</span>` : ''; }).join('') : '';
    const st = PM.data.cells.find(x => x.type === 'Start');
    const isStartNb = !multi && st && st.uid !== c.uid && PM.data.edges.some(e => (e.a === st.uid && e.b === c.uid) || (e.b === st.uid && e.a === c.uid));
    box.innerHTML = `<h4 style="margin-top:0">${multi ? 'Клеток выбрано: ' + cells.length : 'Клетка ' + pmEsc(c.id)}</h4>
      ${multi ? '' : pmInp('Id', c.id, `pmSetCells('id',this.value)`)}
      <div class="pm-f"><label>Тип</label><select onchange="pmSetCells('type',this.value)">${multi && !same('type') ? '<option>— разные —</option>' : ''}${typeOpts}</select></div>
      <div class="pm-f"><label>Регион</label><select onchange="pmSetCells('region',this.value)">${regOpts}</select></div>
      ${pmInp('Подпись (вместо типа)', same('label'), `pmSetCells('label',this.value)`)}
      ${pmInp('Варианты гибрида', same('variants'), `pmSetCells('variants',this.value)`)}
      <div class="pm-row"><div>${pmInp('Ветка', same('branch'), `pmSetCells('branch',this.value)`)}</div><div>${pmInp('Гиммик', same('gimmick'), `pmSetCells('gimmick',this.value)`)}</div></div>
      <div class="pm-f"><label>Статус</label><select onchange="pmSetCells('status',this.value)">${['✅ Решено', '🟡 Предложено', '❓ Открыто', '⏸ Отложено', '❌ Отклонено'].map(s => `<option ${same('status') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="pm-f"><label class="cb-label"><input type="checkbox" ${cells.every(x => x.anomaly) ? 'checked' : ''} onchange="pmSetCells('anomaly',this.checked)"> Аномальная по умолчанию</label></div>
      ${PM.data.fields.length ? '<h4>Свои поля</h4>' + PM.data.fields.map(f => pmFieldInput(f, cells)).join('') : ''}
      <div class="pm-f"><label>Заметка</label><textarea rows="3" onchange="pmSetCells('note',this.value)">${pmEsc(same('note'))}</textarea></div>
      ${isStartNb ? `<div class="pm-f"><label class="cb-label"><input type="checkbox" ${PM.data.flow.exits.includes(c.uid) ? 'checked' : ''} onchange="pmToggleExit('${c.uid}',this.checked)"> Выход из Start (иначе — вход в Start)</label></div>` : ''}
      ${multi ? pmAlignBar() : `<h4>Соседи (${PM.data.edges.filter(e => e.a === c.uid || e.b === c.uid).length})</h4><div>${nbrs || '<span class="pm-mini">нет связей</span>'}</div>`}
      ${cells.length === 2 ? `<button class="btn btn-g" style="width:100%;margin-top:8px" onclick="pmPathSel()">Кратчайший путь между ними</button>` : ''}
      <div class="pm-row" style="margin-top:12px"><button class="btn btn-g" onclick="pmCopy()">Копировать</button><button class="btn btn-g" onclick="pmDuplicate()">Дубль</button><button class="btn btn-r" onclick="pmDelete()">Удалить</button></div>`;
    return;
  }
  if (sel.length === 1) {
    const t = sel[0][0], id = sel[0].slice(2);
    if (t === 'e') {
      const e = PM.data.edges.find(x => x.id === id); if (!e) return;
      const a = pmCell(e.a), b = pmCell(e.b), r = pmDirs()[id];
      const modes = [['auto', 'Авто (по кругу от Start)'], ['both', 'В обе стороны'], ['ab', `${a && a.id} → ${b && b.id}`], ['ba', `${b && b.id} → ${a && a.id}`]];
      box.innerHTML = `<h4 style="margin-top:0">Связь ${pmEsc(a && a.id)} — ${pmEsc(b && b.id)}</h4>
        <div class="pm-f"><label>Направление</label><select onchange="pmSetObj('e','${id}','mode',this.value)">${modes.map(([k, l]) => `<option value="${k}" ${e.mode === k ? 'selected' : ''}>${pmEsc(l)}</option>`).join('')}</select>
        <div class="pm-mini" style="margin-top:4px">Сейчас: ${r.both ? 'в обе стороны' : pmEsc((pmCell(r.f) || {}).id) + ' → ' + pmEsc((pmCell(r.t) || {}).id)}${r.auto ? ' (авто)' : ''}</div></div>
        <div class="pm-f"><label>Изгиб ${e.pts.length ? '(недоступен при изломах)' : ''}</label><input type="range" min="-1" max="1" step="0.05" value="${e.curve || 0}" ${e.pts.length ? 'disabled' : ''} onchange="pmSetObj('e','${id}','curve',+this.value)"></div>
        <div class="pm-mini" style="margin-bottom:10px">Изломов: ${e.pts.length}. Двойной клик по связи — добавить точку, по точке — удалить, тяни красные точки.</div>
        ${e.pts.length ? `<button class="btn btn-g" style="width:100%;margin-bottom:8px" onclick="pmSetObj('e','${id}','pts',[])">Убрать все изломы</button>` : ''}
        <div class="pm-f"><label class="cb-label"><input type="checkbox" ${e.dash ? 'checked' : ''} onchange="pmSetObj('e','${id}','dash',this.checked)"> Пунктир (тайный / условный путь)</label></div>
        ${pmInp('Цвет', e.color || '#6b6b75', `pmSetObj('e','${id}','color',this.value)`, 'color')}
        <button class="btn btn-r" onclick="pmDelete()">Удалить связь</button>`;
      return;
    }
    if (t === 'm') {
      const m = PM.data.markers.find(x => x.id === id); if (!m) return;
      box.innerHTML = `<h4 style="margin-top:0">Маркер</h4>
        <div class="pm-f"><label>Иконка</label><div class="pm-icons">${PM_ICONS.map(i => `<button class="${m.icon === i ? 'on' : ''}" onclick="pmSetObj('m','${id}','icon','${i}')">${i}</button>`).join('')}</div></div>
        ${pmInp('Свой символ / эмодзи', m.icon, `pmSetObj('m','${id}','icon',this.value)`)}
        ${pmInp('Подпись', m.text, `pmSetObj('m','${id}','text',this.value)`)}
        <div class="pm-row"><div>${pmInp('Цвет', m.color || '#38bdf8', `pmSetObj('m','${id}','color',this.value)`, 'color')}</div><div>${pmInp('Размер', m.size || 22, `pmSetObj('m','${id}','size',+this.value)`, 'number')}</div><div>${pmInp('Поворот°', m.rot || 0, `pmSetObj('m','${id}','rot',+this.value)`, 'number')}</div></div>
        <div class="pm-f pm-mini">${m.cell ? 'Привязан к клетке ' + pmEsc((pmCell(m.cell) || {}).id) + ' — двигается вместе с ней.' : 'Свободный маркер.'}</div>
        <div class="pm-row">${m.cell ? `<button class="btn btn-g" onclick="pmUnpin('${id}')">Отвязать</button>` : ''}<button class="btn btn-r" onclick="pmDelete()">Удалить</button></div>`;
      return;
    }
    if (t === 'z') {
      const z = PM.data.regions.find(x => x.id === id); if (!z) return;
      box.innerHTML = `<h4 style="margin-top:0">Зона</h4>
        <div class="pm-f"><label>Название (меняется и у клеток)</label><input value="${pmEsc(z.name)}" onchange="pmRenameRegion('${id}',this.value)"></div>
        <div class="pm-row"><div>${pmInp('Цвет', z.color, `pmSetObj('z','${id}','color',this.value)`, 'color')}</div><div>${pmInp('Префикс Id', z.prefix || '', `pmSetObj('z','${id}','prefix',this.value)`)}</div></div>
        <div class="pm-mini" style="line-height:1.6;margin-bottom:10px">Тяни белые точки — форма · двойной клик по контуру — новая точка · двойной клик по точке — удалить · тяни зону — сдвиг</div>
        <div class="pm-row"><button class="btn btn-g" onclick="pmHullOne('${id}')">Контур по клеткам</button><button class="btn btn-r" onclick="pmDelete()">Удалить</button></div>`;
      return;
    }
  }
  box.innerHTML = `<div class="pm-mini">Выбрано объектов: ${sel.length}</div>${pmAlignBar()}<div class="pm-row" style="margin-top:10px"><button class="btn btn-g" onclick="pmCopy()">Копировать</button><button class="btn btn-r" onclick="pmDelete()">Удалить всё</button></div>`;
}
function pmToggleExit(uid, on) { pmPush(); const ex = new Set(PM.data.flow.exits); on ? ex.add(uid) : ex.delete(uid); PM.data.flow.exits = [...ex]; pmRender(); pmPanelRefresh(true); }
function pmUnpin(id) { const m = PM.data.markers.find(x => x.id === id), c = m && pmCell(m.cell); if (!m) return; pmPush(); if (c) { m.x = c.x + (m.dx || 0); m.y = c.y + (m.dy || 0); } delete m.cell; pmRender(); pmPanelRefresh(true); }
function pmHullOne(id) { const z = PM.data.regions.find(x => x.id === id); if (!z) return; pmPush(); const keep = PM.data.regions; PM.data.regions = [z]; z.points = []; pmHulls(PM.data); PM.data.regions = keep; pmRender(); }
function pmPathSel() {
  const cs = pmSelCells().map(c => c.uid);
  const p = pmShortest(cs[0], cs[1]) || pmShortest(cs[1], cs[0]);
  if (!p) return toast('Пути нет (с учётом направления)', 'err');
  PM.pathCells = p; toast('Кратчайший путь: ' + (p.length - 1) + ' шагов'); pmRender();
}
function pmTypeCounts() {
  const cnt = {}; PM.data.cells.forEach(c => cnt[c.type] = (cnt[c.type] || 0) + 1);
  return PM.data.types.map(t => {
    const n = cnt[t.key] || 0, tg = PM.data.targets[t.key], has = tg != null && tg !== '', ok = has && n === +tg;
    return `<span class="pm-chip ${has ? ok ? 'good' : 'bad' : ''}" title="Выделить все" onclick="PM.sel=new Set(PM.data.cells.filter(c=>c.type==='${pmJs(t.key)}').map(c=>'c:'+c.uid));pmRender();pmPanelRefresh(true)"><span class="pm-dot" style="background:${t.color}"></span>${pmEsc(t.key)} <b>${n}</b>${has ? `<span style="color:${ok ? '#4ade80' : '#f5c842'}">/${tg}${ok ? '' : ` (${n > tg ? '+' : ''}${n - tg})`}</span>` : ''}</span>`;
  }).join('');
}
function pmPTypes(box) {
  box.innerHTML = `<div class="pm-mini" style="margin-bottom:10px">✎ — тип для новых клеток. Поле «цель» — сколько таких клеток должно быть (как бюджет уровня).</div>
    ${PM.data.types.map((t, i) => `<div class="pm-row" style="margin-bottom:6px;${(PM.newType || 'Событие') === t.key ? 'outline:1px solid var(--accent);border-radius:8px;padding:2px' : ''}">
      <input type="color" value="${t.color}" style="flex:none;width:32px;height:32px;padding:2px" onchange="pmTypeSet(${i},'color',this.value)">
      <input value="${pmEsc(t.short)}" style="flex:none;width:40px;padding:6px" title="Значок в кружке" onchange="pmTypeSet(${i},'short',this.value)">
      <input value="${pmEsc(t.key)}" style="padding:6px" onchange="pmTypeRename(${i},this.value)">
      <input type="number" min="0" value="${PM.data.targets[t.key] ?? ''}" placeholder="цель" title="Цель (сколько должно быть)" style="flex:none;width:58px;padding:6px" onchange="pmTarget('${pmJs(t.key)}',this.value)">
      <button class="icon-btn" title="Для новых клеток" onclick="PM.newType='${pmJs(t.key)}';pmPanelRefresh(true)">✎</button>
      <button class="icon-btn danger" title="Удалить тип" onclick="pmTypeDel(${i})">×</button></div>`).join('')}
    <button class="btn btn-g" style="width:100%;margin-top:6px" onclick="pmTypeAdd()">+ Тип клетки</button>
    <h4>Негативные и позитивные типы (для веток и симуляции)</h4>
    ${pmInp('Негативные, через запятую', (PM.data.flow.neg || []).join(', '), `pmFlowList('neg',this.value)`)}
    ${pmInp('Позитивные, через запятую', (PM.data.flow.pos || []).join(', '), `pmFlowList('pos',this.value)`)}
    <h4>Сейчас на карте</h4>${pmTypeCounts()}`;
}
function pmFlowList(k, v) { pmPush(); PM.data.flow[k] = v.split(',').map(s => s.trim()).filter(Boolean); pmPanelRefresh(true); }
function pmTarget(key, v) { pmPush(); if (v === '') delete PM.data.targets[key]; else PM.data.targets[key] = +v; pmPanelRefresh(true); }
function pmTypeSet(i, f, v) { pmPush(); PM.data.types[i][f] = v; pmRender(); pmPanelRefresh(true); }
function pmTypeRename(i, v) {
  if (!v) return; pmPush(); const old = PM.data.types[i].key;
  PM.data.cells.forEach(c => { if (c.type === old) c.type = v; }); PM.data.types[i].key = v;
  if (PM.data.targets[old] != null) { PM.data.targets[v] = PM.data.targets[old]; delete PM.data.targets[old]; }
  if (PM.newType === old) PM.newType = v; pmRender(); pmPanelRefresh(true);
}
function pmTypeDel(i) {
  const t = PM.data.types[i], n = PM.data.cells.filter(c => c.type === t.key).length;
  if (n && !confirm(`Тип «${t.key}» стоит у ${n} клеток. Удалить из списка (клетки сохранят название типа)?`)) return;
  pmPush(); PM.data.types.splice(i, 1); pmRender(); pmPanelRefresh(true);
}
function pmTypeAdd() { const k = prompt('Название типа'); if (!k) return; pmPush(); PM.data.types.push({ key: k, color: '#9ca3af', short: k[0] }); PM.newType = k; pmPanelRefresh(true); }
/* Свои поля клеток: ключ, подпись, тип (текст/число/флаг/список). */
function pmPFields(box) {
  const tsel = (i, v) => `<select style="flex:none;width:92px;padding:6px" onchange="pmFieldSet(${i},'type',this.value)">${[['text', 'текст'], ['number', 'число'], ['bool', 'флаг'], ['select', 'список']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  box.innerHTML = `<div class="pm-mini" style="margin-bottom:10px">Свои свойства клеток без правки кода: вход в регион, вес гибрида, сложность и т.д. Появляются в «Свойствах» клетки, ищутся поиском как <code>ключ:значение</code>.</div>
    ${PM.data.fields.map((f, i) => `<div class="card" style="padding:9px;margin-bottom:8px">
      <div class="pm-row" style="margin-bottom:6px"><input value="${pmEsc(f.key)}" placeholder="ключ" style="padding:6px" onchange="pmFieldSet(${i},'key',this.value)">${tsel(i, f.type)}<button class="icon-btn danger" style="flex:none" onclick="pmFieldDel(${i})">×</button></div>
      <div class="pm-row"><input value="${pmEsc(f.label || '')}" placeholder="подпись" style="padding:6px" onchange="pmFieldSet(${i},'label',this.value)"></div>
      ${f.type === 'select' ? `<div class="pm-row" style="margin-top:6px"><input value="${pmEsc(f.options || '')}" placeholder="варианты через запятую" style="padding:6px" onchange="pmFieldSet(${i},'options',this.value)"></div>` : ''}
      <div class="pm-mini" style="margin-top:5px">Заполнено у ${PM.data.cells.filter(c => (c.props || {})[f.key] !== undefined && (c.props || {})[f.key] !== '').length} клеток</div></div>`).join('')}
    <button class="btn btn-g" style="width:100%" onclick="pmFieldAdd()">+ Поле</button>`;
}
function pmFieldAdd() { const k = prompt('Ключ поля (без пробелов)', 'вход'); if (!k) return; pmPush(); PM.data.fields.push({ key: k.replace(/\s+/g, '_'), label: k, type: 'text' }); pmPanelRefresh(true); }
function pmFieldSet(i, f, v) {
  pmPush(); const fl = PM.data.fields[i];
  if (f === 'key') { v = v.replace(/\s+/g, '_'); const old = fl.key; PM.data.cells.forEach(c => { if (c.props && old in c.props) { c.props[v] = c.props[old]; delete c.props[old]; } }); }
  fl[f] = v; pmPanelRefresh(true);
}
function pmFieldDel(i) { if (!confirm('Удалить поле? Значения у клеток тоже удалятся.')) return; pmPush(); const k = PM.data.fields[i].key; PM.data.cells.forEach(c => { if (c.props) delete c.props[k]; }); PM.data.fields.splice(i, 1); pmPanelRefresh(true); }
function pmRegionFind(name) { const q = 'регион:' + name.toLowerCase(); const el = document.getElementById('pm-q'); if (el) el.value = q; pmSearch(q); pmSelectFound(); }
function pmPRegions(box) {
  box.innerHTML = `<div class="pm-mini" style="margin-bottom:10px">Нарисовать новую — инструмент «Зона» (Z). Клик по названию — выделить зону.</div>
    ${PM.data.regions.map(r => { const n = PM.data.cells.filter(c => c.region === r.name).length; return `<div class="row-item" style="padding:8px 10px;margin-bottom:6px">
      <span style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="PM.sel=new Set(['z:${r.id}']);pmPanel('props');pmRender()"><span class="pm-dot" style="background:${r.color}"></span><b>${pmEsc(r.name)}</b><span class="pm-mini">${n} клеток · ${r.points.length ? r.points.length + ' точек' : 'без контура'}</span></span>
      <span style="display:flex;gap:4px"><button class="icon-btn" title="Найти клетки зоны" onclick="pmRegionFind('${pmJs(r.name)}')">⌕</button><button class="icon-btn" title="Показать/скрыть заливку" onclick="pmSetObj('z','${r.id}','hidden',${!r.hidden})">${r.hidden ? '◌' : '●'}</button></span></div>`; }).join('')}
    <div class="pm-row" style="margin-top:8px"><button class="btn btn-g" onclick="pmAssignRegions()">Регионы по зонам</button><button class="btn btn-g" onclick="pmHullsCmd()">Контуры по клеткам</button></div>`;
}
function pmPMarker(box) {
  box.innerHTML = `<div class="pm-mini" style="margin-bottom:10px">Инструмент «Маркер» (M): клик по холсту — свободный маркер, клик по клетке — маркер, привязанный к ней.</div>
    <div class="pm-f"><label>Иконка для новых</label><div class="pm-icons">${PM_ICONS.map(i => `<button class="${(PM.icon || '★') === i ? 'on' : ''}" onclick="PM.icon='${i}';pmPanelRefresh(true)">${i}</button>`).join('')}</div></div>
    <div class="pm-f"><label>Свой символ / эмодзи / текст</label><input value="${pmEsc(PM.icon || '★')}" onchange="PM.icon=this.value"></div>
    <div class="pm-f"><label>Цвет</label><input type="color" value="${PM.iconColor || '#38bdf8'}" onchange="PM.iconColor=this.value"></div>
    <button class="btn btn-y" style="width:100%" onclick="pmTool('marker')">Ставить маркеры</button>`;
}
function pmIssues() {
  const d = PM.data, out = [], deg = {};
  d.edges.forEach(e => { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
  const ids = {}; d.cells.forEach(c => (ids[c.id] = ids[c.id] || []).push(c));
  Object.entries(ids).forEach(([id, cs]) => cs.length > 1 && out.push({ t: `Повтор Id ${id} (${cs.length} шт.)`, sel: cs.map(c => 'c:' + c.uid) }));
  const adj = pmAdj();
  d.cells.forEach(c => {
    if (!deg[c.uid]) out.push({ t: `${c.id}: нет связей`, sel: ['c:' + c.uid] });
    else if (deg[c.uid] === 1) out.push({ t: `${c.id}: тупик (1 связь)`, sel: ['c:' + c.uid] });
    else if (!(adj[c.uid] || []).length) out.push({ t: `${c.id}: по направлению движения отсюда нет выхода`, sel: ['c:' + c.uid] });
    if (!c.region && c.type !== 'Start') out.push({ t: `${c.id}: без региона`, sel: ['c:' + c.uid] });
    const z = pmRegionAt(c.x, c.y);
    if (z && c.region && z !== c.region && c.type !== 'Start') out.push({ t: `${c.id}: стоит в зоне «${z}», а регион «${c.region}»`, sel: ['c:' + c.uid] });
    if (!d.types.find(t => t.key === c.type)) out.push({ t: `${c.id}: неизвестный тип «${c.type}»`, sel: ['c:' + c.uid] });
  });
  const starts = d.cells.filter(c => c.type === 'Start');
  if (starts.length !== 1) out.push({ t: `Клеток Start: ${starts.length} (нужна 1)`, sel: starts.map(c => 'c:' + c.uid) });
  if (starts.length) {
    if (d.flow.on && !d.flow.exits.length) out.push({ t: 'Не задан выход из Start (выдели соседа Start → «Выход из Start»)', sel: ['c:' + starts[0].uid] });
    const dist = pmDistMap(), unreach = d.cells.filter(c => dist[c.uid] == null);
    if (unreach.length) out.push({ t: `Недостижимы от Start: ${unreach.length}`, sel: unreach.map(c => 'c:' + c.uid) });
  }
  const cnt = {}; d.cells.forEach(c => cnt[c.type] = (cnt[c.type] || 0) + 1);
  Object.entries(d.targets || {}).forEach(([k, v]) => { if ((cnt[k] || 0) !== +v) out.push({ t: `${k}: ${cnt[k] || 0} из ${v} по цели`, sel: d.cells.filter(c => c.type === k).map(c => 'c:' + c.uid) }); });
  return out;
}
function pmPCheck(box) {
  const iss = pmIssues(), lp = pmLoops(), br = pmBranches();
  box.innerHTML = `<h4 style="margin-top:0">Направление движения</h4>
    <label class="cb-label" style="margin-bottom:6px"><input type="checkbox" ${PM.data.flow.on ? 'checked' : ''} onchange="pmPush();PM.data.flow.on=this.checked;pmRender();pmPanelRefresh(true)"> По кругу от Start (для связей в режиме «Авто»)</label>
    <div class="pm-mini" style="margin-bottom:6px">Выходы из Start: ${PM.data.flow.exits.map(u => (pmCell(u) || {}).id).filter(Boolean).join(', ') || '—'} · меняется в свойствах соседней клетки</div>
    <h4>Маршрут</h4>
    <div class="pm-mini" style="line-height:1.7">Кратчайший круг через Start: <b style="color:var(--text)">${lp && lp.shortest ? lp.shortest + ' клеток' : '—'}</b><br>
    Длиннейший круг (без петель): <b style="color:var(--text)">${lp && lp.longest ? lp.longest + ' клеток' : '—'}</b>${lp && lp.cyc ? ' <span style="color:#f5c842">· есть петли по однозначным связям</span>' : ''}<br>
    Самая дальняя клетка от Start: <b style="color:var(--text)">${lp ? lp.farthest + ' шагов' : '—'}</b></div>
    <h4>Ветки между развилками (${br.length})</h4>
    ${br.length ? `<table class="pm-tbl"><tr style="cursor:default;color:var(--sub)"><td>Участок</td><td>шаг</td><td title="Негативные">−</td><td title="Позитивные">+</td><td title="События">?</td><td title="Бои">⚔</td></tr>
      ${br.map(b => `<tr onclick='PM.sel=new Set(${JSON.stringify(b.cells.map(u => 'c:' + u))});PM.pathCells=${JSON.stringify([b.from, ...b.cells])};pmRender()'><td>${pmEsc((pmCell(b.from) || {}).id)} → ${pmEsc((pmCell(b.to) || {}).id)}</td><td>${b.len}</td><td style="color:${b.neg ? '#f97316' : 'inherit'}">${b.neg}</td><td style="color:${b.pos ? '#c4f500' : 'inherit'}">${b.pos}</td><td>${b.ev}</td><td>${b.battles}</td></tr>`).join('')}</table>
      <div class="pm-mini" style="margin-top:4px">Связи «в обе стороны» в ветки не входят. Клик по строке — подсветить участок.</div>` : '<div class="pm-mini">Нет однозначных направлений — включи направление по кругу.</div>'}
    <h4>Проблемы (${iss.length})</h4>
    ${iss.length ? iss.slice(0, 80).map(x => `<div class="pm-warn" onclick='PM.sel=new Set(${JSON.stringify(x.sel)});pmRender()'>${pmEsc(x.t)}</div>`).join('') : '<div class="pm-ok">Проблем не найдено</div>'}
    <h4>Количество по типам (факт / цель)</h4>${pmTypeCounts()}`;
}
function pmPSim(box) {
  const o = PM.simOpt || { players: 6, die: 8, strategy: 'random', trials: 2000 }, r = PM.sim;
  const top = r ? Object.entries(r.land).sort((a, b) => b[1] - a[1]).slice(0, 8) : [];
  const types = r ? Object.entries(r.byType).sort((a, b) => b[1] - a[1]) : [];
  box.innerHTML = `<div class="pm-mini" style="margin-bottom:10px">Боты бросают кубик и ходят по направлению движения. Этап заканчивается, когда кто-то проходит Start. Предметы, телепорты и эффекты клеток не учитываются — только геометрия карты.</div>
    <div class="pm-row"><div class="pm-f"><label>Игроков</label><input id="pm-s-pl" type="number" min="1" max="8" value="${o.players}" onchange="document.getElementById('pm-s-die').value=+this.value<=4?6:+this.value<=6?8:10"></div>
    <div class="pm-f"><label>Кубик</label><select id="pm-s-die">${[4, 6, 8, 10, 12].map(n => `<option value="${n}" ${o.die === n ? 'selected' : ''}>d${n}</option>`).join('')}</select></div></div>
    <div class="pm-row"><div class="pm-f"><label>Развилки</label><select id="pm-s-st">${[['random', 'Случайно'], ['short', 'Кратчайший к Start'], ['safe', 'Избегать негативных'], ['mix', '50/50 случайно/кратчайший']].map(([k, l]) => `<option value="${k}" ${o.strategy === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="pm-f"><label>Прогонов</label><input id="pm-s-tr" type="number" min="100" max="20000" step="100" value="${o.trials}"></div></div>
    <button class="btn btn-y" style="width:100%;margin-bottom:12px" onclick="pmSimRun()">Запустить симуляцию</button>
    ${r ? `<h4 style="margin-top:0">Раундов до конца этапа</h4>
      <div style="font-family:'JetBrains Mono';font-size:22px;color:#fff">${r.avg.toFixed(1)} <span class="pm-mini">в среднем</span></div>
      <div class="pm-mini">10% быстрых: ≤${r.p10} · медиана: ${r.p50} · 10% долгих: ≥${r.p90}${r.stuck ? ` · <span style="color:#f5c842">тупиков по направлению: ${r.stuck} (там боты шли по любой связи)</span>` : ''}</div>
      <h4>Остановки по типам</h4>
      ${types.map(([t, n]) => `<div style="margin-bottom:5px"><div style="display:flex;justify-content:space-between;font-size:12px"><span><span class="pm-dot" style="display:inline-block;background:${pmType(t).color};margin-right:6px"></span>${pmEsc(t)}</span><span>${(n / r.totalLand * 100).toFixed(1)}%</span></div><div class="pm-bar" style="width:${n / types[0][1] * 100}%;background:${pmType(t).color}"></div></div>`).join('')}
      <h4>Самые посещаемые клетки</h4>
      <table class="pm-tbl">${top.map(([u, p]) => { const c = pmCell(u); return c ? `<tr onclick="PM.sel=new Set(['c:${u}']);pmCenterOn(${c.x},${c.y})"><td>${pmEsc(c.id)}</td><td>${pmEsc(c.type)}</td><td style="text-align:right">${(p * 100).toFixed(1)}%</td></tr>` : ''; }).join('')}</table>
      <div class="pm-mini" style="margin-top:6px">На холсте включено наложение «Тепловая карта»: число в клетке — % остановок.</div>` : ''}`;
}
function pmPView(box) {
  const o = PM.opt, cb = (k, t) => `<label class="cb-label" style="margin-bottom:8px"><input type="checkbox" ${o[k] ? 'checked' : ''} onchange="PM.opt.${k}=this.checked;pmSaveOpt();pmRender()"> ${t}</label>`;
  const lay = (k, t) => `<div class="pm-lay"><span>${t}</span><label class="cb-label"><input type="checkbox" ${o.layers[k].v ? 'checked' : ''} onchange="PM.opt.layers.${k}.v=this.checked;pmSaveOpt();pmRender()"> видно</label><label class="cb-label"><input type="checkbox" ${o.layers[k].l ? 'checked' : ''} onchange="PM.opt.layers.${k}.l=this.checked;pmSaveOpt();pmRender()"> 🔒</label></div>`;
  box.innerHTML = `<h4 style="margin-top:0">Слои</h4>${lay('zones', 'Зоны')}${lay('edges', 'Связи')}${lay('cells', 'Клетки')}${lay('markers', 'Маркеры')}
    <div class="pm-mini" style="margin-bottom:8px">🔒 — слой виден, но не ловит клики (удобно, чтобы не цеплять зоны).</div>
    <h4>Закладки вида</h4>
    ${PM.data.views.map((v, i) => `<div class="pm-row" style="margin-bottom:5px"><button class="btn btn-g" style="padding:6px 9px;font-size:13px;justify-content:flex-start" onclick="pmGoView(${i})">${i < 9 ? `<span class="pm-mini">Alt+${i + 1}</span> ` : ''}${pmEsc(v.name)}</button><button class="icon-btn danger" style="flex:none" onclick="pmDelView(${i})">×</button></div>`).join('') || '<div class="pm-mini" style="margin-bottom:6px">Закладок нет.</div>'}
    <button class="btn btn-g" style="width:100%;margin-bottom:6px" onclick="pmAddView()">+ Закладка текущего вида</button>
    <h4>Отображение</h4>
    ${cb('minimap', 'Миникарта')}${cb('arrows', 'Стрелки авто-направления')}${cb('ids', 'Показывать Id')}${cb('types', 'Показывать тип под клеткой')}${cb('labels', 'Подпись вместо типа, если задана')}${cb('grid', 'Сетка (G)')}${cb('snap', 'Привязка к сетке')}${cb('smooth', 'Сглаженные контуры и изломы')}
    <h4>Редактирование</h4>${cb('autoRegion', 'Авто-регион по зоне при перемещении')}${cb('autosave', 'Автосохранение')}
    <div class="pm-f" style="margin-top:8px"><label>Шаг сетки</label><input type="number" value="${PM.data.grid || 20}" onchange="pmPush();PM.data.grid=Math.max(5,+this.value||20);pmRender()"></div>`;
}
async function pmPVersions(box) {
  box.innerHTML = '<span class="spinner"></span>';
  const vs = await pmVersions();
  if (PM.panel !== 'versions') return;
  box.innerHTML = `<button class="btn btn-y" style="width:100%;margin-bottom:6px" onclick="pmSnapshot()">Сохранить версию</button>
    <button class="btn btn-g" style="width:100%;margin-bottom:10px" onclick="pmSaveAs()">Сохранить как отдельную карту</button>
    ${vs.length ? vs.map(v => `<div class="row-item" style="padding:8px 10px;margin-bottom:6px"><div><b style="font-size:13px">${pmEsc(v.label)}</b><div class="pm-mini">${new Date(v.created_at).toLocaleString()}</div></div><button class="btn btn-g" style="padding:5px 9px;font-size:12px" onclick="pmRestore('${v.id}')">Вернуть</button></div>`).join('') : '<div class="pm-mini">Версий пока нет.</div>'}`;
}

/* ---------- импорт / экспорт ---------- */
function pmDownload(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function pmExportJSON() { pmDownload((PM.name || 'map') + '.json', new Blob([JSON.stringify(PM.data, null, 1)], { type: 'application/json' })); }
function pmImportJSON() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try { const d = JSON.parse(await inp.files[0].text()); if (!d.cells) throw new Error('нет поля cells'); pmPush(); PM.data = d; pmNormalize(d); PM.sel.clear(); pmRender(); pmFit(); toast('JSON загружен'); }
    catch (e) { toast('Не удалось прочитать JSON: ' + e.message, 'err'); }
  };
  inp.click();
}
/* Колонки как в листе «Клетки карты»: Id, Регион, Тип, Фикс/Гибрид, Варианты гибрида, Ветка, Соседние клетки, Гиммик, Статус */
function pmTSV() {
  const nb = {}; PM.data.edges.forEach(e => { (nb[e.a] = nb[e.a] || []).push(e.b); (nb[e.b] = nb[e.b] || []).push(e.a); });
  const ord = PM.data.cells.slice().sort((a, b) => (a.type === 'Start' ? -1 : b.type === 'Start' ? 1 : 0) || a.id.localeCompare(b.id, 'ru', { numeric: true }));
  const clean = s => String(s ?? '').replace(/[\t\n]/g, ' ');
  return ord.map(c => [c.id, c.region || '—', c.type, c.type === 'Гибрид' ? 'Гибрид' : 'Фикс', c.variants, c.branch, (nb[c.uid] || []).map(u => (pmCell(u) || {}).id).filter(Boolean).join(', '), c.gimmick, c.status].map(clean).join('\t')).join('\n');
}
async function pmExportTSV() {
  const t = pmTSV();
  try { await navigator.clipboard.writeText(t); toast('Скопировано: вставь в «Клетки карты» начиная с A5'); }
  catch (e) { pmDownload((PM.name || 'map') + '.tsv', new Blob([t], { type: 'text/tab-separated-values' })); }
}
function pmImportTSV() {
  const t = prompt('Вставь строки из листа «Клетки карты» (колонки A–I, без заголовка). Клетки с теми же Id обновятся, новые появятся у центра своего региона.');
  if (!t) return;
  pmPush();
  const rows = t.split(/\r?\n/).map(r => r.split('\t')).filter(r => r[0] && r[0].trim());
  const byId = {}; PM.data.cells.forEach(c => byId[c.id] = c);
  let added = 0, upd = 0;
  rows.forEach(r => {
    const [id, region, type, , variants, branch, , gimmick, status] = r.map(x => (x || '').trim());
    let c = byId[id];
    const reg = region === '—' ? '' : region;
    if (!c) {
      const z = pmRegion(reg), pts = z && z.points.length ? z.points : null;
      const cx = pts ? pts.reduce((s, p) => s + p[0], 0) / pts.length : 0, cy = pts ? pts.reduce((s, p) => s + p[1], 0) / pts.length : 0;
      c = { uid: pmUid(), id, x: Math.round(cx + (Math.random() - .5) * 120), y: Math.round(cy + (Math.random() - .5) * 120), label: '', note: '', props: {} };
      PM.data.cells.push(c); byId[id] = c; added++;
    } else upd++;
    Object.assign(c, { region: reg, type: type || c.type, variants: variants || '', branch: branch || '', gimmick: gimmick || '', status: status || c.status });
    if (type && !PM.data.types.find(x => x.key === type)) PM.data.types.push({ key: type, color: '#9ca3af', short: type[0] });
  });
  const seen = new Set(PM.data.edges.map(e => [e.a, e.b].sort().join('-')));
  rows.forEach(r => {
    const a = byId[(r[0] || '').trim()]; if (!a) return;
    (r[6] || '').split(',').map(s => s.trim()).filter(Boolean).forEach(n => {
      const b = byId[n]; if (!b) return; const k = [a.uid, b.uid].sort().join('-');
      if (!seen.has(k)) { seen.add(k); PM.data.edges.push({ id: pmUid(), a: a.uid, b: b.uid, mode: 'auto', pts: [], curve: 0 }); }
    });
  });
  toast(`Обновлено ${upd}, добавлено ${added}`); pmRender();
}
function pmSVGString() {
  const svg = document.getElementById('pm-svg'), b = pmBounds() || { x0: 0, x1: 100, y0: 0, y1: 100 };
  const x0 = b.x0 - 60, y0 = b.y0 - 60, x1 = b.x1 + 60, y1 = b.y1 + 60;
  const g = svg.querySelector('g[transform]').cloneNode(true); g.removeAttribute('transform');
  g.querySelectorAll('[stroke-dasharray="4 3"],[data-vtx],[data-ept],title').forEach(n => n.remove());
  g.querySelectorAll('[opacity]').forEach(n => { const v = n.getAttribute('opacity'); if (v === '0.18' || v === '0.15') n.setAttribute('opacity', '1'); });
  return { w: x1 - x0, h: y1 - y0, s: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="${x1 - x0}" height="${y1 - y0}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#0b0b0d"/>${g.outerHTML}</svg>` };
}
function pmExportSVG() { pmDownload((PM.name || 'map') + '.svg', new Blob([pmSVGString().s], { type: 'image/svg+xml' })); }
function pmExportPNG() {
  const { w, h, s } = pmSVGString(), img = new Image(), sc = 2;
  img.onload = () => { const cv = document.createElement('canvas'); cv.width = w * sc; cv.height = h * sc; const cx = cv.getContext('2d'); cx.scale(sc, sc); cx.drawImage(img, 0, 0); cv.toBlob(b => pmDownload((PM.name || 'map') + '.png', b)); };
  img.onerror = () => toast('Не удалось отрисовать PNG — скачай SVG', 'err');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}
window.addEventListener('beforeunload', e => { if (PM.dirty && document.getElementById('pm-svg')) { pmSave(true); e.preventDefault(); e.returnValue = ''; } });
