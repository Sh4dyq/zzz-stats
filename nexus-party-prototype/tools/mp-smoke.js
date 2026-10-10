/* Смоук-тест онлайн-демо в Chromium (Playwright), канал #local между вкладками.
   Запуск: python3 -m http.server 8765 в папке прототипа, затем node tools/mp-smoke.js
   Переменные: G=число гостей, HO=1 хост только ведёт, ADDLOCAL=1, RELOAD=1 (перезагрузка гостя), HRELOAD=1 (хоста). */
const { chromium } = require(process.env.PW || 'playwright');
const URL = process.env.U || 'http://127.0.0.1:8765/demo.html#local';
const GUESTS = +(process.env.G || 1), HOSTONLY = !!process.env.HO;
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await b.newContext();
  await ctx.route(/fonts|jsdelivr/, r => r.abort());
  const errs = [];
  const mk = async name => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); }); p.on('dialog', d => { errs.push(name + ' dialog: ' + d.message()); d.accept('Локальный'); }); await p.goto(URL); p._n = name; return p; };
  const host = await mk('host');
  await host.fill('#mpName', 'Хост'); await host.click('#mpCreate');
  await host.waitForSelector('.mp-code');
  const room = await host.textContent('.mp-code');
  const guests = [];
  for (let i = 0; i < GUESTS; i++) { const g = await mk('g' + i); await g.fill('#mpName', 'Гость' + i); await g.fill('#mpCode', room); await g.click('#mpJoin'); guests.push(g); }
  await host.waitForFunction(n => document.querySelectorAll('.mp-seats li').length >= n, (HOSTONLY ? 0 : 1) + GUESTS, { timeout: 15000 });
  if (process.env.ADDLOCAL) { await host.click('#mpAddLocal'); }
  if (HOSTONLY) { const c = await host.$('#mpSpectate'); if (c) await c.click().catch(() => {}); else errs.push('no #mpSpectate'); }
  await host.click('#mpStart'); if (HOSTONLY) console.log('seats', await host.evaluate(() => JSON.stringify(NP.MP.seats.map(s => s.name))));
  const pages = [host, ...guests];
  let last = Date.now(), clicks = 0, over = false;
  const step = async p => {
    return p.evaluate(() => {
      const vis = e => e && e.offsetParent !== null && !e.disabled;
      const q = s => [...document.querySelectorAll(s)].filter(vis);
      if (document.querySelector('#goNew')) return 'over';
      for (const s of ['#ntOk', '#btnRoll', '#evOk']) { const e = q(s)[0]; if (e) { if (s === '#evOk') { const o = q('.ev-opt')[0]; if (o && !document.querySelector('.ev-opt.sel, .ev-opt.on, .ev-opt[aria-checked=true]')) o.click(); } e.click(); return s; } }
      const f = q('#fOk')[0]; if (f) { const r = q('#fRand')[0]; const host = /Записать/.test(f.textContent); if (host) { const w = document.querySelector('.fight-wait'); if (w && /⏳/.test(w.textContent) && !window.__fw) { window.__fw = Date.now(); return null; } if (w && /⏳/.test(w.textContent) && Date.now() - window.__fw < 4000) return null; } window.__fw = 0; r && r.click(); q('#fOk')[0].click(); return 'fight' + (host ? 'H' : 'G'); }
      const o = q('#prompt button[data-k]'); if (o.length) { o[Math.floor(Math.random() * o.length)].click(); return 'choose'; }
      return null;
    }).catch(e => 'ERR ' + e.message);
  };
  const tally = {};
  while (!over) {
    for (const p of pages) { const r = await step(p); if (r === 'over') { over = true; break; } if (r) { tally[p._n + ':' + r] = (tally[p._n + ':' + r] || 0) + 1; last = Date.now(); clicks++; } }
    await new Promise(r => setTimeout(r, 30));
    if (Date.now() - last > 15000) {
      for (const p of pages) { errs.push('STALL ' + p._n + ': prompt=' + (await p.textContent('#prompt').catch(() => '')).slice(0, 200) + ' | modal=' + (await p.textContent('#modalBox').catch(() => '')).slice(0, 200)); }
      break;
    }
    if (process.env.RELOAD && clicks > 60 && !global.__rl) { global.__rl = 1; const g = guests[0]; await g.reload(); await g.fill('#mpName', 'Гость0'); await g.fill('#mpCode', room); await g.click('#mpJoin'); }
    if (process.env.HRELOAD && clicks > 80 && !global.__hr) { global.__hr = 1; await host.reload(); await host.click('#mpResume'); }
    if (clicks > 6000) { errs.push('too many clicks'); break; }
  }
  const gOver = await Promise.all(guests.map(g => g.$('#goNew').then(x => !!x)));
  console.log(JSON.stringify({ over, clicks, guestsSawOver: gOver, tally, errs: errs.slice(0, 30) }, null, 1));
  await b.close();
})();
