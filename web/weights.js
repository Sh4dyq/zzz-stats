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

// доверие ручному весу — persist между заходами
const _WMAN_KEY='zzz_wman';
function _wmanInit(){const v=parseFloat(localStorage.getItem(_WMAN_KEY));return isNaN(v)?0.5:Math.max(0,Math.min(1,v));}
let _W={rows:[],saved:{},sortKey:'power',sortDir:-1,wman:_wmanInit(),roleFilter:'all',expanded:new Set(),
  section:'power',calib:'solo'}; // section: power|shiyu|consts ; calib (в power): solo|duo|trio

// констелляции (майндскейпы), реально сыгранные на турнирах: пики/винрейт + кост майндскейпа.
// Только сыгранные — это заодно отсекает мусорные косты незаигранных M (напр. заглушки).
function _constsByChar(picks,matches,costs){
  const mById={};matches.forEach(m=>mById[m.id]=m);
  const play={};
  picks.forEach(p=>{const c=play[p.character_id]=play[p.character_id]||{};const s=c[p.mindscape]=c[p.mindscape]||{picks:0,wins:0};s.picks++;const m=mById[p.match_id];if(m&&m.winner_id===p.player_id)s.wins++;});
  const costMap={};
  costs.forEach(c=>{if(c.is_allowed===false)return;((costMap[c.character_id]=costMap[c.character_id]||{})[c.mindscape]=costMap[c.character_id][c.mindscape]||[]).push(c.cost);});
  const med=a=>{a=a.slice().sort((x,y)=>x-y);const n=a.length;return n?(n%2?a[(n-1)/2]:Math.round((a[n/2-1]+a[n/2])/2)):null;};
  const out={};
  for(const ch in play){
    out[ch]=Object.keys(play[ch]).map(ms=>{
      const s=play[ch][ms];const raw=(costMap[ch]&&costMap[ch][ms])||[];const nz=raw.filter(x=>x>0);
      return{ms:+ms,picks:s.picks,wins:s.wins,wr:(s.wins+KB_WR*0.5)/(s.picks+KB_WR),cost:nz.length?med(nz):(raw.length?0:null)};
    }).sort((a,b)=>a.ms-b.ms);
  }
  return out;
}

