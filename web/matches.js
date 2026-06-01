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

  const plDatalist=`<datalist id="pl-list">${D.players.map(p=>`<option value="${escapeHtml(p.nickname)}"></option>`).join('')}</datalist>`;
  html(`<div class="card" style="margin-bottom:16px">
    <h3>Новая встреча (Bo2)</h3>
    ${plDatalist}
    <div class="grid2" style="margin-bottom:12px">
      <div><label>Турнир</label>${sel('e-tour',D.tours,x=>x.id,x=>x.name)}</div>
      <div><label>Игрок 1 (фп в матче 1)</label><input id="e-p1" list="pl-list" placeholder="ник игрока — впишите или выберите"></div>
      <div><label>Игрок 2 (фп в матче 2)</label><input id="e-p2" list="pl-list" placeholder="ник игрока — впишите или выберите"></div>
    </div>
    <div style="font-size:11px;color:var(--sub);margin-bottom:8px">Если ник новый — игрок создастся автоматически.</div>
    <button class="btn btn-y" onclick="addEnc()">Создать встречу</button>
  </div>
  <div class="space-y">${list||'<p style="color:var(--sub);font-size:14px">Встреч ещё нет</p>'}</div>`);
}

// Ник → id игрока: ищет существующего (без учёта регистра) или создаёт нового.
async function resolvePlayerNick(nick){
  nick=(nick||'').trim();
  if(!nick)return null;
  const ex=D.players.find(p=>p.nickname.toLowerCase()===nick.toLowerCase());
  if(ex)return ex.id;
  const{data,error}=await sb.from('players').insert({nickname:nick}).select().single();
  if(error){dbErr(error,'создание игрока «'+nick+'»');return null;}
  D.players.push(data);
  return data.id;
}

async function addEnc(){
  const t=v('e-tour'),n1=v('e-p1'),n2=v('e-p2');
  if(!t)return toast('Выбери турнир','err');
  if(!n1||!n2)return toast('Впиши ники обоих игроков','err');
  if(n1.toLowerCase()===n2.toLowerCase())return toast('Игроки должны быть разными','err');
  const p1=await resolvePlayerNick(n1);if(!p1)return;
  const p2=await resolvePlayerNick(n2);if(!p2)return;
  if(p1===p2)return toast('Игроки должны быть разными','err');
  const{error}=await sb.from('encounters').insert({tournament_id:t,player1_id:p1,player2_id:p2});
  if(dbErr(error,'создание встречи'))return;
  toast('Встреча создана');pgMatches();
}
async function delEnc(id){if(!confirm('Удалить встречу и все матчи?'))return;const{error}=await sb.from('encounters').delete().eq('id',id);if(dbErr(error,'удаление встречи'))return;pgMatches();}

