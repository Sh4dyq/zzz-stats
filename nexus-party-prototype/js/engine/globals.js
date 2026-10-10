/* Глобальные события (лист «События», раздел «Глобальные события»). Одно случайное в начале игры и каждого этапа, действует весь этап.
   Мгновенные оставлены только сильные (G-03, G-12, G-18, G-21); слабые мгновенные (G-08, G-09, G-11, G-15, G-16, G-20) убраны. */
(function () {
  const NP = (globalThis.window || globalThis).NP;
  NP.GLOBALS = [
    { id: 'G-03', name: 'В бухгалтерии всё перепутали', text: 'Каждый отдаёт половину своих очков (с округлением вниз) в общий котёл. Котёл делится поровну, остаток сгорает.', w: 2, inst: true, notAtStart: true, once: true },
    { id: 'G-12', name: 'Проиграл 50/50', text: 'Каждый бросает кубик: верхняя половина — редкий предмет, нижняя — потеря случайного предмета.', w: 6, inst: true, demo: true },
    { id: 'G-02', name: 'Хаос', text: 'Все клетки и все предметы аномальные.', w: 6, demo: true },
    { id: 'G-04', name: 'Фея перепутала отряды', text: 'Все бои — случайными отрядами из ростера (без драфта), кроме Grand Challenge. Следят сами игроки.', w: 6 },
    { id: 'G-05', name: 'Концерт Астры Яо', text: 'Клетки боя не запускают бои. Все получают +1 очко в начале каждого раунда.', w: 6, demo: true },
    { id: 'G-06', name: 'Расширение каверны', text: 'Случайный регион: все его клетки работают как случайное событие.', w: 6 },
    { id: 'G-07', name: 'Сбой Интернота', text: 'Никто не может использовать предметы.', w: 6, demo: true },
    { id: 'G-10', name: 'Ночь в Нью-Эриду', text: 'Очки, полученные и потерянные на клетках и в событиях, удваиваются (кроме боёв).', w: 6, demo: true },
    { id: 'G-13', name: 'Распродажа в Нью-Эриду', text: 'Ломбард платит ×2, Гача на 1 очко дешевле.', w: 6, demo: true },
    { id: 'G-14', name: 'Сезон инспектора Мяучело', text: 'Первый, кто остановится в регионе, получает +2 очка (в каждом регионе).', w: 6, demo: true },
    { id: 'G-22', name: 'Мины Сынов Калидона', text: 'В каждом регионе на случайной клетке скрыта мина: −2 очка и Оглушение.', w: 6 },
    { id: 'G-23', name: 'Прайм-тайм Knot TV', text: 'В каждом бою +1 модификатор. Кто выполнил больше всех модификаторов, получает +1 очко (вручную).', w: 6 }
  ];
  // Не реализованы в прототипе: G-18 Горячий телефон, G-21 Аукцион (сложные интерактивные), G-01 Заражённые клетки, G-17 Копилка, G-19 Переворот, G-24 Обмен территориями.

  async function start(g) {
    const S = g.S;
    S.gUsed = S.gUsed || [];
    const pool = NP.GLOBALS.filter(e => (S.stage > 1 || !e.notAtStart) && !(e.once && S.gUsed.includes(e.id)) && (S.cfg.mode !== 'demo' || e.demo));
    if (!pool.length) return;
    const e = g.wpick(pool.map(x => [x, x.w]))[0];
    S.gUsed.push(e.id);
    S.gfx = { id: e.id, stage: S.stage, until: e.inst ? 0 : 99 }; S.g14 = {};
    g.log('Глобальное событие: «' + e.name + '».');
    if (g.io.notice) await g.io.notice({ title: 'Глобальное событие · ' + (e.inst ? 'мгновенно' : 'до конца этапа'), name: e.name, text: e.text });
    const P = g.P;
    switch (e.id) {
      case 'G-03': { let pot = 0; for (const p of P) { const v = Math.floor(p.pts / 2); g.add(p, -v); pot += v; } const share = Math.floor(pot / P.length); for (const p of P) g.add(p, share); g.log('В котле ' + pot + ' очк., каждому по ' + share + '.'); break; }
      case 'G-12': for (const p of P) { const r = g.roll(S.cfg.die); if (r > S.cfg.die / 2) g.giveRandom(p, 'rare'); else if (p.items.length) { const x = g.takeItem(p, Math.floor(g.r() * p.items.length)); g.log(p.name + ' (' + r + ') теряет «' + NP.ITEMS[x.key].name + '».', p); } } break;
      case 'G-06': S.gReg = g.pick(['Ш', 'Б', 'В', 'Р']); g.log('Каверна поглощает регион ' + NP.REGIONS[S.gReg].name + '.'); break;
      case 'G-22': for (const reg of ['Ш', 'Б', 'В', 'Р']) { const c = NP.GRAPH.IDS.filter(id => NP.GRAPH.regionOf(id) === reg && ['Очки', 'Сундук', 'Событие', 'Опасность'].includes(S.cells[id].type)); if (c.length) S.mines.push(g.pick(c)); } break;
    }
    g.upd();
  }
  NP.Globals = { start };
})();
