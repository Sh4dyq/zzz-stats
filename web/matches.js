// matches.js — встречи (Bo2) и матчи

// Шаблон драфта: 6 банов · 12 пиков (18 слотов)
// Порядок: Б1 Б2 Б2 Б1 | П1 П2 П2 П1 | П1 П2 П2 П1 | Б1 Б2 | П2 П1 П1 П2
const DRAFT_TEMPLATE=(fp,dbl)=>[
  {n:1,pid:fp,type:'ban'},{n:2,pid:dbl,type:'ban'},{n:3,pid:dbl,type:'ban'},{n:4,pid:fp,type:'ban'},
  {n:5,pid:fp,type:'pick'},{n:6,pid:dbl,type:'pick'},{n:7,pid:dbl,type:'pick'},{n:8,pid:fp,type:'pick'},
  {n:9,pid:fp,type:'pick'},{n:10,pid:dbl,type:'pick'},{n:11,pid:dbl,type:'pick'},{n:12,pid:fp,type:'pick'},
  {n:13,pid:fp,type:'ban'},{n:14,pid:dbl,type:'ban'},{n:15,pid:dbl,type:'pick'},{n:16,pid:fp,type:'pick'},
  {n:17,pid:fp,type:'pick'},{n:18,pid:dbl,type:'pick'},
];

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

  const template=DRAFT_TEMPLATE(fpId,dblId);

  const pSec=s=>s?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:'';
  const fpTimer=pSec(fpId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const dblTimer=pSec(dblId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const fpR=fpId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);
  const dblR=dblId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);

  document.getElementById('page-title').textContent=`Матч ${num} — ${fp?.nickname} (фп) vs ${dbl?.nickname}`;

  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('matches')">← Назад к встречам</button>

  <div class="card" style="margin-bottom:12px">
    <h3>Импорт драфта по ссылке</h3>
    <div style="display:flex;gap:8px;align-items:flex-end">
      <div style="flex:1"><label>Ссылка shiyu.darte.gg (draft_id + session_key)</label>
        <input id="draft-link" type="text" placeholder="https://shiyu.darte.gg/draft?draft_id=…&session_key=…"></div>
      <button class="btn btn-y" onclick="importDraftFromLink()">Загрузить</button>
    </div>
    <div id="draft-import-status" style="font-size:12px;color:var(--sub);margin-top:8px"></div>
    <div style="font-size:11px;color:var(--sub);margin-top:4px">player0 (ходит первым) → фп/левая колонка. Проверь имена в статусе и сохрани вручную.</div>
  </div>

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
    <h3 style="margin-bottom:14px">Драфт</h3>
    ${renderDraftBoard(template,fpId,dblId,fp?.nickname,dbl?.nickname,match)}
  </div>

  ${renderPickMeta(template,fpId,dblId,fp?.nickname,dbl?.nickname,match)}

  <button class="btn btn-y" style="font-size:15px;padding:10px 28px" onclick="saveMatch('${encId}','${num}','${p1Id}','${p2Id}','${fpId}','${mid}')">
    Сохранить матч
  </button>`);
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

    const cell=isBan
      ?`<div style="display:flex;align-items:center;gap:3px;padding:2px 0">
          <select class="draft-char" data-slot="${slot.n}" data-type="ban" data-pid="${slot.pid}"
            style="flex:1;min-width:110px;font-size:12px;padding:4px 6px">
            <option value="">—</option>${setSel(charOpts,ex.character_id)}
          </select>
        </div>`
      :`<div style="display:flex;align-items:center;gap:3px;padding:2px 0">
          <select class="draft-char" data-slot="${slot.n}" data-type="pick" data-pid="${slot.pid}" onchange="draftCharChanged(this)"
            style="flex:1;min-width:110px;font-size:12px;padding:4px 6px">
            <option value="">—</option>${setSel(charOpts,ex.character_id)}
          </select>
          <select class="draft-ms sm-sel" data-slot="${slot.n}" style="font-size:12px;padding:3px 5px">${msOpts.replace(`value="${ex.mindscape||0}"`,`value="${ex.mindscape||0}" selected`)}</select>
        </div>`;
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

  const fpSlots=slots.filter(s=>s.type==='pick'&&s.pid===fpId);
  const dblSlots=slots.filter(s=>s.type==='pick'&&s.pid===dblId);
  if(!fpSlots.length&&!dblSlots.length)return'';

  // первые 3 пика игрока = Team 1, следующие 3 = Team 2
  const teamLabel=(idx)=>idx<3?'T1':'T2';
  const teamColor=(idx)=>idx<3?'#60a5fa':'#f472b6';

  const makeCol=(playerSlots)=>playerSlots.map((slot,i)=>{
    const ex=pickMap[slot.n]||{};
    const showDivider=i===3;
    const divider=showDivider?`<div style="font-size:10px;font-weight:600;letter-spacing:.06em;color:${teamColor(i)};padding:6px 0 2px">Team 2</div>`:'';
    return`${divider}<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
      <span style="font-size:10px;font-weight:700;color:${teamColor(i)};min-width:14px">${teamLabel(i)}</span>
      <span style="font-size:11px;color:var(--sub);min-width:18px">№${slot.n}</span>
      <label class="cb-label" style="font-size:12px">
        <input type="checkbox" class="draft-sig" data-slot="${slot.n}" ${ex.has_signature?'checked':''}>sig
      </label>
    </div>`;
  }).join('');

  const fpT1label=`<div style="font-size:10px;font-weight:600;letter-spacing:.06em;color:${teamColor(0)};padding:0 0 2px">Team 1</div>`;
  const dblT1label=`<div style="font-size:10px;font-weight:600;letter-spacing:.06em;color:${teamColor(0)};padding:0 0 2px">Team 1</div>`;

  return`<div class="card" style="margin-bottom:16px">
    <h3 style="margin-bottom:12px">Половины и сигнатуры</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">
      <div>
        <div style="text-align:center;font-size:13px;font-weight:600;color:var(--accent);padding:4px 0;border-bottom:1px solid var(--border);margin-bottom:6px">
          ${fpName||'ФП'} <span style="color:var(--sub);font-weight:400;font-size:11px">(фп)</span>
        </div>
        ${fpT1label}${makeCol(fpSlots)}
      </div>
      <div>
        <div style="text-align:center;font-size:13px;font-weight:600;color:var(--accent);padding:4px 0;border-bottom:1px solid var(--border);margin-bottom:6px">
          ${dblName||'Дабл'}
        </div>
        ${dblT1label}${makeCol(dblSlots)}
      </div>
    </div>
  </div>`;
}

function draftCharChanged(el){
  const slot=el.dataset.slot;
  const char=D.chars.find(c=>c.id===el.value);
  const msEl=document.querySelector(`.draft-ms[data-slot="${slot}"]`);
  if(msEl&&char?.rarity==='A')msEl.value='6';
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
  // team_slot вычисляем по позиции пика среди пиков этого игрока: первые 3 → T1, следующие 3 → T2
  const template=DRAFT_TEMPLATE(fpId,dblId);
  const fpPickOrder=template.filter(s=>s.type==='pick'&&s.pid===fpId).map(s=>s.n);
  const dblPickOrder=template.filter(s=>s.type==='pick'&&s.pid===dblId).map(s=>s.n);
  const teamSlotFor=(pid,slot)=>{
    const order=pid===fpId?fpPickOrder:dblPickOrder;
    const idx=order.indexOf(slot);
    return idx<3?1:2;
  };

  const bans=[],picks=[];
  document.querySelectorAll('.draft-char').forEach(el=>{
    if(!el.value)return;
    const slot=+el.dataset.slot,type=el.dataset.type,pid=el.dataset.pid;
    if(type==='ban'){
      bans.push({match_id:mid,player_id:pid,character_id:el.value,ban_order:slot});
    }else{
      const ms=+document.querySelector(`.draft-ms[data-slot="${slot}"]`)?.value||0;
      const sig=document.querySelector(`.draft-sig[data-slot="${slot}"]`)?.checked||false;
      const team=teamSlotFor(pid,slot);
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
