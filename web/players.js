// players.js — игроки, ростеры, призовые

let _RS=[];
const RC={atk:'#fca5a5',stun:'#93c5fd',rupt:'#fcd34d',sup:'#6ee7b7',def:'#86efac',ano:'#c4b5fd'};

async function pgPlayers(){
  const list=D.players.map(p=>{
    const ini=(p.nickname||'?').trim().slice(0,2).toUpperCase();
    const meta=[];
    if(p.age)meta.push(`${p.age} лет`);
    if(p.highest_place!=null)meta.push(`<b>${p.highest_place} место</b>${p.highest_place_count>1?` ×${p.highest_place_count}`:''}`);
    if(p.prize!=null)meta.push(`${(+p.prize).toLocaleString('ru-RU')} ₽`);
    return`<div class="pcard" draggable="true" data-id="${p.id}" data-search="${escapeHtml((p.nickname||'').toLowerCase())}">
    <span title="Перетащить" style="cursor:grab;color:#44444c;font-size:14px;user-select:none;flex-shrink:0">⠿</span>
    <span class="pc-av">${escapeHtml(ini)}</span>
    <div class="pc-body">
      <div class="pc-nick">${escapeHtml(p.nickname)}</div>
      <div class="pc-meta">${meta.join('<span style="color:#3a3a42">·</span>')||'<span>нет данных</span>'}</div>
    </div>
    <div class="gc-acts">
      <button class="icon-btn" title="Ростер и призовые" onclick="openRoster('${p.id}','${(p.nickname||'').replace(/'/g,"\\'")}')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="9" x2="9" y2="20"></line></svg></button>
      <button class="icon-btn danger" title="Удалить" onclick="delPlayer('${p.id}')">✕</button>
    </div>
  </div>`;}).join('');
  html(`<details class="panel">
    <summary>Добавить игрока<span class="chev">▾</span></summary>
    <div class="panel-body">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:2;min-width:160px"><label>Никнейм</label><input id="p-nick" type="text" placeholder="никнейм"></div>
        <div style="flex:1;min-width:80px"><label>Возраст</label><input id="p-age" type="number" min="10" max="99" placeholder="—"></div>
        <div style="flex:1;min-width:100px"><label>Призовые ₽</label><input id="p-prize" type="number" min="0" placeholder="0"></div>
        <button class="btn btn-y" style="flex-shrink:0" onclick="addPlayer()">Добавить</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <div style="flex:1;min-width:120px"><label>Наивысшее место</label><input id="p-place" type="number" min="1" placeholder="—"></div>
        <div style="flex:1;min-width:120px"><label>Раз занято</label><input id="p-place-cnt" type="number" min="1" placeholder="1"></div>
      </div>
    </div>
  </details>
  <div class="listbar">
    <div class="search" style="margin:0;flex:1;max-width:360px">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
      <input type="search" data-target="player-list" oninput="acFilter(this)" placeholder="Поиск игрока…">
    </div>
    <span class="count-chip">${D.players.length} игр.</span>
  </div>
  <div class="pgrid" id="player-list">${list||''}<p data-empty style="color:var(--sub);font-size:14px;${D.players.length?'display:none':''}">Игроков ещё нет</p></div>`);
  if(typeof enableReorder==='function')enableReorder(document.getElementById('player-list'),'players',pgPlayers);
}
async function addPlayer(){const n=v('p-nick');if(!n)return;const{error}=await sb.from('players').insert({nickname:n,age:vn('p-age'),highest_place:vn('p-place'),highest_place_count:vn('p-place-cnt'),prize:vn('p-prize')});if(dbErr(error,'добавление игрока'))return;toast('Игрок добавлен');await refreshData();pgPlayers();}
async function delPlayer(id){if(!confirm('Удалить?'))return;const{error}=await sb.from('players').delete().eq('id',id);if(dbErr(error,'удаление игрока'))return;pgPlayers();}

