// matches.js — встречи (Bo2) и матчи

// Форматы драфта: ключ → {label, gen(fpId,dblId) → [{n, pid, type}]}
const DRAFT_FORMATS={
  '2b7p':{label:'6 банов · 12 пиков (18 слотов)',gen:(fp,dbl)=>[
    {n:1,pid:fp,type:'ban'},{n:2,pid:dbl,type:'ban'},{n:3,pid:dbl,type:'ban'},{n:4,pid:fp,type:'ban'},
    {n:5,pid:fp,type:'pick'},{n:6,pid:dbl,type:'pick'},{n:7,pid:dbl,type:'pick'},{n:8,pid:fp,type:'pick'},
    {n:9,pid:fp,type:'pick'},{n:10,pid:dbl,type:'pick'},{n:11,pid:dbl,type:'pick'},{n:12,pid:fp,type:'pick'},
    {n:13,pid:fp,type:'ban'},{n:14,pid:dbl,type:'ban'},{n:15,pid:dbl,type:'pick'},{n:16,pid:fp,type:'pick'},
    {n:17,pid:fp,type:'pick'},{n:18,pid:dbl,type:'pick'},
  ]},
  '2b3p':{label:'2 бана · 3 пика (10 слотов)',gen:(fp,dbl)=>[
    {n:1,pid:fp,type:'ban'},{n:2,pid:dbl,type:'ban'},{n:3,pid:dbl,type:'ban'},{n:4,pid:fp,type:'ban'},
    {n:5,pid:fp,type:'pick'},{n:6,pid:dbl,type:'pick'},{n:7,pid:dbl,type:'pick'},{n:8,pid:fp,type:'pick'},
    {n:9,pid:fp,type:'pick'},{n:10,pid:dbl,type:'pick'},
  ]},
  '1b3p':{label:'1 бан · 3 пика (8 слотов)',gen:(fp,dbl)=>[
    {n:1,pid:fp,type:'ban'},{n:2,pid:dbl,type:'ban'},
    {n:3,pid:fp,type:'pick'},{n:4,pid:dbl,type:'pick'},{n:5,pid:dbl,type:'pick'},{n:6,pid:fp,type:'pick'},
    {n:7,pid:fp,type:'pick'},{n:8,pid:dbl,type:'pick'},
  ]},
};

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
  const{error}=await sb.from('encounters').insert({tournament_id:t,player1_id:p1,player2_id:p2});
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

  const fmt=localStorage.getItem('zzz_dfmt')||'2b7p';
  const template=(DRAFT_FORMATS[fmt]||DRAFT_FORMATS['2b7p']).gen(fpId,dblId);

  const pSec=s=>s?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:'';
  const fpTimer=pSec(fpId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const dblTimer=pSec(dblId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const fpR=fpId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);
  const dblR=dblId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);

  document.getElementById('page-title').textContent=`Матч ${num} — ${fp?.nickname} (фп) vs ${dbl?.nickname}`;

  const fmtOpts=Object.entries(DRAFT_FORMATS).map(([k,f])=>`<option value="${k}" ${k===fmt?'selected':''}>${f.label}</option>`).join('');

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

  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Драфт</h3>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="display:inline;margin:0">Формат:</label>
        <select style="width:auto;font-size:13px" onchange="changeDraftFmt(this.value,'${encId}',${num},'${p1Id}','${p2Id}')">${fmtOpts}</select>
      </div>
    </div>
    ${renderDraftBoard(template,fpId,dblId,fp?.nickname,dbl?.nickname,match)}
  </div>

  ${renderPickMeta(template,fpId,dblId,fp?.nickname,dbl?.nickname,match)}

  <button class="btn btn-y" style="font-size:15px;padding:10px 28px" onclick="saveMatch('${encId}','${num}','${p1Id}','${p2Id}','${fpId}','${mid}')">
    Сохранить матч
  </button>`);
}

function changeDraftFmt(fmt,encId,num,p1Id,p2Id){
  localStorage.setItem('zzz_dfmt',fmt);
  openMatch(encId,num,p1Id,p2Id);
}

function renderDraftBoard(slots,fpId,dblId,fpName,dblName,match){
  const banMap={},pickMap={};
  (match?.bans||[]).forEach(b=>banMap[b.ban_order]=b);
  (match?.picks||[]).forEach(p=>pickMap[p.pick_order]=p);

  const charOpts=D.chars.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const setSel=(opts,val)=>val?opts.replace(`value="${val}"`,`value="${val}" selected`):opts;

  const rows=slots.map(slot=>{
    const isFp=slot.pid===fpId;
    const isBan=slot.type==='ban';
    const ex=isBan?(banMap[slot.n]||{}):(pickMap[slot.n]||{});

    const charSel=`<select class="draft-char" data-slot="${slot.n}" data-type="${slot.type}" data-pid="${slot.pid}"
      style="flex:1;min-width:110px;font-size:12px;padding:4px 6px">
      <option value="">—</option>${setSel(charOpts,ex.character_id)}
    </select>`;

    const pickExtras=isBan?'':`
      <select class="draft-ms sm-sel" data-slot="${slot.n}" style="font-size:12px;padding:3px 5px">${msOpts.replace(`value="${ex.mindscape||0}"`,`value="${ex.mindscape||0}" selected`)}</select>`;

    const cell=`<div style="display:flex;align-items:center;gap:3px;padding:2px 0">${charSel}${pickExtras}</div>`;
    const empty=`<div></div>`;
    const numCell=`<div style="text-align:center;padding:0 4px">
      <div style="font-size:15px;font-weight:700;line-height:1.1;color:${isBan?'#f87171':'var(--accent)'}">${slot.n}</div>
      <div style="font-size:9px;letter-spacing:.04em;color:${isBan?'#f87171':'var(--sub)'}">${isBan?'БАН':'ПИК'}</div>
    </div>`;

    return isFp
      ?`${cell}${numCell}${empty}`
      :`${empty}${numCell}${cell}`;
  }).join('');

  return`<div style="display:grid;grid-template-columns:1fr 44px 1fr;align-items:center;row-gap:3px">
    <div style="text-align:center;font-size:13px;font-weight:600;color:var(--accent);padding:4px 0">${fpName||'ФП'} <span style="color:var(--sub);font-weight:400;font-size:11px">(фп)</span></div>
    <div></div>
    <div style="text-align:center;font-size:13px;font-weight:600;color:var(--accent);padding:4px 0">${dblName||'Дабл'}</div>
    ${rows}
  </div>`;
}

function renderPickMeta(slots,fpId,dblId,fpName,dblName,match){
  const pickMap={};
  (match?.picks||[]).forEach(p=>pickMap[p.pick_order]=p);

  const pickSlots=slots.filter(s=>s.type==='pick');
  if(!pickSlots.length)return'';

  const rows=pickSlots.map(slot=>{
    const ex=pickMap[slot.n]||{};
    const isFp=slot.pid===fpId;
    const playerName=isFp?(fpName||'ФП'):(dblName||'Дабл');
    const playerLabel=isFp?`${playerName} <span style="color:var(--sub);font-size:10px">(фп)</span>`:playerName;
    return`<tr>
      <td style="padding:4px 8px;font-size:12px;color:var(--sub);text-align:center">${slot.n}</td>
      <td style="padding:4px 8px;font-size:12px">${playerLabel}</td>
      <td style="padding:4px 8px;text-align:center">
        <select class="draft-team sm-sel" data-slot="${slot.n}" style="font-size:12px;padding:3px 8px">
          <option value="1" ${(ex.team_slot||1)===1?'selected':''}>Team 1</option>
          <option value="2" ${ex.team_slot===2?'selected':''}>Team 2</option>
        </select>
      </td>
      <td style="padding:4px 8px;text-align:center">
        <label class="cb-label" style="font-size:12px;justify-content:center">
          <input type="checkbox" class="draft-sig" data-slot="${slot.n}" ${ex.has_signature?'checked':''}>Сигна
        </label>
      </td>
    </tr>`;
  }).join('');

  return`<div class="card" style="margin-bottom:16px">
    <h3 style="margin-bottom:12px">Половины и сигнатуры</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="padding:4px 8px;font-size:11px;color:var(--sub);text-align:center;font-weight:500">Пик №</th>
          <th style="padding:4px 8px;font-size:11px;color:var(--sub);text-align:left;font-weight:500">Игрок</th>
          <th style="padding:4px 8px;font-size:11px;color:var(--sub);text-align:center;font-weight:500">Половина</th>
          <th style="padding:4px 8px;font-size:11px;color:var(--sub);text-align:center;font-weight:500">Сигнатура</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
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
  if(!winnerId&&!isDraw&&t1!=null&&t2!=null){winnerId=t1<=t2?fpId:dblId;}

  const mData={encounter_id:encId,match_number:+num,fp_player_id:fpId,is_draw:isDraw,
    winner_id:isDraw?null:(winnerId||null),
    player1_timer_sec:p1Timer,player2_timer_sec:p2Timer,
    player1_restarts:p1R,player2_restarts:p2R};

  let mid=existingId;
  if(mid){const{error}=await sb.from('matches').update(mData).eq('id',mid);if(dbErr(error,'обновление матча'))return;}
  else{const{data,error}=await sb.from('matches').insert(mData).select().single();if(dbErr(error,'создание матча'))return;mid=data?.id;}
  if(!mid)return toast('Ошибка сохранения матча','err');

  // Собираем баны и пики из драфт-борда
  const bans=[],picks=[];
  document.querySelectorAll('.draft-char').forEach(el=>{
    if(!el.value)return;
    const slot=+el.dataset.slot,type=el.dataset.type,pid=el.dataset.pid;
    if(type==='ban'){
      bans.push({match_id:mid,player_id:pid,character_id:el.value,ban_order:slot});
    }else{
      const ms=+document.querySelector(`.draft-ms[data-slot="${slot}"]`)?.value||0;
      const team=+document.querySelector(`.draft-team[data-slot="${slot}"]`)?.value||1;
      const sig=document.querySelector(`.draft-sig[data-slot="${slot}"]`)?.checked||false;
      picks.push({match_id:mid,player_id:pid,character_id:el.value,
        mindscape:ms,team_slot:team,has_signature:sig,pick_order:slot,
        is_fp:pid===fpId,is_double:false});
    }
  });
  // Дабл-пик: один персонаж у обоих игроков
  const charCount={};
  picks.forEach(p=>charCount[p.character_id]=(charCount[p.character_id]||0)+1);
  picks.forEach(p=>p.is_double=charCount[p.character_id]>1);

  {const{error}=await sb.from('match_bans').delete().eq('match_id',mid);if(dbErr(error,'очистка банов'))return;}
  if(bans.length){const{error}=await sb.from('match_bans').insert(bans);if(dbErr(error,'сохранение банов'))return;}

  {const{error}=await sb.from('match_picks').delete().eq('match_id',mid);if(dbErr(error,'очистка пиков'))return;}
  if(picks.length){const{error}=await sb.from('match_picks').insert(picks);if(dbErr(error,'сохранение пиков'))return;}

  // Обновляем победителя встречи по суммарному таймеру
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