async function pgWeights(){
  html(`<div class="card"><span class="spinner"></span> Считаю косты и винрейты…</div>`);
  await _cmpLoadSolo();
  _renderWeights();
}
// загрузка соло-данных (выделена из pgWeights: нужна и «Сравнению»)
async function _cmpLoadSolo(){
  if(!D.chars||!D.chars.length){ // прямой заход в «Сравнение» — D.chars ещё не загружен
    D.chars=await _fetchAllW('characters');
    D.charMap={};D.chars.forEach(c=>D.charMap[c.id]=c);
  }
  const[costs,picks,matches,saved,csaved]=await Promise.all([
    _fetchAllW('tournament_costs'),_fetchAllW('match_picks'),_fetchAllW('matches'),_fetchAllW('char_weights'),_fetchAllW('char_const_weights')
  ]);
  const avgCost=_avgCosts(costs), wr=_winrates(picks,matches);
  _W.consts=_constsByChar(picks,matches,costs);
  const savedMap={};saved.forEach(r=>savedMap[r.character_id]=r);
  _W.saved=savedMap;
  _W.cweights={};csaved.forEach(r=>{(_W.cweights[r.character_id]=_W.cweights[r.character_id]||{})[r.mindscape]=r.manual_weight;});
  _W.rows=D.chars
    .filter(c=>avgCost[c.id]!==undefined||wr[c.id])   // только персонажи с историей
    .map(c=>({
      id:c.id,c,role:c.role,
      cost:avgCost[c.id]!=null?Math.round(avgCost[c.id]):null,
      wr:wr[c.id]?wr[c.id].wr:null,
      picks:wr[c.id]?wr[c.id].picks:0,
      man:savedMap[c.id]?savedMap[c.id].manual_weight:50
    }));
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

const _ROLES=[['atk','ДД'],['stun','Стан'],['ano','Аном'],['sup','Сап'],['rupt','Разр'],['def','Защ']];
const _roleLabel=r=>{const x=_ROLES.find(e=>e[0]===r);return x?x[1]:r;};

// вес конкретной констелляции (дефолт 50)
const _cw=(id,ms)=>((_W.cweights&&_W.cweights[id])||{})[ms]??50;
const _tierBadge=(t,attr)=>`<span ${attr} style="display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:22px;font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:14px;color:#181820;background:${t.c};border-radius:5px;padding:0 6px">${t.t}</span>`;

// констелляции для показа: M0 — база (S-ранги: строка персонажа=M0, A-ранги: =M6),
// поэтому M0 не отдельная строка; у A-рангов констелляций вообще нет.
function _displayConsts(r){
  if(r.c.rarity==='A')return [];
  return ((_W.consts&&_W.consts[r.id])||[]).filter(c=>c.ms>0);
}

// строки констелляций — тот же формат, что у персонажа (со своим ползунком силы)
function _constRowsHtml(r){
  const cs=_displayConsts(r);
  if(!cs.length)return `<tr data-detail><td colspan="7" style="padding:8px 14px 12px 46px;background:rgba(255,255,255,.015);color:var(--sub);font-size:13px">Нет сыгранных констелляций (M1+) в матчах.</td></tr>`;
  return cs.map(c=>{
    const cr={cost:c.cost,wr:c.wr,man:_cw(r.id,c.ms)};
    const power=_powerOf(cr,_W.wman),tier=_tierOf(power),mtier=_tierOf(_manPowerOf(cr));
    const rawWr=c.picks?Math.round(c.wins/c.picks*100):0;
    return `<tr data-cw="${r.id}:${c.ms}" style="background:rgba(255,255,255,.015);border-top:1px solid var(--line)">
      <td style="padding:7px 14px 7px 46px"><span style="font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:15px;color:var(--gold)">M${c.ms}</span></td>
      <td style="padding:7px 8px;font-family:'JetBrains Mono',monospace;color:var(--sub)">${c.cost!=null?c.cost:'—'}</td>
      <td style="padding:7px 8px;font-family:'JetBrains Mono',monospace;color:var(--sub)">${rawWr}% <span style="opacity:.6">(${c.picks})</span></td>
      <td style="padding:7px 8px;white-space:nowrap">
        <input type="range" min="0" max="100" step="1" value="${cr.man}" style="width:130px;vertical-align:middle" oninput="_cmanChange('${r.id}',${c.ms},this.value)">
        <span data-man style="display:inline-block;min-width:30px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--sub);margin-left:4px">${cr.man}</span>
      </td>
      <td style="padding:7px 8px">${_tierBadge(mtier,'data-mantier')}</td>
      <td data-power style="padding:7px 8px;text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600;color:#fff">${Math.round(power)}</td>
      <td style="padding:7px 14px">
        <div style="display:flex;align-items:center;gap:9px">
          ${_tierBadge(tier,'data-tierbadge')}
          <span style="flex:1;height:6px;background:var(--field);border-radius:3px;overflow:hidden;min-width:60px"><span data-tierbar style="display:block;height:100%;width:${Math.round(power)}%;background:${tier.c}"></span></span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// верхняя навигация раздела «Аналитика»
function _analyticsTabs(){
  const secBtn=(v,l)=>`<button class="tbtn" style="${_W.section===v?'border-color:var(--accent);color:#fff':''}" onclick="_anaSection('${v}')">${l}</button>`;
  let sub='';
  if(_W.section==='power'){
    const cb=(v,l)=>`<button class="tbtn" style="${_W.calib===v?'border-color:var(--accent);color:#fff':''}" onclick="_anaCalib('${v}')">${l}</button>`;
    sub=`<div style="display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px">
      <span style="font-size:12px;color:var(--sub);align-self:center;margin-right:4px">Состав:</span>
      ${cb('solo','Соло')}${cb('duo','Дуо')}${cb('trio','Трио')}</div>`;
  }
  if(_W.section==='spar'){
    const sv=_W.sparView||'spar';
    const vb=(v,l)=>`<button class="tbtn" style="${sv===v?'border-color:var(--accent);color:#fff':''}" onclick="_anaSparView('${v}')">${l}</button>`;
    sub=`<div style="display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px">${vb('spar','Спарринг')}${vb('cmp','Сравнение')}</div>`;
  }
  return `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">
    ${secBtn('power','Калибровка силы персонажей')}${secBtn('spar','Спарринг')}${secBtn('shiyu','Влияние бафов Шиюй')}${secBtn('consts','Теги + майндскейпы')}
  </div>${sub}`;
}
function _anaSection(v){_W.section=v;_renderWeights();}
function _anaCalib(v){_W.calib=v;_renderWeights();}
function _anaSparView(v){_W.sparView=v;_renderWeights();}
// заглушка-раздел (пока не реализован)
function _anaStub(title,note){
  html(`${_analyticsTabs()}<div class="card" style="padding:22px"><h3 style="margin:0 0 8px">${title}</h3>
    <p style="color:var(--sub);font-size:13px;line-height:1.6;margin:0">${note}</p></div>`);
}
function _renderWeights(){
  if(_W.section==='shiyu')return _renderShiyuBuffs();
  if(_W.section==='consts')return _renderTagsEditor();
  if(_W.section==='spar')return (_W.sparView==='cmp')?_renderCompare():_renderSparring();
  // section='power'
  if(_W.calib==='duo')return _renderTeams(2);
  if(_W.calib==='trio')return _renderTeams(3);
  const w=_W.wman;
  const rf=_W.roleFilter;
  let rows=_W.rows.map(r=>({r,power:_powerOf(r,w)}));
  if(rf!=='all')rows=rows.filter(x=>x.r.role===rf);
  const k=_W.sortKey,dir=_W.sortDir;
  const keyVal=x=>k==='name'?x.r.c.name:k==='cost'?(x.r.cost??-1):k==='wr'?(x.r.wr??-1):k==='man'?x.r.man:x.power;
  rows.sort((a,b)=>{const va=keyVal(a),vb=keyVal(b);return dir*(typeof va==='string'?va.localeCompare(vb,'ru'):va-vb);});
  const arrow=key=>k===key?(dir<0?' ↓':' ↑'):'';
  const rbtn=(val,label)=>`<button class="tbtn" style="${rf===val?'border-color:var(--accent);color:#fff':''}" onclick="_roleFilter('${val}')">${label}</button>`;
  html(`
  ${_analyticsTabs()}
  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px">
    <div class="card" style="display:flex;align-items:center;gap:12px;padding:12px 16px">
      <label style="margin:0;text-transform:none;letter-spacing:0;font-size:13px;color:var(--sub)">Доверие ручному весу</label>
      <input type="range" min="0" max="100" step="5" value="${Math.round(w*100)}" style="width:170px" oninput="_wmanChange(this.value)">
      <span id="wman-out" style="font-family:'JetBrains Mono',monospace;font-weight:600;color:#fff;min-width:36px">${w.toFixed(2)}</span>
    </div>
    <button class="btn btn-y" onclick="saveWeights()">Сохранить</button>
    <span class="count-chip">${rows.length} из ${_W.rows.length}</span>
  </div>
  <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:14px">
    <span style="font-size:12px;color:var(--sub);margin-right:4px">Роль:</span>
    ${rbtn('all','Все')}${_ROLES.map(([v,l])=>rbtn(v,l)).join('')}
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
      const open=_W.expanded.has(r.id);
      const hasC=_displayConsts(r).length>0;
      const badge=(t,attr)=>`<span ${attr} style="display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:22px;font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:14px;color:#181820;background:${t.c};border-radius:5px;padding:0 6px">${t.t}</span>`;
      return `<tr data-ri="${idx}" style="border-top:1px solid var(--line)">
        <td style="padding:9px 14px"><div style="display:flex;align-items:center;gap:9px;${hasC?'cursor:pointer':''}" ${hasC?`onclick="_toggleExpand('${r.id}')" title="Показать констелляции"`:''}><span style="color:var(--sub);width:12px;display:inline-block;transition:transform .15s;${open?'transform:rotate(90deg)':''};${hasC?'':'visibility:hidden'}">▶</span>${iconChar(r.c,28)}<span style="font-weight:600">${r.c.name}</span><span style="font-size:11px;color:var(--sub);border:1px solid var(--border);border-radius:4px;padding:0 5px">${_roleLabel(r.role)}</span></div></td>
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
      </tr>${open?_constRowsHtml(r):''}`;
    }).join('')}
    </tbody>
  </table>
  </div>
  <p style="color:var(--sub);font-size:12px;margin-top:12px;line-height:1.5">Клик по персонажу — констелляции (сыгранные майндскейпы + кост/винрейт). Фильтр по ролям сверху. Клик по заголовку — сортировка. Не забудь «Сохранить».</p>`);
}

// Точечная перерисовка ячеек строки БЕЗ пересборки таблицы и без пересортировки —
// иначе тащимый ползунок заменяется новым DOM (застывает), а строка «улетает» при ре-сорте.
// Позиции обновляются только при новой сортировке (клик по заголовку).
// row-like объект строки (персонаж или констелляция) для пересчёта силы
function _rowObj(tr){
  if(tr.dataset.ri!=null&&tr.dataset.ri!=='')return _W.rows[+tr.dataset.ri];
  if(tr.dataset.cw){const[id,ms]=tr.dataset.cw.split(':');const c=(_W.consts[id]||[]).find(x=>x.ms==ms);if(c)return{cost:c.cost,wr:c.wr,man:_cw(id,ms)};}
  return null;
}
function _paintRow(tr){
  const r=_rowObj(tr);if(!r)return;
  const power=_powerOf(r,_W.wman),tier=_tierOf(power),mtier=_tierOf(_manPowerOf(r));
  tr.querySelector('[data-man]').textContent=r.man;
  const mb=tr.querySelector('[data-mantier]');mb.textContent=mtier.t;mb.style.background=mtier.c;
  tr.querySelector('[data-power]').textContent=Math.round(power);
  const badge=tr.querySelector('[data-tierbadge]');badge.textContent=tier.t;badge.style.background=tier.c;
  const bar=tr.querySelector('[data-tierbar]');bar.style.width=Math.round(power)+'%';bar.style.background=tier.c;
}
function _wmanChange(val){
  _W.wman=+val/100;localStorage.setItem(_WMAN_KEY,_W.wman);document.getElementById('wman-out').textContent=_W.wman.toFixed(2);
  document.querySelectorAll('#page-content tbody tr[data-ri],#page-content tbody tr[data-cw]').forEach(_paintRow);
}
function _sortW(key){if(_W.sortKey===key)_W.sortDir*=-1;else{_W.sortKey=key;_W.sortDir=-1;}_renderWeights();}
function _roleFilter(v){_W.roleFilter=v;_renderWeights();}
function _toggleExpand(id){if(_W.expanded.has(id))_W.expanded.delete(id);else _W.expanded.add(id);_renderWeights();}
function _manChange(idx,val){_W.rows[idx].man=+val;const tr=document.querySelector(`#page-content tbody tr[data-ri="${idx}"]`);if(tr)_paintRow(tr);}
function _cmanChange(id,ms,val){(_W.cweights[id]=_W.cweights[id]||{})[ms]=+val;const tr=document.querySelector(`#page-content tbody tr[data-cw="${id}:${ms}"]`);if(tr)_paintRow(tr);}

async function saveWeights(){
  const now=new Date().toISOString();
  const payload=_W.rows.map(r=>({character_id:r.id,manual_weight:r.man,updated_at:now}));
  const{error}=await sb.from('char_weights').upsert(payload,{onConflict:'character_id'});
  if(dbErr(error,'сохранение весов'))return;
  // веса констелляций (только реально сыгранные майндскейпы)
  const cpayload=[];
  for(const id in (_W.cweights||{}))for(const ms in _W.cweights[id])
    cpayload.push({character_id:id,mindscape:+ms,manual_weight:_W.cweights[id][ms],updated_at:now});
  if(cpayload.length){
    const{error:e2}=await sb.from('char_const_weights').upsert(cpayload,{onConflict:'character_id,mindscape'});
    if(dbErr(e2,'сохранение весов констелляций'))return;
  }
  toast('Веса сохранены');
}

// ===== Редактор тегов синергии + майндскейпов (Аналитика → Теги + майндскейпы) =====
// Источник правды — таблица synergy_tags (jsonb на персонажа). Базовые roles/gives/needs
// = шкала 0-4 (M0); ms.gives_self / ms.gives — мидскейпы (mag вне 0-4 допустим, at = порог M).
// Автосохранение построчно (debounce), фолбэк-база — web/data/synergy_tags.json.
// Единый словарь тегов: [ключ, короткая метка, полное описание]. Метки приведены к
// одному виду (Существительное + игровой термин), описания — в тултип.
const _TAGVOCAB=[
  ['atk_buff','Баф ATK','Повышение ATK команде (ширикам ~0.5, скейлятся от HP)'],
  ['dmg_buff','Общий DMG','Универсальный DMG% / DMG-taken / снижение всех RES — полезен всем'],
  ['crit_buff','Крит','Крит-шанс / крит-урон (CRIT Rate / DMG)'],
  ['anomaly_buff','Аномалия','Баф аномалий: Buildup / Proficiency / урон Disorder'],
  ['sheer_dmg_buff','Sheer-урон','Баф Sheer-урона / Sheer Force (разрушение)'],
  ['pen_buff','Пробитие (PEN)','Повышение PEN команде — пробитие DEF'],
  ['def_shred','Снижение DEF','Снижение DEF врага'],
  ['daze','Оглушение','Накопление оглушения / Daze'],
  ['amp_on_stun','Множитель по стану','Множитель урона по застанненному + продление стана'],
  ['anomaly_assist','Разгон аномалий','Разгон аномалий / Disorder союзникам'],
  ['decibel','Децибелы','Генерация децибелов (полезно, редко «нужно»)'],
  ['aftershock','Афтершок','Aftershock: количество и бафы'],
  ['abloom','Расцвет (Abloom)','Abloom для аномалистов: количество и бафы'],
  ['ether_veil','Эфирная вуаль','Ether Veil'],
];
const _ROLEVOCAB=[
  ['crit_dps','Крит-ДПС'],['sheer_dps','Шир-ДПС (Sheer)'],['sub_dps','Саб-ДПС'],
  ['main_anomaly','Мейн-аномалист'],['sub_anomaly','Саб-аномалист'],['stunner','Станер'],
  ['support','Саппорт'],['off_field','Офф-филд'],
];
// внутренние под-теги бафов Шиюй (не входят в редактируемый словарь, но встречаются в эффектах)
const _TAG_ALIAS={dmg_buff_elem:'DMG элемента',dmg_buff_skill:'DMG по кнопке'};
const _tlbl=t=>_TAG_ALIAS[t]||(_TAGVOCAB.find(x=>x[0]===t)||[t,t])[1];
const _ttip=t=>(_TAGVOCAB.find(x=>x[0]===t)||[t,t,''])[2]||'';
const _rlbl=r=>(_ROLEVOCAB.find(x=>x[0]===r)||[r,r])[1];
// короткие заголовки для горизонтальной раскладки (полное имя — в title)
const _TAGSHORT={atk_buff:'ATK',dmg_buff:'DMG',crit_buff:'Крит',anomaly_buff:'Аном',sheer_dmg_buff:'Sheer',
  pen_buff:'PEN',def_shred:'DEF↓',daze:'Оглуш',amp_on_stun:'AmpST',anomaly_assist:'Разгон',
  decibel:'Деци',aftershock:'Афт',abloom:'Abloom',ether_veil:'Вуаль'};
const _ROLESHORT={crit_dps:'КритДПС',sheer_dps:'Шир',sub_dps:'СабДПС',main_anomaly:'МейнАн',
  sub_anomaly:'СабАн',stunner:'Стан',support:'Сапп',off_field:'ОффФ'};
// имена в synergy_tags — полные; в D.chars — короткие (см. ALIAS в synergy.js). Матчим по имени,
// чтобы вытащить настоящую карточку персонажа (иконку). Иначе iconChar не находит файл.
const _NAME_ALIAS={Nicole:'Nicole Demara',Lycaon:'Von Lycaon',Lucy:'Luciana de Montefio',
  Astra:'Astra Yao',Alice:'Alice Thymefield',Burnice:'Burnice White',Vivian:'Vivian Banshee',
  Evelyn:'Evelyn Chevalier',Ellen:'Ellen Joe',Rina:'Alexandrina Sebastiane',
  Yuzuha:'Ukinami Yuzuha',Orphie:'Orphie Magnusson & Magus',Caesar:'Caesar King',
  Yidhari:'Yidhari Murphy',Miyabi:'Hoshimi Miyabi',Pulchra:'Pulchra Fellini',
  'S Anby':'Soldier 0 - Anby',Yanagi:'Tsukishiro Yanagi',Grace:'Grace Howard',
  Koleda:'Koleda Belobog',Seth:'Seth Lowell',Lucia:'Lucia Elowen',
  'S Billy':'Starlight - Billy',Harumasa:'Asaba Harumasa',Nekomata:'Nekomiya Mana',
  Manato:'Komano Manato',Anby:'Anby Demara',Billy:'Billy Kid',
  Corin:'Corin Wickes',Anton:'Anton Ivanov',Velina:'Velina Airgid',Norma:'Norma Hollowell'};
// инверт _NAME_ALIAS: полное имя (в synergy_tags) → короткое (имя файла иконки)
const _FULL2SHORT={};for(const short in _NAME_ALIAS)_FULL2SHORT[_NAME_ALIAS[short]]=short;
function _charByName(name){
  if(!_W.charIdx&&D.chars&&D.chars.length){ // строим индекс только когда карточки реально загружены
    _W.charIdx={};
    D.chars.forEach(c=>{if(!c||!c.name)return;_W.charIdx[c.name]=c;
      const full=_NAME_ALIAS[c.name];if(full)_W.charIdx[full]=c;});
  }
  // карточка (даёт icon_url из БД + роль), иначе — фолбэк с коротким именем под файл иконки
  return (_W.charIdx&&_W.charIdx[name])||{name:_FULL2SHORT[name]||name};
}
function _tagChar(id){
  const t=_W.tags[id]||{};
  return _charByName(t.name);
}

async function _loadTags(){
  if(!D.chars||!D.chars.length){ // прямой заход на вкладку тегов — карточки персонажей (иконки) ещё не загружены
    D.chars=await _fetchAllW('characters');D.charMap={};D.chars.forEach(c=>D.charMap[c.id]=c);_W.charIdx=null;
  }
  const[base,rows]=await Promise.all([
    fetch('web/data/synergy_tags.json?v='+Date.now()).then(r=>r.json()).catch(()=>({})),
    _fetchAllW('synergy_tags')
  ]);
  const map={};
  for(const cid in base)map[cid]=_msNorm(JSON.parse(JSON.stringify(base[cid])));
  _W.tagDb=new Set();
  rows.forEach(r=>{map[r.character_id]=_msNorm(r.data);_W.tagDb.add(String(r.character_id));});
  _W.tags=map;_W.tagsLoaded=true;
}

// нормализуем ms: gives_self/gives → массив [{tag,mag,at}]. Старый формат — объект {tag:{mag,at}}
// (один тег = одна строка). Массив снимает слияние: тег можно повторять (напр. Грейс даёт себе
// разгон аномалии в нескольких констах). mag — АБСОЛЮТНОЕ значение тега с этого M (не +к M0).
// ms.dmg (множитель урона M1-6) остаётся в редакторе для заполнения, но в расчётах НЕ участвует.
function _msNorm(t){
  if(!t)return t;
  const ms=t.ms=t.ms||{};
  ['gives_self','gives'].forEach(which=>{
    const cur=ms[which];
    if(Array.isArray(cur)){ms[which]=cur.map(e=>({tag:e.tag,mag:+e.mag||0,at:+e.at||1}));return;}
    if(cur&&typeof cur==='object')ms[which]=Object.keys(cur).map(tag=>({tag,mag:+(cur[tag].mag)||0,at:+(cur[tag].at)||1}));
    else ms[which]=[];
  });
  ms.dmg=ms.dmg||{};
  return t;
}

function _renderTagsEditor(){
  if(!_W.tagsLoaded){
    html(`${_analyticsTabs()}<div class="card" style="padding:22px"><span class="spinner"></span> Загружаю теги…</div>`);
    _loadTags().then(_renderTagsEditor).catch(e=>{_W.tagsLoaded=false;html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка загрузки тегов: ${e.message}</div>`);});
    return;
  }
  const q=(_W.tagQ||'').toLowerCase();
  const ids=Object.keys(_W.tags).sort((a,b)=>(_W.tags[a].name||'').localeCompare(_W.tags[b].name||'','ru'))
    .filter(id=>!q||(_W.tags[id].name||'').toLowerCase().includes(q));
  const dbN=_W.tagDb?_W.tagDb.size:0;
  html(`${_analyticsTabs()}
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
    <input placeholder="фильтр по имени…" value="${_W.tagQ||''}" oninput="_tagSearch(this.value)"
      style="background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:7px;padding:7px 11px;font-size:13px;min-width:200px">
    <span class="count-chip">${ids.length} персонажей</span>
    <span style="font-size:12px;color:var(--sub)">в БД: ${dbN}/57</span>
    <button class="btn" onclick="_tagImport()" title="Залить текущий web/data/synergy_tags.json в таблицу synergy_tags (перезапишет)">Импорт из файла → БД</button>
    <span id="tag-status" style="font-size:12px;color:var(--sub)"></span>
  </div>
  <p style="color:var(--sub);font-size:12px;margin:0 0 12px;line-height:1.5">Клик по персонажу — редактор. Базовые роли/даёт/нужно — шкала 0-4 (M0). Майндскейпы: «даёт себе»/«даёт команде» строками (тег · значение · с какого M) — значение абсолютное с этого M, может быть больше 4, тег можно повторять. Сохраняется автоматически.</p>
  <div class="card" style="padding:0;overflow:hidden">${ids.map(_tagRow).join('')}</div>`);
}

function _tagPill(txt,color){return `<span style="display:inline-block;font-size:11px;color:${color||'var(--sub)'};border:1px solid var(--border);border-radius:4px;padding:1px 7px;margin:0 4px 2px 0;white-space:nowrap">${txt}</span>`;}

function _tagRow(id){
  const t=_W.tags[id],open=_W.tagExpand===id;
  const inDb=_W.tagDb&&_W.tagDb.has(String(id));
  const c=_tagChar(id);
  const roles=Object.keys(t.roles||{}).filter(r=>t.roles[r]).sort((a,b)=>t.roles[b]-t.roles[a]);
  const rolePills=roles.length?roles.map(r=>_tagPill(_rlbl(r))).join(''):'<span style="color:var(--sub);font-size:12px">— роли не заданы —</span>';
  const gives=Object.keys(t.gives||{}).filter(k=>t.gives[k]).sort((a,b)=>t.gives[b]-t.gives[a]).slice(0,4);
  const givePreview=gives.length?gives.map(k=>`${_tlbl(k)} ${t.gives[k]}`).join(' · '):'';
  const msN=t.ms?((t.ms.gives_self||[]).length+(t.ms.gives||[]).length):0;
  const head=`<div onclick="_tagToggle('${id}')" style="display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;border-top:1px solid var(--line);${open?'background:var(--field)':''}">
    <span style="color:var(--sub);width:12px;flex-shrink:0;transition:transform .15s;${open?'transform:rotate(90deg)':''}">▶</span>
    ${iconChar(c,30)}
    <div style="min-width:180px;flex-shrink:0"><div style="font-weight:600">${t.name}</div>
      <div style="font-size:11px;color:var(--sub)">${(t.element||'')} ${t.specialty?('· '+t.specialty):''}</div></div>
    <div style="flex:1;min-width:0">${rolePills}${givePreview?`<div style="font-size:11px;color:var(--sub);margin-top:2px">даёт: ${givePreview}</div>`:''}</div>
    ${msN?_tagPill('майндскейпы: '+msN,'var(--accent)'):''}
    <span style="flex-shrink:0;font-size:11px;color:${inDb?'var(--accent)':'var(--sub)'}">${inDb?'● в БД':'○ из файла'}</span>
  </div>`;
  return head+(open?_tagForm(id):'');
}

// сегментированный контрол 0..4 (пусто=0). call — JS с плейсхолдером {v}.
function _seg(cur,call,max){
  cur=+cur||0;let b='';
  for(let i=0;i<=(max||4);i++){
    const on=cur===i;
    b+=`<button onclick="${call.replace('{v}',i)}" style="width:24px;height:24px;font-size:12px;font-weight:600;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent)':'transparent'};color:${on?'#181820':(i===0?'var(--sub)':'var(--text)')};border-radius:5px;cursor:pointer;padding:0">${i}</button>`;
  }
  return `<span style="display:inline-flex;gap:3px">${b}</span>`;
}

function _tagForm(id){
  const t=_W.tags[id];
  const ms=t.ms||(t.ms={gives_self:[],gives:[],dmg:{},note:'',a_rank:false});
  const cellSt='padding:6px 10px;border-bottom:1px solid var(--line)';
  const H=s=>`<div style="font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:13px;letter-spacing:.03em;color:var(--text);margin:18px 0 8px">${s}</div>`;

  // числовое поле 0-4 (сегменты не влезают в 14 колонок → просто цифра)
  const numIn=(val,call)=>`<input type="number" min="0" max="4" step="1" value="${val!=null&&val!==0?val:''}" onchange="${call}" style="width:40px;background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 4px;font-size:13px;text-align:center">`;
  const colTh='padding:5px 6px;font-size:11px;color:var(--sub);text-align:center;white-space:nowrap;border-bottom:1px solid var(--line)';
  const cellC='padding:4px 6px;text-align:center;border-bottom:1px solid var(--line)';
  const rowLbl='padding:5px 12px 5px 0;font-size:12px;color:var(--text);white-space:nowrap;text-align:right;border-bottom:1px solid var(--line)';

  // Роли — в строчку (теги-колонки), значения под ними
  const roleTable=`<div style="overflow-x:auto"><table style="border-collapse:collapse">
    <thead><tr><th style="${rowLbl}"></th>${_ROLEVOCAB.map(([k])=>`<th style="${colTh}" title="${_rlbl(k)}">${_ROLESHORT[k]||_rlbl(k)}</th>`).join('')}</tr></thead>
    <tbody><tr><td style="${rowLbl}">Роль</td>${_ROLEVOCAB.map(([k])=>`<td style="${cellC}">${numIn((t.roles||{})[k],`_tagRole('${id}','${k}',this.value)`)}</td>`).join('')}</tr></tbody>
  </table></div>`;

  // Базовые теги — теги В СТРОЧКУ (колонки), «Даёт»/«Нужно» В СТОЛБИК (строки)
  const tagCols=_TAGVOCAB.map(([k])=>`<th style="${colTh}" title="${_tlbl(k)} — ${_ttip(k)}">${_TAGSHORT[k]||k}</th>`).join('');
  const baseTable=`<div style="overflow-x:auto"><table style="border-collapse:collapse">
    <thead><tr><th style="${rowLbl}"></th>${tagCols}</tr></thead>
    <tbody>
      <tr><td style="${rowLbl}">Даёт команде</td>${_TAGVOCAB.map(([k])=>`<td style="${cellC}">${numIn((t.gives||{})[k],`_tagBase('${id}','gives','${k}',this.value)`)}</td>`).join('')}</tr>
      <tr><td style="${rowLbl}">Нужно</td>${_TAGVOCAB.map(([k])=>`<td style="${cellC}">${numIn((t.needs||{})[k],`_tagBase('${id}','needs','${k}',this.value)`)}</td>`).join('')}</tr>
    </tbody></table></div>`;

  // Мидскейпы: таблица Тег | Значение | С M | ✕. Строки — массив (тег можно повторять).
  const msTable=(which)=>{
    const arr=ms[which]||[];
    const rows=arr.map((v,i)=>{
      const tagOpts=_TAGVOCAB.map(([k,l])=>`<option value="${k}" ${k===v.tag?'selected':''}>${l}</option>`).join('');
      const atOpts=[1,2,3,4,5,6].map(m=>`<option value="${m}" ${+v.at===m?'selected':''}>M${m}</option>`).join('');
      const inSt='background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:12px';
      return `<tr>
        <td style="${cellSt}"><select onchange="_tagMsSet('${id}','${which}',${i},'tag',this.value)" style="${inSt};min-width:150px">${tagOpts}</select></td>
        <td style="${cellSt};text-align:center"><input type="number" step="0.5" value="${v.mag}" onchange="_tagMsSet('${id}','${which}',${i},'mag',this.value)" style="${inSt};width:60px;text-align:center"></td>
        <td style="${cellSt};text-align:center"><select onchange="_tagMsSet('${id}','${which}',${i},'at',this.value)" style="${inSt}">${atOpts}</select></td>
        <td style="${cellSt};text-align:center"><button class="btn" style="padding:2px 9px" onclick="_tagMsDel('${id}','${which}',${i})">✕</button></td></tr>`;}).join('')
      ||`<tr><td colspan="4" style="${cellSt};color:var(--sub);font-size:12px">— пусто —</td></tr>`;
    return `<table style="border-collapse:collapse;width:100%">
      <thead><tr style="font-size:11px;color:var(--sub);text-transform:uppercase">
        <th style="text-align:left;padding:4px 10px">Тег</th><th style="padding:4px 10px">Значение с M</th>
        <th style="padding:4px 10px">С M</th><th style="padding:4px 10px"></th></tr></thead>
      <tbody>${rows}</tbody></table>
      <button class="btn" style="padding:3px 12px;margin-top:6px" onclick="_tagMsAdd('${id}','${which}')">+ добавить</button>`;
  };

  const dmg=ms.dmg||{};
  const dmgRow=`<div style="display:flex;gap:10px;flex-wrap:wrap">`+[1,2,3,4,5,6].map(m=>`<label style="display:inline-flex;flex-direction:column;gap:3px;font-size:12px;color:var(--sub)">M${m}<input type="number" step="0.01" placeholder="1.00" value="${dmg[m]!=null?dmg[m]:''}" onchange="_tagDmg('${id}',${m},this.value)" style="width:70px;background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:4px 6px;font-size:13px;text-align:center"></label>`).join('')+`</div>`;

  const noteSt='width:100%;background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 10px;font-size:13px';
  return `<div style="padding:6px 20px 22px 42px;background:var(--field);border-top:1px solid var(--line)">
    ${H('Роли — насколько исполняет (0-4)')}${roleTable}
    ${H('Базовые теги на M0 (0-4)')}
    <div style="font-size:12px;color:var(--sub);margin:-4px 0 8px">«Даёт команде» — сила эффекта. «Нужно» — насколько критично агенту. Наведи на заголовок — полное название.</div>
    ${baseTable}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;margin-top:4px">
      <div>${H('Майндскейпы — даёт себе')}${msTable('gives_self')}</div>
      <div>${H('Майндскейпы — даёт команде')}${msTable('gives')}</div>
    </div>
    <div style="font-size:12px;color:var(--sub);margin-top:6px">«Значение» — АБСОЛЮТНОЕ значение тега начиная с указанного M (не прибавка к M0). Пример: на M0 тег = 3, ставим 4 на M1 → с M1 значение просто 4 (не 3+4). Может быть больше 4 (шкала 0-4 — только для базовых тегов M0). «С M» — с какого майндскейпа значение действует. Один тег можно добавить несколько раз (разные пороги M).</div>
    ${H('Множитель урона по майндскейпам (× к M0)')}
    <div style="font-size:12px;color:var(--sub);margin:-4px 0 8px">Заполняется отдельно от «даёт себе/команде». В расчётах пока НЕ участвует — только справочно, пока не заполнишь.</div>
    ${dmgRow}
    <label style="display:inline-flex;align-items:center;gap:7px;font-size:13px;margin-top:16px;cursor:pointer">
      <input type="checkbox" ${ms.a_rank?'checked':''} onchange="_tagARank('${id}',this.checked)"> A-ранг — эффекты считаем как на M6</label>
    ${H('Заметка')}<input value="${(t.note||'').replace(/"/g,'&quot;')}" onchange="_tagNote('${id}','note',this.value)" style="${noteSt}">
    ${H('Заметка по майндскейпам')}<input value="${(ms.note||'').replace(/"/g,'&quot;')}" onchange="_tagNote('${id}','ms.note',this.value)" style="${noteSt}">
  </div>`;
}

// --- state mutations + autosave ---
function _tagSearch(v){_W.tagQ=v;_renderTagsEditor();}
function _tagToggle(id){_W.tagExpand=_W.tagExpand===id?null:id;_renderTagsEditor();}
// числовые поля (onchange по blur) — БЕЗ ре-рендера, иначе теряется фокус
function _tagRole(id,role,v){const t=_W.tags[id];v=Math.max(0,Math.min(4,+v||0));if(v)t.roles[role]=v;else delete t.roles[role];_tagQueueSave(id);}
function _tagBase(id,kind,tag,v){const t=_W.tags[id];t[kind]=t[kind]||{};v=Math.max(0,Math.min(4,+v||0));if(v)t[kind][tag]=v;else delete t[kind][tag];_tagQueueSave(id);}
function _tagMs(id){const t=_W.tags[id];return t.ms||(t.ms={gives_self:[],gives:[],dmg:{},note:'',a_rank:false});}
function _tagMsAdd(id,which){const m=_tagMs(id);m[which]=m[which]||[];m[which].push({tag:'dmg_buff',mag:1,at:1});_tagQueueSave(id);_renderTagsEditor();}
function _tagMsSet(id,which,i,field,v){const m=_tagMs(id);const e=m[which]&&m[which][i];if(!e)return;e[field]=(field==='tag')?v:(field==='at'?+v:parseFloat(v));_tagQueueSave(id);if(field==='tag')_renderTagsEditor();}
function _tagMsDel(id,which,i){const m=_tagMs(id);if(m[which])m[which].splice(i,1);_tagQueueSave(id);_renderTagsEditor();}
function _tagDmg(id,mval,v){const m=_tagMs(id);m.dmg=m.dmg||{};if(v==='')delete m.dmg[mval];else m.dmg[mval]=parseFloat(v);_tagQueueSave(id);}
function _tagARank(id,on){_tagMs(id).a_rank=!!on;_tagQueueSave(id);}
function _tagNote(id,path,v){const t=_W.tags[id];if(path==='ms.note')_tagMs(id).note=v;else t.note=v;_tagQueueSave(id);}

function _tagStatus(s,color){const el=document.getElementById('tag-status');if(el){el.textContent=s;el.style.color=color||'var(--sub)';}}
_W.tagSaveT={};
function _tagQueueSave(id){
  _tagStatus('изменено…','var(--sub)');
  clearTimeout(_W.tagSaveT[id]);
  _W.tagSaveT[id]=setTimeout(()=>_tagSave(id),700);
}
async function _tagSave(id){
  const{error}=await sb.from('synergy_tags').upsert(
    {character_id:+id,data:_W.tags[id],updated_at:new Date().toISOString()},{onConflict:'character_id'});
  if(error){_tagStatus('ошибка сохранения','var(--red)');dbErr(error,'сохранение тегов');return;}
  if(_W.tagDb)_W.tagDb.add(String(id));
  _tagStatus('✓ сохранено '+(_W.tags[id].name||id),'var(--accent)');
}
async function _tagImport(){
  if(!confirm('Залить web/data/synergy_tags.json в таблицу synergy_tags? Перезапишет существующие строки.'))return;
  _tagStatus('импорт…');
  const base=await fetch('web/data/synergy_tags.json?v='+Date.now()).then(r=>r.json()).catch(()=>null);
  if(!base){_tagStatus('файл не найден','var(--red)');return;}
  const now=new Date().toISOString();
  const payload=Object.keys(base).map(cid=>({character_id:+cid,data:base[cid],updated_at:now}));
  const{error}=await sb.from('synergy_tags').upsert(payload,{onConflict:'character_id'});
  if(dbErr(error,'импорт тегов')){_tagStatus('ошибка','var(--red)');return;}
  _W.tagsLoaded=false;_tagStatus('✓ импортировано '+payload.length);toast('Теги импортированы в БД');_renderTagsEditor();
}

// ===== Ключевые слова бафов Шиюй: таксономия + автоматч + уверенность =====
// Категории с цветами. Автоматч подсвечивает распознанное; по категориям решаем,
// можно ли гейтить авто (элемент/тип урона — да) или нужен ручной выбор персонажей
// (кнопочные клаузы: доля урона по конкретной кнопке у персонажей разная).
const _KW_CAT={element:{l:'Элемент',c:'#5b9dff'},archetype:{l:'Тип урона',c:'#b18cff'},
  button:{l:'Тип атаки',c:'#ffab5b'},stat:{l:'Стат / эффект',c:'#4fd6b8'},cond:{l:'Условие',c:'#8a8a99'}};
const _KW_TERMS=[
  ['physical','element'],['fire','element'],['ice','element'],['electric','element'],['ether','element'],['wind','element'],
  ['anomaly proficiency','archetype'],['anomaly buildup','archetype'],['attribute anomaly','archetype'],['sheer force','archetype'],
  ['sheer','archetype'],['anomaly','archetype'],['abloom','archetype'],['disorder','archetype'],['daze','archetype'],['stun','archetype'],
  ['ex special attack','button'],['basic attack','button'],['dash attack','button'],['special attack','button'],['chain attack','button'],
  ['ultimate','button'],['quick assist','button'],['defensive assist','button'],['assist follow-up','button'],['aftershock','button'],
  ['dodge counter','button'],['assist','button'],
  ['all-attribute res','stat'],['attribute dmg res','stat'],['crit rate','stat'],['crit dmg','stat'],['pen ratio','stat'],
  ['res','stat'],['def','stat'],['atk','stat'],['crit','stat'],['pen','stat'],['impact','stat'],['energy','stat'],['decibel','stat'],
  ['dmg','stat'],['damage','stat'],['hp','stat'],
  ['on hit','cond'],['repeated triggers','cond'],['afflicted','cond'],['when','cond'],['after','cond'],['upon','cond'],['while','cond'],
].sort((a,b)=>b[0].length-a[0].length);
function _kwScan(text){
  const low=(text||'').toLowerCase();const used=new Array(low.length).fill(false);const ranges=[];
  _KW_TERMS.forEach(([term,cat])=>{
    let idx=0;
    while((idx=low.indexOf(term,idx))!==-1){
      const before=idx===0||!/[a-z]/.test(low[idx-1]);
      const after=idx+term.length>=low.length||!/[a-z]/.test(low[idx+term.length]);
      let free=true;for(let k=idx;k<idx+term.length;k++)if(used[k]){free=false;break;}
      if(before&&after&&free){ranges.push({s:idx,e:idx+term.length,cat,term});for(let k=idx;k<idx+term.length;k++)used[k]=true;}
      idx+=term.length;
    }
  });
  ranges.sort((a,b)=>a.s-b.s);
  const byCat={element:[],archetype:[],button:[],stat:[],cond:[]};
  ranges.forEach(r=>{if(!byCat[r.cat].includes(r.term))byCat[r.cat].push(r.term);});
  return {ranges,byCat};
}
function _kwHighlight(text){
  if(!text)return '<span style="color:var(--sub)">— нет текста —</span>';
  const {ranges}=_kwScan(text);let out='',pos=0;
  ranges.forEach(r=>{if(r.s<pos)return;out+=escapeHtml(text.slice(pos,r.s));
    const col=_KW_CAT[r.cat].c;
    out+=`<mark style="background:${col}22;color:${col};border-radius:3px;padding:0 3px" title="${_KW_CAT[r.cat].l}">${escapeHtml(text.slice(r.s,r.e))}</mark>`;
    pos=r.e;});
  out+=escapeHtml(text.slice(pos));return out;
}
// уверенность авто-гейта части по распознанным категориям
function _partConfidence(e){
  const s=_kwScan(e.desc||'');
  const hasEl=s.byCat.element.length>0,hasArch=s.byCat.archetype.length>0,hasBtn=s.byCat.button.length>0;
  if(e.chars&&e.chars.length)return{c:'#3ddc84',t:`вручную: ${e.chars.length} перс.`};
  if(hasBtn&&!hasEl&&!hasArch)return{c:'#ff6b6b',t:'кнопочный — авто не справится, укажи персонажей'};
  if(hasBtn&&(hasEl||hasArch))return{c:'#f5c842',t:'ограничение по кнопке — проверь/уточни'};
  if(hasArch)return{c:'#3ddc84',t:'авто по типу урона'};
  if(hasEl)return{c:'#3ddc84',t:'авто по элементу'};
  return{c:'#f5c842',t:'проверь — авто не уверен'};
}
function _kwLegend(){
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:11px">`
    +Object.values(_KW_CAT).map(v=>`<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:${v.c}"></span>${v.l}</span>`).join('')
    +`<span style="display:inline-flex;align-items:center;gap:4px;margin-left:8px"><span style="width:10px;height:10px;border-radius:50%;background:#3ddc84"></span>авто</span>`
    +`<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:50%;background:#f5c842"></span>проверить</span>`
    +`<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:50%;background:#ff6b6b"></span>вручную</span></div>`;
}

