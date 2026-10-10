/* Движок Nexus Party. Без DOM: все решения игроков и ввод результатов боёв идут через объект io
   (см. README, раздел «Интерфейс io»). Состояние S сериализуется в JSON целиком. */
(function () {
  const NP = (globalThis.window || globalThis).NP;

  class GameOver extends Error { }

  // ---------- граф карты ----------
  const OUT = {}, IN = {}, CELL = {}, ADJ = {};
  for (const c of NP.MAP.cells) { CELL[c.id] = c; OUT[c.id] = []; IN[c.id] = []; ADJ[c.id] = new Set(); }
  for (const [a, b, both] of NP.MAP.edges) {
    OUT[a].push(b); IN[b].push(a); ADJ[a].add(b); ADJ[b].add(a);
    if (both) { OUT[b].push(a); IN[a].push(b); }
  }
  const IDS = NP.MAP.cells.map(c => c.id);
  const regionOf = id => (CELL[id] && CELL[id].region) || '';
  function bfs(from, nbr, max) { // клетки на расстоянии 1..max
    const d = { [from]: 0 }, q = [from], res = [];
    while (q.length) { const x = q.shift(); if (d[x] >= max) continue; for (const y of nbr(x)) if (d[y] === undefined) { d[y] = d[x] + 1; q.push(y); res.push(y); } }
    return { cells: res, dist: d };
  }
  NP.GRAPH = { OUT, IN, CELL, ADJ, IDS, regionOf, bfs };

  // ---------- случайность (сериализуемая) ----------
  function rnd(S) { let t = (S.rs = (S.rs + 0x6D2B79F5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

  class Game {
    constructor(io, state) { this.io = io; this.S = state; }

    static create(cfg, names) {
      const c = Object.assign({}, NP.DEFAULTS, cfg);
      c.players = names.length; c.die = c.die || NP.dieFor(c.players);
      const seed = c.seed || (Date.now() % 2147483647);
      const S = {
        v: 1, cfg: c, seed, rs: seed, stage: 1, round: 0, turnPtr: 0, order: [], players: [], cells: {}, reaperZone: {},
        regionFx: {}, regionBy: {}, shop: null, truck: 0, storm: [], queue: [], bets: [], lastItem: null,
        stagePending: null, hunted: false, deck: { L: {}, R: [] }, over: false, winner: null, endReason: '', log: [], phase: 'turn'
      };
      names.forEach((n, i) => S.players.push({
        i, name: n, color: NP.PLAYER_COLORS[i % 8], pos: 'S', prev: null, trail: [], pts: 0, items: [], lap: 1, marks: [],
        st: { stun: 0, silence: 0, shield: 0, mirror: 0, dice: [], battery: 0, midas: 0, midasAnom: false, badDay: false, extra: false, rollex: 0, bomb: null, extraMod: 0, ban: 0, contract: '' },
        src: { zzz: 0, mod: 0, board: 0 }
      }));
      const g = new Game(null, S);
      S.order = g.shuffle(S.players.map(p => p.i));
      g.genStage();
      for (const p of S.players) for (let k = 0; k < c.startItems; k++) g.giveRandom(p, null, true);
      for (const p of S.players) p.pts = c.startPoints || 0; // стартовые очки
      g.log('Партия создана. Кубик d' + c.die + ', этапов: ' + c.stages + '.');
      return S;
    }

    // ---------- утилиты ----------
    r() { return rnd(this.S); }
    roll(n) { return 1 + Math.floor(this.r() * n); }
    pick(a) { return a[Math.floor(this.r() * a.length)]; }
    shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    wpick(list) { const t = list.reduce((s, x) => s + x[1], 0); let x = this.r() * t; for (const e of list) { if ((x -= e[1]) < 0) return e; } return list[list.length - 1]; }
    get P() { return this.S.players; }
    log(m, p, n) { this.S.log.push(Object.assign({ t: this.S.log.length, m, p: p ? p.i : null, st: this.S.stage, rd: this.S.round }, n ? { n: 1 } : {})); if (this.io && this.io.log) this.io.log(m); }
    note(m, p) { this.log(m, p, true); } // строка журнала + всплывающее уведомление у всех
    announce(spec) { if (this.io && this.io.announce) this.io.announce(spec); } // карточка для всех, без ожидания
    async rollFor(p, d, what) { // бросок, который игрок делает сам и видят все
      await this.io.wait?.({ player: p.i, kind: 'roll', title: what + ': бросить d' + d });
      if (this.S.over) throw new GameOver();
      const r = this.roll(d); this.note('🎲 ' + p.name + ' — ' + what + ': d' + d + ' = ' + r + '.', p); return r;
    }
    upd() { if (this.io && this.io.update) this.io.update(); }
    leader() { return this.P.reduce((a, b) => (b.pts > a.pts ? b : a)); }
    others(p) { return this.P.filter(q => q !== p); }
    fx(reg) { return this.S.regionFx[reg] || null; }
    gActive(id) { const g = this.S.gfx; return !!(g && g.id === id && this.S.stage === g.stage && this.S.round <= g.until); }
    die(p) { let d = this.S.cfg.die; if (p && this.fx('В') === 'E-В6' && regionOf(p.pos) === 'В') d = Math.max(4, d - 2); return d; }
    cellName(id) { // для игроков: тип клетки и регион, без кодового номера
      if (!id || id === 'S' || !this.S.cells[id]) return 'Start';
      const r = NP.REGIONS[regionOf(id)]; return this.S.cells[id].type + (r ? ' · ' + r.name : '');
    }
    cellOpts(ids) { const seen = {}; return ids.map(x => { const n = this.cellName(x); seen[n] = (seen[n] || 0) + 1; return { label: n + (seen[n] > 1 ? ' (' + seen[n] + ')' : ''), value: x }; }); }
    isAnom(id) { const c = this.S.cells[id]; return !!(c && (c.anom || this.gActive('G-02') || (this.fx('Р') === 'E-Р3' && regionOf(id) === 'Р'))); }
    async choose(p, title, options, extra) { // options: [{label, value, hint?, disabled?}]
      const opts = options.filter(o => !o.disabled);
      if (opts.length === 1 && !(extra && extra.always)) return opts[0].value;
      const v = await this.io.choose(Object.assign({ player: p ? p.i : null, title, options }, extra || {}));
      if (this.S.over) throw new GameOver();
      return v;
    }
    metric(mode) { return NP.MODE_METRIC[String(mode || '').replace(/ ×\d+$/, '')] || 'score'; } // «Annihilation ×3» (GC) меряется как Annihilation
    better(mode, x, y) { // true, если результат x лучше y; пустой результат хуже любого
      const ok = v => v !== null && v !== undefined && v !== '' && !isNaN(v);
      if (!ok(x)) return false; if (!ok(y)) return true;
      return this.metric(mode) === 'time' ? +x < +y : +x > +y;
    }
    rankBy(mode, results, ids) { // порядок мест по введённым результатам, ничья — случайно
      return this.shuffle(ids.slice()).sort((a, b) => this.better(mode, results[a], results[b]) ? -1 : this.better(mode, results[b], results[a]) ? 1 : 0);
    }
    async ioFight(spec) { const r = await this.io.fight(spec); if (this.S.over) throw new GameOver(); return r; }
    gm(fn) { this.gmCtx = true; try { fn(); } finally { this.gmCtx = false; } this.upd(); } // действия ведущего вне потока движка

    // ---------- очки и предметы ----------
    add(p, v, src) {
      if (!v) return 0;
      if ((src || 'board') === 'board' && this.gActive('G-10')) v *= 2;
      if (v < 0) v = -Math.min(p.pts, -v);
      p.pts += v; p.src[src || 'board'] += v;
      const th = this.S.cfg.threshold;
      if (th && p.pts >= th && !this.S.over) { this.finish('threshold', p); if (!this.gmCtx) throw new GameOver(); }
      return v;
    }
    steal(from, to, n) { const v = Math.min(from.pts, n); this.add(from, -v); this.add(to, v); return v; }
    randomItemKey(rar) {
      if (!rar) rar = this.wpick([['common', 60], ['rare', 30], ['vrare', 10]])[0];
      const demo = this.S.cfg.mode === 'demo'; // в демо нет предметов с ручной проверкой
      return this.pick(Object.keys(NP.ITEMS).filter(k => NP.ITEMS[k].rarity === rar && !(demo && NP.DEMO_NO_ITEMS.includes(k))));
    }
    giveItem(p, key, anom) {
      if (p.items.length >= this.S.cfg.slots) { this.log(p.name + ': инвентарь полон, «' + NP.ITEMS[key].name + '» сгорает.', p); return false; }
      p.items.push({ key, anom: !!anom }); this.note('▣ ' + p.name + ' получает предмет «' + NP.ITEMS[key].name + '»' + (anom ? ' ✦ аномальный' : '') + '.', p); return true;
    }
    giveRandom(p, rar, quiet, anom) { const k = this.randomItemKey(rar); if (quiet) { if (p.items.length < this.S.cfg.slots) p.items.push({ key: k, anom: !!anom }); return; } this.giveItem(p, k, anom); }
    async giveChoice(p, n) { // выбор 1 из n случайных предметов
      const ks = []; for (let k = 0; k < n; k++) ks.push(this.randomItemKey());
      const k = await this.choose(p, 'Выбери предмет', ks.map(x => ({ label: NP.ITEMS[x].name, value: x, hint: NP.ITEMS[x].text })));
      this.giveItem(p, k);
    }
    takeItem(p, idx) { return p.items.splice(idx, 1)[0]; }
    status(p, k, v) {
      const st = p.st;
      if (k === 'golden' || k === 'rusty') { const opp = k === 'golden' ? -2 : 2, i = st.dice.indexOf(opp); if (i >= 0) st.dice.splice(i, 1); else st.dice.push(k === 'golden' ? 2 : -2); }
      else if (k === 'stun') st.stun = 1;
      else if (k === 'silence') st.silence = Math.max(st.silence, v || 1);
      else if (k === 'shield') st.shield = Math.max(st.shield, 1);
      else if (k === 'mirror') st.mirror = 1;
      else if (k === 'extra') st.extra = true;
      else if (k === 'badDay') st.badDay = true;
      const names = { golden: 'Золотой кубик', rusty: 'Ржавый кубик', stun: 'Оглушение', silence: 'Запрет предметов', shield: 'Щит', mirror: 'Зеркало', extra: 'Дополнительный ход', badDay: 'Плохой день' };
      this.log(p.name + ': ' + (names[k] || k) + '.', p);
    }

    /* Негативное воздействие: Зеркало раньше Щита. fn(target) применяет эффект. src — игрок-источник или null. */
    async hit(t, src, fn, label) {
      if (t.st.mirror) {
        const anom = t.st.mirror === 2; t.st.mirror = 0;
        const to = src && src !== t ? src : this.pick(this.others(t));
        this.log(t.name + ': Зеркало отражает «' + (label || 'эффект') + '» на ' + to.name + '.', t);
        if (anom) this.steal(to, t, 1);
        await fn(to); return false;
      }
      if (t.st.shield > 0) { t.st.shield--; this.log(t.name + ': Щит погасил «' + (label || 'эффект') + '».', t); return false; }
      await fn(t); return true;
    }

    // ---------- этап ----------
    genStage() {
      const S = this.S, keepTraps = {};
      for (const id in S.cells) if (S.cells[id].trap !== null && S.cells[id].trap !== undefined) keepTraps[id] = S.cells[id].trap;
      S.cells = {};
      for (const c of NP.MAP.cells) S.cells[c.id] = { type: c.type, hybrid: c.type === 'Гибрид', anom: c.id !== 'S' && this.r() < S.cfg.anomaly, trap: keepTraps[c.id] ?? null, pity: false, sealed: false };
      // Гибриды: два Жнеца не ближе 2 клеток друг к другу
      for (const c of NP.MAP.cells) if (c.type === 'Гибрид') {
        const near = bfs(c.id, x => ADJ[x], 2).cells;
        const pool = NP.HYBRID_POOL.filter(t => t !== 'Жнец' || !near.some(x => S.cells[x].type === 'Жнец'));
        S.cells[c.id].type = this.pick(pool);
      }
      S.mines = []; S.reaperZone = {}; S.regionFx = {}; S.regionBy = {}; S.storm = []; S.shop = null; S.hunted = false; S.stagePending = null; S.round = 0;
      S.regionFx['Ш'] = this.pick(this.regionPool('Ш')).id; // Шестая улица активна с начала этапа
      this.log('Этап ' + S.stage + ': Шестая улица — «' + this.fxName(S.regionFx['Ш']) + '».');
    }
    regionPool(reg) { return NP.REGION_FX.filter(e => e.region === reg); }
    fxName(id) { const e = NP.REGION_FX.find(x => x.id === id); return e ? e.name : id; }

    // ---------- главный цикл ----------
    async run() {
      try {
        while (!this.S.over) {
          if (this.S.phase === 'turn') await this.playRound();
          else if (this.S.phase === 'stageEnd') await this.stageEnd();
        }
      } catch (e) { if (!(e instanceof GameOver)) throw e; }
      this.upd();
      if (this.io.gameOver) await this.io.gameOver(this.S);
    }
    async playRound() {
      const S = this.S;
      if (!S.roundOpen) { S.round++; S.roundOpen = true; await this.roundStart(); }
      while (S.turnPtr < S.order.length) {
        const p = this.P[S.order[S.turnPtr]];
        if (this.io.save) this.io.save(S);
        await this.turn(p);
        S.turnPtr++;
        this.upd();
        if (S.stagePending !== null) { S.phase = 'stageEnd'; S.turnPtr = 0; S.roundOpen = false; if (this.io.save) this.io.save(S); return; }
      }
      S.turnPtr = 0; S.roundOpen = false;
      await this.roundEnd();
    }
    async roundStart() {
      const S = this.S;
      this.log('— Раунд ' + S.round + ' (этап ' + S.stage + ') —');
      if (S.round === 1 && S.cfg.globalEvents) await NP.Globals.start(this);
      if (this.gActive('G-05')) for (const p of this.P) this.add(p, 1);
      S.g14 = S.g14 || {};
      if (this.fx('Ш') === 'E-Ш1' && !S.shop) { S.shop = this.pick(NP.SIXTH_SHOPS); this.log('Открыто заведение Шестой улицы (🏪 на карте).'); }
      if (this.fx('Р') === 'E-Р6') {
        const inR = this.P.filter(p => regionOf(p.pos) === 'Р');
        if (inR.length) { const v = this.pick(inR); await this.hit(v, null, t => this.status(t, 'stun'), 'Остров спит'); }
      }
    }

    async turn(p) {
      const S = this.S; S.cur = p.i; p.turnRegions = [];
      this.log('Ход: ' + p.name + '.', p);
      if (this.fx('Р') === 'E-Р1') { S.storm = this.shuffle(IDS.filter(id => regionOf(id) === 'Р')).slice(0, 4); }
      this.upd();
      if (p.st.stun) { p.st.stun = 0; this.log(p.name + ': Оглушение, бросок пропущен.', p); await this.tickBomb(p); return; }
      let used = null;
      if (p.st.silence > 0) { p.st.silence--; this.log(p.name + ': запрет предметов на этот ход.', p); }
      else if (this.gActive('G-07')) this.log('Интернот отключён: предметы недоступны.', p);
      else used = await this.preItem(p);
      if (p.st.stun) { p.st.stun = 0; await this.tickBomb(p); return; }
      let r = await this.doRoll(p, !used);
      S.lastRoll = r;
      this.log(p.name + ' идёт на ' + r + ' кл.', p);
      await this.move(p, r, true);
      await this.land(p, true);
      await this.tickBomb(p);
      await this.activateRegions(p);
      if (p.st.extra && S.stagePending === null) { p.st.extra = false; this.log(p.name + ': дополнительный ход.', p); await this.turn(p); }
    }

    async doRoll(p, canPost) {
      const st = p.st; let d = this.die(p);
      await this.io.wait?.({ player: p.i, kind: 'roll', title: 'Бросить d' + d });
      let r = this.roll(d), note = ['d' + d + ': ' + r];
      if (st.battery) { st.battery--; const b = this.roll(d); r = Math.min(r, b); note.push('батарейка ' + b + ' → ' + r); }
      if (st.midas) { st.midas--; const b = this.roll(d); if (st.midasAnom && (b === d || r === d)) this.add(p, 1); r = Math.max(r, b); note.push('рука ' + b + ' → ' + r); }
      const reg = regionOf(p.pos);
      if (this.fx('Б') === 'E-Б2' && reg === 'Б') await this.hit(p, null, () => { const b = this.roll(d); r = Math.min(r, b); note.push('буря ' + b + ' → ' + r); }, 'Песчаная буря');
      if (this.fx('Б') === 'E-Б3' && reg === 'Б') { r += 2; note.push('Инферно-кросс +2'); }
      if (st.dice.length) { const m = st.dice.shift(); r += m; note.push((m > 0 ? 'Золотой кубик +' : 'Ржавый кубик −') + Math.abs(m)); }
      r = Math.max(1, r);
      this.note('🎲 ' + p.name + ' бросает: ' + note.join(', ') + '.', p);
      if (canPost) r = await this.postItem(p, r, d);
      return Math.max(1, r);
    }

    // ---------- движение ----------
    // Все пути ровно на n шагов (без разворота по только что пройденной связи), сгруппированные по конечной клетке.
    paths(from, prev, n) {
      const res = {}; let count = 0;
      const go = (pos, pr, path) => {
        if (count > 20000) return;
        if (path.length === n) { (res[pos] = res[pos] || []).push(path.slice()); count++; return; }
        let opts = OUT[pos].filter(x => x !== pr); if (!opts.length) opts = OUT[pos];
        for (const x of opts) { path.push(x); go(x, pos, path); path.pop(); }
      };
      go(from, prev, []);
      return res;
    }
    async move(p, n, own) {
      if (n <= 0) return;
      const ends = this.paths(p.pos, p.prev, n), ids = Object.keys(ends);
      if (!ids.length) return;
      const to = await this.choose(p, 'Ход на ' + n + ' кл.: выбери клетку', this.cellOpts(ids), { kind: 'cell', cells: ids, always: true, from: p.pos, paths: Object.fromEntries(ids.map(x => [x, ends[x][0]])) }); // выбор показывается всегда; путь подсвечивается на поле
      const path = ends[to][0];
      for (let k = 0; k < path.length; k++) await this.step(p, path[k], own, k === path.length - 1);
    }
    async step(p, to, own, last) {
      p.prev = p.pos; p.trail.push(p.pos); if (p.trail.length > 40) p.trail.shift();
      p.pos = to;
      this.enter(p, to);
      if (this.S.cur === p.i) this.bombPass(p); // бомбу передаёт только её владелец в свой ход
      if (to === 'S') await this.passStart(p);
      if (this.S.shop === to && !last) await this.shopHit(p); // проход через заведение
      this.upd();
    }
    enter(p, id) { // вход в клетку: отметка региона и учёт активации
      const reg = regionOf(id); if (!reg) return;
      if (!p.marks.includes(reg)) { p.marks.push(reg); const v = this.S.cfg.regionPoint || 0; if (v) { this.note('🗺 ' + p.name + ': новый регион ' + NP.REGIONS[reg].name + ' (' + p.marks.length + '/4), +' + v + '.', p); this.add(p, v); } }
      if (p.turnRegions && !p.turnRegions.includes(reg)) p.turnRegions.push(reg);
      if (this.fx('Б') === 'E-Б5' && reg === 'Б' && regionOf(p.prev) !== 'Б' && this.S.regionBy['Б'] !== p.i && this.S.regionBy['Б'] !== undefined) {
        const o = this.P[this.S.regionBy['Б']]; const v = this.steal(p, o, 1); if (v) this.log(p.name + ' платит пошлину Мотор-лиги игроку ' + o.name + '.', p);
      }
    }
    async passStart(p) {
      const S = this.S;
      this.giveRandom(p);
      if (p.marks.length === 4) {
        const v = S.cfg.lapPoint || 0; if (v) { this.note('🏁 ' + p.name + ' проходит Start со всеми 4 регионами: +' + v + '.', p); this.add(p, v); }
        if (p.lap === S.stage && S.stagePending === null) { S.stagePending = p.i; this.log(p.name + ' проходит Start с 4/4 и завершает этап ' + S.stage + '!', p); p.lap = S.stage + 1; }
        else { this.log(p.name + ' проходит Start с 4/4 старого круга и начинает сбор заново.', p); p.lap = S.stage; }
        p.marks = [];
      } else if (p.lap < S.stage) { p.lap = S.stage; p.marks = []; }
    }
    async moveBack(p, n) {
      for (let k = 0; k < n; k++) {
        const back = p.pos === 'S' ? [] : IN[p.pos].filter(x => x !== 'S'); // назад через Start нельзя
        if (!back.length) break;
        const to = this.pick(back); // назад — случайно по входящим связям
        p.prev = null; p.pos = to; this.enter(p, to);
      }
      this.log(p.name + ': назад на ' + n + ' кл. → ' + this.cellName(p.pos) + '.', p);
      this.upd();
    }
    async forceMove(p, n) { this.log(p.name + ' сдвигается вперёд на ' + n + ' кл.', p); await this.move(p, n, false); await this.land(p, false); }
    async teleportTo(p, id) { p.prev = null; p.trail = []; p.pos = id; this.enter(p, id); if (this.S.cur === p.i) this.bombPass(p); this.log(p.name + ' перемещается на ' + this.cellName(id) + '.', p); this.upd(); }
    tpRange(roll) { return Math.max(1, Math.floor(roll * 1.5)); } // радиус телепорта: 1,5× броска (было 2×, −25%)
    rangeCells(from, r) {
      // телепорт не может ни встать на Start, ни пройти через него
      // расстояние по связям в любую сторону: можно попасть и на соседнюю ветку развилки
      return bfs(from, x => [...ADJ[x]].filter(y => y !== 'S'), r).cells.filter(x => x !== 'S' && x !== from);
    }

    // ---------- клетки ----------
    async land(p, own) {
      const S = this.S, id = p.pos; if (id === 'S') return;
      const c = S.cells[id], t = c.type, a = this.isAnom(id), m = a ? 2 : 1, reg = regionOf(id);
      // ловушка, шторм, Жнец — пассивные
      if (c.trap !== null && c.trap !== p.i) {
        const owner = this.P[c.trap]; c.trap = null;
        this.note('⚠ ' + p.name + ' попадает в ловушку ' + owner.name + '!', p);
        await this.hit(p, owner, q => this.event(q, 'Rneg'), 'Ловушка');
      }
      if ((S.mines = S.mines || []).includes(id)) { S.mines.splice(S.mines.indexOf(id), 1); this.log(p.name + ' наступает на мину Сынов Калидона!', p); await this.hit(p, null, q => { this.add(q, -2); this.status(q, 'stun'); }, 'Мина'); }
      if (this.gActive('G-14') && reg && !S.g14[reg]) { S.g14[reg] = true; this.add(p, 2); this.log(p.name + ': значок инспектора Мяучело, +2.', p); }
      if (this.gActive('G-06') && reg === S.gReg) { this.log('Каверна: клетка работает как случайное событие.', p); await this.event(p, 'R'); return; }
      if (S.storm.includes(id)) await this.hit(p, null, q => { this.add(q, -1); this.status(q, 'silence', 1); }, 'Эфирный шторм');
      const ro = S.reaperZone[id];
      if (ro !== undefined && ro !== p.i) await this.hit(p, this.P[ro], q => { const v = this.steal(q, this.P[ro], S.cfg.reaper); this.note('☠ Жнец ' + this.P[ro].name + ' забирает ' + v + ' очк. у ' + q.name + '.', q); }, 'Жнец');
      // бонусы остановки от эффектов регионов
      if (reg === 'Ш' && this.fx('Ш') === 'E-Ш3') this.add(p, 1);
      if (reg === 'Б' && this.fx('Б') === 'E-Б4') this.add(p, 1);
      if (reg === 'Р' && this.fx('Р') === 'E-Р5') { const srt = this.P.map(q => q.pts).sort((x, y) => x - y); if (p.pts <= srt[Math.floor((srt.length - 1) / 2)]) this.add(p, 1); }
      if (S.shop === id) await this.shopHit(p);
      if (!own && !NP.PASSIVE.includes(t)) return;
      const bw = reg === 'Б' && this.fx('Б') === 'E-Б6' ? 2 : 1;
      switch (t) {
        case 'Очки': this.note('➕ ' + p.name + ': клетка Очки, +' + S.cfg.pointsCell * m * bw + '.', p); this.add(p, S.cfg.pointsCell * m * bw); break;
        case 'Опасность':
          await this.hit(p, null, async q => {
            this.add(q, -S.cfg.danger * m * bw); this.note('⚠ ' + q.name + ': Опасность, −' + S.cfg.danger * m * bw + '.', q);
            if (reg === 'В' && this.fx('В') === 'E-В3') { await this.teleportTo(q, this.pick(IDS.filter(x => regionOf(x) === 'В'))); await this.land(q, false); }
            else await this.moveBack(q, 1);
          }, 'Опасность'); break;
        case 'Сундук':
          for (let k = 0; k < m; k++) {
            if (reg === 'Ш' && this.fx('Ш') === 'E-Ш4') this.giveRandom(p, this.wpick([['rare', 75], ['vrare', 25]])[0]); // не ниже редкого
            else { this.giveRandom(p); if (reg === 'В' && this.fx('В') === 'E-В5') { this.add(p, 1); this.log(p.name + ': Чайный сезон +1.', p); } }
          } break;
        case 'Жнец': this.reaperClaim(p, id, a); break;
        case 'Телепорт': await this.teleportCell(p, a, own); break;
        case 'Событие':
          if (!own) await this.event(p, 'R');
          else if (a) { await this.event(p, 'R'); await this.event(p, 'L'); }
          else await this.event(p, this.r() < S.cfg.regionShare ? 'L' : 'R');
          break;
        case 'Общий бой':
          if (reg === 'Ш' && this.fx('Ш') === 'E-Ш3') { this.log('Репетиция Астры Яо: бой не запускается.'); break; }
          if (this.gActive('G-05')) { this.log('Концерт Астры Яо: бой не запускается.'); break; }
          S.queue.push({ k: 'fight', p: p.i, mods: m + (reg === 'В' && this.fx('В') === 'E-В3' ? 1 : 0) });
          this.log(p.name + ' запускает общий бой' + (S.cfg.cellFights === 'now' ? '.' : ' (в конце раунда).'), p);
          if (S.cfg.cellFights === 'now') await this.resolveQueue(); break;
        case 'Дуэль': S.queue.push({ k: 'duelcell', p: p.i, anom: a, v4: reg === 'В' && this.fx('В') === 'E-В4' }); this.log(p.name + ' запускает дуэли' + (S.cfg.cellFights === 'now' ? '.' : ' (в конце раунда).'), p);
          if (S.cfg.cellFights === 'now') await this.resolveQueue(); break;
        case 'Охота': await this.hunt(p, a); break;
        case 'Казино': await this.casino(p, a, reg); break;
        case 'Гача': await this.gacha(p, a, id, reg); break;
        case 'Ломбард': await this.pawn(p, a); break;
        case 'Тайник': await this.stash(p, a, id); break;
      }
    }
    reaperClaim(p, id, a) {
      const S = this.S;
      if (S.reaperZone[id] !== undefined) return;
      const zone = [id, ...ADJ[id]].filter(x => x !== 'S' && regionOf(x) === regionOf(id) && (x === id || S.cells[x].type !== 'Жнец'));
      for (const z of zone) if (S.reaperZone[z] === undefined) S.reaperZone[z] = p.i;
      this.log(p.name + ' захватывает Жнеца (' + this.cellName(id) + ', зона ' + zone.length + ' кл.).', p);
      if (a) for (const q of this.others(p)) if (regionOf(q.pos) === regionOf(id)) this.steal(q, p, S.cfg.reaper);
    }
    async teleportCell(p, a, own) {
      const S = this.S, r = own && S.lastRoll ? S.lastRoll : this.roll(this.die(p)), R = this.tpRange(r);
      const cand = this.rangeCells(p.pos, R).filter(x => S.cells[x].type !== 'Телепорт'); // без цепочек телепортов
      if (!cand.length) return;
      let to;
      if (a) to = this.r() < 0.17 ? this.pick(IDS.filter(x => S.cells[x].type === 'Телепорт' && x !== p.pos)) : this.pick(cand);
      else if (!own) to = this.pick(cand); // не своим ходом — случайный перенос (пассивная клетка)
      else to = await this.choose(p, 'Телепорт: выбери клетку (до ' + R + ' кл. по связям в любую сторону)', this.cellOpts(cand), { kind: 'cell', cells: cand, always: true });
      this.note('⇄ ' + p.name + ': телепорт ' + (a ? '(аномальный) ' : !own ? '(случайно) ' : '') + '→ ' + this.cellName(to) + '.', p);
      await this.teleportTo(p, to);
      if (this.r() < S.cfg.teleportTrap) { this.log('Сбой телепорта: случайное событие!', p); await this.event(p, 'R'); }
      await this.land(p, false);
    }
    async casino(p, a, reg) {
      const S = this.S, N = this.P.length;
      let lim = Math.max(1, Math.floor(N * S.cfg.casinoMult)) * (a ? 2 : 1), min = a ? Math.min(2, p.pts) : 0;
      lim = Math.min(lim, p.pts);
      if (lim <= 0) { this.log(p.name + ': нечего ставить в Казино.', p); return; }
      const opts = []; for (let b = min; b <= lim; b++) opts.push({ label: b === 0 ? 'Не играть' : 'Ставка ' + b, value: b });
      const bet = await this.choose(p, 'Казино: ставка (d' + this.die(p) + ')', opts, { always: true });
      if (!bet) return;
      const d = this.die(p), lose = Math.floor(d / 2) + 1;
      let r = this.roll(d); if (reg === 'Ш' && this.fx('Ш') === 'E-Ш5') r = Math.max(r, this.roll(d));
      if (r <= lose) { this.add(p, -bet); this.note('🎰 ' + p.name + ' — Казино: ' + r + ', проигрыш −' + bet + '.', p); }
      else if (r < d) { this.add(p, bet); this.note('🎰 ' + p.name + ' — Казино: ' + r + ', выигрыш +' + bet + '.', p); }
      else { const k = d >= 10 ? 4 : 3; this.add(p, bet * k); this.note('🎰 ' + p.name + ' — Казино: ДЖЕКПОТ ' + r + ', +' + bet * k + '!', p); }
    }
    async gacha(p, a, id, reg) { // одна попытка за визит; гарант на следующем визите до конца этапа
      const c = this.S.cells[id], cost = Math.max(1, NP.GACHA_COST - (this.gActive('G-13') ? 1 : 0));
      if (p.pts < cost) { this.log(p.name + ': не хватает очков на Гачу (' + cost + ').', p); return; }
      const go = a ? true : await this.choose(p, 'Гача: крутить за ' + cost + ' очк.?' + (c.pity ? ' (гарант!)' : ''), [{ label: 'Крутить', value: true }, { label: 'Пропустить', value: false }], { always: true });
      if (!go) return;
      this.add(p, -cost);
      const d = this.die(p); let r = this.roll(d); if (reg === 'Ш' && this.fx('Ш') === 'E-Ш5') r = Math.max(r, this.roll(d));
      const win = c.pity || r > d / 2;
      if (win) { this.note('🎁 ' + p.name + ' — Гача: ' + (c.pity ? 'гарант' : r) + ', предмет!', p); c.pity = false; this.giveRandom(p, null, false, a && this.r() < 0.5); }
      else { c.pity = true; this.note('🎁 ' + p.name + ' — Гача: ' + r + ', пусто. Клетка заряжена гарантом.', p); }
    }
    async pawn(p, a) {
      for (; ;) {
        const opts = p.items.map((it, i) => ({ label: 'Продать «' + NP.ITEMS[it.key].name + '» за ' + NP.RARITY[NP.ITEMS[it.key].rarity].price * (this.gActive('G-13') ? 2 : 1) + ' очк.', value: i }));
        if (a) opts.push({ label: 'Заложить кубик (очки = бросок, затем Оглушение)', value: 'die' });
        if (!opts.length) return;
        opts.push({ label: 'Уйти', value: -1 });
        const v = await this.choose(p, 'Ломбард', opts, { always: true });
        if (v === -1) return;
        if (v === 'die') { const r = this.roll(this.die(p)); this.add(p, r); this.status(p, 'stun'); this.log(p.name + ' закладывает кубик: +' + r + '.', p); return; }
        const it = this.takeItem(p, v); const pr = NP.RARITY[NP.ITEMS[it.key].rarity].price * (this.gActive('G-13') ? 2 : 1); this.add(p, pr); this.log(p.name + ' продаёт «' + NP.ITEMS[it.key].name + '» за ' + pr + ' очк.', p);
      }
    }
    async stash(p, a, id) {
      const c = this.S.cells[id];
      if (c.sealed) { this.log('Тайник закрыт до конца этапа.', p); return; }
      const rewards = [{ label: 'Время — деньги', value: 'rollex' }, { label: '+5 очков', value: 'pts' }, { label: '3 случайных предмета', value: 'items' }];
      const grant = (q, v, anom) => { if (v === 'rollex') this.giveItem(q, 'item_rollex', anom); else if (v === 'pts') this.add(q, anom ? 10 : 5); else for (let k = 0; k < 3; k++) this.giveRandom(q, null, false, anom); };
      if (this.r() < 0.01) { this.log('Тайник оказался пуст!', p); }
      else if (a) { const v = await this.choose(p, 'Аномальный Тайник: выбери награду (остальным случайная)', rewards, { always: true }); grant(p, v, true); for (const q of this.others(p)) grant(q, this.pick(rewards).value, true); }
      else { const v = this.pick(rewards).value; this.log('Тайник: ' + rewards.find(x => x.value === v).label + '.', p); grant(p, v, false); }
      c.sealed = true; this.log('Тайник закрыт до конца этапа.');
    }
    async shopHit(p) {
      const S = this.S; if (this.fx('Ш') !== 'E-Ш1' || S.shop !== p.pos) return;
      this.log(p.name + ' заходит в заведение Шестой улицы.', p);
      this.giveRandom(p, 'common', false, true);
      S.shop = this.pick(NP.SIXTH_SHOPS.filter(x => x !== p.pos));
      this.log('Открылось другое заведение (🏪 на карте).');
    }

    // ---------- активация регионов ----------
    async activateRegions(p) {
      const S = this.S;
      for (const reg of p.turnRegions || []) {
        if (reg === 'Ш' || S.regionFx[reg] || p.lap !== S.stage) continue;
        const pool = this.shuffle(this.regionPool(reg)).slice(0, 2);
        const id = await this.choose(p, p.name + ' первым в регионе ' + NP.REGIONS[reg].name + ': выбор эффекта до конца этапа', pool.map(e => ({ label: e.name, value: e.id, hint: e.text })), { always: true, kind: 'region', public: true });
        S.regionFx[reg] = id; S.regionBy[reg] = p.i;
        const fx = NP.REGION_FX.find(e => e.id === id);
        this.note('◆ ' + p.name + ' активирует ' + NP.REGIONS[reg].name + ': «' + this.fxName(id) + '».', p);
        this.announce({ player: p.i, title: 'Регион активирован · ' + NP.REGIONS[reg].name + ' · ' + p.name, name: this.fxName(id), text: (fx ? fx.text : '') + ' Действует до конца этапа.', icon: '◆' });
      }
    }

    // ---------- события ----------
    async event(p, kind) { return NP.Events.play(this, p, kind); }

    // ---------- бомба ----------
    bombPass(p) { // бомбу передаёт только её владелец в свой ход, проходя или вставая на клетку с соперником; таймер не сбрасывается
      if (!p.st.bomb) return;
      const q = this.P.find(x => x !== p && x.pos === p.pos && !x.st.bomb);
      if (q) { q.st.bomb = { turns: p.st.bomb.turns }; p.st.bomb = null; this.note('💣 ' + p.name + ' передаёт бомбу игроку ' + q.name + ' (до взрыва ходов ' + q.name + ': ' + q.st.bomb.turns + ').', q); }
    }
    async tickBomb(p) {
      if (!p.st.bomb) return;
      if (--p.st.bomb.turns > 0) { this.note('💣 У ' + p.name + ' бомба: до взрыва ' + p.st.bomb.turns + ' ход(а).', p); return; }
      p.st.bomb = null; this.note('💥 БУМ! Бомба взрывается у ' + p.name + ': −3 очка и 3 клетки назад.', p);
      await this.hit(p, null, async q => { this.add(q, -3); await this.moveBack(q, 3); }, 'Горячая картошка');
    }

    // ---------- предметы ----------
    async preItem(p) {
      const usable = p.items.map((it, i) => ({ it, i })).filter(x => NP.ITEMS[x.it.key].when === 'pre' && this.canUse(p, x.it));
      if (!usable.length) return null;
      const v = await this.choose(p, 'Использовать предмет до броска?', [{ label: 'Бросить без предмета', value: -1 }, ...usable.map(x => ({ label: (x.it.anom ? '✦ ' : '') + NP.ITEMS[x.it.key].name, value: x.i, hint: x.it.anom ? 'Аномалия: ' + NP.ITEMS[x.it.key].anom : NP.ITEMS[x.it.key].text }))], { always: true, kind: 'item' });
      if (v === -1) return null;
      const it = this.takeItem(p, v);
      await this.useItem(p, it);
      return it;
    }
    canUse(p, it) {
      if (it.key === 'item_doppelganger') return !!this.S.lastItem;
      if (it.key === 'item_bet') return this.leader() !== p || it.anom;
      return true;
    }
    async postItem(p, r, d) {
      if (p.st.silence || this.gActive('G-07')) return r;
      const usable = p.items.map((it, i) => ({ it, i })).filter(x => NP.ITEMS[x.it.key].when === 'post');
      if (!usable.length) return r;
      const v = await this.choose(p, 'Выпало ' + r + '. Использовать предмет после броска?', [{ label: 'Идти на ' + r, value: -1 }, ...usable.map(x => ({ label: (x.it.anom ? '✦ ' : '') + NP.ITEMS[x.it.key].name, value: x.i, hint: NP.ITEMS[x.it.key].text }))], { always: true, kind: 'item' });
      if (v === -1) return r;
      const it = this.takeItem(p, v); this.S.lastItem = it.key;
      const anom = this.itemAnom(p, it);
      if (it.key === 'item_kubik') {
        let dd = d;
        if (anom) dd = await this.choose(p, 'Каким кубиком перебросить?', [4, 6, 8, 10, 12].map(x => ({ label: 'd' + x, value: x })), { always: true });
        r = this.roll(dd); this.log(p.name + ': Шулерский кубик → ' + r + '.', p);
      } else {
        const opts = anom ? Array.from({ length: d + 2 }, (_, k) => ({ label: String(k + 1), value: k + 1 })) : [{ label: (r + 2) + ' (+2)', value: r + 2 }, { label: Math.max(1, r - 2) + ' (−2)', value: Math.max(1, r - 2) }];
        r = await this.choose(p, 'Калькулятор', opts, { always: true }); this.log(p.name + ': Калькулятор → ' + r + '.', p);
      }
      return r;
    }
    itemAnom(p, it) { return (it.anom || this.gActive('G-02')) && !(this.fx('Р') === 'E-Р4' && regionOf(p.pos) === 'Р'); }
    async pickTarget(p, title, list) {
      if (!list.length) { this.log('Нет подходящей цели.', p); return null; }
      return this.P[await this.choose(p, title, list.map(q => ({ label: q.name + ' (' + q.pts + ' очк., ' + this.cellName(q.pos) + ')', value: q.i })), { always: true, kind: 'player' })];
    }
    protectedSixth(q) { return this.fx('Ш') === 'E-Ш2' && regionOf(q.pos) === 'Ш'; }
    async useItem(p, it, forceAnom) {
      const S = this.S, I = NP.ITEMS[it.key], anom = forceAnom || this.itemAnom(p, it), k = it.key;
      if (k !== 'item_doppelganger') S.lastItem = k;
      this.log(p.name + ' использует «' + I.name + '»' + (anom ? ' ✦ аномальный' : '') + '.', p);
      const opp = this.others(p);
      switch (k) {
        case 'item_rollex': p.st.rollex = anom ? 2 : 1; break;
        case 'item_move': { const r = await this.rollFor(p, this.die(p), 'Ролики'), n = Math.floor(r * (anom ? 2.5 : 1.5)); this.note('🛼 ' + p.name + ' — Ролики: ' + r + ' × ' + (anom ? '2,5' : '1,5') + ' = ' + n + ' кл. вперёд.', p); await this.move(p, n, false); await this.land(p, false); break; }
        case 'item_shield': p.st.shield = anom ? 2 : 1; break;
        case 'item_mirror': p.st.mirror = anom ? 2 : 1; break;
        case 'item_steal': {
          const ts = anom ? opp : [await this.pickTarget(p, 'У кого украсть 1 очко?', opp)];
          for (const t of ts) if (t && !this.protectedSixth(t)) await this.hit(t, p, q => this.steal(q, q === t ? p : t, 1), 'Воровские перчатки');
          break;
        }
        case 'item_trap': {
          const cand = IDS.filter(x => x !== 'S' && S.cells[x].trap === null && !(this.fx('Ш') === 'E-Ш2' && regionOf(x) === 'Ш'));
          const c = await this.choose(p, 'Куда поставить Ловушку?', this.cellOpts(cand), { kind: 'cell', cells: cand, always: true });
          S.cells[c].trap = p.i;
          if (anom) for (const x of this.shuffle(cand.filter(y => y !== c)).slice(0, 2)) S.cells[x].trap = p.i;
          break;
        }
        case 'item_kick': {
          const t = await this.pickTarget(p, 'Кого пнуть?', opp); if (!t) break;
          const n = await this.rollFor(p, this.die(p), 'Пинок') + (anom ? await this.rollFor(p, this.die(p), 'Пинок, второй кубик') : 0);
          await this.hit(t, p, async q => { await this.moveBack(q, n); await this.land(q, false); }, 'Пинок'); break;
        }
        case 'item_diffs': this.add(p, anom ? 2 : 1); break;
        case 'item_battery': {
          const ts = anom ? opp : [await this.pickTarget(p, 'Кому разрядить кубик?', opp)];
          for (const t of ts) if (t) await this.hit(t, p, q => { q.st.battery++; }, 'Разряженная батарейка'); break;
        }
        case 'item_midas': p.st.midas++; p.st.midasAnom = anom; break;
        case 'item_swap': {
          const t = await this.pickTarget(p, 'С кем поменяться местами?', opp); if (!t) break;
          const a = p.pos; await this.teleportTo(p, t.pos); await this.teleportTo(t, a); break;
        }
        case 'item_syringe': {
          const neg = ['stun', 'silence', 'battery', 'badDay'];
          if (anom) { p.st.silence = 0; p.st.battery = 0; p.st.badDay = false; p.st.dice = p.st.dice.filter(x => x > 0); }
          else { if (p.st.dice.includes(-2)) p.st.dice.splice(p.st.dice.indexOf(-2), 1); else if (p.st.battery) p.st.battery = 0; else if (p.st.silence) p.st.silence = 0; else p.st.badDay = false; }
          void neg; break;
        }
        case 'item_magnet': {
          const ts = anom ? opp : [await this.pickTarget(p, 'У кого украсть предмет?', opp.filter(q => q.items.length))];
          for (const t of ts) if (t && t.items.length && !this.protectedSixth(t)) await this.hit(t, p, q => { const src = q === t ? t : p, dst = q === t ? p : t; if (!src.items.length) return; const x = this.takeItem(src, Math.floor(this.r() * src.items.length)); if (dst.items.length < S.cfg.slots) { dst.items.push(x); this.log(dst.name + ' крадёт «' + NP.ITEMS[x.key].name + '».', dst); } }, 'Магнит');
          break;
        }
        case 'item_pocket_rift': {
          let cand;
          if (anom) { const reg = regionOf(p.pos) || 'Ш', order = ['Ш', 'Б', 'В', 'Р'], i = order.indexOf(reg); const regs = [reg, order[(i + 1) % 4], order[(i + 3) % 4]]; cand = IDS.filter(x => regs.includes(regionOf(x)) && x !== p.pos); }
          else { const r = await this.rollFor(p, this.die(p), 'Карманный разлом'); this.log('Разлом: радиус ' + this.tpRange(r) + '.', p); cand = this.rangeCells(p.pos, this.tpRange(r)); }
          const to = await this.choose(p, 'Куда переместиться?', this.cellOpts(cand), { kind: 'cell', cells: cand, always: true });
          await this.teleportTo(p, to); await this.land(p, false); break;
        }
        case 'item_stun': {
          const t = await this.pickTarget(p, 'Кого оглушить?', opp); if (!t) break;
          await this.hit(t, p, q => { this.status(q, 'stun'); if (anom) this.status(q, 'silence', 1); }, 'Военная глушилка'); break;
        }
        case 'item_noteflight':
          if (anom) { for (const q of this.P) q.st.extraMod++; S.nfOwner = p.i; this.log('Колесо Нотфлайта (аном.): всем +1 модификатор на следующий бой; ' + p.name + ' получит +1 за каждого выполнившего.', p); }
          else { p.st.extraMod++; this.log(p.name + ': +1 модификатор на следующий бой.', p); }
          break;
        case 'item_surprise_box': {
          const POS = ['+3', 'rare', 'vrare', 'golden', 'extra'], NEG = ['-2', 'rusty', 'stun', 'silence', 'loseItem'];
          const txt = { '+3': '+3 очка', '-2': '−2 очка', rare: 'редкий предмет', vrare: 'очень редкий предмет', golden: 'Золотой кубик', rusty: 'Ржавый кубик', stun: 'Оглушение', silence: 'Запрет предметов', extra: 'дополнительный ход', loseItem: 'потеря случайного предмета' };
          const apply = (q, e) => { this.log('Коробка с сюрпризом → ' + q.name + ': ' + txt[e] + '.', q);
            if (e === '+3') this.add(q, 3); else if (e === '-2') this.add(q, -2); else if (e === 'rare' || e === 'vrare') this.giveRandom(q, e);
            else if (e === 'loseItem') { if (q.items.length) this.takeItem(q, Math.floor(this.r() * q.items.length)); } else this.status(q, e); };
          if (anom) { // аномальная: выбор цели, себе только хорошее, сопернику только плохое
            const t = await this.pickTarget(p, 'Коробка: кому открыть?', this.P) || p;
            if (t === p) apply(p, this.pick(POS)); else await this.hit(t, p, q => apply(q, this.pick(NEG)), 'Коробка с сюрпризом');
          } else {
            const e = p.st.badDay ? this.pick(NEG) : this.pick(['+3', '-2', 'rare', 'vrare', 'golden', 'rusty', 'stun', 'extra']);
            if (p.st.badDay) { p.st.badDay = false; this.log(p.name + ': Плохой день — Коробка только плохая.', p); }
            apply(p, e);
          }
          break;
        }
        case 'item_hook': {
          const r = (await this.rollFor(p, this.die(p), 'Мясной крюк')) * (anom ? 3 : 1); const near = bfs(p.pos, x => ADJ[x], r).cells;
          this.log('Крюк: радиус ' + r + '.', p);
          const t = await this.pickTarget(p, 'Кого притянуть?', opp.filter(q => near.includes(q.pos))); if (!t) break;
          await this.hit(t, p, async q => { await this.teleportTo(q, q === t ? p.pos : t.pos); await this.land(q, false); }, 'Мясной крюк'); break;
        }
        case 'item_glove': {
          const t = await this.pickTarget(p, 'Кого вызвать на дуэль?', opp); if (!t) break;
          const mode = anom ? await this.choose(p, 'Перчатка: выбери режим дуэли', NP.FIGHT_MODES.map(m => ({ label: NP.modeName(m[0]), value: m[0] })), { always: true }) : null;
          S.queue.push({ k: 'glove', p: p.i, t: t.i, lead: this.leader() === t, mode }); this.log(t.name + ': вызов на дуэль (в конце раунда).', t); break;
        }
        case 'item_ban': { const t = await this.pickTarget(p, 'Кому запретить агента?', opp); if (t) await this.hit(t, p, q => { q.st.ban += anom ? 2 : 1; }, 'Утконос'); break; }
        case 'item_bet': {
          const L = this.leader(); const t = anom ? await this.pickTarget(p, 'С кем пари?', opp) : L;
          if (t && t !== p) { S.bets.push([p.i, t.i]); this.log('Пари ' + p.name + ' против ' + t.name + ' на следующий общий бой.', p); } break;
        }
        case 'item_hot_potato': {
          const near = [p.pos, ...ADJ[p.pos]]; const t = await this.pickTarget(p, 'Кому подложить бомбу?', opp.filter(q => anom || near.includes(q.pos)));
          if (t) await this.hit(t, p, q => { q.st.bomb = { turns: 2 }; this.note('💣 Бомба у ' + q.name + '! Взорвётся в конце его 2-го хода, если не передать.', q); }, 'Горячая картошка'); break;
        }
        case 'item_doppelganger': { const last = S.lastItem; if (last) await this.useItem(p, { key: last, anom: true }, true); break; }
      }
      this.upd();
    }

    // ---------- бои ----------
    rollMods(n) {
      const out = [];
      for (let k = 0; k < n; k++) { const rar = this.wpick(Object.entries(NP.MOD_RARITY_W))[0]; const list = NP.MODIFIERS.filter(m => m[1] === rar && !out.includes(m)); out.push(this.pick(list)); }
      return out.map(m => ({ name: m[0], rarity: m[1], cond: m[2], pts: m[3] }));
    }
    scale(n) { const top = Math.min(n, 6); return Array.from({ length: n }, (_, k) => Math.max(top - k, 0)); }
    async fight(title, nmods, opts) {
      opts = opts || {};
      const mode = opts.mode || this.wpick(NP.FIGHT_MODES)[0];
      const mods = this.rollMods(nmods + (this.gActive('G-23') ? 1 : 0));
      const extra = {}; for (const p of this.P) if (p.st.extraMod) { extra[p.i] = this.rollMods(p.st.extraMod); p.st.extraMod = 0; }
      const bans = {}; for (const p of this.P) if (p.st.ban) { bans[p.i] = p.st.ban; p.st.ban = 0; }
      const res = await this.ioFight({ kind: 'fight', title, mode, metric: this.metric(mode), mods, extra, bans, players: this.P.map(p => p.i), mult: opts.mult || 1 });
      if (!res.order) res.order = this.rankBy(mode, res.results || {}, this.P.map(p => p.i));
      const sc = this.scale(res.order.length);
      res.order.forEach((i, k) => this.add(this.P[i], sc[k] * (opts.mult || 1), 'zzz'));
      for (const i in res.bonus || {}) if (+res.bonus[i]) { this.add(this.P[i], +res.bonus[i], 'mod'); this.note('✓ ' + this.P[i].name + ': модификаторы +' + res.bonus[i] + '.', this.P[i]); }
      if (this.S.nfOwner !== undefined) { this.log('Колесо Нотфлайта: ' + this.P[this.S.nfOwner].name + ' +1 за каждого выполнившего доп. модификатор (внести в бонусах/через ведущего).'); delete this.S.nfOwner; }
      this.note('⚔ ' + title + ' (' + NP.modeName(mode) + '): ' + res.order.map((i, k) => this.P[i].name + ' +' + sc[k] * (opts.mult || 1)).join(', ') + '.');
      if (!opts.noBets && this.S.bets.length) {
        for (const [a, b] of this.S.bets) { const ia = res.order.indexOf(a), ib = res.order.indexOf(b); const w = ia < ib ? a : b, l = w === a ? b : a; const v = this.steal(this.P[l], this.P[w], 3); this.log('Пари: ' + this.P[w].name + ' забирает ' + v + ' у ' + this.P[l].name + '.'); }
        this.S.bets = [];
      }
      this.upd();
      return res;
    }
    async duels(title, pairs, mult, bonusOf, v4, oddBonus, base, modes) {
      base = base || [2, 1]; // очки за место в паре 1×1
      if (!modes) { const m = this.wpick(NP.FIGHT_MODES)[0]; modes = pairs.map(() => m); }
      modes = modes.map(m => m || this.wpick(NP.FIGHT_MODES)[0]);
      const res = await this.ioFight({ kind: 'duels', title, pairs, mult, modes, metrics: modes.map(m => this.metric(m)) });
      if (!res.winners) res.winners = pairs.map(([a, b], k) => { const r = (res.results || [])[k] || {}; return this.better(modes[k], r[b], r[a]) ? b : this.better(modes[k], r[a], r[b]) ? a : this.pick([a, b]); });
      pairs.forEach(([a, b], k) => {
        const w = res.winners[k], l = w === a ? b : a, [bw, bl] = bonusOf(a, b);
        this.add(this.P[w], (base[0] + bw + (v4 ? 1 : 0)) * mult, 'zzz'); this.add(this.P[l], (base[1] - bl) * mult, 'zzz');
        this.note('⚔ Дуэль: ' + this.P[w].name + ' побеждает ' + this.P[l].name + '.', this.P[w]);
      });
      if (oddBonus !== undefined) { this.add(this.P[oddBonus], 1); this.log(this.P[oddBonus].name + ' без пары: +1.'); }
      this.upd();
    }
    async duelCell(q) {
      const p = this.P[q.p], opp = await this.pickTarget(p, 'Дуэль: выбери соперника', this.others(p));
      const rest = this.shuffle(this.P.filter(x => x !== p && x !== opp).map(x => x.i));
      let odd;
      if (rest.length % 2) { const lo = rest.reduce((a, b) => this.P[b].pts < this.P[a].pts ? b : a); odd = lo; rest.splice(rest.indexOf(lo), 1); }
      const pairs = [[p.i, opp.i]]; for (let k = 0; k < rest.length; k += 2) pairs.push([rest[k], rest[k + 1]]);
      const b = this.S.cfg.duelBonus;
      await this.duels('Дуэли с клетки ' + p.name + (q.anom ? ' (аномалия ×2)' : ''), pairs, q.anom ? 2 : 1, () => [b, b], q.v4, odd);
    }
    async hunt(p, a) {
      const L = this.leader();
      if (L === p || L.pts === 0) { this.log('Охоту запустил сам лидер — играется общий бой.', p); await this.fight('Общий бой (Охота лидера)', a ? 2 : 1); return; }
      const mods = this.rollMods(a ? 2 : 1);
      const mode = await this.choose(L, 'Охота на тебя: выбери режим боя', NP.FIGHT_MODES.map(m => ({ label: NP.modeName(m[0]), value: m[0] })), { always: true });
      const res = await this.ioFight({ kind: 'hunt', title: 'Охота на ' + L.name, mode, metric: this.metric(mode), mods, leader: L.i, stepper: p.i, players: this.P.map(x => x.i) });
      if (!res.beat) { const r = res.results || {}; res.beat = this.P.filter(q => q !== L && this.better(mode, r[q.i], r[L.i])).map(q => q.i); }
      let beaten = 0;
      for (const q of this.others(L)) {
        if ((res.beat || []).includes(q.i)) { this.add(q, q === p ? 3 : 2, 'zzz'); this.log(q.name + ' обходит лидера.'); }
        else beaten++;
      }
      this.add(L, beaten, 'zzz');
      for (const i in res.bonus || {}) if (+res.bonus[i]) { this.add(this.P[i], +res.bonus[i], 'mod'); this.note('✓ ' + this.P[i].name + ': модификаторы +' + res.bonus[i] + '.', this.P[i]); }
      if (this.S.nfOwner !== undefined) { this.log('Колесо Нотфлайта: ' + this.P[this.S.nfOwner].name + ' +1 за каждого выполнившего доп. модификатор (внести в бонусах/через ведущего).'); delete this.S.nfOwner; }
      if (a && (res.beat || []).includes(p.i)) { const x = p.pos; await this.teleportTo(p, L.pos); await this.teleportTo(L, x); }
      this.upd();
    }

    async roundEnd() {
      const S = this.S;
      await this.resolveQueue();
      await this.roundTail();
    }
    async resolveQueue() { // бои из очереди: общий бой (модификаторы суммируются), дуэли с клеток, Перчатки
      const S = this.S, q = S.queue; S.queue = [];
      const fights = q.filter(x => x.k === 'fight');
      if (fights.length) await this.fight('Общий бой раунда (' + fights.map(x => this.P[x.p].name).join(', ') + ')', fights.reduce((s, x) => s + x.mods, 0));
      for (const d of q.filter(x => x.k === 'duelcell')) await this.duelCell(d);
      const gl = q.filter(x => x.k === 'glove');
      if (gl.length) await this.duels('Дуэли по вызову Перчатки', gl.map(x => [x.p, x.t]), 1, (a, b) => { const g = gl.find(x => x.p === a && x.t === b); return g.lead ? [3, 2] : [2, 1]; }, false, undefined, [0, 0], gl.map(x => x.mode));
    }
    async roundTail() {
      const S = this.S;
      for (const p of this.P) {
        if (p.st.rollex === 1) this.add(p, 1);
        if (p.st.rollex === 2) { const o = this.pick(this.others(p)); this.steal(o, p, 1); }
      }
      if (this.fx('Б') === 'E-Б1') await this.truck();
      if (this.fx('Р') === 'E-Р2') for (const p of this.P.filter(x => regionOf(x.pos) === 'Р')) await this.forceMove(p, 2);
      const srt = this.P.slice().sort((a, b) => b.pts - a.pts);
      if (S.cfg.autoHunt && !S.hunted && srt[0].pts - srt[1].pts >= S.cfg.autoHunt) { S.hunted = true; this.log('Автоохота: отрыв лидера ' + (srt[0].pts - srt[1].pts) + '.'); await this.hunt(srt[1], false); }
      this.upd();
    }
    async truck() {
      const S = this.S, L = NP.TRUCK_LOOP;
      for (let k = 0; k < 2; k++) {
        S.truck = (S.truck + 1) % L.length; const c = L[S.truck];
        for (const p of this.P.filter(x => x.pos === c)) await this.hit(p, null, async t => { this.log('Грузовик сбивает ' + t.name + '!', t); this.add(t, -1); await this.moveBack(t, 3); }, 'Грузовик');
      }
      this.log('Грузовик едет дальше (🚚 на карте).');
    }

    // ---------- конец этапа ----------
    async stageEnd() {
      const S = this.S, c = S.cfg, fin = this.P[S.stagePending];
      if (S.queue.length) { this.log('Бои из очереди играются до конца этапа.'); await this.resolveQueue(); }
      this.add(fin, c.speedBonus); this.note('🏁 ' + fin.name + ' завершает этап: бонус за скорость +' + c.speedBonus + '.', fin);
      const last = this.P.reduce((a, b) => (b.pts < a.pts ? b : a)); this.add(last, c.speedLast); this.log(last.name + ' (последнее место): +' + c.speedLast + '.', last);
      if (S.stage >= c.stages || c.gcEveryStage) await this.grandChallenge();
      if (S.stage >= c.stages) { this.finish('gc'); throw new GameOver(); }
      if (!c.gcEveryStage && c.transitionFight === 'fight') await this.fight('Бой перехода этапа', 1);
      for (const p of this.P) { p.st.rollex = 0; p.st.badDay = false; } S.gfx = null; // эффекты «до конца этапа»
      S.stage++;
      for (const p of this.P) {
        if (p === fin || p.pos === 'S' || p.lap >= S.stage) { if (p.lap < S.stage) { p.lap = S.stage; p.marks = []; } continue; } // уже прошёл Start — новый круг начат, телепорт не нужен
        const v = await this.choose(p, 'Этап ' + S.stage + ': вернуться на Start (+1 очко и предмет, новый круг) или остаться?', [{ label: 'На Start (+1 очко и предмет)', value: 'tp' }, { label: 'Остаться: ' + this.cellName(p.pos), value: 'stay' }], { always: true, secret: true });
        if (v === 'tp') { p.pos = 'S'; p.prev = null; p.trail = []; p.lap = S.stage; p.marks = []; this.add(p, 1); this.giveRandom(p); }
      }
      this.genStage();
      S.order = this.P.slice().sort((a, b) => a.pts - b.pts || a.i - b.i).map(p => p.i);
      S.phase = 'turn'; S.turnPtr = 0;
      this.upd();
    }
    async grandChallenge() {
      const mode = this.wpick(NP.GC_MODES)[0];
      for (let k = 1; k <= 3; k++) await this.fight('Grand Challenge, бой ' + k + '/3', 0, { mode, noBets: true });
    }
    finish(reason, p) {
      const S = this.S; if (S.over) return;
      S.over = true; S.endReason = reason;
      S.winner = (p || this.leader()).i;
      this.log(reason === 'threshold' ? this.P[S.winner].name + ' набирает порог ' + S.cfg.threshold + ' и побеждает досрочно!' : 'Партия окончена. Победитель: ' + this.P[S.winner].name + '.');
    }
  }

  NP.Game = Game; NP.GameOver = GameOver;
})();
