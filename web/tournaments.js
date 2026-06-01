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
  renderCostsTable(tourId,tourName,existing||[],tour?.restart_penalties||[]);
}

// Редактор инкрементальных штрафов за рестарт (сек). N полей; пусто = 0.
function renderPenalties(pen){
  const N=6;
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

function renderCostsTable(tourId,tourName,existing,penalties){
  penalties=penalties||[];
  const costMap={};existing.forEach(c=>{costMap[`${c.character_id}_${c.mindscape}`]=c;});
  const charSigMap={};D.sigs.forEach(s=>{if(!charSigMap[s.character_id])charSigMap[s.character_id]=[];charSigMap[s.character_id].push(s);});
  const msCols=[0,1,2,3,4,5,6];
  const msHeads=msCols.map(ms=>`<th style="padding:8px 6px;color:var(--sub);text-align:center;min-width:70px">М${ms}</th>`).join('');
  const rows=D.chars.map(c=>{
    const sOpts=(charSigMap[c.id]||[]).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
    const anyEx=msCols.map(ms=>costMap[`${c.id}_${ms}`]).find(x=>x)||{};
    const sigSel=`<select class="ci-char" data-c="${c.id}" data-f="sig" style="width:160px;font-size:13px;padding:3px 6px">
      <option value="">—</option>${sOpts.replace(`value="${anyEx.sig_id||''}"`,`value="${anyEx.sig_id||''}" selected`)}
    </select>`;
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
      <td style="padding:6px 8px;text-align:center"><input class="ci-char" data-c="${c.id}" data-f="sig_cost" type="number" min="0" placeholder="—" value="${anyEx.sig_cost??''}" style="width:65px;padding:3px 6px;font-size:13px;text-align:center"></td>
      <td style="padding:6px 8px">${sigSel}</td>
      ${msCells}
    </tr>`;
  }).join('');

  const otherTours=D.tours.filter(t=>t.id!==tourId);
  const copySelect=otherTours.length?`<select id="copy-from-tour" style="font-size:13px;padding:5px 10px;margin-right:8px">
    ${otherTours.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
  </select>
  <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="copyCosts('${tourId}')">Скопировать косты</button>`:'<span style="color:var(--sub);font-size:13px">Нет других турниров для копирования</span>';

  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('tournaments')">← Назад</button>
  <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span style="font-weight:600;font-size:14px">Скопировать косты из турнира:</span>
    ${copySelect}
  </div>
  ${renderPenalties(penalties)}
  <div class="card" style="overflow-x:auto;padding:0">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#0b0d14">
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Персонаж</th>
        <th style="padding:8px 6px;color:var(--sub);text-align:center">Кост сигны</th>
        <th style="padding:8px 6px;color:var(--sub)">Сигна</th>
        ${msHeads}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <button class="btn btn-y" style="margin-top:16px" onclick="saveCosts('${tourId}')">Сохранить все косты</button>`);
  updatePenaltyHint();
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
  const charLevel={};
  document.querySelectorAll('.ci-char').forEach(el=>{
    const c=el.dataset.c;
    if(!charLevel[c])charLevel[c]={};
    if(el.dataset.f==='sig_cost')charLevel[c].sig_cost=el.value?+el.value:null;
    if(el.dataset.f==='sig')charLevel[c].sig_id=el.value||null;
  });
  const valid=[];
  document.querySelectorAll('.ci-ms').forEach(el=>{
    if(!el.value)return;
    const c=el.dataset.c,ms=+el.dataset.m;
    const cl=charLevel[c]||{};
    valid.push({tournament_id:tourId,character_id:c,mindscape:ms,cost:+el.value,
      sig_cost:cl.sig_cost??null,sig_id:cl.sig_id??null,is_allowed:true});
  });
  if(valid.length){const{error}=await sb.from('tournament_costs').upsert(valid,{onConflict:'tournament_id,character_id,mindscape'});if(dbErr(error,'сохранение костов'))return;}
  // Штрафы за рестарты — обрезаем хвост нулей, пишем в турнир.
  let pen=[...document.querySelectorAll('.rp-in')].map(el=>+el.value||0);
  while(pen.length&&pen[pen.length-1]===0)pen.pop();
  {const{error}=await sb.from('tournaments').update({restart_penalties:pen}).eq('id',tourId);if(dbErr(error,'сохранение штрафов'))return;
   const t=D.tours.find(t=>t.id===tourId);if(t)t.restart_penalties=pen;}
  toast(`Сохранено ${valid.length} костов + штрафы`);
}
