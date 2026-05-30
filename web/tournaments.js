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
  const costMap={};(existing||[]).forEach(c=>{costMap[`${c.character_id}_${c.mindscape}`]=c;});
  const charSigMap={};D.sigs.forEach(s=>{if(!charSigMap[s.character_id])charSigMap[s.character_id]=[];charSigMap[s.character_id].push(s);});
  const rows=D.chars.map(c=>{
    const sOpts=(charSigMap[c.id]||[]).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
    const anyEx=[0,1,2,3,4,5,6].map(ms=>costMap[`${c.id}_${ms}`]).find(x=>x)||{};
    return[0,1,2,3,4,5,6].map((ms,idx)=>{
      const ex=costMap[`${c.id}_${ms}`]||{};
      const charCells=idx===0?`
        <td rowspan="7" style="padding:8px 10px;font-weight:500;vertical-align:middle;border-right:1px solid var(--border)">${c.name}</td>
        <td rowspan="7" style="padding:6px 10px;vertical-align:middle;border-right:1px solid var(--border)">
          <input class="ci-char" data-c="${c.id}" data-f="sig_cost" type="number" min="0" placeholder="—" value="${anyEx.sig_cost??''}" style="width:70px;padding:4px 8px;font-size:13px">
        </td>
        <td rowspan="7" style="padding:6px 10px;vertical-align:middle">
          <select class="ci-char" data-c="${c.id}" data-f="sig" style="width:auto;font-size:13px;padding:4px 8px">
            <option value="">—</option>${sOpts.replace(`value="${anyEx.sig_id||''}"`,`value="${anyEx.sig_id||''}" selected`)}
          </select>
        </td>`:'';
      return`<tr style="border-top:1px solid var(--border)">
        ${charCells}
        <td style="padding:6px 10px;color:var(--sub);text-align:center">М${ms}</td>
        <td style="padding:6px 10px"><input class="ci-ms" data-c="${c.id}" data-m="${ms}" type="number" min="0" placeholder="—" value="${ex.cost??''}" style="width:70px;padding:4px 8px;font-size:13px"></td>
      </tr>`;
    }).join('');
  }).join('');
  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('tournaments')">← Назад</button>
  <div class="card" style="overflow-x:auto;padding:0">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#0b0d14">
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Персонаж</th>
        <th style="padding:8px 10px;color:var(--sub)">Кост сигны R1</th>
        <th style="padding:8px 10px;color:var(--sub)">Сигна</th>
        <th style="padding:8px 10px;color:var(--sub)">Конста</th>
        <th style="padding:8px 10px;color:var(--sub)">Кост</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <button class="btn btn-y" style="margin-top:16px" onclick="saveCosts('${tourId}')">Сохранить все косты</button>`);
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
  toast(`Сохранено ${valid.length} записей`);
}