async function openMatch(encId,num,p1Id,p2Id){
  const fpId=num===1?p1Id:p2Id;
  const dblId=num===1?p2Id:p1Id;
  const fp=D.players.find(p=>p.id===fpId),dbl=D.players.find(p=>p.id===dblId);
  const{data:match}=window.DEV_PREVIEW
    ?{data:window.DEV_MATCH||null}
    :await sb.from('matches').select('*,picks:match_picks(*),bans:match_bans(*)').eq('encounter_id',encId).eq('match_number',num).maybeSingle();
  const mid=match?.id||'';

  const template=DRAFT_TEMPLATE(fpId,dblId);

  const pSec=s=>s?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:'';
  const fpTimer=pSec(fpId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const dblTimer=pSec(dblId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const fpR=fpId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);
  const dblR=dblId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);

  document.getElementById('page-title').textContent=`Матч ${num} — ${fp?.nickname} (фп) vs ${dbl?.nickname}`;

  const mlbl='font-size:11px;color:var(--sub);white-space:nowrap';
  const minp='padding:5px 8px;text-align:center;font-size:13px;margin:0';
  html(`<style>
    .mbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .mbar input,.mbar .btn{margin:0}
    .mres{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}
    .mres .side{display:flex;align-items:center;gap:6px}
    .mres .nm{font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:15px;text-transform:uppercase;letter-spacing:.02em;padding-right:.22em;flex-shrink:0}
    .mres .side{gap:7px;flex-shrink:0}
    .mres .div{width:1px;height:26px;background:var(--border)}
  </style>
  <div class="mbar">
    <button class="btn btn-g" style="padding:6px 12px;font-size:13px" onclick="go('matches')">← Встречи</button>
    <input id="draft-link" type="text" placeholder="ссылка shiyu.darte.gg (draft_id + session_key)…" style="flex:1;min-width:200px;padding:6px 10px;font-size:13px">
    <button class="btn btn-g" style="padding:6px 14px;font-size:13px" onclick="importDraftFromLink()">Импорт</button>
    <button class="btn btn-y" style="padding:6px 18px;font-size:13px" onclick="saveMatch('${encId}','${num}','${p1Id}','${p2Id}','${fpId}','${mid}')" style="padding:6px 18px;font-size:13px;white-space:nowrap">Сохранить матч</button>
  </div>
  <div id="draft-import-status" style="font-size:11px;color:var(--sub);min-height:13px;margin-bottom:10px"></div>

  <div class="card" style="padding:10px 14px;margin-bottom:12px">
    <div class="mres">
      <div class="side">
        <span class="nm" style="color:var(--accent)">${fp?.nickname}</span><span style="font-size:9px;color:var(--sub);letter-spacing:.1em">ФП</span>
        <span style="${mlbl}">таймер</span><input id="t1" type="text" value="${fpTimer}" placeholder="3:28" title="Итоговый таймер фп (м:сс)" style="width:72px;${minp};font-family:'JetBrains Mono',monospace">
        <span style="${mlbl}">рест.</span><input id="r1" type="number" value="${fpR}" min="0" title="Рестарты фп" style="width:52px;${minp}">
      </div>
      <span class="div"></span>
      <div class="side">
        <span class="nm">${dbl?.nickname}</span>
        <span style="${mlbl}">таймер</span><input id="t2" type="text" value="${dblTimer}" placeholder="3:45" title="Итоговый таймер (м:сс)" style="width:72px;${minp};font-family:'JetBrains Mono',monospace">
        <span style="${mlbl}">рест.</span><input id="r2" type="number" value="${dblR}" min="0" title="Рестарты" style="width:52px;${minp}">
      </div>
      <span style="flex:1;min-width:8px"></span>
      <label class="cb-label" style="font-size:13px"><input type="checkbox" id="m-draw" ${match?.is_draw?'checked':''}>Ничья</label>
      <div class="side">
        <span style="${mlbl}">победитель</span>
        <select id="m-winner" style="width:auto;padding:5px 8px;font-size:13px">
          <option value="">авто (таймер)</option>
          <option value="${fpId}" ${match?.winner_id===fpId?'selected':''}>${fp?.nickname}</option>
          <option value="${dblId}" ${match?.winner_id===dblId?'selected':''}>${dbl?.nickname}</option>
        </select>
      </div>
    </div>
  </div>

  <div class="card" style="padding:12px 14px">
    ${renderDraftBoard(template,fpId,dblId,fp?.nickname,dbl?.nickname,match)}
  </div>`);
}


// Сигнатурный амплификатор персонажа (по character_id).
function sigForChar(charId){return charId?D.sigs.find(s=>s.character_id===charId)||null:null;}

