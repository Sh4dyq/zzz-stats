/* Онлайн-мультиплеер демо. Хост (создатель комнаты) запускает движок у себя; гости получают состояние партии
   и отвечают на свои решения: выбор, бросок, результат боя. Канал — Supabase Realtime (broadcast), без таблиц.
   Для проверки без сети: #local в адресе — канал BroadcastChannel между вкладками одного браузера. */
(function () {
  const NP = window.NP, $ = s => document.querySelector(s);
  const SB_URL = 'https://zoavnckfbfiejxfjakue.supabase.co', SB_KEY = 'sb_publishable_37RZBsmdp3O1i795EuEfeg_vFpdPTFZ';
  const META_KEY = 'np_mp_host_v1', LOG_TAIL = 120;
  const rid = () => Math.random().toString(36).slice(2, 10);
  const code = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } } };
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  const cid = ss.get('np_mp_cid') || (() => { const c = rid(); ss.set('np_mp_cid', c); return c; })();

  // ---------- канал ----------
  function transport(room, onMsg) {
    if (MP.factory) return MP.factory(room, onMsg); // тесты
    const name = 'np-room-' + room;
    if (/local/.test(location.hash) || !window.supabase) {
      const bc = new BroadcastChannel(name); bc.onmessage = e => onMsg(e.data);
      return { kind: 'local', ready: Promise.resolve(), send: m => bc.postMessage(m), close: () => bc.close() };
    }
    const client = window.supabase.createClient(SB_URL, SB_KEY, { realtime: { params: { eventsPerSecond: 20 } } });
    const ch = client.channel(name, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload));
    const ready = new Promise((res, rej) => ch.subscribe(st => { if (st === 'SUBSCRIBED') res(); else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') rej(new Error('Нет связи с сервером (' + st + ')')); }));
    return { kind: 'supabase', ready, send: m => ready.then(() => ch.send({ type: 'broadcast', event: 'm', payload: m })), close: () => client.removeChannel(ch) };
  }

  const MP = { role: null, room: null, seats: [], hostCid: null, hostName: '', started: false, pending: {}, net: null, factory: null, cid };
  const send = m => { if (MP.net) MP.net.send(Object.assign({ from: cid }, m)); };
  const mySeats = () => MP.seats.map((s, i) => s.cid === cid ? i : -1).filter(i => i >= 0);
  // Решения без игрока (глобальные события и т. п.) принимает хост, даже если он только ведёт партию и не играет.
  const ownerOf = i => (i === null || i === undefined || !MP.seats[i]) ? MP.hostCid : MP.seats[i].cid;
  const nameOf = i => MP.seats[i] ? MP.seats[i].name : '?';
  const spectating = () => !!MP.hostCid && !MP.seats.some(s => s.own);
  const KIND = { choose: 'выбирает', wait: 'бросает кубик', notice: 'читает событие', fight: 'вводит результат боя' };

  // ---------- общая часть: строка ожидания ----------
  function showWaiting(list) { // list: [{player, kind}] — чужие решения, которых ждём
    const box = $('#prompt'); if (!box || MP.busy) return;
    if (!list || !list.length) { if (box.dataset.mpWait) { box.innerHTML = ''; delete box.dataset.mpWait; } return; }
    box.dataset.mpWait = '1'; box.className = 'card prompt';
    box.innerHTML = `<h3>Ждём…</h3><p class="muted">${list.map(w => NP.App.esc(w.player === null || w.player === undefined ? 'Ведущий' : nameOf(w.player)) + ' ' + (KIND[w.kind] || '')).join('<br>')}</p>`;
  }

  // ---------- хост ----------
  function hostIO(g, base) {
    let localWait = null, timer = 0;
    const pushState = () => { if (timer) return; timer = setTimeout(() => { timer = 0; const S = Object.assign({}, g.S, { log: g.S.log.slice(-LOG_TAIL) }); send({ t: 'state', S, seats: MP.seats, hostCid: MP.hostCid, wait: waits() }); if (!MP.busy) showWaiting(waits().filter(w => ownerOf(w.player) !== cid)); }, 120); };
    const waits = () => Object.values(MP.pending).map(p => ({ player: p.spec.player, kind: p.kind })).concat(localWait ? [localWait] : []);
    const local = (kind, fn, spec) => { localWait = { player: spec.player, kind }; MP.busy = true; pushState(); return fn(spec).then(v => { localWait = null; MP.busy = false; pushState(); return v; }); };
    const remote = (kind, spec) => new Promise(res => {
      const id = rid(), to = ownerOf(spec.player);
      MP.pending[id] = { to, kind, spec, res: v => { delete MP.pending[id]; pushState(); res(v); } };
      send({ t: 'req', rid: id, to, kind, spec }); pushState();
    });
    MP.pushState = pushState;
    return Object.assign({}, base, {
      choose: spec => ownerOf(spec.player) === cid ? local('choose', base.choose, spec) : remote('choose', spec),
      wait: spec => ownerOf(spec.player) === cid ? local('wait', base.wait, spec) : remote('wait', spec),
      notice: spec => { // глобальные события и итоги событий видят все; ждём только «хозяина» карточки
        send({ t: 'show', spec, except: ownerOf(spec.player) });
        return ownerOf(spec.player) === cid ? local('notice', base.notice, spec) : remote('notice', spec);
      },
      fight: spec => {
        const seats = spec.kind === 'duels' ? [...new Set(spec.pairs.flat())] : spec.players;
        if (seats.every(i => ownerOf(i) === cid)) return local('fight', base.fight, spec);
        return new Promise(res => {
          const id = rid(), p = MP.pending[id] = { to: '*', kind: 'fight', spec, buf: [], res: null };
          MP.busy = true;
          send({ t: 'req', rid: id, to: '*', kind: 'fight', spec }); pushState();
          NP.App.renderFight(spec, v => { delete MP.pending[id]; MP.busy = false; send({ t: 'close', rid: id }); pushState(); res(v); },
            { mine: mySeats(), host: true, onReady: api => { p.api = api; p.buf.forEach(x => api.inject(x.value, x.seat)); } });
        });
      },
      log: m => { base.log(m); pushState(); },
      update: () => { base.update(); pushState(); },
      save: S => { base.save(S); ls.set(META_KEY, meta()); },
      gameOver: S => { MP.busy = true; const b = $('#prompt'); if (b) { b.innerHTML = ''; delete b.dataset.mpWait; } base.gameOver(S); send({ t: 'over', S: Object.assign({}, S, { log: S.log.slice(-LOG_TAIL) }) }); }
    });
  }

  function onHost(m) {
    if (m.from === cid) return;
    if (m.t === 'hello') {
      const known = MP.seats.find(s => s.cid === m.from);
      if (!MP.started && !known && MP.seats.length < 8) MP.seats.push({ cid: m.from, name: (m.name || 'Гость').slice(0, 24) });
      lobbyBroadcast();
      if (MP.started) { if (MP.pushState) MP.pushState(); for (const id in MP.pending) { const p = MP.pending[id]; if (p.to === m.from || p.to === '*') send({ t: 'req', rid: id, to: p.to, kind: p.kind, spec: p.spec }); } }
    } else if (m.t === 'res') { const p = MP.pending[m.rid]; if (p && p.to === m.from && p.res) p.res(m.value); }
    else if (m.t === 'fres') { const p = MP.pending[m.rid]; if (p && p.kind === 'fight') { const x = { value: m.value, seat: m.seats[0] }; (m.seats || []).forEach(s => { if (p.api) p.api.inject(m.value, s); else p.buf.push({ value: m.value, seat: s }); }); } }
    else if (m.t === 'leave' && !MP.started) { MP.seats = MP.seats.filter(s => s.cid !== m.from); lobbyBroadcast(); }
  }
  function lobbyBroadcast() { send({ t: 'lobby', room: MP.room, seats: MP.seats, hostCid: MP.hostCid, started: MP.started }); renderRoom(); }
  const meta = () => ({ room: MP.room, seats: MP.seats, hostCid: MP.hostCid, hostName: MP.hostName });

  async function host(name, room, seats) {
    MP.role = 'host'; MP.room = room || code(); MP.seats = seats || [{ cid, name, own: true }]; MP.started = false;
    MP.hostCid = cid; MP.hostName = name;
    MP.net = transport(MP.room, onHost);
    try { await MP.net.ready; } catch (e) { alert(e.message); }
    lobbyBroadcast();
  }
  function startOnline() {
    if (MP.seats.length < 2) { alert('Нужно минимум 2 игрока.'); return; }
    const S = NP.Game.create(NP.App.buildCfg(), MP.seats.map(s => s.name));
    MP.started = true; lobbyBroadcast();
    ls.set(META_KEY, meta());
    NP.App.play(S, hostIO);
  }
  async function resumeHost() { // продолжить свою онлайн-партию после перезагрузки страницы
    const m = ls.get(META_KEY), S = NP.App.savedState && NP.App.savedState();
    if (!m || !S) return;
    const old = m.hostCid || m.seats[0].cid; // старые сохранения: хост сидел на месте 0
    await host(m.hostName || m.seats[0].name, m.room, m.seats.map((s, i) => s.cid === old ? Object.assign({}, s, { cid }, m.hostCid ? {} : { own: i === 0 }) : s));
    MP.started = true; lobbyBroadcast();
    NP.App.play(S, hostIO);
  }

  // ---------- гость ----------
  let cur = null; // текущий запрос к этому гостю
  function onGuest(m) {
    if (m.from === cid || (m.to && m.to !== '*' && m.to !== cid)) return;
    if (m.hostCid) MP.hostCid = m.hostCid;
    if (m.t === 'lobby') { MP.seats = m.seats; MP.started = m.started; renderRoom(); }
    else if (m.t === 'state') {
      MP.seats = m.seats; MP.started = true;
      if ($('#btnGM')) $('#btnGM').classList.add('hidden');
      NP.App.view(m.S);
      if (MP.queued) { const q = MP.queued; MP.queued = null; onGuest(q); }
      if (!cur) showWaiting((m.wait || []).filter(w => !(mySeats().includes(w.player) && w.kind !== 'fight')));
    } else if (m.t === 'req') {
      if (cur && cur.rid === m.rid) return; // повтор после переподключения
      if (!NP.App.game) { MP.queued = m; return; } // состояние ещё не пришло — ответим после него
      cur = { rid: m.rid, kind: m.kind }; MP.busy = true;
      const done = (t, value) => { send(Object.assign({ t, rid: m.rid, value }, t === 'fres' ? { seats: mySeats() } : {})); if (t !== 'fres') { cur = null; MP.busy = false; } };
      if (m.kind === 'choose') NP.App.renderChoice(m.spec, v => done('res', v));
      else if (m.kind === 'wait') NP.App.renderWait(m.spec, () => done('res'));
      else if (m.kind === 'notice') NP.App.notice(m.spec).then(() => done('res'));
      else if (m.kind === 'fight') {
        const seats = m.spec.kind === 'duels' ? m.spec.pairs.flat() : m.spec.players;
        if (!mySeats().some(i => seats.includes(i))) { cur = null; MP.busy = false; return; } // не участвует — просто ждёт
        NP.App.renderFight(m.spec, v => done('fres', v), { mine: mySeats() });
      }
    } else if (m.t === 'close') { if (cur && cur.rid === m.rid) { NP.App.closeModal(); cur = null; MP.busy = false; } }
    else if (m.t === 'show') { if (m.except !== cid && !cur) NP.App.notice(m.spec); }
    else if (m.t === 'over') { NP.App.view(m.S); NP.App.gameOver(m.S); }
  }
  async function join(name, room) {
    MP.role = 'guest'; MP.room = room.toUpperCase(); MP.net = transport(MP.room, onGuest);
    try { await MP.net.ready; } catch (e) { alert(e.message); return; }
    send({ t: 'hello', name }); renderRoom();
    MP.hello = setInterval(() => { if (!MP.started) send({ t: 'hello', name }); else clearInterval(MP.hello); }, 3000);
  }

  // ---------- лобби ----------
  function renderRoom() {
    const box = $('#mpRoom'); if (!box) return;
    box.classList.remove('hidden');
    const link = location.href.split('#')[0] + '#room=' + MP.room + (/local/.test(location.hash) ? '&local' : '');
    box.innerHTML = `<p>Комната <b class="mp-code">${MP.room}</b>${MP.net && MP.net.kind === 'local' ? ' <span class="muted">(локально: вкладки этого браузера)</span>' : ''}</p>
      <p class="muted">Ссылка для друзей: <input class="mp-link" readonly value="${NP.App.esc(link)}" onclick="this.select()"></p>
      <ol class="mp-seats">${MP.seats.map((s, i) => `<li><span class="swatch" style="background:${NP.PLAYER_COLORS[i]}"></span>${NP.App.esc(s.name)}${s.cid === cid ? ' <em>(ты)</em>' : ''}${s.own ? ' <em>хост</em>' : ''}</li>`).join('')}</ol>` +
      (spectating() ? `<p class="muted">Ведущий${MP.role === 'host' ? ' (ты)' : ''} только ведёт партию и не играет.</p>` : '') +
      (MP.role === 'host' ? `<label class="check"><input type="checkbox" id="mpSpectate" ${spectating() ? 'checked' : ''}> Только вести партию (хост не играет)</label><div class="row"><button class="btn ghost" id="mpAddLocal">+ Игрок на этом экране</button><button class="btn primary" id="mpStart" ${MP.seats.length < 2 ? 'disabled' : ''}>Начать онлайн-партию</button></div>`
        : `<p class="muted">${MP.started ? 'Партия идёт, подключаемся…' : 'Ждём, пока хост начнёт партию.'}</p>`);
    if (MP.role === 'host') {
      $('#mpAddLocal').onclick = () => { if (MP.seats.length < 8) { const n = prompt('Имя игрока на этом экране', 'Игрок ' + (MP.seats.length + 1)); if (n) { MP.seats.push({ cid, name: n.slice(0, 24) }); lobbyBroadcast(); } } };
      $('#mpStart').onclick = startOnline;
      $('#mpSpectate').onchange = e => {
        if (e.target.checked) MP.seats = MP.seats.filter(s => !s.own);
        else if (MP.seats.length < 8) MP.seats.unshift({ cid, name: MP.hostName, own: true });
        lobbyBroadcast();
      };
    }
  }
  function mountLobby() {
    const card = $('#lobby .lobby-card'); if (!card || $('#mpCard') || NP.App.mode !== 'demo') return;
    const room = (location.hash.match(/room=([A-Z0-9]+)/i) || [])[1] || '';
    const div = document.createElement('div'); div.id = 'mpCard'; div.className = 'mp-card';
    div.innerHTML = `<h3>Онлайн</h3><p class="muted">Каждый играет со своего устройства: ходит, принимает решения и вводит свои результаты боёв. Партию ведёт браузер хоста — хосту нельзя закрывать вкладку.</p>
      <div class="mp-row"><input id="mpName" maxlength="24" placeholder="Твоё имя" value="${NP.App.esc(ls.get('np_mp_name') || '')}"></div>
      <div class="mp-row"><button class="btn primary" id="mpCreate">Создать комнату</button><button class="btn ghost" id="mpCreateHost" title="Хост ведёт партию и не играет">Создать как ведущий</button><span class="muted">или</span><input id="mpCode" maxlength="5" placeholder="Код" value="${room}"><button class="btn" id="mpJoin">Войти</button></div>
      ${ls.get(META_KEY) && NP.App.savedState && NP.App.savedState() ? '<div class="mp-row"><button class="btn ghost" id="mpResume">Продолжить свою онлайн-партию</button></div>' : ''}
      <div id="mpRoom" class="hidden"></div>`;
    card.appendChild(div);
    const nm = () => { const n = $('#mpName').value.trim(); if (!n) { $('#mpName').focus(); return null; } ls.set('np_mp_name', n); return n; };
    $('#mpCreate').onclick = () => { const n = nm(); if (n) { lockLobby(); host(n); } };
    $('#mpCreateHost').onclick = () => { const n = nm(); if (n) { lockLobby(); host(n, null, []); } };
    $('#mpJoin').onclick = () => { const n = nm(), c = $('#mpCode').value.trim(); if (n && c) { lockLobby(); join(n, c); } };
    if ($('#mpResume')) $('#mpResume').onclick = () => { lockLobby(); resumeHost(); };
  }
  function lockLobby() { ['#mpCreate', '#mpCreateHost', '#mpJoin', '#mpResume'].forEach(s => { if ($(s)) $(s).disabled = true; }); }

  MP.mount = mountLobby; MP.host = host; MP.join = join; MP.startOnline = startOnline;
  NP.MP = MP;
  if (document.readyState !== 'loading') setTimeout(mountLobby, 0); else document.addEventListener('DOMContentLoaded', mountLobby);
})();