// ===== Влияние бафов Шиюй (Аналитика → Влияние бафов Шиюй) =====
// Три блока: (1) справочник множителей всех семейств бафов, (2) какие бафы у турниров,
// (3) редактор текущих множителей выбранного турнира. Константы зеркалят tournaments.js
// (BUFF_BAND) и synergy.js (гейты buffMatchup). mag = 0.4 + 0.6·норм; условие ×0.7.
const _BUFF_FAMILIES=[
  ['dmg_buff','Общий DMG',[10,40],'всем','DMG% / DMG-taken / снижение всех RES — универсально'],
  ['dmg_buff_elem','DMG элемента',[10,40],'доля урона в баф-элементах','DMG% элемента и «ignore <эл> RES» — только урон этого элемента'],
  ['dmg_buff_skill','DMG по кнопке',[10,40],'≈0.5 (заглушка)','DMG% по типу атаки (Basic/EX/Chain/Ult) — нужна раскладка урона'],
  ['atk_buff','Баф ATK',[10,30],'всем','ATK кормит все формулы (стандарт/аномалия/шир)'],
  ['sheer_dmg_buff','Sheer-урон',[20,40],'доля Sheer-ДПС','Sheer DMG / Sheer Force'],
  ['crit_buff','Крит',[15,40],'доля крит-ДПС','CRIT множитель ≈1 у аномалы/шир → им не идёт'],
  ['anomaly_buff','Аномалия',[15,40],'доля аномалии','Buildup / Proficiency / урон Disorder (AP плоские очки: 30–60)'],
  ['pen_buff','Пробитие (PEN)',[10,20],'1 − доля Sheer','Sheer игнорит DEF → PEN бесполезен ширикам'],
  ['def_shred','Снижение DEF',[10,25],'1 − доля Sheer','Снижение DEF врага — ширикам не нужно'],
];
// тег бафа турнира: сохранённый buff_tag, иначе доразбор из текста ротации на лету
// (старые ротации грузились до появления парсера — тега нет, но buff.lines есть).
function _shyTag(t){
  const sd=t.shiyu_data||{};
  if(sd.buff_tag)return sd.buff_tag;
  const raw=(sd.buff&&sd.buff.lines&&sd.buff.lines.join('\n'))||(sd.buff&&sd.buff.title)||'';
  const txt=String(raw).replace(/<[^>]+>/g,' ');
  return (typeof parseBuffTag==='function')?parseBuffTag(txt):{elems:[],elem:null,mech:null,strength:0,effects:[]};
}
function _renderShiyuBuffs(){
  // источник — свежий список турниров (D.tours на этой странице может быть ещё не загружен)
  if(!_W.shyLoaded){
    html(`${_analyticsTabs()}<div class="card" style="padding:22px"><span class="spinner"></span> Загружаю ротации…</div>`);
    Promise.all([_fetchAllW('tournaments'),
      fetch('web/data/synergy_tags.json?v='+Date.now()).then(r=>r.json()).catch(()=>({})),
      (D.chars&&D.chars.length)?Promise.resolve(D.chars):_fetchAllW('characters')])
      .then(([rows,tj,chars])=>{_W.shyTours=rows;
        if(!D.chars||!D.chars.length){D.chars=chars;D.charMap={};chars.forEach(c=>D.charMap[c.id]=c);}
        _W.shyCharMap={};(chars||[]).forEach(c=>_W.shyCharMap[c.id]=c);
        // ростер для пикера: карточка персонажа (иконка+имя) по id из synergy_tags
        _W.shyRoster=Object.entries(tj).map(([id,v])=>({id,name:(_W.shyCharMap[id]&&_W.shyCharMap[id].name)||v.name}))
          .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ru'));
        _W.shyLoaded=true;_renderShiyuBuffs();})
      .catch(e=>html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка загрузки: ${e.message}</div>`));
    return;
  }
  const tours=(_W.shyTours||[]).filter(t=>t.shiyu_data);       // все загруженные ротации
  if(_W.shyTour===undefined||!tours.some(t=>t.id===_W.shyTour))_W.shyTour=tours.length?tours[0].id:null;
  const card='background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:16px';
  const H=s=>`<div style="font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:14px;letter-spacing:.03em;color:var(--text);margin:0 0 10px">${s}</div>`;
  const th='text-align:left;padding:6px 10px;font-size:11px;color:var(--sub);text-transform:uppercase;border-bottom:1px solid var(--line)';
  const td='padding:7px 10px;border-bottom:1px solid var(--line);font-size:13px';

  // (1) справочник семейств: сила по умолчанию задаётся руками (0-4), сохраняется локально,
  // применяется как стартовая сила новых эффектов этого семейства
  const famRows=_BUFF_FAMILIES.map(([k,l,band,gate,desc])=>`<tr>
    <td style="${td}"><b>${l}</b><div style="font-size:11px;color:var(--sub)">${desc}</div></td>
    <td style="${td};text-align:center;font-family:'JetBrains Mono',monospace">${band[0]}–${band[1]}%</td>
    <td style="${td};text-align:center">${_seg(_famW(k),`_shyFamW('${k}',{v})`)}</td>
    <td style="${td}">${gate}</td></tr>`).join('');
  const ref=`<div style="${card}">${H('Общие множители всех видов бафов')}
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:560px">
      <thead><tr><th style="${th}">Семейство бафа</th><th style="${th};text-align:center">Диапазон %</th>
        <th style="${th};text-align:center">Сила (0-4)</th><th style="${th}">Кому применяется (гейт)</th></tr></thead>
      <tbody>${famRows}</tbody></table></div>
    <div style="font-size:12px;color:var(--sub);margin-top:10px;line-height:1.6">
      Сила эффекта — та же шкала <b>0-4</b>, что у тегов. Авто-разбор ставит стартовую силу по % (слабый ≈2, сильный ≈4),
      дальше правится вручную. В модель эффект идёт как <b>сила/4 × попадание отряда</b> (по элементу/архетипу/формуле урона),
      условная строка (when/after/upon) → ×0.7, суммарный вклад ≤ <b>BUFF_CAP = 0.10</b>, вес блока <b>BUFF_W = 0.50</b>,
      нужда отряда = 0.5 + 0.5·(доля дпс, кому эффект нужен).</div></div>`;

  // (2) бафы по турнирам — с описанием ротации
  const bt=t=>{
    const saved=!!(t.shiyu_data&&t.shiyu_data.buff_tag);
    const tag=_shyTag(t);
    const b=t.shiyu_data.buff||{};
    const desc=(b.lines||[]).join('<br>')||escapeHtml(b.title||'—');
    const elems=(tag.elems&&tag.elems.length?tag.elems:(tag.elem?[tag.elem]:[])).map(_elLbl).join(', ')||'—';
    const mechs=((tag.mechs&&tag.mechs.length)?tag.mechs:(tag.mech?[tag.mech]:[])).map(_mechLbl).join(', ')||'—';
    const eff=(tag.effects||[]).map(e=>{const w=e.w!=null?e.w:_w04(e.mag);
      const who=(e.chars&&e.chars.length)?` [${e.chars.length}👤]`:'';
      const ap=(e.apply!=null&&e.apply!==100)?` ${e.apply}%`:'';
      return `${_tlbl(e.tag)} ${w}/4${ap}${who}`;}).join(' · ')||'—';
    const notSaved=saved?'':' <span style="font-size:10px;color:var(--sub);border:1px solid var(--border);border-radius:3px;padding:0 4px">не сохранён</span>';
    return `<tr>
      <td style="${td};vertical-align:top;min-width:150px"><b>${escapeHtml(t.name||t.id)}</b>${notSaved}
        <div style="font-size:12px;color:var(--accent);margin-top:2px">${escapeHtml(b.title||'')}</div></td>
      <td style="${td};font-size:12px;color:var(--sub);max-width:340px;line-height:1.5">${desc}</td>
      <td style="${td};text-align:center;font-size:12px">${elems}</td>
      <td style="${td};text-align:center;font-size:12px">${mechs}</td>
      <td style="${td};font-size:12px">${eff}</td></tr>`;
  };
  const unsaved=tours.filter(t=>!(t.shiyu_data&&t.shiyu_data.buff_tag)).length;
  const backfillBtn=unsaved?`<button class="btn" style="margin-left:12px" onclick="_shyBackfill()" title="Зафиксировать доразобранные теги всех ротаций без buff_tag (иначе разбор идёт заново при каждой загрузке)">Зафиксировать доразбор (${unsaved})</button><span id="shy-bf-status" style="font-size:12px;color:var(--sub);margin-left:8px"></span>`:'';
  const perTour=tours.length?`<div style="${card}">${H('Бафы по турнирам')+backfillBtn}
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:720px">
      <thead><tr><th style="${th}">Турнир · баф</th><th style="${th}">Описание ротации</th><th style="${th};text-align:center">Элементы</th>
        <th style="${th};text-align:center">Архетипы</th><th style="${th}">Эффекты (сила 0-4)</th></tr></thead>
      <tbody>${tours.map(bt).join('')}</tbody></table></div></div>`
    : `<div style="${card}">${H('Бафы по турнирам')}<div style="color:var(--sub);font-size:13px">Ни у одного турнира не загружена ротация Шиюй. Импорт — в «Турниры → Настройки → Ротация Шиюй».</div></div>`;

  // (3) редактор выбранного турнира (мульти-элемент/архетип, сила 0-4, описание)
  let editor='';
  const cur=tours.find(t=>t.id===_W.shyTour);
  const opts=tours.map(t=>`<option value="${t.id}" ${t.id===_W.shyTour?'selected':''}>${escapeHtml(t.name||t.id)}</option>`).join('');
  if(cur){
    const savedTag=!!(cur.shiyu_data&&cur.shiyu_data.buff_tag);
    if(!_W.shyDraft||_W.shyDraftFor!==_W.shyTour){_W.shyDraft=_shyDraftFrom(_shyTag(cur));_W.shyDraftFor=_W.shyTour;}
    const d=_W.shyDraft;
    const b=cur.shiyu_data.buff||{};
    const descBlock=`<div style="background:var(--field);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:16px">
      <div style="font-weight:700;color:var(--accent);margin-bottom:4px">${escapeHtml(b.title||'Баф ротации')}</div>
      <div style="font-size:13px;color:var(--sub);line-height:1.6">${(b.lines||[]).join('<br>')||'—'}</div></div>`;
    const chip=(on,label,call)=>`<button onclick="${call}" style="font-size:12px;padding:4px 11px;border-radius:14px;cursor:pointer;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent)':'transparent'};color:${on?'#181820':'var(--text)'}">${label}</button>`;
    const elChips=_ELEMS.map(([e,l])=>chip(d.elems.includes(e),l,`_shyTglElem('${e}')`)).join(' ');
    const mChips=_MECHS.map(([m,l])=>chip(d.mechs.includes(m),l,`_shyTglMech('${m}')`)).join(' ');
    const inSt='background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:4px 7px;font-size:13px';
    const rosterName={};(_W.shyRoster||[]).forEach(r=>rosterName[r.id]=r.name);
    const tagOpt=e=>[..._TAGVOCAB.map(x=>[x[0],x[1]]),['dmg_buff_elem','DMG элемента'],['dmg_buff_skill','DMG по кнопке']]
      .map(([k,l])=>`<option value="${k}" ${k===e.tag?'selected':''}>${l}</option>`).join('');
    const charCard=cid=>_W.shyCharMap&&_W.shyCharMap[cid]||{name:rosterName[cid]||cid};
    const partCard=(e,i)=>{
      const chars=(e.chars||[]).map(String);
      const isSkill=e.tag==='dmg_buff_skill';
      const ap=e.charApply||{};
      // выбранные персонажи: иконка + имя + (для «DMG по кнопке») свой % работы
      const chipRow=cid=>{
        const c=charCard(cid);
        const pctIn=isSkill?`<input type="number" min="0" max="100" step="5" value="${ap[cid]!=null?ap[cid]:100}" onchange="_shyCharApply(${i},'${cid}',this.value)" title="доля урона этого перса по указанным кнопкам" style="${inSt};width:52px;text-align:center;padding:2px 4px;font-size:11px">%`:'';
        return `<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(83,74,183,.14);border-radius:10px;padding:2px 8px 2px 4px;margin:2px 5px 2px 0">
          ${iconChar(c,22)}<span style="font-size:11.5px;color:#c9c2f2">${escapeHtml(c.name)}</span>${pctIn}
          <span style="cursor:pointer;opacity:.6;font-size:11px" onclick="_shyPartCharTgl(${i},'${cid}')">✕</span></span>`;
      };
      const chips=chars.length?chars.map(chipRow).join('')
        :'<span style="font-size:11px;color:var(--sub)">— не выбраны → авто-гейт по элементу/архетипу —</span>';
      // иконочный пикер персонажей
      let picker='';
      if(_W.shyPartOpen===i){
        const q=(_W.shyPickQ||'').toLowerCase();
        const list=(_W.shyRoster||[]).filter(r=>!q||(r.name||'').toLowerCase().includes(q))
          .map(r=>{const on=chars.includes(String(r.id));const c=charCard(r.id);
            return `<div onclick="_shyPartCharTgl(${i},'${r.id}')" title="${escapeHtml(r.name)}" style="display:flex;flex-direction:column;align-items:center;gap:2px;width:60px;padding:5px 2px;border-radius:8px;cursor:pointer;border:1px solid ${on?'var(--accent)':'transparent'};${on?'background:rgba(83,74,183,.22)':''}">
              ${iconChar(c,38)}<span style="font-size:10px;text-align:center;line-height:1.1;max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.name)}</span></div>`;}).join('');
        picker=`<div style="margin-top:8px;border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--card)">
          <input placeholder="поиск…" value="${escapeHtml(_W.shyPickQ||'')}" oninput="_shyPickSearch(this.value)" style="${inSt};width:200px;margin-bottom:8px">
          <div style="max-height:260px;overflow:auto;display:flex;flex-wrap:wrap;gap:3px">${list||'<span style="color:var(--sub);font-size:12px">ничего не найдено</span>'}</div>
          <button class="btn" style="padding:2px 10px;margin-top:8px" onclick="_shyPartTgl(${i})">Готово</button></div>`;
      }
      // кнопки для «DMG по кнопке»
      const btns=e.buttons||[];
      const btnBlock=isSkill?`<div style="margin-top:10px;padding:10px;border:1px dashed var(--border);border-radius:8px">
        <div style="font-size:12px;color:var(--sub);margin-bottom:6px">Кнопки, по которым идёт DMG (можно несколько)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${_SKILL_BTNS.map(([k,l])=>chip(btns.includes(k),l,`_shyBtnTgl(${i},'${k}')`)).join('')}</div>
        ${btns.length?'':'<div style="font-size:11px;color:#f5c842;margin-top:6px">не выбрана ни одна кнопка</div>'}</div>`:'';
      const conf=_partConfidence(e);
      return `<div style="border:1px solid var(--border);border-left:3px solid ${conf.c};border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--card)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:600;color:${conf.c};border:1px solid ${conf.c}66;border-radius:10px;padding:1px 9px">${conf.t}</span></div>
        <div style="font-size:13px;line-height:1.55;margin-bottom:8px">${_kwHighlight(e.desc||'')}</div>
        <input value="${escapeHtml(e.desc||'')}" onchange="_shyPartField(${i},'desc',this.value)" placeholder="править текст части" style="${inSt};width:100%;margin-bottom:10px;font-size:12px;opacity:.8">
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--sub)">Тип <select onchange="_shyPartField(${i},'tag',this.value)" style="${inSt};margin-left:4px">${tagOpt(e)}</select></label>
          <span style="font-size:12px;color:var(--sub)">Сила ${_seg(e.w!=null?e.w:_w04(e.mag),`_shyEffW(${i},{v})`)}</span>
          <label style="font-size:12px;color:var(--sub)" title="${isSkill?'общий % — переопределяется индивидуальными у персонажей':''}">Работает <input type="number" min="0" max="100" step="5" value="${e.apply!=null?e.apply:100}" onchange="_shyPartField(${i},'apply',this.value)" style="${inSt};width:60px;text-align:center">%</label>
          <label style="font-size:12px;color:var(--sub);display:inline-flex;align-items:center;gap:5px"><input type="checkbox" ${e.cond?'checked':''} onchange="_shyPartField(${i},'cond',this.checked)">условный</label>
          <button class="btn" style="padding:2px 10px;margin-left:auto" onclick="_shyEffDel(${i})">✕ удалить</button>
        </div>
        ${e.pct!=null?`<div style="font-size:11px;color:var(--sub);margin-top:6px">из текста: ${e.pct}${e.flat?'pts':'%'}</div>`:''}
        ${btnBlock}
        <div style="margin-top:10px"><div style="font-size:12px;color:var(--sub);margin-bottom:4px">Для кого работает${isSkill?' (и % урона по кнопкам у каждого)':''}
          <button class="btn" style="padding:1px 9px;margin-left:6px" onclick="_shyPartTgl(${i})">${_W.shyPartOpen===i?'скрыть':'выбрать'} (${chars.length})</button></div>
          <div>${chips}</div>${picker}</div></div>`;
    };
    const partsHTML=d.effects.length?d.effects.map(partCard).join(''):`<div style="color:var(--sub);font-size:13px">Части не заданы.</div>`;
    editor=`<div style="${card}">${H('Редактор бафа — выбор турнира')}
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <label style="font-size:13px;color:var(--sub)">Турнир</label>
        <select onchange="_shyPick(this.value)" style="${inSt};min-width:220px">${opts}</select>
        ${savedTag?'':'<span style="font-size:11px;color:var(--sub);border:1px solid var(--border);border-radius:4px;padding:1px 6px">тег доразобран — сохрани, чтобы зафиксировать</span>'}
      </div>
      ${descBlock}
      <div style="margin-bottom:14px"><div style="font-size:12px;color:var(--sub);margin-bottom:6px">Элементы бафа (можно несколько)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${elChips}</div></div>
      <div style="margin-bottom:16px"><div style="font-size:12px;color:var(--sub);margin-bottom:6px">Архетипы (можно несколько)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${mChips}</div></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:13px;color:var(--sub)">Общая сила бафа (0-4)</span>${_seg(_w04(d.strength),'_shyStr({v})')}</div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">Части бафа</div>
      <div style="font-size:12px;color:var(--sub);margin:-4px 0 10px;line-height:1.5">Ключевые слова подсвечены по категориям. Цвет слева от карточки — уверенность авто-гейта: <b style="color:#3ddc84">зелёный</b> авто (элемент/тип урона), <b style="color:#f5c842">жёлтый</b> проверь, <b style="color:#ff6b6b">красный</b> кнопочный — укажи персонажей вручную.</div>
      ${_kwLegend()}
      ${partsHTML}
      <button class="btn" style="padding:3px 12px;margin-top:4px" onclick="_shyEffAdd()">+ часть</button>
      <div style="margin-top:16px"><button class="btn btn-y" onclick="_shySave()">Сохранить баф</button>
        <span id="shy-status" style="margin-left:12px;font-size:12px;color:var(--sub)"></span></div></div>`;
  }
  html(`${_analyticsTabs()}${ref}${perTour}${editor}`);
}
// элементы/архетипы с русскими метками
const _ELEMS=[['physical','Физика'],['fire','Огонь'],['ice','Лёд'],['electric','Электро'],['ether','Эфир'],['wind','Ветер']];
const _MECHS=[['sheer','Шир'],['anomaly','Аномалия'],['stun','Стан'],['crit','Крит']];
const _elLbl=e=>(_ELEMS.find(x=>x[0]===e)||[e,e])[1];
const _mechLbl=m=>(_MECHS.find(x=>x[0]===m)||[m,m])[1];
// mag(0-1) <-> сила(0-4). Отображаем 0-4, храним 0-1 (модель читает mag=сила/4).
const _w04=mag=>Math.max(0,Math.min(4,Math.round((+mag||0)*4)));
const _magFromW=w=>+((+w||0)/4).toFixed(2);
// ручная сила семейств бафов (0-4) — persist локально, дефолт 3
const _FAM_KEY='zzz_buff_fam';
function _famAll(){try{return JSON.parse(localStorage.getItem(_FAM_KEY))||{};}catch(e){return {};}}
function _famW(k){const v=_famAll()[k];return v==null?3:v;}
function _shyFamW(k,v){const a=_famAll();a[k]=+v||0;localStorage.setItem(_FAM_KEY,JSON.stringify(a));_renderShiyuBuffs();}
// черновик редактора: нормализуем тег к {elems[],mechs[],strength(0-1),effects[]}
function _shyDraftFrom(tag){
  return{
    elems:(tag.elems&&tag.elems.length?tag.elems:(tag.elem?[tag.elem]:[])).slice(),
    mechs:((tag.mechs&&tag.mechs.length)?tag.mechs:(tag.mech?[tag.mech]:[])).slice(),
    strength:tag.strength??0.6,
    effects:(tag.effects||[]).map(e=>({...e}))
  };
}
function _shyPick(id){_W.shyTour=id;_W.shyDraft=null;_renderShiyuBuffs();}
function _shyTglElem(e){const d=_W.shyDraft;const i=d.elems.indexOf(e);i<0?d.elems.push(e):d.elems.splice(i,1);_renderShiyuBuffs();}
function _shyTglMech(m){const d=_W.shyDraft;const i=d.mechs.indexOf(m);i<0?d.mechs.push(m):d.mechs.splice(i,1);_renderShiyuBuffs();}
function _shyStr(w){_W.shyDraft.strength=_magFromW(w);_renderShiyuBuffs();}
function _shyEffW(i,w){const e=_W.shyDraft.effects[i];e.w=+w||0;e.mag=_magFromW(w);_renderShiyuBuffs();}
function _shyPartField(i,field,val){const e=_W.shyDraft.effects[i];
  if(field==='apply')e.apply=Math.max(0,Math.min(100,+val||0));
  else if(field==='cond')e.cond=!!val;
  else e[field]=val;
  if(field==='tag'){const fw=_famW(val);e.w=fw;e.mag=_magFromW(fw);} // сила по умолчанию из семейства
  if(field==='desc'||field==='apply')return; // текст/число по blur — без ре-рендера
  _renderShiyuBuffs();}