const DRAFT_CSS=`<style>
/* Драфт-борд в стиле shiyu: сетка-очередь — фп (слева, к центру) · PICKS · дабл (справа). */
.dboard{max-width:1100px;margin:0 auto}
.dgrid{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:stretch}
.dgcol{min-width:0}
.dgname{font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;text-transform:uppercase;font-size:20px;letter-spacing:.02em;color:var(--text);display:flex;align-items:baseline;gap:8px;margin-bottom:8px;min-width:0}
.dgname b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dgname.dbl{justify-content:flex-end;text-align:right}
.dgname .dtag{font-size:10px;font-style:normal;font-weight:700;letter-spacing:.1em;color:#fff;background:var(--grad);border-radius:3px;padding:1px 6px;flex-shrink:0}
.dgcells{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;align-content:start}
.dgmid{display:flex;align-items:center;justify-content:center;min-width:30px}
.dgmid-lbl{font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:14px;letter-spacing:.18em;color:var(--sub);white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg)}

/* универсальная ячейка драфта (бан=ч/б+рамка, пик=оверлеи минскейп/амп) */
.dcell{display:flex;flex-direction:column;gap:4px;min-width:0}
.dcell.empty{visibility:hidden}
.dcell .pk-thumb{position:relative;width:100%;aspect-ratio:1;border-radius:9px;overflow:hidden;background:#11141f;border:1px solid var(--border)}
.dcell .pk-thumb img,.dcell .pk-thumb .pic{width:100%!important;height:100%!important;border-radius:0!important;object-fit:cover;display:block}
.pk-num{position:absolute;top:3px;left:3px;z-index:3;min-width:18px;height:18px;padding:0 4px;border-radius:5px;background:rgba(8,8,12,.8);color:#fff;font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:13px;line-height:18px;text-align:center}
.dcell.ban .pk-thumb{border-color:#ef4444;box-shadow:inset 0 0 0 3px #ef4444}
.dcell.ban .pk-thumb img,.dcell.ban .pk-thumb .pic{filter:grayscale(1) brightness(.62)}
.dcell.ban .pk-num{background:#dc2626}

/* движок-амплификатор: бейдж снизу-слева (чекбокс + иконка) — клик переключает sig */
.pk-eng{position:absolute;left:3px;bottom:3px;z-index:3;display:flex;align-items:center;gap:2px;background:rgba(8,8,12,.82);border:1px solid #2a2d3a;border-radius:8px;padding:0px 3px;margin:0;cursor:pointer}
.pk-eng input[type=checkbox]{width:9px;height:9px;margin:0;accent-color:var(--accent);cursor:pointer;flex-shrink:0}
.pk-amp{display:inline-flex;align-items:center;line-height:0}
.pk-amp img,.pk-amp .pic{width:14px!important;height:14px!important;border-radius:3px!important;object-fit:contain;background:transparent!important}

/* минскейп: бейдж M0..M6 снизу-справа (нативный select без стрелки) */
.pk-ms{position:absolute;right:3px;bottom:3px;z-index:3;appearance:none;-webkit-appearance:none;background:rgba(8,8,12,.82);border:1px solid #2a2d3a;color:#fff;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;padding:2px 5px;width:auto;min-width:0;cursor:pointer;text-align:center;text-align-last:center}
.pk-ms:hover,.pk-ms:focus{border-color:var(--accent)}

/* селект персонажа под портретом */
.dcell .draft-char{width:100%;font-size:11px;padding:3px 6px;border-radius:5px}

@media(max-width:760px){
  .dgrid{grid-template-columns:1fr;gap:18px}
  .dgmid{display:none}
  .dgname.dbl{justify-content:flex-start;text-align:left}
}
</style>`;

// Раскладка очереди как на сайте (4 колонки, фп зеркалит к центру).
// Числа — это slot.n; null — пустая ячейка-распорка (чтобы последний пик
// встал ближе к центру, как в референсе). Слоты фп/дабл из DRAFT_TEMPLATE фиксированы.
const DRAFT_ORDER_FP =[8,5,4,1, 16,13,12,9, null,null,17,null];
const DRAFT_ORDER_DBL=[2,3,6,7, 10,11,14,15, null,18,null,null];

