/* Отрисовка поля в SVG по координатам карты. Цвета и значки типов — как в редакторе карты админки.
   Статичные слои (регионы, рёбра) рисуются один раз; клетки — на каждое обновление; фишки живут постоянно,
   чтобы их перемещение анимировалось через CSS transition. */
(function () {
  const NP = window.NP, NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const R = 22, TR = 9;
  const typeLabel = t => (NP.TYPE_LABEL && NP.TYPE_LABEL[t]) || (t === 'Start' ? 'Старт' : t);
  const LABEL_SIDE = { 'Р': 'bottom', 'В': 'bottom' };

  function viewBox() {
    const xs = NP.MAP.cells.map(c => c.x), ys = NP.MAP.cells.map(c => c.y), pad = 72;
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];
  }

  // Однократная подготовка: defs, области регионов, рёбра со стрелками, пустые слои клеток и фишек.
  function ensure(svg) {
    if (svg._np && svg._np.gCell.parentNode === svg) return svg._np;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', viewBox().join(' '));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Игровое поле');
    const defs = el('defs', {}, svg);
    const mk = el('marker', { id: 'npArr', viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 11, markerHeight: 11, markerUnits: 'userSpaceOnUse', orient: 'auto' }, defs);
    el('path', { d: 'M1,1 L9,5 L1,9 L3.5,5 z', class: 'edge-arrow' }, mk);
    const gr = el('radialGradient', { id: 'npShade', cx: '35%', cy: '30%', r: '75%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': '.38' }, gr);
    el('stop', { offset: '55%', 'stop-color': '#fff', 'stop-opacity': '0' }, gr);
    el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': '.28' }, gr);

    const C = NP.GRAPH.CELL;
    // области регионов: круги внутри группы с общей прозрачностью сливаются в одно пятно
    const gReg = el('g', { class: 'regions-layer' }, svg);
    for (const reg in NP.REGIONS) {
      const cs = NP.MAP.cells.filter(c => c.region === reg); if (!cs.length) continue;
      const col = NP.REGIONS[reg].color;
      const blob = el('g', { class: 'region-area', fill: col }, gReg);
      for (const c of cs) el('circle', { cx: c.x, cy: c.y, r: 58 }, blob);
      const x = cs.reduce((s, c) => s + c.x, 0) / cs.length;
      const y = LABEL_SIDE[reg] === 'bottom' ? Math.max(...cs.map(c => c.y)) + 66 : Math.min(...cs.map(c => c.y)) - 50;
      const t = el('text', { x, y, class: 'region-label', fill: col }, gReg); t.textContent = NP.REGIONS[reg].name.toUpperCase();
    }
    // рёбра: шеврон посередине показывает направление, двусторонние — пунктир
    const gEdge = el('g', { class: 'edges-layer' }, svg);
    for (const [a, b, both] of NP.MAP.edges) {
      const A = C[a], B = C[b]; if (!A || !B) continue;
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1;
      const x1 = A.x + dx / d * (R + 3), y1 = A.y + dy / d * (R + 3), x2 = B.x - dx / d * (R + 4), y2 = B.y - dy / d * (R + 4);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const attrs = { d: `M${x1},${y1} L${mx},${my} L${x2},${y2}`, class: 'edge' + (both ? ' both' : '') };
      if (!both) attrs['marker-mid'] = 'url(#npArr)';
      el('path', attrs, gEdge);
      if (both) { // двусторонняя связь: шевроны в обе стороны
        const at = t => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
        const [ax, ay] = at(0.5), [bx, by] = at(0.68), [cx, cy] = at(0.32);
        el('path', { d: `M${ax},${ay} L${bx},${by}`, class: 'edge-tick', 'marker-end': 'url(#npArr)' }, gEdge);
        el('path', { d: `M${ax},${ay} L${cx},${cy}`, class: 'edge-tick', 'marker-end': 'url(#npArr)' }, gEdge);
      }
    }
    const gPath = el('g', { class: 'path-layer' }, svg);
    const gCell = el('g', { class: 'cells-layer' }, svg);
    const gTok = el('g', { class: 'tokens-layer' }, svg);
    svg._np = { gCell, gTok, gPath, tokens: {} };
    panZoom(svg);
    tooltip(svg);
    return svg._np;
  }

  function globalAnom(S) { const g = S.gfx; return !!(g && g.id === 'G-02' && S.stage === g.stage && S.round <= g.until); }

  function render(svg, S, ui) {
    const L = ensure(svg), C = NP.GRAPH.CELL;
    L.gCell.innerHTML = '';
    const pick = ui.pickCells ? new Set(ui.pickCells) : null;
    const gAnom = globalAnom(S);
    for (const c of NP.MAP.cells) {
      const st = S.cells[c.id], type = st ? st.type : c.type, T = NP.TYPES[type] || NP.TYPES['Start'];
      const canPick = pick && pick.has(c.id);
      const g = el('g', { class: 'cell' + (pick ? (canPick ? ' pickable' : ' dim') : ''), 'data-id': c.id }, L.gCell);
      const owner = S.reaperZone[c.id];
      const regCol = NP.REGIONS[c.region] ? NP.REGIONS[c.region].color : '#f5c842';
      if (canPick) el('circle', { cx: c.x, cy: c.y, r: R + 9, class: 'pick-ring' }, g);
      if (owner !== undefined && S.players[owner]) el('circle', { cx: c.x, cy: c.y, r: R + 6, class: 'owner-ring', stroke: S.players[owner].color }, g);
      el('circle', { cx: c.x, cy: c.y, r: R + 2.5, class: 'ring', stroke: regCol }, g);
      el('circle', { cx: c.x, cy: c.y, r: R, fill: T.color, class: 'body' }, g);
      el('circle', { cx: c.x, cy: c.y, r: R, fill: 'url(#npShade)', class: 'shade' }, g);
      if (st && st.hybrid) el('circle', { cx: c.x, cy: c.y, r: R - 6, class: 'hybrid' }, g);
      if ((st && st.anom) || gAnom || (S.regionFx['Р'] === 'E-Р3' && c.region === 'Р')) el('circle', { cx: c.x, cy: c.y, r: R + 8, class: 'anom' }, g);
      const ic = el('text', { x: c.x, y: c.y + 1, class: 'icon' + (T.icon.length > 1 ? ' long' : '') }, g); ic.textContent = T.icon;
      const id = el('text', { x: c.x, y: c.y + R + 12, class: 'cid' }, g); id.textContent = typeLabel(type) + (st && st.hybrid ? ' ◐' : '');
      const badges = [];
      if (st && st.trap !== null && st.trap !== undefined && S.players[st.trap]) badges.push(['⚠', S.players[st.trap].color, 'ловушка']);
      if (S.shop === c.id) badges.push(['🏪', '#fff', 'открытое заведение']);
      if (S.storm.includes(c.id)) badges.push(['☁', '#b79cff', 'шторм']);
      if (S.regionFx['Б'] === 'E-Б1' && NP.TRUCK_LOOP[S.truck] === c.id) badges.push(['🚚', '#fff', 'грузовик']);
      if (st && st.pity) badges.push(['♥', '#2dd4bf', 'гарант Гачи']);
      if (st && st.sealed) badges.push(['🔒', '#fff', 'Тайник закрыт']);
      badges.forEach((b, k) => {
        const bx = c.x - R + 1 - k * 17, by = c.y - R + 1;
        el('circle', { cx: bx, cy: by, r: 8.5, class: 'badge-bg', stroke: b[1] }, g);
        const t = el('text', { x: bx, y: by + 0.5, class: 'badge', fill: b[1] }, g); t.textContent = b[0];
      });
      g.dataset.type = typeLabel(type); g.dataset.badges = badges.map(b => b[0] + ' ' + b[2]).join(' · '); // подсказка — своя (tooltip), без системного title
      if (canPick) {
        g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', 'Выбрать клетку ' + typeLabel(type) + (c.region ? ', ' + NP.REGIONS[c.region].name : ''));
        g.addEventListener('click', () => { if (!svg._pz || !svg._pz.dragged) ui.onPick(c.id); });
        g.addEventListener('mouseenter', () => showPath(svg, c.id)); g.addEventListener('mouseleave', () => showPath(svg, null));
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.onPick(c.id); } });
      }
    }
    svg._ui = ui; svg._S = S;
    if (!ui.paths) L.gPath.innerHTML = '';
    renderTokens(L, S, C);
  }

  // Путь до выбранной клетки при ходе: подсвеченная линия по клеткам маршрута.
  function showPath(svg, id) {
    const L = svg._np, ui = svg._ui; if (!L) return;
    L.gPath.innerHTML = '';
    if (!id || !ui || !ui.paths || !ui.paths[id]) return;
    const C = NP.GRAPH.CELL, pts = [ui.from, ...ui.paths[id]].map(x => C[x]).filter(Boolean);
    el('polyline', { points: pts.map(c => c.x + ',' + c.y).join(' '), class: 'move-path' }, L.gPath);
    pts.slice(1, -1).forEach(c => el('circle', { cx: c.x, cy: c.y, r: 6, class: 'move-dot' }, L.gPath));
  }

  // Подсказка при наведении на клетку: тип, регион и что делает клетка.
  function tooltip(svg) {
    const wrap = svg.parentNode; if (!wrap) return;
    let tip = wrap.querySelector('.cell-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'cell-tip hidden'; wrap.appendChild(tip); }
    const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    svg.addEventListener('mousemove', e => {
      const g = e.target.closest && e.target.closest('.cell'), S = svg._S;
      if (!g || !S || (svg._pz && svg._pz.dragged)) { tip.classList.add('hidden'); return; }
      const id = g.dataset.id, st = S.cells[id], c = NP.GRAPH.CELL[id], type = st ? st.type : (c.type || 'Start');
      const reg = NP.REGIONS[c.region], fx = reg && NP.REGION_FX && NP.REGION_FX.find(x => x.id === S.regionFx[c.region]);
      const here = S.players.filter(p => p.pos === id).map(p => `<b style="color:${p.color}">${esc(p.name)}</b>`).join(', ');
      tip.innerHTML = `<div class="ct-h"><b>${esc(typeLabel(type))}</b>${st && st.hybrid ? ' ◐ гибрид' : ''}${(st && st.anom) ? ' <span class="ct-anom">✦ аномальная</span>' : ''}${reg ? ` <span class="ct-reg" style="color:${reg.color}">· ${esc(reg.name)}</span>` : ''}</div>` +
        `<div class="ct-d">${esc(NP.cellDesc ? NP.cellDesc(type, S.cfg) : '')}</div>` +
        ((NP.PASSIVE || []).includes(type) ? '<div class="ct-m">● срабатывает и не своим ходом</div>' : '<div class="ct-m">○ только своим ходом (кубиком)</div>') +
        (fx ? `<div class="ct-m">Регион: «${esc(fx.name)}»</div>` : '') + (here ? `<div class="ct-m">Здесь: ${here}</div>` : '') +
        (g.dataset.badges ? '<div class="ct-m">' + esc(g.dataset.badges) + '</div>' : '');
      const r = wrap.getBoundingClientRect();
      let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
      tip.classList.remove('hidden');
      if (x + tip.offsetWidth > r.width) x = e.clientX - r.left - tip.offsetWidth - 10;
      if (y + tip.offsetHeight > r.height) y = e.clientY - r.top - tip.offsetHeight - 10;
      tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
    });
    svg.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  }

  // Показать клетку (фишку игрока): приблизить поле к ней и мигнуть кольцом.
  function focus(svg, id) {
    const c = NP.GRAPH.CELL[id]; if (!c || !svg._pz) return;
    svg._pz.center(c.x, c.y);
    const L = svg._np; if (!L) return;
    const ring = el('circle', { cx: c.x, cy: c.y, r: R + 14, class: 'focus-ring' }, L.gPath);
    setTimeout(() => ring.remove(), 1800);
  }

  // Фишки: при нескольких на клетке раскладываются дугой/кругом вокруг неё, чтобы не перекрываться.
  function renderTokens(L, S, C) {
    const byCell = {};
    for (const p of S.players) (byCell[p.pos] = byCell[p.pos] || []).push(p);
    const seen = new Set();
    for (const id in byCell) {
      const c = C[id]; if (!c) continue;
      const list = byCell[id], n = list.length;
      list.forEach((p, k) => {
        let ang, rr;
        if (n === 1) { ang = -Math.PI / 4; rr = R + 2; }
        else if (n <= 4) { const a0 = -160, a1 = -20; ang = (a0 + (a1 - a0) * k / (n - 1)) * Math.PI / 180; rr = R + 5; }
        else { ang = -Math.PI / 2 + k * 2 * Math.PI / n; rr = R + 7; }
        const x = c.x + Math.cos(ang) * rr, y = c.y + Math.sin(ang) * rr;
        seen.add(p.i);
        let t = L.tokens[p.i];
        const isNew = !t;
        if (isNew) {
          t = { g: el('g', { class: 'token', 'data-p': p.i }) };
          t.halo = el('circle', { cx: 0, cy: 0, r: TR + 6, class: 'halo' }, t.g);
          t.body = el('circle', { cx: 0, cy: 0, r: TR, class: 'tbody' }, t.g);
          t.txt = el('text', { x: 0, y: 0.5, class: 'tinit' }, t.g);
          t.bomb = el('text', { x: TR + 3, y: -TR - 2, class: 'tbomb' }, t.g);
          t.title = el('title', {}, t.g);
          L.tokens[p.i] = t;
        }
        t.body.setAttribute('fill', p.color);
        t.txt.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
        t.bomb.textContent = p.st && p.st.bomb ? '💣' : '';
        t.title.textContent = p.name + ' · ' + p.pts + ' очк.';
        t.g.setAttribute('class', 'token' + (S.cur === p.i && !S.over ? ' cur' : ''));
        t.g.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        if (isNew) L.gTok.appendChild(t.g);
      });
    }
    for (const k in L.tokens) if (!seen.has(+k)) { L.tokens[k].g.remove(); delete L.tokens[k]; }
  }
  // Перемещение и масштаб поля: колесо — зум к курсору, перетаскивание — сдвиг, два пальца — зум, кнопки +/−/⟲.
  function panZoom(svg) {
    const base = viewBox(), MAX = 4;
    let vb = base.slice();
    const pz = svg._pz = { dragged: false };
    pz.center = (x, y) => { const w = Math.min(vb[2], base[2] / 2), h = vb[3] * w / vb[2]; vb = [x - w / 2, y - h / 2, w, h]; apply(); };
    const apply = () => {
      const k = base[2] / vb[2];
      // поле не уезжает за край больше чем на половину экрана
      vb[0] = Math.min(Math.max(vb[0], base[0] - vb[2] / 2), base[0] + base[2] - vb[2] / 2);
      vb[1] = Math.min(Math.max(vb[1], base[1] - vb[3] / 2), base[1] + base[3] - vb[3] / 2);
      svg.setAttribute('viewBox', vb.map(v => v.toFixed(1)).join(' '));
      svg.classList.toggle('zoomed', k > 1.01);
    };
    // масштаб с центром в точке экрана (cx, cy); у viewBox с meet учитываем реальный масштаб
    const toSvg = (cx, cy) => { const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
    const zoom = (f, cx, cy) => {
      const w = Math.min(base[2], Math.max(base[2] / MAX, vb[2] / f)), r = w / vb[2];
      const p = cx === undefined ? { x: vb[0] + vb[2] / 2, y: vb[1] + vb[3] / 2 } : toSvg(cx, cy);
      vb = [p.x - (p.x - vb[0]) * r, p.y - (p.y - vb[1]) * r, w, vb[3] * r];
      if (w >= base[2]) vb = base.slice();
      apply();
    };
    svg.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY); }, { passive: false });
    const pts = new Map(); let last = null, pinch = 0;
    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pz.dragged = false; last = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    svg.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoom(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch = d; pz.dragged = true; return;
      }
      if (!pz.dragged && Math.hypot(e.clientX - last.sx, e.clientY - last.sy) < 6) return;
      if (!pz.dragged) { pz.dragged = true; svg.setPointerCapture(e.pointerId); svg.classList.add('panning'); }
      const m = svg.getScreenCTM(); if (!m) return;
      vb[0] -= (e.clientX - last.x) / m.a; vb[1] -= (e.clientY - last.y) / m.d; last.x = e.clientX; last.y = e.clientY;
      apply();
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; svg.classList.remove('panning'); setTimeout(() => { if (!pts.size) pz.dragged = false; }, 0); };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('dblclick', e => { if (!e.target.closest('.cell.pickable')) { vb = base.slice(); apply(); } });
    // кнопки управления рядом с полем
    const wrap = svg.parentNode;
    if (wrap && !wrap.querySelector('.zoom-ctl')) {
      const box = document.createElement('div'); box.className = 'zoom-ctl';
      box.innerHTML = '<button class="btn small" data-z="in" title="Приблизить (колесо мыши)" aria-label="Приблизить">+</button><button class="btn small" data-z="out" title="Отдалить" aria-label="Отдалить">−</button><button class="btn small" data-z="reset" title="Показать всё поле (двойной клик)" aria-label="Показать всё поле">⟲</button>';
      box.addEventListener('click', e => { const z = e.target.closest('[data-z]'); if (!z) return; if (z.dataset.z === 'reset') { vb = base.slice(); apply(); } else zoom(z.dataset.z === 'in' ? 1.4 : 1 / 1.4); });
      wrap.appendChild(box);
    }
  }
  NP.Board = { render, focus, showPath };
})();
