// players.js — игроки, ростеры, призовые

let _RS=[];
const RC={atk:'#fca5a5',stun:'#93c5fd',rupt:'#fcd34d',sup:'#6ee7b7',def:'#86efac',ano:'#c4b5fd'};

async function pgPlayers(){
  const list=D.players.map(p=>`<div class="row-item">
    <div>
      <div style="font-weight:600">${p.nickname}</div>
      <div style="font-size:12px;color:var(--sub)">${p.age||'—'} ${p.prize!=null?'· '+p.prize+'$':''}</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openRoster('${p.id}','${p.nickname.replace(/'/g,"\'")}')">Ростер</button>
      <button class="btn-r" onclick="delPlayer('${p.id}')">✕</button>
    </div>
  </div>`).join('');
  html(`<div class="card" style="margin-bottom:16px">
    <h3>Добавить игрока</h3>
    <div class="grid2">
      <div><label>Никнейм</label><input id="p-nick" type="text"></div>
      <div><label>Возраст</label><input id="p-age" type="number" min="10" max="99"></div>
    </div>
    <button class="btn btn-y" style="margin-top:12px" onclick="addPlayer()">Добавить</button>
  </div>
  <div class="space-y">${list||'<p style="color:var(--sub);font-size:14px">Игроков ещё нет</p>'}</div>`);
}
async function addPlayer(){const n=v('p-nick');if(!n)return;const{error}=await sb.from('players').insert({nickname:n,age:vn('p-age')});if(dbErr(error,'добавление игрока'))return;toast('Игрок добавлен');pgPlayers();}
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
    <h3>Призовые</h3>
    <div style="display:flex;align-items:flex-end;gap:10px">
      <div><label>Сумма ($)</label><input id="r-prize" type="number" min="0" placeholder="0" style="width:140px" value="${player.prize??''}"></div>
      <button class="btn btn-y" onclick="savePrize('${pid}')">Сохранить</button>
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

    <div id="ms-picker" style="display:none;background:#0d0f18;border:2px solid var(--accent);
      border-radius:8px;padding:12px;margin-bottom:14px">
      <div style="font-size:12px;color:var(--sub);margin-bottom:8px">Конста для <b id="ms-cname"></b>:</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="ms-btns"></div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:8px">${charGrid}</div>
  </div>`);
}

function charPickClick(cid){
  const c=D.chars.find(x=>x.id===cid);if(!c)return;
  const already=_RS.find(r=>r.character_id===cid);
  if(already){
    openMsPicker(cid,c.name);
    return;
  }
  const defaultMs=c.rarity==='S'?0:6;
  _RS.push({character_id:cid,mindscape:defaultMs});
  renderSelected();
}

function openMsPicker(cid,cname){
  document.getElementById('ms-cname').textContent=cname;
  document.getElementById('ms-btns').innerHTML=[0,1,2,3,4,5,6].map(ms=>
    `<button class="btn btn-g" style="padding:5px 14px;font-size:13px" onclick="setMindscape('${cid}',${ms})">М${ms}</button>`
  ).join('');
  document.getElementById('ms-picker').style.display='block';
}

function setMindscape(cid,ms){
  const entry=_RS.find(r=>r.character_id===cid);
  if(entry)entry.mindscape=ms;
  document.getElementById('ms-picker').style.display='none';
  renderSelected();
}

function addToRoster(cid,ms){
  _RS=_RS.filter(r=>r.character_id!==cid);
  _RS.push({character_id:cid,mindscape:ms});
  document.getElementById('ms-picker').style.display='none';
  renderSelected();
}

function removeFromRoster(cid){
  _RS=_RS.filter(r=>r.character_id!==cid);
  if(document.getElementById('ms-picker').style.display!=='none'){
    const shown=document.getElementById('ms-cname').textContent;
    const c=D.chars.find(x=>x.id===cid);
    if(c&&c.name===shown)document.getElementById('ms-picker').style.display='none';
  }
  renderSelected();
}

function renderSelected(){
  const el=document.getElementById('r-selected');if(!el)return;
  if(!_RS.length){el.innerHTML='<span style="color:var(--sub);font-size:13px;align-self:center">Ростер пуст</span>';return;}
  el.innerHTML=_RS.map(r=>{
    const c=D.chars.find(x=>x.id===r.character_id);if(!c)return'';
    return`<div style="display:flex;align-items:center;gap:5px;background:#12141d;border:1px solid var(--border);border-radius:6px;padding:5px 10px;cursor:pointer"
      onclick="openMsPicker('${r.character_id}','${c.name.replace(/'/g,"\\'")}')">
      <span style="width:8px;height:8px;border-radius:50%;background:${RC[c.role]||'#7b7f96'}"></span>
      <span style="font-size:13px;font-weight:600">${c.name}</span>
      <span class="ms-tag">М${r.mindscape}</span>
      <button onclick="event.stopPropagation();removeFromRoster('${r.character_id}')" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:16px;line-height:1;margin-left:2px;padding:0">×</button>
    </div>`;
  }).join('');
}

async function loadTourRoster(pid){
  const tourId=v('r-tour');if(!tourId)return;
  const{data}=await sb.from('player_rosters').select('*').eq('tournament_id',tourId).eq('player_id',pid);
  _RS=(data||[]).map(r=>({character_id:r.character_id,mindscape:r.mindscape}));
  renderSelected();
}

async function savePrize(pid){
  const val=document.getElementById('r-prize')?.value;
  if(val===''||val==null)return toast('Введи сумму','err');
  const{error}=await sb.from('players').update({prize:+val}).eq('id',pid);
  if(dbErr(error,'сохранение призовых'))return;
  await refreshData();
  toast('Призовые сохранены');
}

async function saveRoster(pid){
  const tourId=v('r-tour');if(!tourId)return toast('Выбери турнир','err');
  const{error:dErr}=await sb.from('player_rosters').delete().match({tournament_id:tourId,player_id:pid});
  if(dbErr(dErr,'очистка ростера'))return;
  if(_RS.length){
    const rows=_RS.map(r=>({tournament_id:tourId,player_id:pid,character_id:r.character_id,mindscape:r.mindscape}));
    const{error}=await sb.from('player_rosters').insert(rows);
    if(dbErr(error,'сохранение ростера'))return;
  }
  toast(`Ростер сохранён: ${_RS.length} персонажей`);
}
