/* Карточки событий. Событие показывается игроку с вариантами выбора; исход разбирается парсером на «быстрые действия»
   (очки, предметы, статусы, сдвиги, броски кубика), которые применяются одной кнопкой. Остальное — через панель ведущего. */
(function () {
  const NP = (globalThis.window || globalThis).NP;
  const RAR = { 'очень редк': 'vrare', 'редк': 'rare', 'обычн': 'common' };

  function splitOptions(ev) {
    const out = [];
    const add = (letter, txt) => {
      if (!txt) return;
      const m = txt.split('→'); const t0 = txt.replace(/^[АБВ]\)\s*/, '').trim();
      const label = m.length > 1 ? m[0].trim() : (t0.length <= 70 ? t0 : (letter === 'А' ? 'Принять' : 'Вариант ' + letter));
      out.push({ letter, label: label.replace(/^[АБВ]\)\s*/, ''), outcome: (m.length > 1 ? m.slice(1).join('→') : txt).trim() });
    };
    add('А', ev.a);
    if (ev.b) {
      const parts = ev.b.split(/\n(?=[БВ]\))/);
      if (parts.length > 1) parts.forEach(t => add(t.trim()[0], t.trim().replace(/^[БВ]\)\s*/, '')));
      else add('Б', ev.b.replace(/^Б\)\s*/, ''));
    }
    if (ev.c) { const m = ev.c.split('→'); out.push({ letter: 'Г', label: '[' + ev.cond + '] ' + m[0].trim(), outcome: (m[1] || ev.c).trim(), cond: ev.cond }); }
    if (!out.length) out.push({ letter: 'А', label: 'Принять', outcome: ev.desc });
    return out;
  }

  // Проверка условия доп. варианта L-событий ([Есть Ролики], [У тебя 4/4 отметки] ...). Неизвестное условие считается выполненным.
  function condOk(g, p, cond) {
    let m = cond.match(/^Есть (\d)\+ предмет/); if (m) return p.items.length >= +m[1];
    if (/аномальн/.test(cond)) return p.items.some(i => i.anom);
    m = cond.match(/^Есть (.+)$/); if (m) return p.items.some(i => NP.ITEMS[i.key].name.toLowerCase() === m[1].toLowerCase());
    if (/4\/4/.test(cond)) return p.marks.length === 4;
    if (/последний/.test(cond)) return g.P.every(q => q.pts >= p.pts);
    if (/негативный статус/.test(cond)) return !!(p.st.stun || p.st.silence || p.st.battery || p.st.badDay || p.st.dice.some(x => x < 0));
    return true;
  }
  function eligible(g, p, e) {
    if (e.only === 'leader' && g.leader() !== p) return false;
    if (e.only === 'last' && !g.P.every(q => q.pts >= p.pts)) return false;
    if (e.need === 'items' && !p.items.length) return false;
    if (e.need === 'oppItems' && !g.others(p).some(q => q.items.length)) return false;
    if (e.need === 'anomItems' && !p.items.some(i => i.anom)) return false;
    return true;
  }

  // Разбор текста исхода на быстрые действия.
  function chips(text, g) {
    const res = [], seen = new Set(), push = c => { const k = c.k + ':' + (c.v ?? ''); if (!seen.has(k)) { seen.add(k); res.push(c); } };
    if (!text) return res;
    const W = '[а-яёА-ЯЁ]*';
    const re = (src, f) => new RegExp(src.replace(/\\w/g, W), f || 'i');
    for (const m of text.matchAll(/\bd(4|6|8|10|12)\b/g)) push({ k: 'roll', v: +m[1], label: '🎲 d' + m[1] });
    if (re('текущ\\w кубик').test(text)) push({ k: 'roll', v: g.S.cfg.die, label: '🎲 кубик партии d' + g.S.cfg.die });
    for (const m of text.matchAll(re('(?:за|заплатить|стоит|отдать|потерять|ставка)\\s+(\\d+)\\s*очк', 'gi'))) push({ k: 'pts', v: -m[1], label: '−' + m[1] + ' очк.' });
    for (const m of text.matchAll(/(^|[\s(:;,—])([+−])(\d+)(?![\d–-])(?!\s*(?:к\s|клет))/g)) { if (/брос\S*\s*$/.test(text.slice(0, m.index + m[1].length))) continue; const v = (m[2] === '+' ? 1 : -1) * +m[3]; push({ k: 'pts', v, label: (v > 0 ? '+' : '−') + Math.abs(v) + ' очк.' }); }
    if (re('Золот\\w кубик').test(text)) push({ k: 'st', v: 'golden', label: 'Золотой кубик' });
    if (re('Ржав\\w кубик').test(text)) push({ k: 'st', v: 'rusty', label: 'Ржавый кубик' });
    if (re('Оглушени').test(text)) push({ k: 'st', v: 'stun', label: 'Оглушение' });
    if (re('Запрет предметов').test(text)) push({ k: 'st', v: 'silence', label: 'Запрет предметов' });
    if (re('(^|[^а-яё])Щит').test(text)) push({ k: 'st', v: 'shield', label: 'Щит' });
    if (re('Дополнительн\\w ход').test(text)) push({ k: 'st', v: 'extra', label: 'Доп. ход' });
    if (re('Плох\\w день').test(text)) push({ k: 'st', v: 'badDay', label: 'Плохой день' });
    if (re('сня\\w .*негативн').test(text)) push({ k: 'cleanse', label: 'Снять негативный статус' });
    const lose = re('(потер\\w|отда\\w|сда\\w|тер\\w|выпада\\w|конфиск\\w|изыма\\w|крад\\w)[^.;]{0,25}предмет').test(text);
    if (lose) push({ k: 'loseItem', label: '− случайный предмет' });
    for (const m of text.matchAll(re('(очень редк|редк|обычн)\\w\\s+(?:аномальн\\w\\s+)?предмет', 'gi'))) push({ k: 'item', v: RAR[m[1].toLowerCase()], label: '+ ' + m[1].toLowerCase() + (m[1].toLowerCase() === 'обычн' ? 'ый' : 'ий') + ' предмет' });
    if (!lose && re('предмет').test(text) && !res.some(c => c.k === 'item')) push({ k: 'item', v: null, label: '+ случайный предмет' });
    for (const m of text.matchAll(/назад на (\d+)/g)) push({ k: 'back', v: +m[1], label: '← назад ' + m[1] });
    for (const m of text.matchAll(/вперёд на (\d+)/g)) push({ k: 'fwd', v: +m[1], label: 'вперёд ' + m[1] + ' →' });
    if (re('Контракт').test(text)) push({ k: 'contract', label: 'Контракт' });
    return res;
  }

  async function applyChip(g, p, c) {
    switch (c.k) {
      case 'roll': { const r = g.roll(c.v); g.log(p.name + ' бросает d' + c.v + ': ' + r + '.', p); return r; }
      case 'pts': g.add(p, c.v); g.log(p.name + ': ' + (c.v > 0 ? '+' : '') + c.v + ' очк.', p); break;
      case 'st': g.status(p, c.v); break;
      case 'cleanse': p.st.stun = 0; p.st.silence = 0; p.st.battery = 0; p.st.badDay = false; p.st.dice = p.st.dice.filter(x => x > 0); g.log(p.name + ': негативные статусы сняты.', p); break;
      case 'item': g.giveRandom(p, c.v); break;
      case 'loseItem': if (p.items.length) { const it = g.takeItem(p, Math.floor(g.r() * p.items.length)); g.log(p.name + ' теряет «' + NP.ITEMS[it.key].name + '».', p); } break;
      case 'back': await g.moveBack(p, c.v); break;
      case 'fwd': await g.forceMove(p, c.v); break;
      case 'contract': p.st.contract = 'есть'; g.log(p.name + ' берёт Контракт (условие на следующий бой — вручную).', p); break;
    }
    g.upd();
  }

  function draw(g, kind, p) {
    const S = g.S, E = NP.EVENTS || { L: [], R: [] };
    let pool;
    if (kind === 'L') pool = E.L.filter(e => e.region === NP.GRAPH.regionOf(p.pos) || e.region === '*');
    else {
      pool = E.R;
      if (kind === 'Rneg') pool = pool.filter(e => e.sign === '-');
      else if (g.fx('В') === 'E-В2' && NP.GRAPH.regionOf(p.pos) === 'В') pool = pool.filter(e => e.sign === '+');
    }
    pool = pool.filter(e => eligible(g, p, e) && !(S.cfg.mode === 'demo' && e.hard));
    if (!pool.length) return null;
    const pickW = list => kind === 'L' ? g.pick(list) : g.wpick(list.map(e => [e, e.w || 30]))[0];
    if (!S.cfg.eventDeck) return pickW(pool);
    const key = kind === 'L' ? 'L' + NP.GRAPH.regionOf(p.pos) : kind;
    const used = S.deck[key] || (S.deck[key] = []);
    let left = pool.filter(e => !used.includes(e.id));
    if (!left.length) { used.length = 0; left = pool; }
    const e = pickW(left); used.push(e.id); return e;
  }


  /* ---------- Демо: короткий набор событий, исход считается автоматически ----------
     fx: pts (±очки), cost (плата, без Щита), item (null|rare), lose (потеря предмета), st (статус), fwd/back (сдвиг),
     roll {die, lo, hi} (lo — нижняя половина), steal (украсть у лидера). Негативное проходит через Зеркало и Щит. */
  NP.DEMO_NO_ITEMS = ['item_noteflight', 'item_ban'];
  NP.DEMO_EVENTS = [
    { id: 'D-01', name: 'Потерянный кошелёк', sign: '±', w: 6, desc: 'На тротуаре лежит пухлый кошелёк.', opts: [
      { label: 'Забрать себе', text: '+3 очка, но d6: 1–3 — тебя заметили: Оглушение', fx: [{ pts: 3 }, { roll: { die: 6, lo: [{ st: 'stun' }], hi: [] } }] },
      { label: 'Вернуть владельцу', text: '+1 очко и Щит', fx: [{ pts: 1 }, { st: 'shield' }] }] },
    { id: 'D-02', name: 'Уличный торговец', sign: '+', w: 6, desc: 'Торговец с Шестой улицы предлагает товар из-под прилавка.', opts: [
      { label: 'Купить за 2 очка', text: 'редкий предмет', need: { pts: 2 }, fx: [{ cost: 2 }, { item: 'rare' }] },
      { label: 'Пройти мимо', text: 'ничего', fx: [] }] },
    { id: 'D-03', name: 'Банбу-курьер', sign: '+', w: 6, desc: 'Банбу перепутал адрес и отдаёт посылку тебе.', opts: [
      { label: 'Принять посылку', text: 'случайный предмет', fx: [{ item: null }] }] },
    { id: 'D-04', name: 'Попутный ветер', sign: '+', w: 5, desc: 'Попутка предлагает подвезти.', opts: [
      { label: 'Ехать', text: 'вперёд на 3 клетки', fx: [{ fwd: 3 }] },
      { label: 'Остаться', text: '+1 очко', fx: [{ pts: 1 }] }] },
    { id: 'D-05', name: 'Ставка на гонку', sign: '±', w: 6, desc: 'Байкеры Блэйзвуда принимают ставки.', opts: [
      { label: 'Поставить 2 очка', text: 'd6: 4–6 — +5 очков, 1–3 — ставка сгорает', need: { pts: 2 }, fx: [{ cost: 2 }, { roll: { die: 6, lo: [], hi: [{ pts: 5 }] } }] },
      { label: 'Не ставить', text: 'ничего', fx: [] }] },
    { id: 'D-06', name: 'Счастливая монетка', sign: '+', w: 5, desc: 'Монетка падает орлом три раза подряд.', opts: [
      { label: 'Загадать желание', text: 'Золотой кубик (+2 к следующему броску)', fx: [{ st: 'golden' }] }] },
    { id: 'D-07', name: 'Репортёр Knot TV', sign: '+', w: 5, desc: 'Тебя узнали и просят интервью.', opts: [
      { label: 'Дать интервью', text: '+2 очка', fx: [{ pts: 2 }] },
      { label: 'Сбежать от камер', text: 'дополнительный ход', fx: [{ st: 'extra' }] }] },
    { id: 'D-08', name: 'Тренировка с агентами', sign: '+', w: 5, desc: 'Агенты показывают пару приёмов.', opts: [
      { label: 'Тренироваться', text: 'Щит', fx: [{ st: 'shield' }] }] },
    { id: 'D-09', name: 'Робин Гуд из Нью-Эриду', sign: '±', w: 4, desc: 'Можно пощипать лидера.', opts: [
      { label: 'Украсть у лидера', text: 'Забрать 2 очка у лидера, но d6: 1–2 — Оглушение', fx: [{ steal: 2 }, { roll: { die: 6, lo: [], hi: [] }, stunOn: 2 }] },
      { label: 'Не рисковать', text: '+1 очко', fx: [{ pts: 1 }] }] },
    { id: 'D-10', name: 'Шальной эфириал', sign: '−', w: 5, desc: 'Из каверны выскакивает эфириал.', opts: [
      { label: 'Отбиваться', text: '−2 очка', fx: [{ pts: -2 }] }] },
    { id: 'D-11', name: 'Карманник', sign: '−', w: 4, desc: 'В толпе кто-то шарит по карманам.', opts: [
      { label: 'Проверить карманы', text: 'потеря случайного предмета (нет предметов — −1 очко)', fx: [{ lose: 1 }] }] },
    { id: 'D-12', name: 'Дорожная пробка', sign: '−', w: 4, desc: 'Перекрыли улицу.', opts: [
      { label: 'Объехать', text: 'назад на 2 клетки', fx: [{ back: 2 }] }] },
    { id: 'D-13', name: 'Ржавые шестерни', sign: '−', w: 4, desc: 'Кубик заедает.', opts: [
      { label: 'Смириться', text: 'Ржавый кубик (−2 к следующему броску)', fx: [{ st: 'rusty' }] }] },
    { id: 'D-14', name: 'Налоговая проверка', sign: '−', w: 4, desc: 'Налоговый инспектор просит показать декларацию.', opts: [
      { label: 'Заплатить', text: '−2 очка', fx: [{ pts: -2 }] },
      { label: 'Спорить', text: 'd6: 1–3 — −4 очка, 4–6 — ничего', fx: [{ roll: { die: 6, lo: [{ pts: -4 }], hi: [] } }] }] }
  ];

  async function applyFx(g, p, list, res, ev) {
    for (const f of list) {
      const neg = (f.pts < 0) || f.lose || f.back || f.st === 'stun' || f.st === 'rusty';
      const run = async q => {
        if (f.pts) { g.add(q, f.pts); res.push(q.name + ': ' + (f.pts > 0 ? '+' : '−') + Math.abs(f.pts) + ' очк.'); }
        if (f.cost) { g.add(q, -f.cost); res.push(q.name + ' платит ' + f.cost + ' очк.'); }
        if ('item' in f) { const n = q.items.length; g.giveRandom(q, f.item); res.push(q.items.length > n ? q.name + ' получает «' + NP.ITEMS[q.items[q.items.length - 1].key].name + '».' : 'Инвентарь полон, предмет сгорает.'); }
        if (f.lose) { if (q.items.length) { const it = g.takeItem(q, Math.floor(g.r() * q.items.length)); res.push(q.name + ' теряет «' + NP.ITEMS[it.key].name + '».'); } else { g.add(q, -1); res.push(q.name + ': предметов нет, −1 очко.'); } }
        if (f.st) { g.status(q, f.st); res.push(q.name + ': ' + ({ golden: 'Золотой кубик', rusty: 'Ржавый кубик', stun: 'Оглушение', shield: 'Щит', extra: 'дополнительный ход' }[f.st]) + '.'); }
        if (f.fwd) { res.push(q.name + ' движется вперёд на ' + f.fwd + ' кл.'); await g.forceMove(q, f.fwd); }
        if (f.back) { res.push(q.name + ' отступает на ' + f.back + ' кл.'); await g.moveBack(q, f.back); await g.land(q, false); }
      };
      if (f.roll) {
        const r = g.roll(f.roll.die); res.push('Бросок d' + f.roll.die + ': ' + r + '.');
        if (f.stunOn && r <= f.stunOn) await applyFx(g, p, [{ st: 'stun' }], res, ev);
        await applyFx(g, p, r > f.roll.die / 2 ? f.roll.hi : f.roll.lo, res, ev);
      } else if (f.steal) {
        const L = g.leader();
        if (L === p) res.push('Ты и есть лидер — красть не у кого.');
        else { const ok = await g.hit(L, p, q => { const v = g.steal(q, p, f.steal); res.push(p.name + ' забирает ' + v + ' очк. у ' + q.name + '.'); }, ev.name); if (!ok) res.push(L.name + ': сработал Щит или Зеркало.'); }
      } else if (neg) {
        const ok = await g.hit(p, null, run, ev.name); if (!ok) res.push('Сработал Щит или Зеркало.');
      } else await run(p);
    }
  }

  async function playDemo(g, p, kind) {
    let pool = NP.DEMO_EVENTS;
    if (kind === 'Rneg') pool = pool.filter(e => e.sign === '−');
    else if (g.fx('В') === 'E-В2' && NP.GRAPH.regionOf(p.pos) === 'В') pool = pool.filter(e => e.sign === '+');
    const S = g.S, used = S.deck.D || (S.deck.D = []);
    let left = pool.filter(e => !used.includes(e.id)); if (!left.length) { used.length = 0; left = pool; }
    const ev = g.wpick(left.map(e => [e, e.w]))[0]; used.push(ev.id);
    g.log(p.name + ': событие «' + ev.name + '».', p);
    const ok = o => !o.need || (!o.need.pts || p.pts >= o.need.pts);
    const ch = await g.choose(p, '📜 ' + ev.name + ' — ' + ev.desc, ev.opts.map((o, i) => ({ label: o.label, value: i, hint: o.text, disabled: !ok(o) })), { always: true, kind: 'event' });
    const o = ev.opts[ch] || ev.opts.find(ok) || ev.opts[0], res = [];
    g.log(p.name + ' выбирает: ' + o.label + '.', p);
    await applyFx(g, p, o.fx, res, ev);
    if (!res.length) res.push('Ничего не произошло.');
    g.upd();
    if (g.io.notice) await g.io.notice({ player: p.i, title: 'Событие · ' + o.label, name: ev.name, text: res.join(' '), icon: '📜' });
  }

  async function play(g, p, kind) {
    if (g.S.cfg.mode === 'demo') { if (p.st.badDay) { p.st.badDay = false; if (kind !== 'L') kind = 'Rneg'; } return playDemo(g, p, kind); }
    if (kind !== 'Rneg' && kind !== 'L' && p.st.badDay) { p.st.badDay = false; kind = 'Rneg'; g.log(p.name + ': Плохой день — только негативное событие.', p); }
    const ev = draw(g, kind, p);
    if (!ev) { g.log('Нет событий для ' + kind + ' — пропуск.', p); return; }
    g.log(p.name + ' тянет событие ' + ev.id + ' «' + ev.name + '».', p);
    const options = splitOptions(ev);
    const card = { id: ev.id, name: ev.name, desc: ev.desc, hard: ev.hard || '', kind: kind === 'L' ? 'L' : 'R', options: options.map(o => Object.assign({}, o, { chips: chips((o.label === 'Принять' ? '' : o.label + ' → ') + o.outcome + (ev.sign ? ' ' + ev.name : ''), g), disabled: o.cond ? !condOk(g, p, o.cond) : false })), sign: ev.sign || '', note: ev.note || '', trig: ev.trig || '', descChips: chips(ev.desc, g) };
    const choice = await g.io.eventCard({ player: p.i, card });
    if (g.S.over) throw new NP.GameOver();
    if (choice !== undefined && options[choice]) g.log(p.name + ' выбирает: ' + options[choice].label + '.', p);
  }

  NP.Events = { play, applyChip, chips, splitOptions, condOk };
})();