function _shyEffDel(i){_W.shyDraft.effects.splice(i,1);if(_W.shyPartOpen===i)_W.shyPartOpen=null;_renderShiyuBuffs();}
function _shyEffAdd(){_W.shyDraft.effects.push({tag:'dmg_buff',pct:null,flat:false,cond:false,w:2,mag:0.5,apply:100,chars:[],charApply:{},buttons:[],desc:''});_renderShiyuBuffs();}
// выбор персонажей для части
function _shyPartTgl(i){_W.shyPartOpen=_W.shyPartOpen===i?null:i;_W.shyPickQ='';_renderShiyuBuffs();}
function _shyPickSearch(v){_W.shyPickQ=v;_renderShiyuBuffs();
  const inp=document.querySelector('#page-content input[placeholder="поиск…"]');if(inp){inp.focus();inp.setSelectionRange(v.length,v.length);}}
function _shyPartCharTgl(i,id){const e=_W.shyDraft.effects[i];e.chars=e.chars||[];e.charApply=e.charApply||{};
  const j=e.chars.map(String).indexOf(String(id));
  if(j<0){e.chars.push(id);if(e.charApply[id]==null)e.charApply[id]=100;}
  else{e.chars.splice(j,1);delete e.charApply[id];}
  _renderShiyuBuffs();}