// Универсальная ячейка драфта. slot===null → пустая распорка.
// Бан: портрет ч/б + красная рамка + №. Пик: + минскейп M0..M6, чекбокс sig и картинка амплификатора.
function draftCellHtml(slot,banMap,pickMap,charOpts,setSel){
  if(!slot)return`<div class="dcell empty"></div>`;
  const isBan=slot.type==='ban';
  const ex=(isBan?banMap:pickMap)[slot.n]||{};
  const ch=D.chars.find(c=>c.id===ex.character_id)||null;
  let ov='';
  if(!isBan){
    const sig=sigForChar(ex.character_id);
    const ampOp=ex.has_signature?1:.3;
    ov=`<label class="pk-eng" title="Сигнатурный амплификатор">
        <input type="checkbox" class="draft-sig" data-slot="${slot.n}" onchange="draftSigChanged(this)" ${ex.has_signature?'checked':''}>
        <span class="pk-amp" data-ampslot="${slot.n}" style="opacity:${ampOp}">${sig?sigImg(sig,18):''}</span></label>
      <select class="draft-ms pk-ms" data-slot="${slot.n}" title="Минскейп">${setSel(msOpts,String(ex.mindscape||0))}</select>`;
  }
  return`<div class="dcell ${isBan?'ban':'pick'}">
    <div class="pk-thumb">
      <span class="pk-img" data-imgslot="${slot.n}">${iconChar(ch,isBan?64:88)}</span>
      <span class="pk-num">${slot.n}</span>
      ${ov}</div>
    <select class="draft-char" data-slot="${slot.n}" data-type="${slot.type}" data-pid="${slot.pid}" onchange="draftCharChanged(this)">
      <option value="">—</option>${setSel(charOpts,ex.character_id)}</select>
  </div>`;
}

// Борд в духе сайта: одна сетка-очередь, слоты в реальном порядке драфта,
// фп слева (зеркалит к центру) · PICKS · дабл справа. Все элементы редактируемы.
function renderDraftBoard(slots,fpId,dblId,fpName,dblName,match){
  const banMap={},pickMap={};
  (match?.bans||[]).forEach(b=>banMap[b.ban_order]=b);
  (match?.picks||[]).forEach(p=>pickMap[p.pick_order]=p);

  const charOpts=D.chars.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const setSel=(opts,val)=>val?opts.replace(`value="${val}"`,`value="${val}" selected`):opts;

  const byN={};slots.forEach(s=>byN[s.n]=s);
  const cells=order=>order.map(n=>draftCellHtml(n?byN[n]:null,banMap,pickMap,charOpts,setSel)).join('');

  return DRAFT_CSS+`<div class="dboard">
    <div class="dgrid">
      <div class="dgcol">
        <div class="dgname"><b>${fpName||'ФП'}</b><span class="dtag">ФП</span></div>
        <div class="dgcells">${cells(DRAFT_ORDER_FP)}</div>
      </div>
      <div class="dgmid"><span class="dgmid-lbl">PICKS</span></div>
      <div class="dgcol">
        <div class="dgname dbl"><b>${dblName||'Дабл'}</b></div>
        <div class="dgcells">${cells(DRAFT_ORDER_DBL)}</div>
      </div>
    </div>
  </div>`;
}

function draftCharChanged(el){
  const slot=el.dataset.slot;
  const char=D.chars.find(c=>c.id===el.value)||null;
  const msEl=document.querySelector(`.draft-ms[data-slot="${slot}"]`);
  if(msEl&&char?.rarity==='A')msEl.value='6';
  const img=document.querySelector(`.pk-img[data-imgslot="${slot}"]`);
  if(img)img.innerHTML=iconChar(char,48);
  const amp=document.querySelector(`.pk-amp[data-ampslot="${slot}"]`);
  if(amp){const sig=sigForChar(el.value);amp.innerHTML=sig?sigImg(sig,18):'';}
}

function draftSigChanged(cb){
  const amp=document.querySelector(`.pk-amp[data-ampslot="${cb.dataset.slot}"]`);
  if(amp)amp.style.opacity=cb.checked?1:.35;
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
