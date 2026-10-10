/* Надстройка интерфейса демо: плашка «Ходит», заставка смены хода, цвет панели действия, клавиши 1–9, легенда клеток.
   Только читает DOM, который рисует app.js, и не трогает движок. */
(function () {
  const NP = window.NP, $ = s => document.querySelector(s);
  const game = $('#game'), chip = $('#turnChip'), splash = $('#turnSplash'), prompt = $('#prompt');
  if (!game || !chip) return;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let lastTurn = null;

  // кто ходит: берём из карточки игрока с классом .cur
  function syncTurn() {
    const cur = $('#players .pl.cur');
    if (!cur) { chip.innerHTML = ''; game.style.removeProperty('--turn'); lastTurn = null; return; }
    const color = cur.style.getPropertyValue('--pc').trim(), name = cur.querySelector('.pl-name b')?.textContent || '';
    game.style.setProperty('--turn', color);
    chip.innerHTML = `<span class="tc-av">${esc(name.trim().charAt(0).toUpperCase())}</span><span><span class="tc-l">Ходит</span><br><span class="tc-n">${esc(name)}</span></span>`;
    if (lastTurn !== null && lastTurn !== name && !game.classList.contains('hidden')) {
      splash.innerHTML = `<div><small>ход</small><b>${esc(name)}</b></div>`;
      splash.classList.remove('show'); void splash.offsetWidth; splash.classList.add('show');
    }
    lastTurn = name;
  }

  // коды клеток (Ш01, Б12…) игрокам не показываем: заменяем на «тип · регион». Тип берём с поля, он может меняться (Гибрид).
  const CODE = /(^|[^А-ЯЁа-яё\w])([ШБВР]\d\d)(?![\d\w])/g;
  const typeLabel = t => (NP.TYPE_LABEL && NP.TYPE_LABEL[t]) || (t === 'Start' ? 'Старт' : t);
  const cellType = id => { const g = document.querySelector(`#board .cell[data-id="${id}"]`); return g && g.dataset.type ? g.dataset.type : typeLabel((NP.GRAPH.CELL[id] || {}).type) || id; };
  const cellName = id => { const c = NP.GRAPH.CELL[id], r = c && NP.REGIONS[c.region]; return cellType(id) + (r ? ' · ' + r.name : ''); };
  const decode = txt => txt.replace(CODE, (m, pre, id) => pre + (NP.GRAPH.CELL[id] ? cellType(id) : id)).replace(/ [RL]-\d+(?= «)/g, '');

  // панель действия окрашивается в цвет того, кто сейчас решает; варианты-клетки подсвечивают клетку на поле
  function syncDock() {
    const who = prompt.querySelector('.who');
    const c = who && who.style.getPropertyValue('--pc').trim();
    if (c) game.style.setProperty('--dock-c', c); else game.style.removeProperty('--dock-c');
    prompt.querySelectorAll('button[data-k]').forEach(b => {
      const m = /^([ШБВР]\d\d|S) · /.exec(b.firstChild && b.firstChild.nodeType === 3 ? b.firstChild.nodeValue : '');
      if (!m) return;
      b.dataset.cell = m[1]; b.firstChild.nodeValue = cellName(m[1]);
      const hl = on => { const g = document.querySelector(`#board .cell[data-id="${m[1]}"]`); if (g) g.classList.toggle('hl', on); if (NP.Board.showPath) NP.Board.showPath($('#board'), on ? m[1] : null); };
      b.addEventListener('mouseenter', () => hl(true)); b.addEventListener('mouseleave', () => hl(false));
      b.addEventListener('focus', () => hl(true)); b.addEventListener('blur', () => hl(false));
    });
    const h = prompt.querySelector('h3'); if (h) h.textContent = decode(h.textContent);
  }
  // журнал и окна: те же замены в тексте
  function decodeIn(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) { const v = decode(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  }

  new MutationObserver(syncTurn).observe($('#players'), { childList: true });
  new MutationObserver(syncDock).observe(prompt, { childList: true });
  new MutationObserver(() => decodeIn($('#log'))).observe($('#log'), { childList: true });
  new MutationObserver(() => { if (!$('#gmCell')) decodeIn($('#modalBox')); }).observe($('#modalBox'), { childList: true });
  syncTurn(); syncDock();

  // клавиши: 1–9 выбирают вариант в панели действия (Enter и пробел уже жмут кнопку броска, она в фокусе)
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    if (!$('#modal').classList.contains('hidden') || game.classList.contains('hidden')) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    const b = prompt.querySelectorAll('.opts .btn.opt')[+e.key - 1];
    if (b) { e.preventDefault(); b.click(); }
  });

  // легенда клеток: всегда под рукой, без открытия памятки
  const lg = $('#legend');
  if (lg && NP && NP.TYPES) {
    const passive = new Set(NP.PASSIVE || []);
    lg.innerHTML = Object.entries(NP.TYPES).map(([k, v]) =>
      `<span class="lg-row" title="${esc(typeLabel(k))}${passive.has(k) ? ' — срабатывает и при чужом ходе' : ''}"><span class="lg-c" style="background:${v.color}">${esc(v.icon)}</span><span class="lg-n">${esc(typeLabel(k))}</span>${passive.has(k) ? '<span class="lg-p">●</span>' : ''}</span>`).join('') +
      '<span class="legend-foot"><span class="lg-p">●</span> срабатывает и при чужом ходе</span>';
    if (window.innerWidth > 1280) $('#legendCard').open = true;
  }
})();