// «DMG по кнопке»: выбор кнопок и индивидуальный % урона на перса
const _SKILL_BTNS=[['basic','Basic'],['dash','Dash'],['special','Special'],['ex_special','EX Special'],
  ['chain','Chain'],['ultimate','Ultimate'],['assist','Assist'],['aftershock','Aftershock']];
function _shyBtnTgl(i,k){const e=_W.shyDraft.effects[i];e.buttons=e.buttons||[];
  const j=e.buttons.indexOf(k);j<0?e.buttons.push(k):e.buttons.splice(j,1);_renderShiyuBuffs();}
function _shyCharApply(i,id,v){const e=_W.shyDraft.effects[i];e.charApply=e.charApply||{};
  e.charApply[id]=Math.max(0,Math.min(100,+v||0));} // по blur, без ре-рендера
async function _shySave(){
  const t=(_W.shyTours||[]).find(x=>x.id===_W.shyTour);if(!t||!t.shiyu_data||!_W.shyDraft)return;
  const st=document.getElementById('shy-status');const set=(s,c)=>{if(st){st.textContent=s;st.style.color=c||'var(--sub)';}};
  const d=_W.shyDraft;
  const tag={elems:d.elems.slice(),elem:d.elems[0]||null,
    mechs:d.mechs.slice(),mech:d.mechs[0]||null,
    strength:Math.max(0,Math.min(1,d.strength)),
    effects:d.effects.map(e=>{const w=e.w!=null?e.w:_w04(e.mag);
      return{...e,w,mag:_magFromW(w),apply:e.apply!=null?e.apply:100,chars:(e.chars||[]).slice()};})};
  const sd={...t.shiyu_data,buff_tag:tag};
  set('сохранение…');
  const{error}=await sb.from('tournaments').update({shiyu_data:sd}).eq('id',_W.shyTour);
  if(dbErr(error,'сохранение бафа')){set('ошибка','var(--red)');return;}
  t.shiyu_data=sd;const dt=(D.tours||[]).find(x=>x.id===_W.shyTour);if(dt)dt.shiyu_data=sd;
  set('✓ сохранено','var(--accent)');toast('Баф сохранён');
}
// массово фиксируем доразбор: старые ротации без buff_tag парсятся на лету при каждой загрузке.
// Прогоняем _shyTag и пишем результат в shiyu_data.buff_tag, чтобы разбор больше не терялся.
async function _shyBackfill(){
  const st=document.getElementById('shy-bf-status');const set=(s,c)=>{if(st){st.textContent=s;st.style.color=c||'var(--sub)';}};
  const todo=(_W.shyTours||[]).filter(t=>t.shiyu_data&&!t.shiyu_data.buff_tag);
  if(!todo.length){set('нечего фиксировать');return;}
  set(`фиксирую ${todo.length}…`);
  let ok=0;
  for(const t of todo){
    const tag=_shyTag(t);
    const sd={...t.shiyu_data,buff_tag:tag};
    const{error}=await sb.from('tournaments').update({shiyu_data:sd}).eq('id',t.id);
    if(error){dbErr(error,'фиксация бафа '+(t.name||t.id));set('ошибка','var(--red)');return;}
    t.shiyu_data=sd;const dt=(D.tours||[]).find(x=>x.id===t.id);if(dt)dt.shiyu_data=sd;ok++;
  }
  set(`✓ зафиксировано ${ok}`,'var(--accent)');toast('Доразбор зафиксирован');_renderShiyuBuffs();
}

