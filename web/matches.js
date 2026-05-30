// matches.js — встречи (Bo2) и матчи

async function pgMatches(){
  const{data:encs}=await sb.from('encounters').select('*').order('created_at',{ascending:false});
  const{data:ms}=encs?.length?await sb.from('matches').select('*').in('encounter_id',encs.map(e=>e.id)):{data:[]};
  const mByEnc={};(ms||[]).forEach(m=>{if(!mByEnc[m.encounter_id])mByEnc[m.encounter_id]=[];mByEnc[m.encounter_id].push(m);});
  const tourMap={};D.tours.forEach(t=>tourMap[t.id]=t);
  const plMap={};D.players.forEach(p=>plMap[p.id]=p);

  const list=(encs||[]).map(e=>{
    const t=tourMap[e.tournament_id],p1=plMap[e.player1_id],p2=plMap[e.player2_id],win=plMap[e.winner_id];
    const ems=mByEnc[e.id]||[];
    const m1done=ems.find(m=>m.match_number===1)?.winner_id||ems.find(m=>m.match_number===1)?.is_draw;
    const m2done=ems.find(m=>m.match_number===2)?.winner_id||ems.find(m=>m.match_number===2)?.is_draw;
    return`<div class="card">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <div><span style="font-weight:600">${p1?.nickname||'?'}</span><span style="color:var(--sub);margin:0 8px">vs</span><span style="font-weight:600">${p2?.nickname||'?'}</span></div>
        <span style="font-size:12px;color:var(--sub)">${t?.name||'?'}</span>
      </div>
      ${win?`<div style="font-size:12px;margin-bottom:8px">Победитель встречи: <span style="color:var(--accent);font-weight:600">${win.nickname}</span></div>`:''}
      <div style="display:flex;gap:8px">
        <button class="btn ${m1done?'btn-g':'btn-y'}" style="font-size:12px;padding:5px 14px" onclick="openMatch('${e.id}',1,'${e.player1_id}','${e.player2_id}')">
          ${m1done?'✓':''} Матч 1</button>
        <button class="btn ${m2done?'btn-g':'btn-y'}" style="font-size:12px;padding:5px 14px" onclick="openMatch('${e.id}',2,'${e.player1_id}','${e.player2_id}')">
          ${m2done?'✓':''} Матч 2</button>
        <button class="btn-r" style="margin-left:auto" onclick="delEnc('${e.id}')">Удалить встречу</button>
      </div>
    </div>`;
  }).join('');

  const pOpts=D.players.map(p=>`<option value="${p.id}">${p.nickname}</option>`).join('');
  html(`<div class="card" style="margin-bottom:16px">
    <h3>Новая встреча (Bo2)</h3>
    <div class="grid2" style="margin-bottom:12px">
      <div><label>Турнир</label>${sel('e-tour',D.tours,x=>x.id,x=>x.name)}</div>
      <div><label>Игрок 1 (фп в матче 1)</label><select id="e-p1">${pOpts}</select></div>
      <div><label>Игрок 2 (фп в матче 2)</label><select id="e-p2">${pOpts}</select></div>
    </div>
    <button class="btn btn-y" onclick="addEnc()">Создать встречу</button>
  </div>
  <div class="space-y">${list||'<p style="color:var(--sub);font-size:14px">Встреч ещё нет</p>'}</div>`);
}

async function addEnc(){
  const t=v('e-tour'),p1=v('e-p1'),p2=v('e-p2');
  if(!t)return toast('Выбери турнир','err');
  if(p1===p2)return toast('Выбери разных игроков','err');
  const{error}=await sb.from('encounters').insert({tournament_id:t,stage:v('e-stage'),player1_id:p1,player2_id:p2});
  if(dbErr(error,'создание встречи'))return;
  toast('Встреча создана');pgMatches();
}
async function delEnc(id){if(!confirm('Удалить встречу и все матчи?'))return;const{error}=await sb.from('encounters').delete().eq('id',id);if(dbErr(error,'удаление встречи'))return;pgMatches();}

