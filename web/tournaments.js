// tournaments.js — турниры и косты

const TOUR_STATUSES=[['live','🔴 Идёт сейчас'],['upcoming','🗓 Анонс'],['finished','✓ Завершён']];
async function pgTournaments(){
  const list=D.tours.map(t=>{
    const st=t.status||'finished';
    const statusSel=`<select onchange="setTourStatus('${t.id}',this.value)" title="Статус турнира. «Идёт сейчас» = текущий на главной и во вкладке статистики (только один турнир)" style="font-size:12px;padding:5px 8px">
      ${TOUR_STATUSES.map(([v,l])=>`<option value="${v}" ${st===v?'selected':''}>${l}</option>`).join('')}
    </select>`;
    return`<div class="row-item" draggable="true" data-id="${t.id}">
    <div style="display:flex;align-items:center;gap:10px">
      <span title="Перетащить для сортировки" style="cursor:grab;color:var(--sub);font-size:15px;user-select:none">⠿</span>
      <div>
        <div style="font-weight:600">${st==='live'?'<span style="color:var(--red)">●</span> ':''}${t.name}</div>
        <div style="font-size:12px;color:var(--sub)">${new Date(t.created_at).toLocaleDateString('ru')}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      ${statusSel}
      <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="renameTour('${t.id}','${t.name.replace(/'/g,"\\'")}')">✎</button>
      <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openCosts('${t.id}','${t.name.replace(/'/g,"\\'")}')">Косты</button>
      <button class="btn-r" onclick="delTour('${t.id}')">✕</button>
    </div>
  </div>`;}).join('');
  html(`<div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent)">
    <div style="font-size:13px;line-height:1.5">💡 <b>После турнира:</b> поставь ему статус <b>«✓ Завершён»</b>, а новому — <b>«🔴 Идёт сейчас»</b>. Этого достаточно — на главной и в статистике «текущим» автоматически станет live-турнир, а в блоке «Топ турнира» — последний завершённый. <span style="color:var(--sub)">SQL править больше не нужно.</span></div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <h3>Новый турнир</h3>
    <div class="grid2"><div><label>Название</label><input id="t-name" type="text" placeholder="Nexus Shiyu Proxy Rush 6"></div></div>
    <button class="btn btn-y" style="margin-top:12px" onclick="addTour()">Добавить</button>
  </div>
  <div class="space-y" id="tour-list">${list||'<p style="color:var(--sub);font-size:14px">Турниров ещё нет</p>'}</div>`);
  if(typeof enableReorder==='function')enableReorder(document.getElementById('tour-list'),'tournaments',pgTournaments);
}
async function addTour(){const n=v('t-name');if(!n)return;const{error}=await sb.from('tournaments').insert({name:n,status:'upcoming'});if(dbErr(error,'добавление турнира'))return;toast('Турнир добавлен (статус: Анонс)');await refreshData();pgTournaments();}
// Статус турнира. «live» эксклюзивен — снимаем live с остальных (на главной/в статистике
// «текущим» считается ровно один live-турнир). Колонка из sql/add_tournament_status.sql.
async function setTourStatus(id,status){
  if(status==='live'){
    for(const o of D.tours.filter(t=>t.id!==id&&t.status==='live')){
      const{error}=await sb.from('tournaments').update({status:'finished'}).eq('id',o.id);
      if(dbErr(error,'смена статуса'))return;
    }
  }
  const{error}=await sb.from('tournaments').update({status}).eq('id',id);
  if(dbErr(error,'смена статуса турнира'))return;
  toast('Статус обновлён');await refreshData();pgTournaments();
}
async function renameTour(id,cur){const n=prompt('Новое название турнира:',cur);if(n==null)return;const name=n.trim();if(!name||name===cur)return;const{error}=await sb.from('tournaments').update({name}).eq('id',id);if(dbErr(error,'переименование турнира'))return;toast('Название обновлено');await refreshData();pgTournaments();}
async function delTour(id){if(!confirm('Удалить турнир?'))return;const{error}=await sb.from('tournaments').delete().eq('id',id);if(dbErr(error,'удаление турнира'))return;pgTournaments();}

