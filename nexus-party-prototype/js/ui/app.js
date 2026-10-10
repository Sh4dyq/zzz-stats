/* Интерфейс прототипа: лобби, панели, окна выбора и ввода результатов. Реализует объект io для движка. */
(function () {
  const NP = window.NP, $ = s => document.querySelector(s);
  const MODE = document.body.dataset.mode === 'demo' ? 'demo' : 'full';
  const SAVE_KEY = MODE === 'demo' ? 'np_demo_save_v1' : 'np_proto_save_v1';
  let game = null, ui = { pickCells: null, onPick: null }, raf = 0;
  const mode = MODE;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const P = i => game.S.players[i];
  const pname = i => `<b style="color:${P(i).color}">${esc(P(i).name)}</b>`;
  const store = { get() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }, set(S) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { } } };

  // ---------- лобби ----------
  function lobby() {
    $('#lobby').classList.remove('hidden'); $('#game').classList.add('hidden');
    const opt = (sel, vals, def, fmt) => { $(sel).innerHTML = vals.map(v => `<option value="${v}" ${v === def ? 'selected' : ''}>${fmt ? fmt(v) : v}</option>`).join(''); };
    opt('#cfgPlayers', [2, 3, 4, 5, 6, 7, 8], 4);
    opt('#cfgStages', [1, 2, 3, 4, 5, 6], 4);
    opt('#cfgThreshold', [0, 80, 90, 100, 110, 120, 130, 140, 150], 100, v => v ? v : 'выкл');
    opt('#cfgShare', [0, 25, 45, 50, 75, 100], 45, v => v + '%');
    opt('#cfgHunt', [0, 10, 15, 20, 25, 30], 15, v => v ? v : 'выкл');
    const names = () => {
      const n = +$('#cfgPlayers').value, old = [...document.querySelectorAll('#names input')].map(i => i.value);
      $('#names').innerHTML = Array.from({ length: n }, (_, i) => `<label class="nm" style="--pc:${NP.PLAYER_COLORS[i]}"><span class="nm-h"><span class="swatch"></span>Игрок ${i + 1}</span><input type="text" maxlength="24" value="${esc(old[i] || 'Игрок ' + (i + 1))}"></label>`).join('');
    };
    $('#cfgPlayers').onchange = names; names();
    if (mode === 'demo') {
      document.querySelectorAll('#fullCfg label').forEach(l => l.classList.toggle('hidden', !l.querySelector('#cfgPlayers,#cfgStages')));
      document.querySelectorAll('.lobby-card .check').forEach(l => l.classList.add('hidden'));
      $('#cfgStages').value = '2';
    }
    $('#modeNote').textContent = mode === 'demo'
      ? 'Короткая партия (по умолчанию 2 этапа): простые события, глобальные события и готовые настройки.'
      : 'Полная версия: все 152 события, все глобальные события и настройки.';
    $('#btnResume').disabled = !store.get();
  }
  function startNew() {
    const names = [...document.querySelectorAll('#names input')].map((i, k) => i.value.trim() || 'Игрок ' + (k + 1));
    play(NP.Game.create(buildCfg(), names));
  }
  function buildCfg() {
    const tr = $('#cfgTrans').value;
    const cfg = {
      stages: +$('#cfgStages').value, threshold: +$('#cfgThreshold').value, anomaly: +$('#cfgAnom').value, regionShare: +$('#cfgShare').value / 100,
      autoHunt: +$('#cfgHunt').value, eventDeck: $('#cfgDeck').checked, seed: +$('#cfgSeed').value || 0,
      transitionFight: tr === 'gc' ? 'none' : tr, gcEveryStage: tr === 'gc',
      cellFights: $('#cfgCellFights').value, globalEvents: $('#cfgGlobal').checked, mode
    };
    if (mode === 'demo') Object.assign(cfg, { threshold: NP.DEFAULTS.threshold, anomaly: NP.DEFAULTS.anomaly, regionShare: NP.DEFAULTS.regionShare, autoHunt: NP.DEFAULTS.autoHunt, eventDeck: true, transitionFight: 'fight', gcEveryStage: false, cellFights: 'roundEnd', globalEvents: true, seed: 0 });
    return cfg;
  }

  // ---------- запуск ----------
  function play(S, wrapIO) { // wrapIO — обёртка мультиплеера (хост), иначе игра за одним экраном
    $('#lobby').classList.add('hidden'); $('#game').classList.remove('hidden'); closeModal();
    const g = new NP.Game(null, S); game = g;
    g.io = wrapIO ? wrapIO(g, makeIO(g)) : makeIO(g);
    store.set(S);
    update();
    g.run().catch(e => { console.error(e); alert('Ошибка движка: ' + e.message + '\nПартия сохранена на начале хода, её можно продолжить.'); });
  }

  function makeIO(g) {
    const live = () => game === g;
    return {
      choose: spec => new Promise(res => { if (live()) renderChoice(spec, res); }),
      wait: spec => new Promise(res => { if (live()) renderWait(spec, res); }),
      fight: spec => new Promise(res => { if (live()) renderFight(spec, res); }),
      eventCard: spec => new Promise(res => { if (live()) renderEvent(spec, res); }),
      notice: spec => new Promise(res => { if (!live()) return; const box = openModal('notice'); box.innerHTML = `<div class="notice-banner"><span class="notice-ic" aria-hidden="true">${spec.icon || '🌐'}</span><div><div class="ev-kind">${esc(spec.title)}</div><h2>${esc(spec.name)}</h2></div></div><p class="notice-text">${esc(spec.text)}</p><div class="row end"><button class="btn primary" id="ntOk">Дальше</button></div>`; $('#ntOk').focus(); $('#ntOk').onclick = () => { closeModal(); res(); }; }),
      log: () => live() && update(),
      update: () => live() && update(),
      save: S => live() && store.set(S),
      gameOver: S => { if (live()) { store.set(S); renderGameOver(S); } }
    };
  }

  // ---------- отрисовка ----------
  function update() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function draw() {
    if (!game) return;
    const S = game.S;
    NP.Board.render($('#board'), S, ui);
    const L = game.leader();
    const gx = S.gfx && NP.GLOBALS.find(e => e.id === S.gfx.id);
    const pips = Array.from({ length: S.cfg.stages }, (_, k) => `<i class="${k + 1 < S.stage ? 'done' : k + 1 === S.stage ? 'now' : ''}"></i>`).join('');
    $('#stageBar').innerHTML = `<div class="sb-row">${S.cfg.mode === 'demo' ? '<span class="sb-tag">Демо</span>' : ''}<span class="sb-item sb-stage"><span class="sb-l">Этап</span><b>${S.stage}</b><span class="muted">/${S.cfg.stages}</span><span class="pips" aria-hidden="true">${pips}</span></span><span class="sb-item"><span class="sb-l">Раунд</span><b>${S.round}</b></span><span class="sb-item"><span class="sb-l">Кубик</span><b>d${S.cfg.die}</b></span><span class="sb-item"><span class="sb-l">Порог</span><b>${S.cfg.threshold || '—'}</b></span></div>` +
      (gx ? `<div class="sb-global ${game.gActive(gx.id) ? '' : 'past'}" title="${esc(gx.text)}"><span aria-hidden="true">🌐</span><span><b>${esc(gx.name)}</b>${game.gActive(gx.id) ? '' : ' <span class="muted">(прошло)</span>'}<small>${esc(gx.text)}</small></span></div>` : '');
    $('#players').innerHTML = S.order.map(i => {
      const p = S.players[i], st = p.st, sts = [];
      const s = (ic, cls, tip, n) => sts.push(`<span class="st ${cls}" title="${esc(tip)}" aria-label="${esc(tip)}">${ic}${n ? `<i>${n}</i>` : ''}</span>`);
      if (st.stun) s('💫', 'neg', 'Оглушение: пропускает следующий бросок');
      if (st.silence) s('🔇', 'neg', 'Запрет предметов');
      if (st.battery) s('🔋', 'neg', 'Разряженная батарейка: следующий бросок — меньший из двух', st.battery > 1 ? st.battery : '');
      if (st.badDay) s('🌧', 'neg', 'Плохой день: следующее событие — только негативное');
      if (st.bomb) s('💣', 'neg', 'Горячая картошка: ходов до взрыва — ' + st.bomb.turns, st.bomb.turns);
      if (st.ban) s('⛔', 'neg', 'Запрет агента на следующий бой ×' + st.ban, st.ban > 1 ? st.ban : '');
      if (st.shield) s('🛡', 'pos', 'Щит: гасит следующий негативный эффект' + (st.shield > 1 ? ' (×' + st.shield + ')' : ''), st.shield > 1 ? st.shield : '');
      if (st.mirror) s('🔮', 'pos', 'Зеркало: отражает следующий негативный эффект');
      if (st.midas) s('🍀', 'pos', 'Счастливая рука: следующий бросок — больший из двух');
      if (st.extra) s('⏩', 'pos', 'Дополнительный ход');
      if (st.rollex) s('⌚', st.rollex === 2 ? 'anom' : 'pos', st.rollex === 2 ? 'Время — деньги ✦ аномальный: забирает 1 очко у случайного игрока в конце каждого раунда' : 'Время — деньги: +1 очко в конце каждого раунда');
      if (st.extraMod) s('🎡', 'pos', 'Доп. модификатор на следующий бой ×' + st.extraMod, st.extraMod > 1 ? st.extraMod : '');
      if (st.contract) s('📜', 'pos', 'Контракт: условие на следующий бой');
      for (const d of st.dice) s('🎲', d > 0 ? 'pos gold' : 'neg rust', d > 0 ? 'Золотой кубик' : 'Ржавый кубик');
      const marks = ['Ш', 'Б', 'В', 'Р'].map(r => { const on = p.marks.includes(r); return `<span class="mk ${on ? 'on' : ''}" style="--rc:${NP.REGIONS[r].color}" title="${esc(NP.REGIONS[r].name)}: ${on ? 'отметка есть' : 'нет отметки'}">${r}</span>`; }).join('');
      const items = p.items.map(it => { const I = NP.ITEMS[it.key], rar = NP.RARITY[I.rarity] ? NP.RARITY[I.rarity].name : ''; return `<span class="chip it r-${I.rarity} ${it.anom ? 'anom' : ''}" title="${esc(I.name + ' · ' + rar + (it.anom ? ' · ✦ аномальный' : '') + '\n' + (it.anom ? 'Аномальный эффект: ' + I.anom : I.text))}">${it.anom ? '<b class="anom-mk">✦</b>' : ''}${esc(I.name)}</span>`; }).join('');
      const cur = S.cur === i && !S.over;
      return `<div class="pl ${cur ? 'cur' : ''}" style="--pc:${p.color}">
        <div class="pl-h"><span class="pl-av" aria-hidden="true">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</span><span class="pl-name"><b>${esc(p.name)}</b>${p === L && p.pts ? ' <span class="crown" title="Лидер">♛</span>' : ''}${cur ? ' <span class="pl-turn">ходит</span>' : ''}</span><span class="pts">${p.pts}<small>очк.</small></span></div>
        <div class="pl-meta"><span class="pl-pos" title="Клетка">◉ ${esc(p.pos)}</span><span title="Круг">круг ${p.lap}</span><span class="marks" aria-label="Отметки регионов">${marks}</span></div>
        <div class="pl-src" title="Источники очков">бои ${p.src.zzz}+${p.src.mod} · поле ${p.src.board}</div>
        ${items || sts.length ? `<div class="items">${items}${sts.length ? `<span class="sts">${sts.join('')}</span>` : ''}</div>` : ''}</div>`;
    }).join('');
    $('#regions').innerHTML = '<div class="card-head">Регионы</div>' + ['Ш', 'Б', 'В', 'Р'].map(r => {
      const id = S.regionFx[r], fx = NP.REGION_FX.find(e => e.id === id);
      return `<div class="r" style="--rc:${NP.REGIONS[r].color}"><b>${NP.REGIONS[r].name}</b><span title="${esc(fx ? fx.text : '')}">${fx ? esc(fx.name) + (S.regionBy[r] !== undefined ? ' · ' + esc(P(S.regionBy[r]).name) : '') : '<span class="muted">не активен</span>'}</span></div>`;
    }).join('');
    $('#log').innerHTML = S.log.slice(-250).reverse().map(l => `<div class="${l.m.startsWith('—') ? 'round' : ''}">${l.p !== null && S.players[l.p] ? `<span class="ld" style="background:${S.players[l.p].color}"></span>` : ''}${esc(l.m)}</div>`).join('');
  }

  // ---------- выбор ----------
  function head(spec) { return spec.player !== null && spec.player !== undefined && P(spec.player) ? `<div class="who" style="--pc:${P(spec.player).color}"><span class="who-dot"></span>Решает ${pname(spec.player)}</div>` : ''; }
  function renderChoice(spec, res) {
    const box = $('#prompt'), opts = spec.options.filter(o => !o.disabled);
    const done = v => { ui.pickCells = null; ui.onPick = null; $('#boardHint').classList.add('hidden'); box.innerHTML = ''; box.className = 'card prompt'; update(); res(v); };
    const isCell = spec.kind === 'cell';
    if (isCell) { ui.pickCells = spec.cells; ui.onPick = id => done(id); $('#boardHint').innerHTML = '<span class="hint-dot"></span>Выбери подсвеченную клетку на поле'; $('#boardHint').classList.remove('hidden'); update(); }
    const many = opts.length > 8 || isCell;
    box.className = 'card prompt' + (spec.secret ? ' secret' : '');
    box.innerHTML = head(spec) + `<h3>${esc(spec.title)}</h3>` + (isCell ? '<p class="prompt-sub">Нажми клетку на поле или выбери из списка:</p>' : '') + `<div class="${many ? 'grid-opts' : 'opts'}">` +
      opts.map((o, k) => `<button class="btn ${many ? 'small' : 'opt'}" data-k="${k}">${esc(o.label)}${o.hint && !many ? `<small>${esc(o.hint)}</small>` : ''}</button>`).join('') + '</div>' +
      (spec.secret ? '<p class="secret-note">🙈 Выбор втёмную: остальные отворачиваются.</p>' : '');
    box.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => done(opts[+b.dataset.k].value));
    box.scrollIntoView({ block: 'nearest' });
  }
  function renderWait(spec, res) {
    const box = $('#prompt');
    box.className = 'card prompt';
    box.innerHTML = head(spec) + `<h3>Ход ${pname(spec.player)}</h3><div class="opts"><button class="btn primary big" id="btnRoll"><span aria-hidden="true">🎲</span> ${esc(spec.title)}</button></div>`;
    $('#btnRoll').onclick = () => { box.innerHTML = ''; res(); };
    $('#btnRoll').focus();
  }

  // ---------- бои ----------
  function modsHtml(mods) { return mods && mods.length ? `<div class="mods"><div class="mods-h">Модификаторы</div><ul>${mods.map(m => `<li><span>${esc(m.name)} — ${esc(m.cond)}</span><b>+${m.pts}</b></li>`).join('')}</ul></div>` : '<div class="mods empty">Без модификаторов.</div>'; }
  const pBtnLabel = (i, extra) => `<span class="pdot" style="background:${P(i).color}"></span><span class="pn">${esc(P(i).name)}${extra || ''}</span>`;
  // Результат боя: таймер (м:сс, меньше лучше) или счёт (больше лучше) — зависит от режима.
  const parseVal = (metric, v) => { v = String(v || '').trim(); if (!v) return null; if (metric === 'time') { const m = v.match(/^(\d+):(\d{1,2})$/); return m ? +m[1] * 60 + +m[2] : (isNaN(+v) ? null : +v); } return isNaN(+v.replace(/\s/g, '')) ? null : +v.replace(/\s/g, ''); };
  const fmtVal = (metric, n) => n === null || n === undefined ? '' : metric === 'time' ? Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0') : String(n);
  const randVal = metric => metric === 'time' ? 60 + Math.floor(Math.random() * 540) : 1000 + Math.floor(Math.random() * 39000);
  const metricHint = metric => metric === 'time' ? '⏱ таймер, м:сс — меньше лучше' : '🎯 счёт — больше лучше';
  // opt (мультиплеер): mine — места, которые вводит этот экран (остальные видны, но закрыты);
  // host — экран хоста (может заполнить за всех и записать в любой момент); onReady(api) — api.inject(vals, bonus, seat) для пришедших результатов.
  function renderFight(spec, res, opt) {
    opt = opt || {};
    const box = openModal('fight');
    const duel = spec.kind === 'duels';
    const entries = duel ? spec.pairs.flatMap((pr, k) => pr.map(i => ({ key: k + '_' + i, seat: i, metric: spec.metrics[k] }))) : spec.players.map(i => ({ key: String(i), seat: i, metric: spec.metric }));
    const metricOf = key => entries.find(e => e.key === key).metric;
    const canEdit = i => !opt.mine || opt.mine.includes(+i);
    const mineOnly = opt.mine && !opt.host;
    const vals = {}, bonus = {}, got = new Set();
    const top = (kind, sub) => `<div class="m-kicker"><span class="kick-ic" aria-hidden="true">⚔</span>${kind}</div><h2>${esc(spec.title)}</h2>${sub || ''}`;
    const inp = e => `<input class="res-in" ${canEdit(e.seat) ? '' : 'disabled'} type="text" inputmode="${e.metric === 'time' ? 'text' : 'numeric'}" placeholder="${e.metric === 'time' ? 'м:сс' : 'счёт'}" value="${esc(fmtVal(e.metric, vals[e.key]))}" data-r="${e.key}" aria-label="Результат ${esc(P(e.seat).name)}">`;
    const bonusRow = i => `<label class="bonus" title="Бонусные очки за выполненные модификаторы"><span>бонус</span><input ${canEdit(i) ? '' : 'disabled'} type="number" min="0" max="20" value="${bonus[i] || 0}" data-b="${i}" aria-label="Бонус ${esc(P(i).name)}"></label>`;
    const extraInfo = i => [(spec.extra && spec.extra[i]) ? 'доп. мод: ' + spec.extra[i].map(m => m.name + ' (+' + m.pts + ')').join(', ') : '', (spec.bans && spec.bans[i]) ? 'запрет агентов: ' + spec.bans[i] : ''].filter(Boolean).join(' · ');
    const xi = i => { const t = extraInfo(i); return t ? `<small>${esc(t)}</small>` : ''; };
    const read = () => { box.querySelectorAll('input[data-b]:not([disabled])').forEach(x => { bonus[x.dataset.b] = +x.value || 0; }); box.querySelectorAll('input[data-r]:not([disabled])').forEach(x => { vals[x.dataset.r] = parseVal(metricOf(x.dataset.r), x.value); }); };
    const remote = [...new Set(entries.map(e => e.seat))].filter(i => !canEdit(i));
    const waitLine = () => opt.host && remote.length ? `<p class="muted fight-wait">${remote.map(i => (got.has(i) ? '✓ ' : '⏳ ') + esc(P(i).name)).join(' · ')}</p>` : '';
    const actions = () => waitLine() + `<div class="row end m-actions"><button class="btn ghost" id="fRand" title="${mineOnly ? 'Заполнить свой результат случайно' : 'Симуляция: заполнить пустые результаты за всех'}">${mineOnly ? 'Случайно' : 'Заполнить за всех'}</button><button class="btn primary" id="fOk">${mineOnly ? 'Отправить' : 'Записать'}</button></div>`;
    const body = () => {
      if (duel) return top('Дуэли') + `<p class="muted">Каждый вводит свой результат — победителя пары игра определит сама${spec.mult > 1 ? ' (очки ×' + spec.mult + ')' : ''}.</p>` +
        spec.pairs.map((pr, k) => `<div class="duel-block"><p class="fight-mode">Режим: <b>${esc(NP.modeName(spec.modes[k]))}</b> <span class="muted">${metricHint(spec.metrics[k])}</span></p><div class="duel">${pr.map(i => `<div class="duel-side"><span class="pbtn static">${pBtnLabel(i)}</span>${inp(entries.find(e => e.key === k + '_' + i))}</div>`).join('<span class="vs">vs</span>')}</div></div>`).join('');
      const head = (kind, note) => top(kind, `<p class="fight-mode">Режим: <b>${esc(NP.modeName(spec.mode))}</b> <span class="muted">${metricHint(spec.metric)}</span>${spec.mult > 1 ? ' <span class="mult">очки ×' + spec.mult + '</span>' : ''}</p>`) + modsHtml(spec.mods) + `<p class="muted">${note}</p>`;
      const row = (e, tag) => `<div class="fight-row"><span class="pbtn static">${pBtnLabel(e.seat, tag || '')}${xi(e.seat)}</span>${inp(e)}${bonusRow(e.seat)}</div>`;
      if (spec.kind === 'hunt') return head('Охота', `Режим выбрал лидер ${pname(spec.leader)}. Каждый вводит свой результат. Кто обошёл лидера, получает +2 (охотник +3). Лидер получает +1 за каждого, кто его не обошёл. Справа — бонус за модификаторы.`) +
        `<div class="fight-list">${entries.map(e => row(e, e.seat === spec.leader ? ' <em>лидер</em>' : e.seat === spec.stepper ? ' <em>охотник</em>' : '')).join('')}</div>`;
      const sc = game.scale(spec.players.length);
      return head('Общий бой', `Каждый вводит свой результат — места и очки (${sc.map(x => '+' + x * (spec.mult || 1)).join(' / ')}) игра посчитает сама. Справа — бонус за модификаторы.`) + `<div class="fight-list">${entries.map(e => row(e)).join('')}</div>`;
    };
    const output = only => { // only — набор мест для отправки (клиент), иначе все
      const pick = e => !only || only.includes(e.seat);
      const b = {}; for (const i in bonus) if (!only || only.includes(+i)) b[i] = bonus[i];
      if (duel) return { results: spec.pairs.map((pr, k) => { const o = {}; pr.forEach(i => { if (pick({ seat: i })) o[i] = vals[k + '_' + i]; }); return o; }), bonus: b };
      const r = {}; entries.forEach(e => { if (pick(e)) r[e.seat] = vals[e.key]; }); return { results: r, bonus: b };
    };
    const paint = () => {
      box.innerHTML = body() + actions();
      $('#fRand').onclick = () => { read(); entries.forEach(e => { if ((mineOnly ? canEdit(e.seat) : true) && (vals[e.key] === null || vals[e.key] === undefined)) vals[e.key] = randVal(e.metric); }); paint(); };
      $('#fOk').onclick = () => { read();
        if (mineOnly) { res(output(opt.mine)); box.innerHTML = top('Результат отправлен') + '<p class="muted">Ждём остальных игроков и хоста.</p>'; return; }
        closeModal(); res(output(null)); };
    };
    paint();
    if (opt.onReady) opt.onReady({ inject(part, seat) { // результаты, пришедшие от другого игрока
      read(); if (seat !== undefined) got.add(seat);
      const rs = part.results; if (duel) (rs || []).forEach((o, k) => { for (const i in (o || {})) vals[k + '_' + i] = o[i]; }); else for (const i in (rs || {})) vals[String(i)] = rs[i];
      for (const i in (part.bonus || {})) bonus[i] = part.bonus[i];
      if (box.querySelector('#fOk')) paint();
    } });
  }

  // ---------- события ----------
  function renderEvent(spec, res) {
    const box = openModal('event'), c = spec.card, p = P(spec.player);
    let sel = c.options.length === 1 ? 0 : null; const used = new Set();
    const generic = [{ k: 'pts', v: 1, label: '+1 очк.' }, { k: 'pts', v: -1, label: '−1 очк.' }, { k: 'item', v: null, label: '+ предмет' }, { k: 'roll', v: game.S.cfg.die, label: '🎲 d' + game.S.cfg.die }];
    const reg = c.kind === 'L' ? NP.GRAPH.regionOf(p.pos) : '';
    const signCls = { '+': 'plus', '-': 'minus', '±': 'pm' }[c.sign] || 'none';
    const signTxt = { '+': 'положительное', '-': 'отрицательное', '±': 'смешанное' }[c.sign] || '';
    const accent = c.kind === 'L' && NP.REGIONS[reg] ? NP.REGIONS[reg].color : '';
    const paint = () => {
      const o = sel !== null ? c.options[sel] : null;
      const chipList = o ? [...o.chips, ...c.descChips.filter(x => !o.chips.some(y => y.k === x.k && y.v === x.v))] : [];
      box.innerHTML = `<div class="ev ev-${c.kind} sign-${signCls}"${accent ? ` style="--ev:${accent}"` : ''}>
        <div class="ev-top"><span class="ev-sign" aria-hidden="true">${c.kind === 'L' ? '◆' : (c.sign === '-' ? '−' : c.sign || '?')}</span><div class="ev-kind">${c.kind === 'L' ? 'Событие региона' + (NP.REGIONS[reg] ? ' · ' + esc(NP.REGIONS[reg].name) : '') : 'Случайное событие' + (signTxt ? ' · ' + signTxt : '')}</div><span class="ev-id">${esc(c.id)}</span></div>
        <h2>${esc(c.name)}</h2><div class="who" style="--pc:${p.color}"><span class="who-dot"></span>Для ${pname(spec.player)}</div><p class="ev-desc">${esc(c.desc)}</p>
        ${c.note ? `<p class="ev-note">${esc(c.note)}</p>` : ''}${c.hard ? `<div class="hard">⚠ ${esc(c.hard)} — разыграйте вручную быстрыми кнопками или через «Ведущего».</div>` : ''}
        <div class="ev-opts" role="group" aria-label="Варианты">${c.options.map((x, k) => `<button type="button" class="ev-opt ${sel === k ? 'sel' : ''}" data-k="${k}" aria-pressed="${sel === k}" ${x.disabled ? 'style="opacity:.4;pointer-events:none" disabled' : ''}><span class="ev-letter">${esc(x.letter)}</span><span class="ev-body"><b>${esc(x.label)}</b><span>${esc(x.outcome)}</span>${x.disabled ? ' <i>(условие не выполнено)</i>' : ''}</span></button>`).join('')}</div>
        ${o ? `<div class="qa"><div class="qa-h">Быстрые действия для ${esc(p.name)}</div><div class="chips">${[...chipList, ...generic].map((ch, k) => `<button class="btn small qa-chip ${k >= chipList.length ? 'gen' : 'card-chip'}" data-c="${k}" ${used.has(k) && ch.k !== 'roll' ? 'disabled' : ''}>${esc(ch.label)}</button>`).join('')}<span id="diceOut" class="dice-out" aria-live="polite"></span></div></div>` : ''}
        <div class="row end m-actions"><button class="btn ghost" id="evGM">Ведущий</button><button class="btn primary" id="evOk" ${o ? '' : 'disabled'}>Готово</button></div></div>`;
      box.querySelectorAll('.ev-opt').forEach(d => d.onclick = () => { sel = +d.dataset.k; used.clear(); paint(); });
      if (o) box.querySelectorAll('button[data-c]').forEach(b => b.onclick = async () => {
        const ch = [...chipList, ...generic][+b.dataset.c]; used.add(+b.dataset.c);
        let r; game.gmCtx = true; try { r = await NP.Events.applyChip(game, p, ch); } finally { game.gmCtx = false; }
        paint(); if (ch.k === 'roll') $('#diceOut').textContent = 'd' + ch.v + ': ' + r;
      });
      $('#evOk').onclick = () => { closeModal(); res(sel); };
      $('#evGM').onclick = () => openGM(() => renderEvent(spec, res));
    };
    paint();
  }

  // ---------- ведущий ----------
  function openGM(back) {
    if (!game) return;
    const box = openModal('gm'), S = game.S;
    let who = S.cur ?? 0, out = '';
    const itemsOpt = Object.entries(NP.ITEMS).map(([k, v]) => `<option value="${k}">${esc(v.name)} (${NP.RARITY[v.rarity].name})</option>`).join('');
    const paint = () => {
      const p = P(who);
      box.innerHTML = `<div class="m-kicker">Ручные правки</div><h2>Ведущий</h2><p class="muted">Для всего, что прототип не считает сам. Каждое действие попадает в журнал.</p>
        <div class="row gm-who">${S.players.map(q => `<button class="btn ${q.i === who ? 'primary' : ''}" data-w="${q.i}" aria-pressed="${q.i === who}"><span class="pdot" style="background:${q.color}"></span>${esc(q.name)}</button>`).join('')}</div>
        <div class="gm-grid">
          <div><b>Очки (${p.pts})</b><div class="chips">${[-3, -2, -1, 1, 2, 3, 5].map(v => `<button class="btn small" data-pts="${v}">${v > 0 ? '+' : ''}${v}</button>`).join('')}</div></div>
          <div><b>Статусы</b><div class="chips">${[['stun', 'Оглушение'], ['silence', 'Запрет предм.'], ['shield', 'Щит'], ['mirror', 'Зеркало'], ['golden', 'Золотой'], ['rusty', 'Ржавый'], ['extra', 'Доп. ход'], ['badDay', 'Плохой день']].map(s => `<button class="btn small" data-st="${s[0]}">${s[1]}</button>`).join('')}<button class="btn small" data-cl="1">Снять негатив</button></div></div>
          <div><b>Выдать предмет</b><div class="row"><select id="gmItem">${itemsOpt}</select><label class="check"><input type="checkbox" id="gmAnom">аном.</label><button class="btn small" id="gmGive">Выдать</button></div></div>
          <div><b>Предметы</b><div class="chips">${p.items.map((it, k) => `<button class="btn small" data-rm="${k}" title="Забрать">${it.anom ? '✦ ' : ''}${esc(NP.ITEMS[it.key].name)} ×</button>`).join('') || '<span class="muted">нет</span>'}</div></div>
          <div><b>Переставить фишку</b><div class="row"><select id="gmCell">${NP.MAP.cells.map(c => `<option ${c.id === p.pos ? 'selected' : ''}>${c.id}</option>`).join('')}</select><button class="btn small" id="gmMove">Без эффекта</button><button class="btn small" id="gmMoveLand">С эффектом клетки</button></div></div>
          <div><b>Кубик</b><div class="chips">${[4, 6, 8, 10, 12].map(d => `<button class="btn small" data-d="${d}">d${d}</button>`).join('')}<span class="dice-out">${out}</span></div></div>
        </div>
        <div class="row end m-actions"><button class="btn primary" id="gmClose">${back ? 'Назад' : 'Закрыть'}</button></div>`;
      const act = (fn, m) => { game.gm(fn); if (m) game.log('Ведущий: ' + m, p); paint(); };
      box.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { who = +b.dataset.w; paint(); });
      box.querySelectorAll('[data-pts]').forEach(b => b.onclick = () => act(() => game.add(p, +b.dataset.pts), p.name + ' ' + b.textContent + ' очк.'));
      box.querySelectorAll('[data-st]').forEach(b => b.onclick = () => act(() => game.status(p, b.dataset.st)));
      box.querySelectorAll('[data-cl]').forEach(b => b.onclick = () => act(() => { p.st.stun = 0; p.st.silence = 0; p.st.battery = 0; p.st.badDay = false; p.st.dice = p.st.dice.filter(x => x > 0); }, 'сняты негативные статусы ' + p.name));
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => act(() => game.takeItem(p, +b.dataset.rm), 'забран предмет у ' + p.name));
      box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { out = 'd' + b.dataset.d + ': ' + game.roll(+b.dataset.d); game.log('Ведущий бросает ' + out + '.'); paint(); });
      $('#gmGive').onclick = () => act(() => game.giveItem(p, $('#gmItem').value, $('#gmAnom').checked));
      $('#gmMove').onclick = () => act(() => game.teleportTo(p, $('#gmCell').value));
      $('#gmMoveLand').onclick = async () => { game.gmCtx = true; try { await game.teleportTo(p, $('#gmCell').value); await game.land(p, false); } catch (e) { if (!(e instanceof NP.GameOver)) throw e; } finally { game.gmCtx = false; } paint(); update(); };
      $('#gmClose').onclick = () => { if (back) back(); else closeModal(); update(); };
    };
    paint();
  }

  function renderGameOver(S) {
    const box = openModal('over');
    const rows = S.players.slice().sort((a, b) => b.pts - a.pts);
    box.innerHTML = `<div class="over-hero"><div class="m-kicker">Финал</div><h2>${S.endReason === 'threshold' ? 'Досрочная победа' : 'Партия окончена'}</h2><p class="over-win">🏆 Победитель: ${pname(S.winner)}</p></div>
      <div class="table-wrap"><table class="score"><thead><tr><th>#</th><th>Игрок</th><th>Очки</th><th>Бои</th><th>Модиф.</th><th>Поле</th></tr></thead><tbody>${rows.map((p, k) => `<tr class="${k === 0 ? 'first' : ''}"><td>${k + 1}</td><td><span class="pdot" style="background:${p.color}"></span>${esc(p.name)}</td><td><b>${p.pts}</b></td><td>${p.src.zzz}</td><td>${p.src.mod}</td><td>${p.src.board}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">Этап ${S.stage}, раундов в последнем этапе: ${S.round}.</p>
      <div class="row end m-actions"><button class="btn ghost" id="goExport">Сохранить файл партии</button><button class="btn primary" id="goNew">Новая партия</button></div>`;
    $('#goExport').onclick = exportFile; $('#goNew').onclick = () => { closeModal(); lobby(); };
  }

  function openRules() {
    const box = openModal('rules');
    box.innerHTML = `<div class="m-kicker">Как играть</div><h2>Памятка</h2>
      <p><b>Ход:</b> предмет до броска → бросок → предмет после броска (Шулерский кубик, Калькулятор) → движение (поле подсвечивает, куда можно дойти, — выбери клетку) → эффект клетки.</p>
      <p><b>Этап</b> завершает тот, кто проходит Start с отметками всех 4 регионов текущего круга: ему +2, игроку на последнем месте +1. Затем бой перехода, а в конце партии — Grand Challenge. На новом этапе каждый втёмную выбирает: вернуться на Start (+1 очко и предмет) или остаться.</p>
      <p><b>Бои</b> с клеток играются в конце раунда: все общие бои — одним боем (модификаторы суммируются), затем дуэли. Охота — сразу. Каждый вводит свой результат, места игра считает сама.</p>
      <p><b>Не своим ходом</b> срабатывают только пассивные клетки: Start, Очки, Сундук, Опасность, Жнец, Телепорт, Событие (только случайное), ловушки.</p>
      <div class="legend">${Object.entries(NP.TYPES).map(([k, v]) => `<span class="lg"><span class="lg-c" style="background:${v.color}">${esc(v.icon)}</span>${esc(k)}</span>`).join('')}</div>
      <p class="muted">Пунктирное кольцо — аномальная клетка, ◐ — гибрид (тип меняется каждый этап), ⚠ — ловушка, ♥ — гарант Гачи, 🏪 — открытое заведение, ☁ — шторм, 🚚 — грузовик, 🔒 — Тайник закрыт. Цвет обводки клетки — регион или владелец Жнеца.</p>
      <div class="row end m-actions"><button class="btn primary" id="rOk">Понятно</button></div>`;
    $('#rOk').onclick = closeModal;
  }

  // ---------- модалка, файлы ----------
  let modalStack = 0;
  function openModal(kind) { $('#modal').classList.remove('hidden'); modalStack++; const b = $('#modalBox'); b.className = 'modal-box card' + (kind ? ' m-' + kind : ''); b.scrollTop = 0; return b; }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; $('#modalBox').className = 'modal-box card'; modalStack = 0; }
  function exportFile() {
    if (!game) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(game.S)], { type: 'application/json' }));
    a.download = 'nexus-party-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json'; a.click();
  }

  // ---------- кнопки ----------
  $('#btnStart').onclick = startNew;
  $('#btnResume').onclick = () => { const S = store.get(); if (S) play(S); };
  $('#btnNew').onclick = () => { if (!game || game.S.over || confirm('Начать новую партию? Текущая сохранится, пока не начнётся новая.')) { game = null; closeModal(); lobby(); } };
  $('#btnGM').onclick = () => game && !game.S.over ? openGM() : null;
  $('#btnRules').onclick = openRules;
  if ($('#btnExport')) $('#btnExport').onclick = exportFile;
  if ($('#fileImport')) $('#fileImport').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { play(JSON.parse(t)); } catch (err) { alert('Не удалось прочитать файл: ' + err.message); } }); e.target.value = ''; };

  // Доступ для мультиплеера (js/net/mp.js): хост запускает движок, гость только показывает состояние.
  NP.App = {
    mode, buildCfg, play, renderChoice, renderWait, renderFight, openModal, closeModal, update, esc, lobby,
    get game() { return game; },
    view(S) { // гость: показать состояние без движка
      $('#lobby').classList.add('hidden'); $('#game').classList.remove('hidden');
      game = new NP.Game(null, S); update();
    },
    notice(spec) { return new Promise(res => { const box = openModal('notice'); box.innerHTML = `<div class="notice-banner"><span class="notice-ic" aria-hidden="true">${spec.icon || '🌐'}</span><div><div class="ev-kind">${esc(spec.title)}</div><h2>${esc(spec.name)}</h2></div></div><p class="notice-text">${esc(spec.text)}</p><div class="row end"><button class="btn primary" id="ntOk">Дальше</button></div>`; $('#ntOk').onclick = () => { closeModal(); res(); }; }); },
    gameOver: S => renderGameOver(S),
    savedState: () => store.get()
  };

  const saved = store.get();
  if (saved && !saved.over) { lobby(); } else lobby();
})();
