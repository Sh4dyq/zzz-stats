// weights.js — админ-страница «Веса персонажей». Ручная калибровка силы (0..100)
// поверх авто-сигналов (средний кост + байес-винрейт). Пишет в char_weights.
// Средний кост/винрейт считаются на лету из tournament_costs + match_picks/matches.

const KB_WR=15; // псевдо-счёт байес-винрейта (как в rating-tab)

async function _fetchAllW(table){
  let out=[],from=0,step=1000;
  for(;;){
    const{data,error}=await sb.from(table).select('*').range(from,from+step-1);
    if(dbErr(error,'загрузка '+table))break;
    out=out.concat(data||[]);
    if(!data||data.length<step)break;
    from+=step;
  }
  return out;
}

// средний кост по турнирам: на турнир берём кост при минимальном майндскейпе, затем среднее
function _avgCosts(costs){
  const perTour={}; // tour -> char -> {cost,ms}
  costs.forEach(c=>{
    if(c.is_allowed===false)return;
    (perTour[c.tournament_id]=perTour[c.tournament_id]||{});
    const p=perTour[c.tournament_id][c.character_id];
    if(p===undefined||c.mindscape<p.ms)perTour[c.tournament_id][c.character_id]={cost:c.cost,ms:c.mindscape};
  });
  const acc={};
  for(const t in perTour)for(const ch in perTour[t])(acc[ch]=acc[ch]||[]).push(perTour[t][ch].cost);
  const out={};
  for(const ch in acc){
    // кост 0 в турнире = бесплатный бейслайн (напр. S Anby), а не реальная цена.
    // Если у перса есть ненулевой кост где-то ещё — усредняем только по ненулевым.
    const nz=acc[ch].filter(x=>x>0);
    const use=nz.length?nz:acc[ch];
    out[ch]=use.reduce((a,b)=>a+b,0)/use.length;
  }
  return out;
}

// байес-винрейт + пикрейт по всем матчам
function _winrates(picks,matches){
  const mById={};matches.forEach(m=>mById[m.id]=m);
  const total=matches.length||1;
  const st={};
  picks.forEach(p=>{
    const m=mById[p.match_id];if(!m)return;
    const s=st[p.character_id]=st[p.character_id]||{picks:0,wins:0};
    s.picks++;if(m.winner_id===p.player_id)s.wins++;
  });
  const out={};
  for(const ch in st){const s=st[ch];out[ch]={wr:(s.wins+KB_WR*0.5)/(s.picks+KB_WR),pr:s.picks/total,picks:s.picks};}
  return out;
}

let _W={rows:[],saved:{},sortKey:'power',sortDir:-1,wman:0.5};

async function pgWeights(){
  html(`<div class="card"><span class="spinner"></span> Считаю косты и винрейты…</div>`);
  const[costs,picks,matches,saved]=await Promise.all([
    _fetchAllW('tournament_costs'),_fetchAllW('match_picks'),_fetchAllW('matches'),_fetchAllW('char_weights')
  ]);
  const avgCost=_avgCosts(costs), wr=_winrates(picks,matches);
  const savedMap={};saved.forEach(r=>savedMap[r.character_id]=r);
  _W.saved=savedMap;
  _W.rows=D.chars
    .filter(c=>avgCost[c.id]!==undefined||wr[c.id])   // только персонажи с историей
    .map(c=>({
      id:c.id,c,
      cost:avgCost[c.id]!=null?Math.round(avgCost[c.id]):null,
      wr:wr[c.id]?wr[c.id].wr:null,
      picks:wr[c.id]?wr[c.id].picks:0,
      man:savedMap[c.id]?savedMap[c.id].manual_weight:50
    }));
  _renderWeights();
}