async function openRoster(pid,pnick){
  _RS=[];
  document.getElementById('page-title').textContent=`Ростер — ${pnick}`;
  const player=D.players.find(p=>p.id===pid)||{};
  const charGrid=D.chars.map(c=>`<button class="cpb" data-id="${c.id}" onclick="charPickClick('${c.id}')"
    style="border:2px solid var(--border);border-radius:8px;padding:7px 12px;background:var(--card);color:var(--text);
    cursor:pointer;font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:600;
    display:flex;align-items:center;gap:6px;transition:border-color .15s">
    <span style="width:8px;height:8px;border-radius:50%;background:${RC[c.role]||'#7b7f96'};flex-shrink:0"></span>
    ${c.name}<span class="${c.rarity==='S'?'badge-s':'badge-a'}">${c.rarity}</span>
  </button>`).join('');
  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('players')">← Назад</button>

  <div class="card" style="margin-bottom:12px">
    <h3>Профиль</h3>
    <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap">
      <div><label>Никнейм</label><input id="r-nick" type="text" placeholder="ник" style="width:160px" value="${escapeHtml(player.nickname||'')}"></div>
      <div><label>Возраст</label><input id="r-age" type="number" min="10" max="99" placeholder="—" style="width:100px" value="${player.age??''}"></div>
      <div><label>Наивысшее место</label><input id="r-place" type="number" min="1" placeholder="—" style="width:120px" value="${player.highest_place??''}"></div>
      <div><label>Раз занято</label><input id="r-place-cnt" type="number" min="1" placeholder="1" style="width:100px" value="${player.highest_place_count??''}"></div>
      <div><label>Призовые (₽)</label><input id="r-prize" type="number" min="0" placeholder="0" style="width:140px" value="${player.prize??''}"></div>
      <button class="btn btn-y" onclick="saveProfile('${pid}')">Сохранить</button>
    </div>
  </div>

  <div class="card">
    <h3>Персонажи ростера</h3>
    <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <div style="flex:1;min-width:160px"><label>Турнир</label>${sel('r-tour',D.tours,x=>x.id,x=>x.name)}</div>
      <button class="btn btn-g" onclick="loadTourRoster('${pid}')">Загрузить</button>
      <button class="btn btn-y" onclick="saveRoster('${pid}')">Сохранить ростер</button>
    </div>

    <div id="r-selected" style="display:flex;flex-wrap:wrap;gap:8px;min-height:40px;padding:10px;
      background:#0a0c12;border:1px solid var(--border);border-radius:8px;margin-bottom:14px">
      <span style="color:var(--sub);font-size:13px;align-self:center">Ростер пуст</span>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:8px">${charGrid}</div>
  </div>`);
}

function charPickClick(cid){
  const c=D.chars.find(x=>x.id===cid);if(!c)return;
  if(_RS.find(r=>r.character_id===cid)){toast('Уже в ростере');return;}
  const defaultMs=c.rarity==='S'?0:6;
  _RS.push({character_id:cid,mindscape:defaultMs});
  renderSelected();
}

function setRosterMs(cid,ms){
  const entry=_RS.find(r=>r.character_id===cid);
  if(entry)entry.mindscape=+ms;
}

function removeFromRoster(cid){
  _RS=_RS.filter(r=>r.character_id!==cid);
  renderSelected();
}

function renderSelected(){
  const el=document.getElementById('r-selected');if(!el)return;
  if(!_RS.length){el.innerHTML='<span style="color:var(--sub);font-size:13px;align-self:center">Ростер пуст</span>';return;}
  el.innerHTML=_RS.map(r=>{
    const c=D.chars.find(x=>x.id===r.character_id);if(!c)return'';
    const msOptsSel=[0,1,2,3,4,5,6].map(ms=>`<option value="${ms}" ${ms===r.mindscape?'selected':''}>М${ms}</option>`).join('');
    return`<div style="display:flex;align-items:center;gap:6px;background:#12141d;border:1px solid var(--border);border-radius:7px;padding:5px 8px 5px 10px">
      <span style="width:8px;height:8px;border-radius:50%;background:${RC[c.role]||'#7b7f96'};flex-shrink:0"></span>
      <span style="font-size:13px;font-weight:600">${c.name}</span>
      <select class="rms" onchange="setRosterMs('${r.character_id}',this.value)" title="Конста" style="width:auto;padding:2px 4px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--gold);background:#241f0e;border:1px solid #4a3d12;border-radius:5px">${msOptsSel}</select>
      <button onclick="removeFromRoster('${r.character_id}')" title="Убрать" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:16px;line-height:1;padding:0">×</button>
    </div>`;
  }).join('');
}

async function loadTourRoster(pid){
  const tourId=v('r-tour');if(!tourId)return;
  const{data}=await sb.from('player_rosters').select('*').eq('tournament_id',tourId).eq('player_id',pid);
  _RS=(data||[]).map(r=>({character_id:r.character_id,mindscape:r.mindscape}));
  renderSelected();
  // Подсказка об источнике: 'auto' — собран из пиков (перетрётся новыми результатами),
  // 'manual' — защищён от авто-сбора. Сохранение тут всегда делает ростер ручным.
  const isAuto=(data||[]).length&&(data||[]).every(r=>r.source==='auto');
  toast(data?.length?(isAuto?'Ростер собран авто из пиков (сохранение зафиксирует как ручной)':'Ростер ручной (защищён от авто-сбора)'):'Ростер для этого турнира пуст');
}

async function saveProfile(pid){
  const a=document.getElementById('r-age')?.value;
  const pl=document.getElementById('r-place')?.value;
  const plc=document.getElementById('r-place-cnt')?.value;
  const pr=document.getElementById('r-prize')?.value;
  const patch={
    age:a===''||a==null?null:+a,
    highest_place:pl===''||pl==null?null:+pl,
    highest_place_count:plc===''||plc==null?null:+plc,
    prize:pr===''||pr==null?null:+pr
  };
  // Ник меняем по id → все привязки (встречи/матчи/ростеры/результаты) сохраняются,
  // т.к. ссылаются на players.id (uuid), а не на ник. Новый ник подхватится везде.
  const nick=document.getElementById('r-nick')?.value?.trim();
  const cur=D.players.find(p=>p.id===pid);
  if(nick&&nick!==cur?.nickname)patch.nickname=nick;
  const{error}=await sb.from('players').update(patch).eq('id',pid);
  if(dbErr(error,'сохранение профиля'))return;
  await refreshData();
  toast('Профиль сохранён');
}

async function saveRoster(pid){
  const tourId=v('r-tour');if(!tourId)return toast('Выбери турнир','err');
  const{error:dErr}=await sb.from('player_rosters').delete().match({tournament_id:tourId,player_id:pid});
  if(dbErr(dErr,'очистка ростера'))return;
  if(_RS.length){
    // source='manual' → авто-сбор из результатов больше не перетрёт этот ростер.
    const rows=_RS.map(r=>({tournament_id:tourId,player_id:pid,character_id:r.character_id,mindscape:r.mindscape,source:'manual'}));
    const{error}=await sb.from('player_rosters').insert(rows);
    if(dbErr(error,'сохранение ростера'))return;
  }
  toast(`Ростер сохранён: ${_RS.length} персонажей`);
}