// ===== Дуо / Трио: ручные рейтинги пар и троек (Аналитика → Калибровка силы) =====
// Таблица team_ratings: key = "cid:ms|cid:ms[|cid:ms]" (cid сортированы), members jsonb,
// stars_synergy / stars_power 0-5. A-ранги всегда M6 (клик по бейджу заблокирован).
// Подсказка из данных: винрейт реальных пиков (пары = подмножества троек матчей).

function _tmKey(members){ // канонический ключ состава
  return members.slice().sort((a,b)=>String(a.cid).localeCompare(String(b.cid)))
    .map(m=>m.cid+':'+m.ms).join('|');
}
function _tmStatsCalc(picks,matches){ // винрейты пар и троек из реальных пиков
  const mBy={};matches.forEach(m=>mBy[m.id]=m);
  // сторона драфта = 6 пиков, но играются ДВЕ тройки → группируем по team_slot;
  // пары считаем только ВНУТРИ тройки (реально играли вместе), не по всей шестёрке
  const teams={};
  picks.forEach(p=>{const k=p.match_id+'|'+p.player_id+'|'+(p.team_slot??0);
    (teams[k]=teams[k]||{cids:[],m:p.match_id,pl:p.player_id}).cids.push(String(p.character_id));});
  const pair={},trio={};
  Object.values(teams).forEach(t=>{
    const m=mBy[t.m];if(!m||!m.winner_id)return;
    const win=m.winner_id===t.pl?1:0;const c=[...new Set(t.cids)].sort();
    for(let i=0;i<c.length;i++)for(let j=i+1;j<c.length;j++){
      const k=c[i]+'|'+c[j];(pair[k]=pair[k]||{g:0,w:0});pair[k].g++;pair[k].w+=win;}
    if(c.length===3){const k=c.join('|');(trio[k]=trio[k]||{g:0,w:0});trio[k].g++;trio[k].w+=win;}
  });
  return{pair,trio};
}
async function _tmLoad(){
  const jobs=[_fetchAllW('team_ratings')];
  jobs.push((D.chars&&D.chars.length)?Promise.resolve(D.chars):_fetchAllW('characters'));
  jobs.push(_W.tmStats?Promise.resolve(null):_fetchAllW('match_picks'));
  jobs.push(_W.tmStats?Promise.resolve(null):_fetchAllW('matches'));
  const[rows,chars,picks,matches]=await Promise.all(jobs);
  _W.tmRows={};rows.forEach(r=>_W.tmRows[r.key]=r);
  _W.tmChars=chars.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','ru'));
  _W.tmCharMap={};chars.forEach(c=>_W.tmCharMap[c.id]=c);
  if(picks)_W.tmStats=_tmStatsCalc(picks,matches);
  _W.tmLoaded=true;
}
const _KB_TM=8; // прайор байес-винрейта пар/троек (выборки крошечные)
function _tmWr(cids){
  const s=_W.tmStats||{pair:{},trio:{}};
  const c=cids.map(String).sort();
  const rec=c.length===2?s.pair[c.join('|')]:s.trio[c.join('|')];
  if(!rec)return null;
  return{g:rec.g,wr:(rec.w+_KB_TM*0.5)/(rec.g+_KB_TM)};
}
// звёзды 0-5: клик по активной гасит в 0
function _stars(cur,call){
  cur=+cur||0;let s='';
  for(let i=1;i<=5;i++)s+=`<span onclick="${call.replace('{v}',i===cur?0:i)}" style="cursor:pointer;font-size:18px;line-height:1;color:${i<=cur?'#f5c842':'var(--border)'};user-select:none">★</span>`;
  return `<span style="white-space:nowrap;letter-spacing:2px">${s}</span>`;
}
function _tmMsBadge(c,ms,call){ // бейдж майндскейпа; A-ранг залочен на M6
  const isA=c&&c.rarity==='A';
  const v=isA?6:(+ms||0);
  const base=`display:inline-block;min-width:26px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;border:1px solid var(--border);border-radius:4px;padding:1px 4px;color:${(isA||v>0)?'#f5c842':'var(--sub)'};`;
  if(isA||!call)return `<span title="${isA?'A-ранг — всегда M6':''}" style="${base}cursor:default">M${v}</span>`;
  return `<span title="Клик — сменить майндскейп" onclick="${call}" style="${base}cursor:pointer">M${v}</span>`;
}