// авто-z из коста и винрейта (грубая нормировка под шкалу; финальная калибровка — в predict.js)
function _zAuto(r){
  const zc=r.cost!=null?(r.cost/100-0.5)*0.9:0;
  const zw=r.wr!=null?(r.wr-0.5)*6:0;
  return 0.5*zc+0.5*zw;
}
const _zMan=m=>(m-50)/25;
function _powerOf(r,w){const z=w*_zMan(r.man)+(1-w)*_zAuto(r);return 100/(1+Math.exp(-0.6*z));}
// «сила» чисто ручного веса (wMan=1) — для тира по ручному, сопоставимого со шкалой Силы
function _manPowerOf(r){return 100/(1+Math.exp(-0.6*_zMan(r.man)));}
// тир по итоговой Силе (0..100). Центр пула ~50 → B.
function _tierOf(power){
  if(power>=70)return{t:'S+',c:'#a970ff'};
  if(power>=62)return{t:'S', c:'#7c5cff'};
  if(power>=54)return{t:'A', c:'#46d369'};
  if(power>=46)return{t:'B', c:'#3aa0ff'};
  if(power>=38)return{t:'C', c:'#f5c842'};
  return{t:'D', c:'#ff6a3d'};
}

function _renderWeights(){
  const w=_W.wman;
  const rows=_W.rows.map(r=>({r,power:_powerOf(r,w)}));
  const k=_W.sortKey,dir=_W.sortDir;
  const keyVal=x=>k==='name'?x.r.c.name:k==='cost'?(x.r.cost??-1):k==='wr'?(x.r.wr??-1):k==='man'?x.r.man:x.power;
  rows.sort((a,b)=>{const va=keyVal(a),vb=keyVal(b);return dir*(typeof va==='string'?va.localeCompare(vb,'ru'):va-vb);});
  const arrow=key=>k===key?(dir<0?' ↓':' ↑'):'';
  html(`
  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px">
    <div class="card" style="display:flex;align-items:center;gap:12px;padding:12px 16px">
      <label style="margin:0;text-transform:none;letter-spacing:0;font-size:13px;color:var(--sub)">Доверие ручному весу</label>
      <input type="range" min="0" max="100" step="5" value="${Math.round(w*100)}" style="width:170px" oninput="_wmanChange(this.value)">
      <span id="wman-out" style="font-family:'JetBrains Mono',monospace;font-weight:600;color:#fff;min-width:36px">${w.toFixed(2)}</span>
    </div>
    <button class="btn btn-y" onclick="saveWeights()">Сохранить</button>
    <span class="count-chip">${_W.rows.length} персонажей</span>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
  <table>
    <thead><tr style="text-align:left;font-size:12px;color:var(--sub)">
      <th style="padding:10px 14px;cursor:pointer;user-select:none" onclick="_sortW('name')">Персонаж${arrow('name')}</th>
      <th style="padding:10px 8px;cursor:pointer;user-select:none" onclick="_sortW('cost')">Кост ср.${arrow('cost')}</th>
      <th style="padding:10px 8px;cursor:pointer;user-select:none" onclick="_sortW('wr')">Винрейт${arrow('wr')}</th>
      <th style="padding:10px 8px;width:190px;cursor:pointer;user-select:none" onclick="_sortW('man')">Ручной вес${arrow('man')}</th>
      <th style="padding:10px 8px;cursor:pointer;user-select:none" onclick="_sortW('man')">Ручной тир${arrow('man')}</th>
      <th style="padding:10px 8px;text-align:right;cursor:pointer;user-select:none" onclick="_sortW('power')">Сила${arrow('power')}</th>
      <th style="padding:10px 14px;cursor:pointer;user-select:none" onclick="_sortW('power')">Тир Силы${arrow('power')}</th>
    </tr></thead>
    <tbody>
    ${rows.map(({r,power})=>{
      const idx=_W.rows.indexOf(r);
      const tier=_tierOf(power);
      const mtier=_tierOf(_manPowerOf(r));
      const badge=(t,attr)=>`<span ${attr} style="display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:22px;font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:14px;color:#181820;background:${t.c};border-radius:5px;padding:0 6px">${t.t}</span>`;
      return `<tr data-ri="${idx}" style="border-top:1px solid var(--line)">
        <td style="padding:9px 14px"><div style="display:flex;align-items:center;gap:9px">${iconChar(r.c,28)}<span style="font-weight:600">${r.c.name}</span></div></td>
        <td style="padding:9px 8px;font-family:'JetBrains Mono',monospace;color:var(--sub)">${r.cost!=null?r.cost:'—'}</td>
        <td style="padding:9px 8px;font-family:'JetBrains Mono',monospace;color:var(--sub)">${r.wr!=null?Math.round(r.wr*100)+'%':'—'}</td>
        <td style="padding:9px 8px;white-space:nowrap">
          <input type="range" min="0" max="100" step="1" value="${r.man}" style="width:130px;vertical-align:middle" oninput="_manChange(${idx},this.value)">
          <span data-man style="display:inline-block;min-width:30px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--sub);margin-left:4px">${r.man}</span>
        </td>
        <td style="padding:9px 8px">${badge(mtier,'data-mantier')}</td>
        <td data-power style="padding:9px 8px;text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600;color:#fff">${Math.round(power)}</td>
        <td style="padding:9px 14px">
          <div style="display:flex;align-items:center;gap:9px">
            ${badge(tier,'data-tierbadge')}
            <span style="flex:1;height:6px;background:var(--field);border-radius:3px;overflow:hidden;min-width:60px"><span data-tierbar style="display:block;height:100%;width:${Math.round(power)}%;background:${tier.c}"></span></span>
          </div>
        </td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>
  </div>
  <p style="color:var(--sub);font-size:12px;margin-top:12px;line-height:1.5">Ползунок 0–100: 50 = средний персонаж. «Сила» (0–100) — итог после смешивания руки с авто (кост+винрейт), относительна пулу. Клик по «Кост»/«Винрейт»/«Сила» — сортировка. Не забудь «Сохранить».</p>`);
}

// Точечная перерисовка ячеек строки БЕЗ пересборки таблицы и без пересортировки —
// иначе тащимый ползунок заменяется новым DOM (застывает), а строка «улетает» при ре-сорте.
// Позиции обновляются только при новой сортировке (клик по заголовку).
function _paintRow(tr){
  const r=_W.rows[+tr.dataset.ri];if(!r)return;
  const power=_powerOf(r,_W.wman),tier=_tierOf(power),mtier=_tierOf(_manPowerOf(r));
  tr.querySelector('[data-man]').textContent=r.man;
  const mb=tr.querySelector('[data-mantier]');mb.textContent=mtier.t;mb.style.background=mtier.c;
  tr.querySelector('[data-power]').textContent=Math.round(power);
  const badge=tr.querySelector('[data-tierbadge]');badge.textContent=tier.t;badge.style.background=tier.c;
  const bar=tr.querySelector('[data-tierbar]');bar.style.width=Math.round(power)+'%';bar.style.background=tier.c;
}
function _wmanChange(val){
  _W.wman=+val/100;document.getElementById('wman-out').textContent=_W.wman.toFixed(2);
  document.querySelectorAll('#page-content tbody tr').forEach(_paintRow);
}
function _sortW(key){if(_W.sortKey===key)_W.sortDir*=-1;else{_W.sortKey=key;_W.sortDir=-1;}_renderWeights();}
function _manChange(idx,val){_W.rows[idx].man=+val;const tr=document.querySelector(`#page-content tbody tr[data-ri="${idx}"]`);if(tr)_paintRow(tr);}

async function saveWeights(){
  const payload=_W.rows.map(r=>({character_id:r.id,manual_weight:r.man,updated_at:new Date().toISOString()}));
  const{error}=await sb.from('char_weights').upsert(payload,{onConflict:'character_id'});
  if(dbErr(error,'сохранение весов'))return;
  toast('Веса сохранены');
}