async function openCosts(tourId,tourName){
  document.getElementById('page-title').textContent=`Косты — ${tourName}`;
  const{data:existing}=await sb.from('tournament_costs').select('*').eq('tournament_id',tourId);
  const{data:tour}=await sb.from('tournaments').select('restart_penalties').eq('id',tourId).maybeSingle();
  renderCostsPage(tourId,tourName,existing||[],tour?.restart_penalties||[]);
}

// Совмещённая страница: два раскрывающихся блока (косты персонажей / костов амплификаторов), оба изначально свёрнуты.
function renderCostsPage(tourId,tourName,existing,penalties){
  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('tournaments')">← Назад</button>
  ${costsTopControls(tourId,penalties)}
  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <button id="cost-tg-char" class="btn btn-g" onclick="toggleCostSection('char')">▸ Косты персонажей</button>
    <button id="cost-tg-amp" class="btn btn-g" onclick="toggleCostSection('amp')">▸ Косты амплификаторов</button>
  </div>
  <div id="cost-sec-char" hidden>${charCostsSection(tourId,tourName,existing,penalties)}</div>
  <div id="cost-sec-amp" hidden>${ampCostsSection(tourId,tourName,existing)}</div>`);
  updatePenaltyHint();
}

// Импорт из ссылки + копирование костов + штрафы рестартов — общие элементы над таблицами.
function costsTopControls(tourId,penalties){
  const otherTours=D.tours.filter(t=>t.id!==tourId);
  const copySelect=otherTours.length?`<select id="copy-from-tour" style="font-size:13px;padding:5px 10px;margin-right:8px">
    ${otherTours.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
  </select>
  <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="copyCosts('${tourId}')">Скопировать косты</button>`:'<span style="color:var(--sub);font-size:13px">Нет других турниров для копирования</span>';
  return`<div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-weight:600;font-size:14px">Импорт из ссылки драфта:</span>
      <input id="rs-link" type="text" placeholder="ссылка shiyu.darte.gg…" style="flex:1;min-width:220px;padding:6px 10px;font-size:13px">
      <button class="btn btn-g" style="font-size:13px;padding:6px 14px" onclick="importTourRuleset('${tourId}')">Загрузить косты и штрафы</button>
    </div>
    <div id="rs-status" style="font-size:12px;color:var(--sub);margin-top:8px"></div>
    <div style="font-size:11px;color:var(--sub);margin-top:4px">Заполнит косты персонажей по минскейпам и штрафы рестартов. Косты амплификаторов — в блоке «Косты амплификаторов». Проверь и нажми «Сохранить».</div>
  </div>
  <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span style="font-weight:600;font-size:14px">Скопировать косты из турнира:</span>
    ${copySelect}
  </div>
  ${renderPenalties(penalties)}`;
}

function toggleCostSection(which){
  const sec=document.getElementById('cost-sec-'+which);
  const btn=document.getElementById('cost-tg-'+which);
  if(!sec||!btn)return;
  const show=sec.hidden;sec.hidden=!show;
  btn.classList.toggle('btn-y',show);
  btn.textContent=(show?'▾':'▸')+btn.textContent.slice(1);
}

// Редактор инкрементальных штрафов за рестарт (сек). N полей; пусто = 0.
function renderPenalties(pen){
  const N=4;
  const inputs=Array.from({length:N},(_,i)=>`<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
    <span style="font-size:11px;color:var(--sub)">рест. ${i+1}</span>
    <input class="rp-in" data-i="${i}" type="number" min="0" placeholder="0" value="${pen[i]??''}" style="width:54px;padding:4px 6px;font-size:13px;text-align:center" oninput="updatePenaltyHint()">
  </div>`).join('');
  return`<div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-weight:600;font-size:14px">Штрафы за рестарты (доп. секунды, накопительно):</span>
      ${inputs}
      <span id="rp-hint" style="font-size:12px;color:var(--sub)"></span>
    </div>
  </div>`;
}
function updatePenaltyHint(){
  const vals=[...document.querySelectorAll('.rp-in')].map(el=>+el.value||0);
  let cum=0;const parts=vals.map(v=>{cum+=v;return cum;});
  const el=document.getElementById('rp-hint');
  if(el)el.textContent='итого после N рестартов: '+parts.map((c,i)=>`${i+1}→+${c}с`).join(', ');
}

function charCostsSection(tourId,tourName,existing,penalties){
  penalties=penalties||[];
  const costMap={};existing.forEach(c=>{costMap[`${c.character_id}_${c.mindscape}`]=c;});
  const msCols=[0,1,2,3,4,5,6];
  const msHeads=msCols.map(ms=>`<th style="padding:8px 6px;color:var(--sub);text-align:center;min-width:70px">М${ms}</th>`).join('');
  const rows=D.chars.map(c=>{
    const msCells=msCols.map(ms=>{
      const ex=costMap[`${c.id}_${ms}`]||{};
      return`<td style="padding:6px 6px;text-align:center"><input class="ci-ms" data-c="${c.id}" data-m="${ms}" type="number" min="0" placeholder="—" value="${ex.cost??''}" style="width:65px;padding:3px 6px;font-size:13px;text-align:center"></td>`;
    }).join('');
    const avatarPh=iconChar(c,32);
    const rarityPh=iconRarity(c.rarity,20);
    const elemPh=iconElement(c.element,20);
    return`<tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:8px">
          ${avatarPh}
          <span style="font-weight:500">${c.name}</span>
          ${rarityPh}
          ${elemPh}
        </div>
      </td>
      ${msCells}
    </tr>`;
  }).join('');

  return`<div class="card" style="overflow-x:auto;padding:0">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#0b0d14">
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Персонаж</th>
        ${msHeads}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <button class="btn btn-y" style="margin-top:16px" onclick="saveCosts('${tourId}')">Сохранить все косты</button>`;
}

// Снапшот рулсетов (косты+штрафы) из репо; draft_systems закрыт CORS из браузера.
let _shiyuSystems=null;
async function loadShiyuSystems(){
  if(_shiyuSystems)return _shiyuSystems;
  const r=await fetch('web/data/shiyu_systems.json?v='+Date.now());
  if(!r.ok)throw new Error('shiyu_systems.json не загрузился');
  _shiyuSystems=await r.json();return _shiyuSystems;
}

// Импорт костов персонажей (по минскейпам) + штрафов рестартов из ссылки драфта.
async function importTourRuleset(tourId){
  const st=document.getElementById('rs-status');
  const set=m=>{if(st)st.textContent=m;};
  const url=document.getElementById('rs-link')?.value?.trim();
  if(!url)return set('Вставь ссылку на драфт');
  if(typeof fetchDraftState!=='function')return set('draft-import.js не загружен');
  const parsed=parseDraftLink(url);
  if(!parsed)return set('Не разобрал ссылку (нужны draft_id и session_key)');
  set('Загружаю рулсет…');
  try{
    const state=await fetchDraftState(parsed.id,parsed.key);
    const sys=(await loadShiyuSystems()).systems?.[state.system];
    if(!sys)return set('Система '+state.system+' не в кэше. Запусти: python tools/fetch_system.py "'+url+'"');
    const base=e=>String(e).split('_')[0];
    const byEnka={};D.chars.forEach(c=>{if(c.enka_id)byEnka[base(c.enka_id)]=c;});
    let filled=0,miss=0;
    Object.entries(sys.agents).forEach(([enka,costs])=>{
      const c=byEnka[enka];if(!c){miss++;return;}
      costs.forEach((cost,ms)=>{const el=document.querySelector(`.ci-ms[data-c="${c.id}"][data-m="${ms}"]`);if(el){el.value=cost;filled++;}});
    });
    const pen=Array(sys.restart?.free||0).fill(0).concat(sys.restart?.paid||[]);
    document.querySelectorAll('.rp-in').forEach((el,i)=>{el.value=pen[i]??'';});
    if(typeof updatePenaltyHint==='function')updatePenaltyHint();
    // Косты амплификаторов R1–R5: bis[ownerEnka] (точнее), иначе own-role base[0..4]. Нули сохраняем.
    let ampFilled=0;
    D.sigs.forEach(s=>{
      const engEnka=s.enka_id?base(s.enka_id):null;
      const ch=D.chars.find(x=>x.id===s.character_id);
      const ownerEnka=ch&&ch.enka_id?base(ch.enka_id):null;
      const e=engEnka?sys.engines?.[engEnka]:null;if(!e)return;
      const costs=(ownerEnka&&e.bis&&e.bis[ownerEnka])?e.bis[ownerEnka]:(e.base||[]).slice(0,5);
      for(let i=0;i<5;i++){const el=document.querySelector(`.ac-in[data-sig="${s.id}"][data-r="${i}"]`);if(el&&costs[i]!=null){el.value=costs[i];ampFilled++;}}
    });
    set(`Заполнено ${filled} костов персонажей + ${ampFilled} ячеек амплификаторов из «${sys.title}» (лимит ${sys.costLimit}), штрафы [${pen.join(',')||'нет'}]`+(miss?` · ${miss} агентов нет в БД`:'')+'. Проверь и нажми «Сохранить» в обоих блоках.');
  }catch(e){set('Ошибка: '+e.message);}
}

async function copyCosts(tourId){
  const srcId=document.getElementById('copy-from-tour')?.value;
  if(!srcId)return;
  const srcTour=D.tours.find(t=>t.id===srcId);
  if(!confirm(`Скопировать косты из «${srcTour?.name||srcId}»? Текущие незаполненные ячейки будут заполнены, заполненные — перезаписаны.`))return;
  const{data:srcCosts,error}=await sb.from('tournament_costs').select('*').eq('tournament_id',srcId);
  if(dbErr(error,'загрузка костов'))return;
  (srcCosts||[]).forEach(sc=>{
    const msEl=document.querySelector(`.ci-ms[data-c="${sc.character_id}"][data-m="${sc.mindscape}"]`);
    if(msEl&&sc.cost!=null)msEl.value=sc.cost;
    const sigCostEl=document.querySelector(`.ci-char[data-c="${sc.character_id}"][data-f="sig_cost"]`);
    if(sigCostEl&&sc.sig_cost!=null)sigCostEl.value=sc.sig_cost;
    const sigEl=document.querySelector(`.ci-char[data-c="${sc.character_id}"][data-f="sig"]`);
    if(sigEl&&sc.sig_id)sigEl.value=sc.sig_id;
  });
  toast(`Скопировано из «${srcTour?.name||srcId}»`);
}

async function saveCosts(tourId){
  // Косты амплификаторов (sig_cost/sig_id) ведутся отдельным редактором — здесь их НЕ трогаем.
  // upsert без этих полей оставляет их без изменений у существующих строк (ON CONFLICT обновляет только переданные колонки).
  const valid=[];
  document.querySelectorAll('.ci-ms').forEach(el=>{
    if(!el.value)return;
    const c=el.dataset.c,ms=+el.dataset.m;
    valid.push({tournament_id:tourId,character_id:c,mindscape:ms,cost:+el.value,is_allowed:true});
  });
  if(valid.length){const{error}=await sb.from('tournament_costs').upsert(valid,{onConflict:'tournament_id,character_id,mindscape'});if(dbErr(error,'сохранение костов'))return;}
  // Штрафы за рестарты — обрезаем хвост нулей, пишем в турнир.
  let pen=[...document.querySelectorAll('.rp-in')].map(el=>+el.value||0);
  while(pen.length&&pen[pen.length-1]===0)pen.pop();
  {const{error}=await sb.from('tournaments').update({restart_penalties:pen}).eq('id',tourId);if(dbErr(error,'сохранение штрафов'))return;
   const t=D.tours.find(t=>t.id===tourId);if(t)t.restart_penalties=pen;}
  toast(`Сохранено ${valid.length} костов + штрафы`);
}

// --- КОСТЫ АМПЛИФИКАТОРОВ ---
// Список амплификаторов, у каждого — кост на его персонаже.
// По дефолту ничего не проставляется; заполняем только там, где кост в этом турнире задан.
function ampCostsSection(tourId,tourName,existing){
  // текущая сигна+косты R1–R5 у персонажа (поля продублированы по строкам минскейпов — берём первую заполненную)
  const charSig={};
  existing.forEach(c=>{if(c.sig_id!=null&&!charSig[c.character_id])charSig[c.character_id]={sig_id:c.sig_id,sig_cost:c.sig_cost,sig_costs:Array.isArray(c.sig_costs)?c.sig_costs:[]};});

  const RN=5;
  const rHeads=Array.from({length:RN},(_,i)=>`<th style="padding:8px 4px;color:var(--sub);text-align:center;min-width:50px">R${i+1}</th>`).join('');
  const sigs=[...D.sigs].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const rows=sigs.map(s=>{
    const c=D.chars.find(x=>x.id===s.character_id);
    if(!c)return'';
    const cur=charSig[c.id]?.sig_id===s.id?charSig[c.id]:null;
    const arr=cur?.sig_costs||[];
    const img=typeof sigImg==='function'?sigImg(s,28):'';
    // R1–R5: из sig_costs; легаси-фолбэк — одиночный sig_cost в R1. Нули показываем как есть.
    const rCells=Array.from({length:RN},(_,i)=>{
      const val=arr.length?arr[i]:(i===0?cur?.sig_cost:undefined);
      return`<td style="padding:6px 4px;text-align:center"><input class="ac-in" data-sig="${s.id}" data-char="${c.id}" data-r="${i}" type="number" min="0" placeholder="—" value="${val??''}" style="width:48px;padding:4px 4px;font-size:13px;text-align:center"></td>`;
    }).join('');
    return`<tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:8px">${img}<span style="font-weight:500">${s.name}</span></div>
      </td>
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:8px">${iconChar(c,28)}<span>${c.name}</span></div>
      </td>
      ${rCells}
    </tr>`;
  }).join('');

  return`<div class="card" style="margin-bottom:16px">
    <div style="font-size:12px;color:var(--sub)">Кост сигнатурного амплификатора на его персонаже по наложениям R1–R5. Пустая ячейка — не котируется (прочерк); 0 — это реальный 0. Импорт из ссылки заполняет автоматически.</div>
  </div>
  <div class="card" style="overflow-x:auto;padding:0">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#0b0d14">
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Амплификатор</th>
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Персонаж</th>
        ${rHeads}
      </tr></thead>
      <tbody>${rows||'<tr><td colspan="7" style="padding:14px;color:var(--sub)">Сначала добавь амплификаторы в разделе «Амплификаторы»</td></tr>'}</tbody>
    </table>
  </div>
  <button class="btn btn-y" style="margin-top:16px" onclick="saveAmpCosts('${tourId}')">Сохранить косты амплификаторов</button>`;
}

async function saveAmpCosts(tourId){
  // группируем 5 ячеек P1–P5 по паре (амплификатор, персонаж)
  const groups={};
  document.querySelectorAll('.ac-in').forEach(el=>{
    const key=el.dataset.sig+'|'+el.dataset.char;
    (groups[key]=groups[key]||{sig:el.dataset.sig,char:el.dataset.char,p:[]});
    groups[key].p[+el.dataset.r]=el.value!==''?+el.value:null;
  });
  let set=0,cleared=0;
  for(const k in groups){
    const g=groups[k];
    // массив R1–R5: нормализуем дыры в null, обрезаем хвостовые null (0 сохраняем как есть)
    const arr=[];for(let i=0;i<5;i++)arr[i]=g.p[i]===undefined?null:g.p[i];
    while(arr.length&&arr[arr.length-1]==null)arr.pop();
    const hasAny=arr.some(x=>x!=null);
    const p1=arr.length?arr[0]:null; // зеркало для статистики (statistics.html читает sig_cost)
    if(hasAny){
      // проставляем sig_id+sig_cost(P1)+sig_costs на строки персонажа; если строк нет — заводим заглушку M0
      const{data:upd,error}=await sb.from('tournament_costs')
        .update({sig_id:g.sig,sig_cost:p1,sig_costs:arr}).eq('tournament_id',tourId).eq('character_id',g.char).select('id');
      if(dbErr(error,'сохранение коста амплификатора'))return;
      if(!upd||!upd.length){
        const{error:insErr}=await sb.from('tournament_costs')
          .insert({tournament_id:tourId,character_id:g.char,mindscape:0,cost:null,sig_id:g.sig,sig_cost:p1,sig_costs:arr,is_allowed:true});
        if(dbErr(insErr,'создание строки коста амплификатора'))return;
      }
      set++;
    }else{
      // снимаем кост только если этот амплификатор был привязан к персонажу
      const{data:upd,error}=await sb.from('tournament_costs')
        .update({sig_id:null,sig_cost:null,sig_costs:[]}).eq('tournament_id',tourId).eq('character_id',g.char).eq('sig_id',g.sig).select('id');
      if(dbErr(error,'очистка коста амплификатора'))return;
      if(upd&&upd.length)cleared++;
    }
  }
  toast(`Косты амплификаторов: задано ${set}, снято ${cleared}`);
}
