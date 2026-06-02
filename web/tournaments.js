// tournaments.js — турниры и косты

async function pgTournaments(){
  const list=D.tours.map(t=>`<div class="row-item"><div>
    <div style="font-weight:600">${t.name}</div>
    <div style="font-size:12px;color:var(--sub)">${new Date(t.created_at).toLocaleDateString('ru')}</div>
  </div><div style="display:flex;gap:8px">
    <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openCosts('${t.id}','${t.name.replace(/'/g,"\\'")}')">Косты</button>
    <button class="btn-r" onclick="delTour('${t.id}')">✕</button>
  </div></div>`).join('');
  html(`<div class="card" style="margin-bottom:16px">
    <h3>Новый турнир</h3>
    <div class="grid2"><div><label>Название</label><input id="t-name" type="text" placeholder="Nexus Shiyu"></div></div>
    <button class="btn btn-y" style="margin-top:12px" onclick="addTour()">Добавить</button>
  </div>
  <div class="space-y">${list||'<p style="color:var(--sub);font-size:14px">Турниров ещё нет</p>'}</div>`);
}
async function addTour(){const n=v('t-name');if(!n)return;const{error}=await sb.from('tournaments').insert({name:n});if(dbErr(error,'добавление турнира'))return;toast('Турнир добавлен');pgTournaments();}
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
    set(`Заполнено ${filled} костов из «${sys.title}» (лимит ${sys.costLimit}), штрафы [${pen.join(',')||'нет'}]`+(miss?` · ${miss} агентов нет в БД`:'')+'. Проверь и нажми «Сохранить все косты».');
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
  // текущая сигна+кост у персонажа (поля продублированы по строкам минскейпов — берём любую заполненную)
  const charSig={};
  existing.forEach(c=>{if(c.sig_id!=null&&!charSig[c.character_id])charSig[c.character_id]={sig_id:c.sig_id,sig_cost:c.sig_cost};});

  const sigs=[...D.sigs].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const rows=sigs.map(s=>{
    const c=D.chars.find(x=>x.id===s.character_id);
    if(!c)return'';
    const cur=charSig[c.id]?.sig_id===s.id?charSig[c.id]:null;
    const img=typeof sigImg==='function'?sigImg(s,28):'';
    return`<tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:8px">${img}<span style="font-weight:500">${s.name}</span></div>
      </td>
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:8px">${iconChar(c,28)}<span>${c.name}</span></div>
      </td>
      <td style="padding:6px 10px;text-align:center">
        <input class="ac-in" data-sig="${s.id}" data-char="${c.id}" type="number" min="0" placeholder="—" value="${cur?.sig_cost??''}" style="width:75px;padding:4px 6px;font-size:13px;text-align:center">
      </td>
    </tr>`;
  }).join('');

  return`<div class="card" style="margin-bottom:16px">
    <div style="font-size:12px;color:var(--sub)">Кост указывается на персонаже, для которого амплификатор сигнатурный. Пустое поле — амплификатор не котируется в этом турнире.</div>
  </div>
  <div class="card" style="overflow-x:auto;padding:0">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#0b0d14">
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Амплификатор</th>
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Персонаж</th>
        <th style="padding:8px 10px;color:var(--sub);text-align:center">Кост</th>
      </tr></thead>
      <tbody>${rows||'<tr><td colspan="3" style="padding:14px;color:var(--sub)">Сначала добавь амплификаторы в разделе «Амплификаторы»</td></tr>'}</tbody>
    </table>
  </div>
  <button class="btn btn-y" style="margin-top:16px" onclick="saveAmpCosts('${tourId}')">Сохранить косты амплификаторов</button>`;
}

async function saveAmpCosts(tourId){
  const inputs=[...document.querySelectorAll('.ac-in')];
  let set=0,cleared=0;
  for(const el of inputs){
    const charId=el.dataset.char,sigId=el.dataset.sig;
    const val=el.value!==''?+el.value:null;
    if(val!=null){
      // проставляем sig_id+sig_cost на существующие строки персонажа; если строк нет — заводим заглушку M0
      const{data:upd,error}=await sb.from('tournament_costs')
        .update({sig_id:sigId,sig_cost:val}).eq('tournament_id',tourId).eq('character_id',charId).select('id');
      if(dbErr(error,'сохранение коста амплификатора'))return;
      if(!upd||!upd.length){
        const{error:insErr}=await sb.from('tournament_costs')
          .insert({tournament_id:tourId,character_id:charId,mindscape:0,cost:null,sig_id:sigId,sig_cost:val,is_allowed:true});
        if(dbErr(insErr,'создание строки коста амплификатора'))return;
      }
      set++;
    }else{
      // снимаем кост только если этот амплификатор был привязан к персонажу
      const{data:upd,error}=await sb.from('tournament_costs')
        .update({sig_id:null,sig_cost:null}).eq('tournament_id',tourId).eq('character_id',charId).eq('sig_id',sigId).select('id');
      if(dbErr(error,'очистка коста амплификатора'))return;
      if(upd&&upd.length)cleared++;
    }
  }
  toast(`Косты амплификаторов: задано ${set}, снято ${cleared}`);
}