function _renderTeams(size){
  if(!_W.tmLoaded){
    html(`${_analyticsTabs()}<div class="card" style="padding:22px"><span class="spinner"></span> Загружаю пары/тройки и статистику пиков…</div>`);
    _tmLoad().then(()=>_renderWeights()).catch(e=>html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка загрузки: ${e.message}</div>`));
    return;
  }
  const label=size===2?'пар':'троек';
  if(!_W.tmNew||_W.tmNew.size!==size)_W.tmNew={size,slots:Array(size).fill(''),ms:Array(size).fill(0)};
  const n=_W.tmNew;
  const inSt='background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:4px 7px;font-size:13px';
  // слот: иконка (или пустой квадрат) + имя/«выбрать» + бейдж M. Клик открывает иконочный пикер.
  const slotSel=i=>{
    const c=_W.tmCharMap[n.slots[i]];
    const open=_W.tmPickOpen===i;
    const face=c?`<span style="display:inline-flex;align-items:center;gap:6px">${iconChar(c,34)}<span style="font-size:13px;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.name)}</span></span>`
      :`<span style="display:inline-flex;align-items:center;gap:6px;color:var(--sub)"><span style="width:34px;height:34px;border-radius:6px;background:#1c1f2e;display:inline-block"></span>выбрать</span>`;
    return `<span style="display:inline-flex;align-items:center;gap:6px">
      <button class="btn" style="padding:5px 9px;border-color:${open?'var(--accent)':'var(--border)'}" onclick="_tmPickTgl(${i})">${face}</button>
      ${n.slots[i]?_tmMsBadge(c,n.ms[i],`_tmMsCycle(${i})`):''}</span>`;
  };
  const picker=()=>{
    const i=_W.tmPickOpen;if(i==null)return '';
    const taken=new Set(n.slots.filter((v,j)=>v&&j!==i));
    const q=(_W.tmPickQ||'').toLowerCase();
    const list=_W.tmChars.filter(c=>!taken.has(c.id)&&(!q||(c.name||'').toLowerCase().includes(q)));
    const cell=c=>`<div onclick="_tmSlot(${i},'${c.id}')" title="${escapeHtml(c.name)}" style="display:flex;flex-direction:column;align-items:center;gap:3px;width:66px;padding:6px 2px;border-radius:8px;cursor:pointer;${n.slots[i]===c.id?'background:rgba(83,74,183,.22);border:1px solid var(--accent)':'border:1px solid transparent'}" onmouseover="this.style.background='var(--field)'" onmouseout="this.style.background='${n.slots[i]===c.id?'rgba(83,74,183,.22)':'transparent'}'">
      ${iconChar(c,44)}<span style="font-size:10.5px;text-align:center;line-height:1.15;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.name)}${c.rarity==='A'?' (A)':''}</span></div>`;
    return `<div class="card" style="padding:12px 14px;margin-bottom:16px;border-color:var(--accent)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:13px;font-weight:600">Слот ${i+1} — выбери персонажа</span>
        <input placeholder="поиск…" value="${escapeHtml(_W.tmPickQ||'')}" oninput="_tmPickSearch(this.value)" style="${inSt};min-width:180px">
        <button class="btn" style="padding:3px 11px;margin-left:auto" onclick="_tmPickTgl(${i})">Закрыть</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:320px;overflow:auto">${list.map(cell).join('')||'<span style="color:var(--sub);font-size:12px">ничего не найдено</span>'}</div></div>`;
  };
  const createForm=`<div class="card" style="padding:14px 16px;margin-bottom:16px">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">Новая ${size===2?'пара':'тройка'}</div>
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      ${Array.from({length:size},(_,i)=>slotSel(i)).join('<span style="color:var(--sub)">+</span>')}
      <button class="btn btn-y" onclick="_tmAdd()">Добавить</button>
      <span id="tm-status" style="font-size:12px;color:var(--sub)"></span>
    </div>
    <div style="font-size:11px;color:var(--sub);margin-top:8px">Клик по бейджу M — смена майндскейпа (A-ранги всегда M6). Дубликаты по составу+констам не создаются.</div>
  </div>${picker()}`;
  // список сохранённых
  const rows=Object.values(_W.tmRows).filter(r=>r.size===size)
    .sort((a,b)=>(b.stars_power-a.stars_power)||(b.stars_synergy-a.stars_synergy)||a.key.localeCompare(b.key));
  const rowHTML=r=>{
    const mem=r.members||[];
    const chips=mem.map(m=>{const c=_W.tmCharMap[m.cid]||{name:'?'};
      return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px">${iconChar(c,26)}<span style="font-size:13px;font-weight:600">${escapeHtml(c.name||'?')}</span>${_tmMsBadge(c,m.ms,'')}</span>`;}).join('');
    const wr=_tmWr(mem.map(m=>m.cid));
    const wrTxt=wr?`<span title="байес-винрейт по реальным пикам (прайор ${_KB_TM})" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:${wr.wr>=0.5?'#3ddc84':'#ff8a8a'}">${Math.round(wr.wr*100)}% · ${wr.g} игр</span>`
      :'<span style="font-size:11px;color:var(--sub)">нет пиков</span>';
    return `<tr style="border-top:1px solid var(--line)">
      <td style="padding:9px 14px">${chips}</td>
      <td style="padding:9px 8px;text-align:center;white-space:nowrap">${_stars(r.stars_synergy,`_tmStar('${r.key}','stars_synergy',{v})`)}</td>
      <td style="padding:9px 8px;text-align:center;white-space:nowrap">${_stars(r.stars_power,`_tmStar('${r.key}','stars_power',{v})`)}</td>
      <td style="padding:9px 8px;text-align:center">${wrTxt}</td>
      <td style="padding:9px 8px;min-width:160px"><input value="${escapeHtml(r.note||'')}" placeholder="заметка" onchange="_tmNote('${r.key}',this.value)" style="${inSt};width:100%;font-size:12px"></td>
      <td style="padding:9px 10px;text-align:center"><button class="btn" style="padding:2px 9px" onclick="_tmDel('${r.key}')">✕</button></td></tr>`;
  };
  const list=rows.length?`<div class="card" style="padding:0;overflow:hidden"><table style="width:100%;border-collapse:collapse">
    <thead><tr style="font-size:11px;color:var(--sub);text-transform:uppercase;text-align:left">
      <th style="padding:10px 14px">Состав</th><th style="padding:10px 8px;text-align:center">Синергия</th>
      <th style="padding:10px 8px;text-align:center">Сила</th><th style="padding:10px 8px;text-align:center">Факт (пики)</th>
      <th style="padding:10px 8px">Заметка</th><th></th></tr></thead>
    <tbody>${rows.map(rowHTML).join('')}</tbody></table></div>`
    :`<div class="card" style="padding:18px;color:var(--sub);font-size:13px">Пока нет сохранённых ${label}. Собери первую выше.</div>`;
  html(`${_analyticsTabs()}${createForm}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span class="count-chip">${rows.length} ${label}</span>
      <span style="font-size:12px;color:var(--sub)">Звёзды сохраняются сразу. «Факт» — винрейт состава по реальным пикам матчей (без учёта конст).</span></div>
    ${list}`);
}
function _tmSlot(i,cid){const n=_W.tmNew;n.slots[i]=cid;
  const c=_W.tmCharMap[cid];n.ms[i]=(c&&c.rarity==='A')?6:0;_W.tmPickOpen=null;_W.tmPickQ='';_renderWeights();}
function _tmPickTgl(i){_W.tmPickOpen=_W.tmPickOpen===i?null:i;_W.tmPickQ='';_renderWeights();}
function _tmPickSearch(v){_W.tmPickQ=v;const i=_W.tmPickOpen;_renderWeights();
  const inp=document.querySelector('#page-content input[placeholder="поиск…"]');if(inp){inp.focus();inp.setSelectionRange(v.length,v.length);}}
function _tmMsCycle(i){const n=_W.tmNew;const c=_W.tmCharMap[n.slots[i]];
  if(c&&c.rarity==='A')return;n.ms[i]=(n.ms[i]+1)%7;_renderWeights();}
function _tmSt(s,c){const el=document.getElementById('tm-status');if(el){el.textContent=s;el.style.color=c||'var(--sub)';}}
async function _tmAdd(){
  const n=_W.tmNew;
  if(n.slots.some(v=>!v))return _tmSt('выбери всех персонажей','var(--red)');
  const members=n.slots.map((cid,i)=>{const c=_W.tmCharMap[cid];
    return{cid,ms:(c&&c.rarity==='A')?6:n.ms[i]};});
  const key=_tmKey(members);
  if(_W.tmRows[key])return _tmSt('такой состав уже есть','var(--red)');
  const row={key,size:n.size,members,stars_synergy:0,stars_power:0,note:'',updated_at:new Date().toISOString()};
  _tmSt('сохранение…');
  const{error}=await sb.from('team_ratings').upsert(row,{onConflict:'key'});
  if(dbErr(error,'создание состава'))return _tmSt('ошибка','var(--red)');
  _W.tmRows[key]=row;_W.tmNew=null;_renderWeights();toast('Состав добавлен');
}
async function _tmSave(key){
  const r=_W.tmRows[key];if(!r)return;
  r.updated_at=new Date().toISOString();
  const{error}=await sb.from('team_ratings').upsert(r,{onConflict:'key'});
  if(dbErr(error,'сохранение рейтинга'))return _tmSt('ошибка','var(--red)');
  _tmSt('✓ сохранено','var(--accent)');
}
function _tmStar(key,field,v){const r=_W.tmRows[key];if(!r)return;r[field]=+v||0;_tmSave(key);_renderWeights();}
function _tmNote(key,v){const r=_W.tmRows[key];if(!r)return;r.note=v;_tmSave(key);}
async function _tmDel(key){
  if(!confirm('Удалить состав?'))return;
  const{error}=await sb.from('team_ratings').delete().eq('key',key);
  if(dbErr(error,'удаление состава'))return;
  delete _W.tmRows[key];_renderWeights();
}

// ===== Сравнение Соло / Дуо / Трио — рейтинг из голосов спарринга =====
// Итог парных сравнений из sparring_votes: модель Брэдли-Терри (MM-итерации).
// Единица сравнения = состав на калибровочном M ("cid:ms|…"), поэтому M6 Солдатка и
// M0 Солдатка — РАЗНЫЕ единицы. Отдельно от ручной калибровки char_weights.
function _btKey(team){return (team||[]).map(m=>m.cid+':'+(m.ms||0)).sort().join('|');}
// Брэдли-Терри: games=[{w:key,l:key}] → {key:{score 0-100, games}}
function _btRank(games){
  const ids=[...new Set(games.flatMap(g=>[g.w,g.l]))];
  if(ids.length<2)return {};
  const wins={},opp={};ids.forEach(i=>{wins[i]=0;opp[i]=[];});
  games.forEach(g=>{wins[g.w]++;opp[g.w].push(g.l);opp[g.l].push(g.w);});
  let p={};ids.forEach(i=>p[i]=1);
  for(let it=0;it<200;it++){
    const np={};
    ids.forEach(i=>{let d=0;opp[i].forEach(j=>d+=1/(p[i]+p[j]));np[i]=d>0?(wins[i]||1e-3)/d:p[i];});
    let ls=0;ids.forEach(i=>ls+=Math.log(np[i]||1e-9));const g=Math.exp(ls/ids.length);
    ids.forEach(i=>np[i]=np[i]/g);p=np;
  }
  const lg=ids.map(i=>Math.log(p[i]||1e-9));
  const mean=lg.reduce((a,b)=>a+b,0)/lg.length;
  const sd=Math.sqrt(lg.reduce((a,b)=>a+(b-mean)**2,0)/lg.length)||1;
  const out={};ids.forEach((i,k)=>{out[i]={score:100/(1+Math.exp(-(lg[k]-mean)/sd)),games:opp[i].length};});
  return out;
}
async function _cmpLoadVotes(){_W.spVotes=await _fetchAllW('sparring_votes');}
function _renderCompare(){
  if(!_W.tmLoaded){
    html(`${_analyticsTabs()}<div class="card" style="padding:22px"><span class="spinner"></span> Загружаю ростер…</div>`);
    _tmLoad().then(()=>_renderWeights()).catch(e=>html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка: ${e.message}</div>`));
    return;
  }
  if(!_W.spVotes){
    html(`${_analyticsTabs()}<div class="card" style="padding:22px"><span class="spinner"></span> Загружаю голоса спарринга…</div>`);
    _cmpLoadVotes().then(()=>_renderWeights()).catch(e=>html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка: ${e.message}</div>`));
    return;
  }
  const bar=(v,color)=>`<div style="display:flex;align-items:center;gap:8px">
    <span style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:#fff;min-width:26px;text-align:right">${Math.round(v)}</span>
    <span style="flex:1;height:6px;background:var(--field);border-radius:3px;overflow:hidden;min-width:50px"><span style="display:block;height:100%;width:${Math.max(2,Math.round(v))}%;background:${color||'var(--grad)'}"></span></span></div>`;
  const cardSt='background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px';
  const hd=(t,n)=>`<div style="font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:14px;letter-spacing:.03em;margin-bottom:10px">${t} <span style="color:var(--sub);font-weight:600;font-style:normal">${n}</span></div>`;
  const msBadge=ms=>`<span style="font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;color:${ms?'#f5c842':'var(--sub)'};margin-left:2px">M${ms}</span>`;
  // разбор "cid:ms|…" → элементы {cid,ms}
  const parseKey=k=>k.split('|').map(p=>{const[cid,ms]=p.split(':');return{cid,ms:+ms||0};});
  const col=(size,color)=>{
    const games=_W.spVotes.filter(v=>v.size===size).map(v=>{
      const a=_btKey(v.left_team),b=_btKey(v.right_team);
      return v.winner==='left'?{w:a,l:b}:{w:b,l:a};
    }).filter(g=>g.w!==g.l);
    const rank=_btRank(games);
    const items=Object.entries(rank).sort((a,b)=>b[1].score-a[1].score).slice(0,30);
    if(!items.length)return `<div style="color:var(--sub);font-size:12px;padding:8px 0">Пока нет голосов — калибруй во вкладке «Спарринг».</div>`;
    return items.map(([key,r])=>{
      const mem=parseKey(key);
      const face=mem.map(m=>{const c=_W.tmCharMap[m.cid]||{};
        return `<span style="display:inline-flex;align-items:center">${iconChar(c,size===1?24:20)}${msBadge(m.ms)}</span>`;}).join('<span style="color:var(--sub);font-size:10px;margin:0 2px">+</span>');
      const nameTxt=mem.map(m=>(_W.tmCharMap[m.cid]||{}).name||'?').join(' + ');
      return `<div style="display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--line)">
        <span style="display:inline-flex;align-items:center;gap:4px;min-width:0" title="${escapeHtml(nameTxt)} · ${r.games} сравн.">${face}</span>
        ${bar(r.score,color)}</div>`;
    }).join('');
  };
  const nGames=s=>_W.spVotes.filter(v=>v.size===s).length;
  html(`${_analyticsTabs()}
  <div style="font-size:12px;color:var(--sub);margin-bottom:12px;line-height:1.5">Рейтинг из парных голосов «Спарринга» (Брэдли-Терри, шкала 0-100). Единица — состав на калибровочном майндскейпе, поэтому M0 и M6 одного перса — разные строки. Это НЕ ручная калибровка — чистый результат сравнений.</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
    <div style="${cardSt}">${hd('Соло','· '+nGames(1)+' голосов')}${col(1,'var(--grad)')}</div>
    <div style="${cardSt}">${hd('Дуо','· '+nGames(2)+' голосов')}${col(2,'#b18cff')}</div>
    <div style="${cardSt}">${hd('Трио','· '+nGames(3)+' голосов')}${col(3,'#5b9dff')}</div>
  </div>`);
}

// ===== Спарринг-калибровка (Аналитика → Спарринг: Соло/Дуо/Трио) =====
// Парные сравнения рандомных вариантов, подобранных ПО РОЛЯМ (см. weights-roadmap):
// правая сторона повторяет ролевой профиль левой — не сравниваем 2 ДД против 2 станнеров.
// Персонажи МОГУТ повторяться между сторонами (дуо/трио), составы не идентичны.
// Клик по стороне → голос в sparring_votes; «Сложно / ничья» → замена без записи.
// Майндскейпы: S-ранги M0, A-ранги M6 (турнирная конвенция predict).
const _SP_ROLE_LBL={atk:'ДД',stun:'Стан',sup:'Саппорт',ano:'Аномалия',rupt:'Разлом',def:'Защита'};
async function _spLoad(){
  if(!_W.tmLoaded)await _tmLoad();                       // ростер + карта персонажей
  if(!_W.tagsLoaded)await _loadTags();                   // теги для подбора похожих пар
  const[votes,cfg,picks]=await Promise.all([
    _fetchAllW('sparring_votes'),_fetchAllW('sparring_config'),_fetchAllW('match_picks')]);
  _W.spCounts={1:0,2:0,3:0};votes.forEach(v=>_W.spCounts[v.size]=(_W.spCounts[v.size]||0)+1);
  _W.spCfg={};cfg.forEach(r=>_W.spCfg[r.character_id]={calib_ms:r.calib_ms,in_game:r.in_game!==false});
  // калибровочный M из пиков: самый частый майндскейп персонажа в реальных матчах
  const cnt={};picks.forEach(p=>{const c=cnt[p.character_id]=cnt[p.character_id]||{};c[p.mindscape]=(c[p.mindscape]||0)+1;});
  _W.spRepMs={};
  for(const id in cnt){let best=null,bn=-1;for(const ms in cnt[id])if(cnt[id][ms]>bn){bn=cnt[id][ms];best=+ms;}_W.spRepMs[id]=best;}
  _W.spSig={};                                           // тег-сигнатура персонажа (для похожести)
  for(const id in (_W.tags||{})){const t=_W.tags[id];const s=new Set();
    Object.keys(t.roles||{}).forEach(k=>t.roles[k]&&s.add('r:'+k));
    Object.keys(t.gives||{}).forEach(k=>t.gives[k]&&s.add('g:'+k));
    Object.keys(t.needs||{}).forEach(k=>t.needs[k]&&s.add('n:'+k));
    _W.spSig[id]=s;}
  _W.spRecent=_W.spRecent||[];
  _W.spLoaded=true;
}
// калибровочный M: ручной оверрайд → самый частый из пиков → A=6/S=0
function _spMs(c){
  const cf=_W.spCfg&&_W.spCfg[c.id];
  if(cf&&cf.calib_ms!=null)return cf.calib_ms;
  const rep=_W.spRepMs&&_W.spRepMs[c.id];
  if(rep!=null)return rep;
  return c.rarity==='A'?6:0;
}
const _spInGame=c=>!(_W.spCfg&&_W.spCfg[c.id]&&_W.spCfg[c.id].in_game===false);
function _spPool(){return _W.tmChars.filter(c=>c.role&&_spInGame(c));} // роль известна + в игре
const _spPick=arr=>arr[Math.floor(Math.random()*arr.length)];
// похожесть тегов (Жаккар) — станнер-с-аномалистами (Наньгун) ближе к Ликаону, чем к чистому стану
function _spSim(a,b){
  const A=_W.spSig[a],B=_W.spSig[b];if(!A||!B||!A.size||!B.size)return 0;
  let inter=0;A.forEach(x=>{if(B.has(x))inter++;});return inter/(A.size+B.size-inter);
}
const _spRecentHas=id=>(_W.spRecent||[]).includes(String(id));
// взвешенно-случайный выбор с приоритетом кандидата (вес>0)
function _spWeighted(cands,weightFn){
  const w=cands.map(weightFn);const tot=w.reduce((a,b)=>a+b,0);
  if(tot<=0)return _spPick(cands);
  let r=Math.random()*tot;for(let i=0;i<cands.length;i++){r-=w[i];if(r<=0)return cands[i];}
  return cands[cands.length-1];
}
// левая команда: рандом без повторов, штраф за недавних
function _spTeamLeft(size){
  const pool=_spPool();const team=[];const used=new Set();
  for(let i=0;i<size;i++){
    let cand=pool.filter(c=>!used.has(c.id));if(!cand.length)return null;
    const fresh=cand.filter(c=>!_spRecentHas(c.id));if(fresh.length)cand=fresh;
    const c=_spPick(cand);used.add(c.id);team.push(c);
  }
  return team;
}
// правая команда: повторяет роли левой + подбирает похожих по тегам к соответствующему левому
function _spTeamRight(size,left){
  const pool=_spPool();const team=[];const used=new Set();
  for(let i=0;i<size;i++){
    const r=left[i].role;
    let cand=pool.filter(c=>!used.has(c.id)&&c.role===r);
    if(!cand.length)cand=pool.filter(c=>!used.has(c.id));
    if(!cand.length)return null;
    const fresh=cand.filter(c=>!_spRecentHas(c.id));if(fresh.length)cand=fresh;
    // вес: похожесть тегов к левому i (Наньгун↔Ликаон), лёгкий базовый шум
    const c=_spWeighted(cand,x=>0.15+_spSim(left[i].id,x.id));
    used.add(c.id);team.push(c);
  }
  return team;
}
function _spGen(){
  const size=_W.sparSize||1;
  const pool=_spPool();if(pool.length<size+1)return null;
  for(let tries=0;tries<80;tries++){
    const left=_spTeamLeft(size);if(!left)continue;
    const right=_spTeamRight(size,left);if(!right)continue;
    const lk=left.map(c=>c.id).sort().join('|'),rk=right.map(c=>c.id).sort().join('|');
    if(lk===rk)continue;                                  // полностью одинаковые составы
    if(size===1&&left[0].id===right[0].id)continue;       // соло: сам с собой
    return{left,right};
  }
  return null;
}
// запомнить показанных, чтобы ~20 последних не всплывали снова из-за похожести тегов
function _spRemember(cur){
  if(!cur)return;const ids=[...cur.left,...cur.right].map(c=>String(c.id));
  _W.spRecent=[...ids,...(_W.spRecent||[])].slice(0,40); // ~20 пар × 2 стороны
}
function _spNext(){if(_W.spCur)_spRemember(_W.spCur);_W.spCur=_spGen();_renderWeights();}
function _renderSparring(){
  if(!_W.spLoaded){
    html(`${_analyticsTabs()}<div class="card" style="padding:22px"><span class="spinner"></span> Загружаю ростер и голоса…</div>`);
    _spLoad().then(()=>{_W.spCur=null;_renderWeights();})
      .catch(e=>html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка загрузки: ${e.message}</div>`));
    return;
  }
  const size=_W.sparSize||1;
  if(!_W.spCur)_W.spCur=_spGen();
  const cur=_W.spCur;
  const sb2=(v,l)=>`<button class="tbtn" style="${size===v?'border-color:var(--accent);color:#fff':''}" onclick="_spMode(${v})">${l}</button>`;
  const tabs=`<div style="display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px">
    <span style="font-size:12px;color:var(--sub);align-self:center;margin-right:4px">Состав:</span>
    ${sb2(1,'Соло')}${sb2(2,'Дуо')}${sb2(3,'Трио')}
    <button class="tbtn" style="margin-left:10px;${_W.spCfgOpen?'border-color:var(--accent);color:#fff':''}" onclick="_spCfgTgl()">⚙ Калибровка</button>
    <span style="font-size:12px;color:var(--sub);align-self:center;margin-left:14px">за сессию: <b style="color:#fff">${_W.spSession||0}</b> · всего в БД: <b style="color:#fff">${_W.spCounts[size]||0}</b></span>
  </div>`;
  if(_W.spCfgOpen){html(`${_analyticsTabs()}${tabs}${_spConfigPanel()}`);return;}
  if(!cur){
    html(`${_analyticsTabs()}${tabs}<div class="card" style="padding:22px;color:var(--sub)">Не удалось собрать пару вариантов (мало персонажей с ролями).</div>`);
    return;
  }
  const sideCard=(team,side)=>{
    const chips=team.map(c=>`<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:86px">
      ${iconChar(c,64)}
      <span style="font-size:12.5px;font-weight:600;text-align:center;line-height:1.2">${escapeHtml(c.name)}</span>
      <span style="display:flex;gap:4px;align-items:center">
        <span style="font-size:10px;color:var(--sub);border:1px solid var(--border);border-radius:3px;padding:0 4px">${_SP_ROLE_LBL[c.role]||c.role||'?'}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${_spMs(c)?'#f5c842':'var(--sub)'}">M${_spMs(c)}</span>
      </span></div>`).join('');
    return `<div onclick="_spVote('${side}')" title="Клик — этот вариант сильнее"
      style="flex:1;min-width:250px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px 18px;cursor:pointer;transition:border-color .12s,transform .12s"
      onmouseover="this.style.borderColor='var(--accent)';this.style.transform='translateY(-2px)'"
      onmouseout="this.style.borderColor='var(--border)';this.style.transform=''">
      <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap">${chips}</div>
      <div style="text-align:center;margin-top:14px;font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:13px;letter-spacing:.04em;color:var(--sub)">Сильнее ${side==='left'?'левый':'правый'}</div>
    </div>`;
  };
  html(`${_analyticsTabs()}${tabs}
  <div style="font-size:12px;color:var(--sub);margin-bottom:14px;line-height:1.5">Кликни вариант, который кажется сильнее (в вакууме, без учёта врагов). Роли сторон совпадают. «Сложно / ничья» — заменить пару без записи. Норма итерации — пара десятков ответов.</div>
  <div style="display:flex;gap:16px;align-items:stretch;flex-wrap:wrap">
    ${sideCard(cur.left,'left')}
    <div style="display:flex;flex-direction:column;justify-content:center;gap:10px;align-self:center">
      <span style="font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:22px;color:var(--sub);text-align:center">VS</span>
      <button class="btn" style="padding:8px 14px" onclick="_spSkip()">Сложно / ничья</button>
      <button class="btn" style="padding:8px 14px" onclick="_spNext()">Новая пара</button>
    </div>
    ${sideCard(cur.right,'right')}
  </div>
  <div style="margin-top:12px"><span id="sp-status" style="font-size:12px;color:var(--sub)"></span></div>`);
}
// ⚙ Панель калибровки: на персонажа — калибровочный M (авто/оверрайд) и флаг «в игре».
function _spConfigPanel(){
  const q=(_W.spCfgQ||'').toLowerCase();
  const chars=_W.tmChars.filter(c=>c.role&&(!q||(c.name||'').toLowerCase().includes(q)))
    .slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','ru'));
  const inSt='background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:4px 7px;font-size:13px';
  const cell=c=>{
    const cf=_W.spCfg[c.id]||{};
    const inGame=cf.in_game!==false;
    const rep=_W.spRepMs&&_W.spRepMs[c.id];
    const eff=_spMs(c);
    const over=cf.calib_ms!=null;
    const msOpts=['<option value="">авто</option>'].concat([0,1,2,3,4,5,6].map(m=>`<option value="${m}" ${cf.calib_ms===m?'selected':''}>M${m}</option>`));
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:${inGame?'transparent':'rgba(255,80,80,.06)'};border:1px solid var(--line)">
      ${iconChar(c,34)}
      <div style="min-width:0;flex:1"><div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.name)}</div>
        <div style="font-size:10.5px;color:var(--sub)">${_SP_ROLE_LBL[c.role]||c.role} · авто M${rep!=null?rep:(c.rarity==='A'?6:0)}${rep==null?' (нет пиков)':''}</div></div>
      <select onchange="_spCfgMs('${c.id}',this.value)" style="${inSt}" title="Калибровочный майндскейп (авто = самый частый из пиков)">${msOpts.join('')}</select>
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:${over?'#f5c842':'var(--sub)'};min-width:26px;text-align:center" title="итоговый M">M${eff}</span>
      <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--sub);cursor:pointer" title="Выключить — не показывать в спарринге (напр. ещё не вышел)">
        <input type="checkbox" ${inGame?'checked':''} onchange="_spCfgGame('${c.id}',this.checked)">в игре</label>
    </div>`;
  };
  return `<div class="card" style="padding:14px 16px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <span style="font-size:13px;font-weight:600">Калибровочный майндскейп и «в игре»</span>
      <input placeholder="поиск…" value="${escapeHtml(_W.spCfgQ||'')}" oninput="_spCfgSearch(this.value)" style="${inSt};min-width:180px">
      <span id="sp-cfg-status" style="font-size:12px;color:var(--sub);margin-left:auto"></span></div>
    <div style="font-size:11px;color:var(--sub);margin-bottom:10px;line-height:1.5">«Авто» берёт самый частый майндскейп из реальных пиков (Астра→M1, стандартные→M6). Оверрайд — для тех, кого почти не берут (Пироис). Сними «в игре» у ещё не вышедших (Сигрид, Рамиэль) — они пропадут из подбора. Сохраняется сразу.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:6px">${chars.map(cell).join('')}</div></div>`;
}
function _spCfgTgl(){_W.spCfgOpen=!_W.spCfgOpen;_renderWeights();}
function _spCfgSearch(v){_W.spCfgQ=v;_renderWeights();
  const inp=document.querySelector('#page-content input[placeholder="поиск…"]');if(inp){inp.focus();inp.setSelectionRange(v.length,v.length);}}
function _spCfgStatus(s,c){const el=document.getElementById('sp-cfg-status');if(el){el.textContent=s;el.style.color=c||'var(--sub)';}}
async function _spCfgSave(cid){
  const cf=_W.spCfg[cid]||{in_game:true};
  const row={character_id:+cid,calib_ms:cf.calib_ms==null?null:cf.calib_ms,in_game:cf.in_game!==false,updated_at:new Date().toISOString()};
  _spCfgStatus('сохранение…');
  const{error}=await sb.from('sparring_config').upsert(row,{onConflict:'character_id'});
  if(dbErr(error,'сохранение калибровки')){_spCfgStatus('ошибка','var(--red)');return;}
  _spCfgStatus('✓ сохранено','var(--accent)');
}
function _spCfgMs(cid,v){const cf=_W.spCfg[cid]=_W.spCfg[cid]||{in_game:true};cf.calib_ms=v===''?null:+v;_W.spCur=null;_spCfgSave(cid);_renderWeights();}
function _spCfgGame(cid,on){const cf=_W.spCfg[cid]=_W.spCfg[cid]||{};cf.in_game=!!on;_W.spCur=null;_spCfgSave(cid);_renderWeights();}
function _spMode(v){_W.sparSize=v;_W.spCur=null;_W.spSession=0;_renderWeights();}
function _spSkip(){_spNext();}
function _spSt(s,c){const el=document.getElementById('sp-status');if(el){el.textContent=s;el.style.color=c||'var(--sub)';}}
async function _spVote(side){
  const cur=_W.spCur;if(!cur)return;
  const size=_W.sparSize||1;
  const pack=t=>t.map(c=>({cid:c.id,ms:_spMs(c)}));
  const row={size,left_team:pack(cur.left),right_team:pack(cur.right),winner:side};
  _spNext();                                             // мгновенно следующая пара
  _W.spSession=(_W.spSession||0)+1;
  const{error}=await sb.from('sparring_votes').insert(row);
  if(dbErr(error,'запись голоса')){_W.spSession--;_spSt('голос НЕ записан (нет таблицы/авторизации?)','var(--red)');return;}
  _W.spCounts[size]=(_W.spCounts[size]||0)+1;_spSt('✓ записано','var(--accent)');
}