async function openMatch(encId,num,p1Id,p2Id){
  const fpId=num===1?p1Id:p2Id;
  const dblId=num===1?p2Id:p1Id;
  const fp=D.players.find(p=>p.id===fpId),dbl=D.players.find(p=>p.id===dblId);
  const{data:match}=await sb.from('matches').select('*,picks:match_picks(*),bans:match_bans(*)').eq('encounter_id',encId).eq('match_number',num).maybeSingle();
  const mid=match?.id||'';

  const charOpts=D.chars.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const pSec=s=>s?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:'';

  const fpTimer=pSec(fpId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const dblTimer=pSec(dblId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const fpR=fpId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);
  const dblR=dblId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);

  document.getElementById('page-title').textContent=`Матч ${num} — ${fp?.nickname} (фп) vs ${dbl?.nickname}`;

  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('matches')">← Назад к встречам</button>

  <div class="card" style="margin-bottom:12px">
    <h3>Результат матча</h3>
    <div class="grid2" style="margin-bottom:12px">
      <div>
        <label>${fp?.nickname} (фп)</label>
        <div style="display:flex;gap:8px">
          <div style="flex:1"><label>Таймер (м:сс)</label><input id="t1" type="text" value="${fpTimer}" placeholder="3:28"></div>
          <div><label>Рестарты</label><input id="r1" type="number" value="${fpR}" min="0" style="width:80px"></div>
        </div>
      </div>
      <div>
        <label>${dbl?.nickname}</label>
        <div style="display:flex;gap:8px">
          <div style="flex:1"><label>Таймер (м:сс)</label><input id="t2" type="text" value="${dblTimer}" placeholder="3:45"></div>
          <div><label>Рестарты</label><input id="r2" type="number" value="${dblR}" min="0" style="width:80px"></div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:16px;align-items:center">
      <label class="cb-label"><input type="checkbox" id="m-draw" ${match?.is_draw?'checked':''}>Ничья</label>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="display:inline;margin:0;color:var(--sub)">Победитель (если не авто):</label>
        <select id="m-winner" style="width:auto">
          <option value="">— авто по таймеру —</option>
          <option value="${fpId}" ${match?.winner_id===fpId?'selected':''}>${fp?.nickname}</option>
          <option value="${dblId}" ${match?.winner_id===dblId?'selected':''}>${dbl?.nickname}</option>
        </select>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:12px">
    <h3>Баны</h3>
    <div id="bans-list" class="space-y" style="margin-bottom:10px">
      ${(match?.bans||[]).map(b=>`<div class="ban-row" data-player="${b.player_id}">
        <span style="font-size:12px;color:var(--sub);min-width:80px">${b.player_id===fpId?fp?.nickname:dbl?.nickname}</span>
        <select class="ban-char" style="flex:1"><option value="">—</option>${charOpts.replace(`value="${b.character_id}"`,`value="${b.character_id}" selected`)}</select>
        <button class="btn-r" onclick="this.closest('.ban-row').remove()">✕</button>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g" onclick="addBanRow('${fpId}','${fp?.nickname}','${charOpts.replace(/'/g,"&apos;")}')">+ Бан ${fp?.nickname}</button>
      <button class="btn btn-g" onclick="addBanRow('${dblId}','${dbl?.nickname}','${charOpts.replace(/'/g,"&apos;")}')">+ Бан ${dbl?.nickname}</button>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h3>Пики</h3>
    <h4>${fp?.nickname} <span style="color:var(--sub);font-weight:400;font-size:12px">(фп в этом матче)</span></h4>
    <div id="picks-fp" class="space-y" style="margin-bottom:10px">
      ${(match?.picks||[]).filter(p=>p.player_id===fpId).map(p=>pickRowHTML(fpId,charOpts,p)).join('')}
    </div>
    <button class="btn btn-g" onclick="addPickRow('picks-fp','${fpId}','${charOpts.replace(/'/g,"&apos;")}')">+ Пик</button>

    <h4 style="margin-top:20px">${dbl?.nickname}</h4>
    <div id="picks-dbl" class="space-y" style="margin-bottom:10px">
      ${(match?.picks||[]).filter(p=>p.player_id===dblId).map(p=>pickRowHTML(dblId,charOpts,p)).join('')}
    </div>
    <button class="btn btn-g" onclick="addPickRow('picks-dbl','${dblId}','${charOpts.replace(/'/g,"&apos;")}')">+ Пик</button>
  </div>

  <button class="btn btn-y" style="font-size:15px;padding:10px 28px" onclick="saveMatch('${encId}','${num}','${p1Id}','${p2Id}','${fpId}','${mid}')">
    Сохранить матч
  </button>`);
}

function pickRowHTML(playerId,charOpts,existing={}){
  return`<div class="pick-row" data-player="${playerId}">
    <select class="pr-char" style="flex:1"><option value="">— персонаж —</option>${charOpts.replace(`value="${existing.character_id||''}"`,`value="${existing.character_id||''}" selected`)}</select>
    <select class="pr-ms sm-sel">${msOpts.replace(`value="${existing.mindscape||0}"`,`value="${existing.mindscape||0}" selected`)}</select>
    <select class="pr-team sm-sel">
      <option value="1" ${(existing.team_slot||1)===1?'selected':''}>Team 1</option>
      <option value="2" ${existing.team_slot===2?'selected':''}>Team 2</option>
    </select>
    <label class="cb-label"><input type="checkbox" class="pr-sig" ${existing.has_signature?'checked':''}>сигна</label>
    <label class="cb-label"><input type="checkbox" class="pr-fp" ${existing.is_fp?'checked':''}>фп</label>
    <label class="cb-label"><input type="checkbox" class="pr-dbl" ${existing.is_double?'checked':''}>дабл</label>
    <button class="btn-r" onclick="this.closest('.pick-row').remove()">✕</button>
  </div>`;
}

function addPickRow(containerId,playerId,charOpts){
  const div=document.createElement('div');
  div.innerHTML=pickRowHTML(playerId,charOpts);
  document.getElementById(containerId).appendChild(div.firstElementChild);
}

function addBanRow(playerId,playerName,charOpts){
  const div=document.createElement('div');
  div.className='ban-row';div.dataset.player=playerId;
  div.innerHTML=`<span style="font-size:12px;color:var(--sub);min-width:80px">${playerName}</span>
    <select class="ban-char" style="flex:1"><option value="">—</option>${charOpts}</select>
    <button class="btn-r" onclick="this.closest('.ban-row').remove()">✕</button>`;
  document.getElementById('bans-list').appendChild(div);
}

function parseSec(s){if(!s)return null;const p=s.split(':').map(Number);if(p.length!==2||isNaN(p[0])||isNaN(p[1]))return null;return p[0]*60+p[1];}

async function saveMatch(encId,num,p1Id,p2Id,fpId,existingId){
  const isDraw=document.getElementById('m-draw').checked;
  const t1=parseSec(v('t1')),t2=parseSec(v('t2'));
  const r1=+document.getElementById('r1')?.value||0;
  const r2=+document.getElementById('r2')?.value||0;
  const dblId=fpId===p1Id?p2Id:p1Id;

  const p1Timer=fpId===p1Id?t1:t2;
  const p2Timer=fpId===p1Id?t2:t1;
  const p1R=fpId===p1Id?r1:r2;
  const p2R=fpId===p1Id?r2:r1;

  let winnerId=v('m-winner');
  if(!winnerId&&!isDraw&&t1!=null&&t2!=null){
    winnerId=t1<=t2?fpId:dblId;
  }

  const mData={encounter_id:encId,match_number:+num,fp_player_id:fpId,is_draw:isDraw,
    winner_id:isDraw?null:(winnerId||null),
    player1_timer_sec:p1Timer,player2_timer_sec:p2Timer,
    player1_restarts:p1R,player2_restarts:p2R};

  let mid=existingId;
  if(mid){const{error}=await sb.from('matches').update(mData).eq('id',mid);if(dbErr(error,'обновление матча'))return;}
  else{const{data,error}=await sb.from('matches').insert(mData).select().single();if(dbErr(error,'создание матча'))return;mid=data?.id;}
  if(!mid)return toast('Ошибка сохранения матча','err');

  {const{error}=await sb.from('match_bans').delete().eq('match_id',mid);if(dbErr(error,'очистка банов'))return;}
  const bans=[...document.querySelectorAll('.ban-row')].map((row,i)=>({
    match_id:mid,player_id:row.dataset.player,
    character_id:row.querySelector('.ban-char')?.value,ban_order:i+1
  })).filter(b=>b.character_id);
  if(bans.length){const{error}=await sb.from('match_bans').insert(bans);if(dbErr(error,'сохранение банов'))return;}

  {const{error}=await sb.from('match_picks').delete().eq('match_id',mid);if(dbErr(error,'очистка пиков'))return;}
  const picks=[...document.querySelectorAll('#picks-fp .pick-row, #picks-dbl .pick-row')].map((row,i)=>({
    match_id:mid,player_id:row.dataset.player,
    character_id:row.querySelector('.pr-char')?.value,
    mindscape:+row.querySelector('.pr-ms')?.value||0,
    has_signature:row.querySelector('.pr-sig')?.checked||false,
    team_slot:+row.querySelector('.pr-team')?.value||1,
    pick_order:i+1,
    is_fp:row.querySelector('.pr-fp')?.checked||false,
    is_double:row.querySelector('.pr-dbl')?.checked||false,
  })).filter(p=>p.character_id);
  if(picks.length){const{error}=await sb.from('match_picks').insert(picks);if(dbErr(error,'сохранение пиков'))return;}

  const{data:allMs}=await sb.from('matches').select('*').eq('encounter_id',encId);
  if(allMs&&allMs.length>=2){
    let p1T=0,p2T=0;
    allMs.forEach(m=>{p1T+=m.player1_timer_sec||0;p2T+=m.player2_timer_sec||0;});
    const encWin=p1T<=p2T?p1Id:p2Id;
    const{error}=await sb.from('encounters').update({winner_id:encWin}).eq('id',encId);
    if(dbErr(error,'обновление победителя встречи'))return;
  }

  toast('Матч сохранён!');
  setTimeout(()=>go('matches'),800);
}
