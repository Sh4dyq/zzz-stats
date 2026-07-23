// weights.js — админ-аналитика: ручная калибровка силы (0..100) поверх авто-сигналов
// (средний кост + байес-винрейт). Пишет в char_weights.

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
    // кост 0 = бесплатный бейслайн, не цена: если есть ненулевые — усредняем по ним
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

// реально сыгранные констелляции: пики/винрейт + кост майндскейпа (отсекает мусорные косты незаигранных M)
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

// авто-z из коста и винрейта (грубая нормировка под шкалу)
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

// констелляции для показа (M0 — база, у A-рангов констелляций нет)
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
      ${cb('solo','Соло')}${cb('duo','Дуо')}${cb('trio','Трио')}${cb('valid','Валидные комбинации')}</div>`;
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
  if(_W.calib==='valid')return _renderValid();
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

// точечная перерисовка ячеек строки без пересборки таблицы (иначе ползунок застывает при драге)
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

// ===== Редактор тегов синергии + майндскейпов =====
// источник — synergy_tags (jsonb); roles/gives/needs = шкала 0-4 (M0); ms.gives_self/gives — мидскейпы.
// автосейв построчно (debounce), фолбэк — web/data/synergy_tags.json.
// словарь тегов: [ключ, короткая метка, полное описание (в тултип)]
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
// имена в synergy_tags полные, в D.chars короткие — матчим по имени для иконки
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
  const[base,rows,synJson]=await Promise.all([
    fetch('web/data/synergy_tags.json?v='+Date.now()).then(r=>r.json()).catch(()=>({})),
    _fetchAllW('synergy_tags'),
    fetch('web/data/characters_synergy.json?v='+Date.now()).then(r=>r.json()).catch(()=>({}))
  ]);
  const map={};
  for(const cid in base)map[cid]=_msNorm(JSON.parse(JSON.stringify(base[cid])));
  _W.tagDb=new Set();
  rows.forEach(r=>{map[r.character_id]=_msNorm(r.data);_W.tagDb.add(String(r.character_id));});
  // Additional Ability: атрибуты (фракция/элемент/спец) — из nanoka (только для показа гейта);
  // условие (trigger) бэкфиллим в тег-данные, если в БД его ещё нет → станет редактируемым.
  const syn=(synJson&&synJson.agents)||synJson||{};
  _W.synAttr={};
  for(const cid in map){const s=syn[cid];const t=map[cid];
    if(s){_W.synAttr[cid]={faction:s.faction,element:s.element,specialty:s.specialty};
      if(t.trigger===undefined)t.trigger=s.trigger?JSON.parse(JSON.stringify(s.trigger)):null;}
    else if(t.trigger===undefined)t.trigger=null;}
  _W.tags=map;_W.tagsLoaded=true;
}

// ms: gives_self/gives → массив [{tag,mag,at}] (тег можно повторять); mag — абсолютное значение с этого M.
// старый формат {tag:{mag,at}} конвертируется. ms.dmg в расчётах не участвует.
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
    ${H('Доп. способность (Additional Ability)')}
    ${_addAbilityBlock(id,t)}
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
// ---- Additional Ability: важность (passive_use 0-4) + условие активации (trigger) ----
// trigger = ИЛИ из: тиммейт со спецом из spec[], элементом из elem[], та же фракция, тот же элемент.
// null = пассивка активна всегда (без гейта). Атрибуты агента (фракция/элемент/спец) — из датамайна.
const _SPEC_VOCAB=[['Attack','Атака'],['Stun','Стан'],['Anomaly','Аномалия'],['Support','Саппорт'],['Defense','Защита'],['Rupture','Разрушение']];
const _ELEM_VOCAB=[['Ice','Лёд'],['Fire','Пожар'],['Electric','Электро'],['Physical','Физ'],['Ether','Эфир'],['Wind','Ветер']];
function _addAbilityBlock(id,t){
  const attr=(_W.synAttr&&_W.synAttr[id])||{};
  const tr=t.trigger;   // undefined уже не бывает (бэкфилл в _loadTags), либо объект, либо null
  const pill=(on,label,call)=>`<span onclick="${call}" style="cursor:pointer;user-select:none;display:inline-block;padding:3px 10px;margin:2px;border-radius:12px;font-size:12px;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent)':'transparent'};color:${on?'#181820':'var(--sub)'}">${label}</span>`;
  const chk=(on,label,call)=>`<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-right:16px;cursor:pointer"><input type="checkbox" ${on?'checked':''} onchange="${call}">${label}</label>`;
  const numIn=`<input type="number" min="0" max="4" step="1" value="${t.passive_use!=null?t.passive_use:''}" onchange="_tagPassive('${id}',this.value)" style="width:46px;background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 4px;font-size:13px;text-align:center">`;
  const attrLine=`<div style="font-size:12px;color:var(--sub);margin:2px 0 10px">Атрибуты агента (датамайн): фракция <b>${attr.faction||'—'}</b> · элемент <b>${attr.element||'—'}</b> · спец <b>${attr.specialty||'—'}</b></div>`;
  const importance=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:13px">Важность (0-4):</span>${numIn}<span style="font-size:12px;color:var(--sub)">насколько пассивка важна агенту</span></div>`;
  if(tr===null){
    return attrLine+importance+`<div style="font-size:13px;color:var(--sub)">Условие: <b style="color:var(--text)">нет гейта</b> — пассивка активна всегда. ${pill(false,'Задать условие','_tagTrigEnable(\''+id+'\')')}</div>`;
  }
  const spec=tr.spec||[],elem=tr.elem||[];
  return attrLine+importance+`
    <div style="font-size:12px;color:var(--sub);margin-bottom:6px">Условие активации — пассивка работает, если в отряде есть тиммейт, удовлетворяющий ЛЮБОМУ из выбранного:</div>
    <div style="margin-bottom:8px">${chk(!!tr.faction,'та же фракция',`_tagTrigBool('${id}','faction',this.checked)`)}${chk(!!tr.attribute,'тот же элемент, что у агента',`_tagTrigBool('${id}','attribute',this.checked)`)}</div>
    <div style="font-size:12px;color:var(--sub);margin-bottom:2px">Спец тиммейта:</div>
    <div style="margin-bottom:8px">${_SPEC_VOCAB.map(([k,l])=>pill(spec.includes(k),l,`_tagTrigList('${id}','spec','${k}')`)).join('')}</div>
    <div style="font-size:12px;color:var(--sub);margin-bottom:2px">Элемент тиммейта:</div>
    <div style="margin-bottom:8px">${_ELEM_VOCAB.map(([k,l])=>pill(elem.includes(k),l,`_tagTrigList('${id}','elem','${k}')`)).join('')}</div>
    <div>${pill(false,'✕ убрать гейт (всегда активна)',`_tagTrigClear('${id}')`)}</div>`;
}
function _tagPassive(id,v){const t=_W.tags[id];v=v===''?null:Math.max(0,Math.min(4,+v||0));if(v==null)delete t.passive_use;else t.passive_use=v;_tagQueueSave(id);}
function _tagTrigEnable(id){_W.tags[id].trigger={spec:[],elem:[],faction:false,attribute:false};_tagQueueSave(id);_renderTagsEditor();}
function _tagTrigClear(id){_W.tags[id].trigger=null;_tagQueueSave(id);_renderTagsEditor();}
function _tagTrigBool(id,field,on){const tr=_W.tags[id].trigger;if(!tr)return;tr[field]=!!on;_tagQueueSave(id);}
function _tagTrigList(id,which,val){const tr=_W.tags[id].trigger;if(!tr)return;tr[which]=tr[which]||[];const i=tr[which].indexOf(val);if(i>=0)tr[which].splice(i,1);else tr[which].push(val);_tagQueueSave(id);_renderTagsEditor();}
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

// ===== Влияние бафов Шиюй =====
// (1) справочник семейств, (2) бафы турниров, (3) редактор множителей турнира.
// константы зеркалят tournaments.js (BUFF_BAND) и synergy.js (гейты buffMatchup).
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
function _shyTag(t){
  const sd=t.shiyu_data||{};
  if(sd.buff_tag)return sd.buff_tag;
  const raw=(sd.buff&&sd.buff.lines&&sd.buff.lines.join('\n'))||(sd.buff&&sd.buff.title)||'';
  const txt=String(raw).replace(/<[^>]+>/g,' ');
  return (typeof parseBuffTag==='function')?parseBuffTag(txt):{elems:[],elem:null,mech:null,strength:0,effects:[]};
}
// ключ группы: один и тот же Шиюй (id из ссылки) → турниры делят один баф
function _shyKey(t){
  const u=t.shiyu_url||'';const m=u.match(/shiyu\/(\d+)/);
  if(m)return 'id:'+m[1];
  if(u)return 'url:'+u;
  const sid=t.shiyu_data&&t.shiyu_data.id;return sid?('sid:'+sid):('t:'+t.id);
}
// сгруппировать турниры по Шиюй; rep — носитель бафа (с buff_tag), иначе первый
function _shyGroups(tours){
  const map=new Map();
  tours.forEach(t=>{const k=_shyKey(t);if(!map.has(k))map.set(k,[]);map.get(k).push(t);});
  return [...map.values()].map(ts=>({key:_shyKey(ts[0]),tours:ts,rep:ts.find(x=>x.shiyu_data&&x.shiyu_data.buff_tag)||ts[0]}));
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
        // synergy_tags ключи = enka_id → резолвим к персонажу по enka (иначе битые иконки: имя полное, файл — короткий)
        _W.shyByEnka={};(chars||[]).forEach(c=>{if(c.enka_id)_W.shyByEnka[String(c.enka_id).split('_')[0]]=c;});
        // ростер для пикера: карточка персонажа (иконка+имя) + элемент/специальность для фильтра
        _W.shyRoster=Object.entries(tj).map(([id,v])=>{const c=_W.shyByEnka[id]||null;
          return{id,char:c||{name:v.name},name:(c&&c.name)||v.name,elem:(v.element||'').toLowerCase(),spec:(v.specialty||'').toLowerCase()};})
          .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ru'));
        _W.shyLoaded=true;_renderShiyuBuffs();})
      .catch(e=>html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка загрузки: ${e.message}</div>`));
    return;
  }
  const tours=(_W.shyTours||[]).filter(t=>t.shiyu_data);       // все загруженные ротации
  const groups=_shyGroups(tours);                              // группы по Шиюй (не дублировать баф)
  if(_W.shyTour===undefined||!groups.some(g=>g.rep.id===_W.shyTour))_W.shyTour=groups.length?groups[0].rep.id:null;
  const card='background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:16px';
  const H=s=>`<div style="font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:14px;letter-spacing:.03em;color:var(--text);margin:0 0 10px">${s}</div>`;
  const th='text-align:left;padding:6px 10px;font-size:11px;color:var(--sub);text-transform:uppercase;border-bottom:1px solid var(--line)';
  const td='padding:7px 10px;border-bottom:1px solid var(--line);font-size:13px';

  // (1) справочник семейств (сила 0-4 руками, стартовая сила новых эффектов семейства)
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

  // (2) бафы по Шиюй (одна строка на группу турниров — баф общий)
  const bt=g=>{
    const t=g.rep;
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
    const members=g.tours.length>1?`<div style="font-size:11px;color:var(--sub);margin-top:3px">🔗 ${g.tours.length} турнира: ${g.tours.map(x=>escapeHtml(x.name||x.id)).join(', ')}</div>`:'';
    return `<tr>
      <td style="${td};vertical-align:top;min-width:150px"><b>${escapeHtml(t.name||t.id)}</b>${notSaved}
        <div style="font-size:12px;color:var(--accent);margin-top:2px">${escapeHtml(b.title||'')}</div>${members}</td>
      <td style="${td};font-size:12px;color:var(--sub);max-width:340px;line-height:1.5">${desc}</td>
      <td style="${td};text-align:center;font-size:12px">${elems}</td>
      <td style="${td};text-align:center;font-size:12px">${mechs}</td>
      <td style="${td};font-size:12px">${eff}</td></tr>`;
  };
  const unsaved=groups.filter(g=>!(g.rep.shiyu_data&&g.rep.shiyu_data.buff_tag)).length;
  const backfillBtn=unsaved?`<button class="btn" style="margin-left:12px" onclick="_shyBackfill()" title="Зафиксировать доразобранные теги ротаций без buff_tag (иначе разбор идёт заново при каждой загрузке)">Зафиксировать доразбор (${unsaved})</button><span id="shy-bf-status" style="font-size:12px;color:var(--sub);margin-left:8px"></span>`:'';
  const perTour=groups.length?`<div style="${card}">${H('Бафы по Шиюй')+backfillBtn}
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:720px">
      <thead><tr><th style="${th}">Шиюй (турниры) · баф</th><th style="${th}">Описание ротации</th><th style="${th};text-align:center">Элементы</th>
        <th style="${th};text-align:center">Архетипы</th><th style="${th}">Эффекты (сила 0-4)</th></tr></thead>
      <tbody>${groups.map(bt).join('')}</tbody></table></div></div>`
    : `<div style="${card}">${H('Бафы по Шиюй')}<div style="color:var(--sub);font-size:13px">Ни у одного турнира не загружена ротация Шиюй. Импорт — в «Турниры → Настройки → Ротация Шиюй».</div></div>`;

  // (3) редактор группы (мульти-элемент/архетип, сила 0-4, описание) — сохранение разливается на все турниры группы
  let editor='';
  const curG=groups.find(g=>g.rep.id===_W.shyTour);
  const cur=curG&&curG.rep;
  const opts=groups.map(g=>`<option value="${g.rep.id}" ${g.rep.id===_W.shyTour?'selected':''}>${escapeHtml(g.rep.name||g.rep.id)}${g.tours.length>1?` (×${g.tours.length})`:''}</option>`).join('');
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
    const charCard=cid=>(_W.shyByEnka&&_W.shyByEnka[cid])||(_W.shyCharMap&&_W.shyCharMap[cid])||{name:rosterName[cid]||cid};
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
        const fe=_W.shyPickElem||'',fr=_W.shyPickRole||'';
        const fchip=(on,label,call)=>`<button onclick="${call}" style="font-size:11px;padding:2px 9px;border-radius:12px;cursor:pointer;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent)':'transparent'};color:${on?'#181820':'var(--sub)'}">${label}</button>`;
        const elFilter=_ELEMS.map(([e,l])=>fchip(fe===e,l,`_shyPickElemSet('${e}')`)).join(' ');
        const roFilter=_SHY_SPEC.map(([r,l])=>fchip(fr===r,l,`_shyPickRoleSet('${r}')`)).join(' ');
        const list=(_W.shyRoster||[]).filter(r=>(!q||(r.name||'').toLowerCase().includes(q))&&(!fe||r.elem===fe)&&(!fr||r.spec===fr))
          .map(r=>{const on=chars.includes(String(r.id));const c=r.char||charCard(r.id);
            return `<div onclick="_shyPartCharTgl(${i},'${r.id}')" title="${escapeHtml(r.name)}" style="display:flex;flex-direction:column;align-items:center;gap:2px;width:60px;padding:5px 2px;border-radius:8px;cursor:pointer;border:1px solid ${on?'var(--accent)':'transparent'};${on?'background:rgba(83,74,183,.22)':''}">
              ${iconChar(c,38)}<span style="font-size:10px;text-align:center;line-height:1.1;max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.name)}</span></div>`;}).join('');
        picker=`<div style="margin-top:8px;border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--card)">
          <input placeholder="поиск…" value="${escapeHtml(_W.shyPickQ||'')}" oninput="_shyPickSearch(this.value)" style="${inSt};width:200px;margin-bottom:8px">
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:6px"><span style="font-size:10px;color:var(--sub);margin-right:2px">Элемент:</span>${fchip(!fe,'все',`_shyPickElemSet('')`)}${elFilter}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:8px"><span style="font-size:10px;color:var(--sub);margin-right:2px">Роль:</span>${fchip(!fr,'все',`_shyPickRoleSet('')`)}${roFilter}</div>
          <div style="max-height:260px;overflow:auto;display:flex;flex-wrap:wrap;gap:3px">${list||'<span style="color:var(--sub);font-size:12px">ничего не найдено</span>'}</div>
          <button class="btn" style="padding:2px 10px;margin-top:8px" onclick="_shyPartTgl(${i})">Готово</button></div>`;
      }
      // кнопки для «DMG по кнопке»
      const btns=e.buttons||[];
      const btnBlock=isSkill?`<div style="margin-top:10px;padding:10px;border:1px dashed var(--border);border-radius:8px">
        <div style="font-size:12px;color:var(--sub);margin-bottom:6px">Кнопки, по которым идёт DMG (можно несколько)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${_SKILL_BTNS.map(([k,l])=>chip(btns.includes(k),l,`_shyBtnTgl(${i},'${k}')`)).join('')}</div>
        ${btns.length?'':'<div style="font-size:11px;color:#f5c842;margin-top:6px">не выбрана ни одна кнопка</div>'}</div>`:'';
      // элемент отдельной части: у «DMG элемента» это сам гейт (пусто → общий элемент бафа),
      // у остальных — опциональное ограничение части этим элементом
      const isElem=e.tag==='dmg_buff_elem';
      const elHint=isElem?'пусто → общий элемент бафа':'необязательно — ограничить часть элементом';
      const elemBlock=`<div style="margin-top:10px;padding:10px;border:1px dashed var(--border);border-radius:8px">
        <div style="font-size:12px;color:var(--sub);margin-bottom:6px">Элемент этой части <span style="font-size:11px">(${elHint})</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${_ELEMS.map(([el,l])=>chip((e.elems||[]).includes(el),l,`_shyPartElem(${i},'${el}')`)).join('')}</div></div>`;
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
        ${btnBlock}${elemBlock}
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
// специальности персонажей (для фильтра пикера) — ключи из synergy_tags.specialty (lowercase)
const _SHY_SPEC=[['attack','ДД'],['anomaly','Аномалия'],['stun','Стан'],['support','Саппорт'],['defense','Защита'],['rupture','Разлом']];
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
function _shyPickElemSet(e){_W.shyPickElem=_W.shyPickElem===e?'':e;_renderShiyuBuffs();}
function _shyPickRoleSet(r){_W.shyPickRole=_W.shyPickRole===r?'':r;_renderShiyuBuffs();}
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
// тумблер элемента отдельной части
function _shyPartElem(i,el){const e=_W.shyDraft.effects[i];e.elems=e.elems||[];
  const j=e.elems.indexOf(el);j<0?e.elems.push(el):e.elems.splice(j,1);_renderShiyuBuffs();}
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
  // разливаем на все турниры той же группы Шиюй (один баф — не проставлять руками на каждый)
  const key=_shyKey(t);
  const grp=(_W.shyTours||[]).filter(x=>x.shiyu_data&&_shyKey(x)===key);
  set('сохранение…');
  for(const g of grp){
    const sd={...g.shiyu_data,buff_tag:tag};
    const{error}=await sb.from('tournaments').update({shiyu_data:sd}).eq('id',g.id);
    if(dbErr(error,'сохранение бафа')){set('ошибка','var(--red)');return;}
    g.shiyu_data=sd;const dt=(D.tours||[]).find(x=>x.id===g.id);if(dt)dt.shiyu_data=sd;
  }
  set(`✓ сохранено (${grp.length} турн.)`,'var(--accent)');toast(`Баф сохранён на ${grp.length} турнир(ов)`);
}
// пишем эффективный тег на все невыставленные турниры группы: ручной buff_tag носителя, иначе доразбор.
async function _shyBackfill(){
  const st=document.getElementById('shy-bf-status');const set=(s,c)=>{if(st){st.textContent=s;st.style.color=c||'var(--sub)';}};
  const groups=_shyGroups((_W.shyTours||[]).filter(t=>t.shiyu_data));
  const jobs=[];                                           // {t, tag} — что дописать
  groups.forEach(g=>{const tag=(g.rep.shiyu_data&&g.rep.shiyu_data.buff_tag)||_shyTag(g.rep);
    g.tours.forEach(t=>{if(!(t.shiyu_data&&t.shiyu_data.buff_tag))jobs.push({t,tag});});});
  if(!jobs.length){set('нечего фиксировать');return;}
  set(`фиксирую ${jobs.length}…`);
  let ok=0;
  for(const{t,tag} of jobs){
    const sd={...t.shiyu_data,buff_tag:tag};
    const{error}=await sb.from('tournaments').update({shiyu_data:sd}).eq('id',t.id);
    if(error){dbErr(error,'фиксация бафа '+(t.name||t.id));set('ошибка','var(--red)');return;}
    t.shiyu_data=sd;const dt=(D.tours||[]).find(x=>x.id===t.id);if(dt)dt.shiyu_data=sd;ok++;
  }
  set(`✓ зафиксировано ${ok}`,'var(--accent)');toast('Доразбор зафиксирован');_renderShiyuBuffs();
}

// ===== Дуо / Трио: ручные рейтинги пар и троек =====
// team_ratings: key="cid:ms|cid:ms[|cid:ms]", stars_synergy/stars_power 0-5, A-ранги всегда M6.

function _tmKey(members){ // канонический ключ состава
  return members.slice().sort((a,b)=>String(a.cid).localeCompare(String(b.cid)))
    .map(m=>m.cid+':'+m.ms).join('|');
}
function _tmStatsCalc(picks,matches){ // винрейты пар и троек из реальных пиков
  const mBy={};matches.forEach(m=>mBy[m.id]=m);
  // группируем по team_slot: пары считаем внутри тройки, не по всей шестёрке
  const teams={};
  picks.forEach(p=>{const k=p.match_id+'|'+p.player_id+'|'+(p.team_slot??0);
    (teams[k]=teams[k]||{cids:[],m:p.match_id,pl:p.player_id}).cids.push(String(p.character_id));});
  const solo={},pair={},trio={};
  Object.values(teams).forEach(t=>{
    const m=mBy[t.m];if(!m||!m.winner_id)return;
    const win=m.winner_id===t.pl?1:0;const c=[...new Set(t.cids)].sort();
    c.forEach(id=>{(solo[id]=solo[id]||{g:0,w:0});solo[id].g++;solo[id].w+=win;});
    for(let i=0;i<c.length;i++)for(let j=i+1;j<c.length;j++){
      const k=c[i]+'|'+c[j];(pair[k]=pair[k]||{g:0,w:0});pair[k].g++;pair[k].w+=win;}
    if(c.length===3){const k=c.join('|');(trio[k]=trio[k]||{g:0,w:0});trio[k].g++;trio[k].w+=win;}
  });
  return{solo,pair,trio};
}
async function _tmLoad(){
  if(!_W.tagsLoaded)await _loadTags();                    // теги нужны скореру
  // боевой движок синергии на живых тегах из БД — тот же Synergy.score, что в предиктах/симуляторе
  if(window.Synergy&&!Synergy.ready){try{await Synergy.load(_W.tags);}catch(e){console.warn('Synergy.load',e);}}
  const jobs=[_fetchAllW('team_ratings')];
  jobs.push((D.chars&&D.chars.length)?Promise.resolve(D.chars):_fetchAllW('characters'));
  jobs.push(_W.tmStats?Promise.resolve(null):_fetchAllW('match_picks'));
  jobs.push(_W.tmStats?Promise.resolve(null):_fetchAllW('matches'));
  const[rows,chars,picks,matches]=await Promise.all(jobs);
  _W.tmRows={};rows.forEach(r=>_W.tmRows[r.key]=r);
  _W.tmChars=chars.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','ru'));
  _W.tmCharMap={};chars.forEach(c=>_W.tmCharMap[c.id]=c);
  if(picks)_W.tmStats=_tmStatsCalc(picks,matches);
  if(!_W.cweights){ // ручная калибровка (база+консты) нужна скореру; прямой заход мимо pgWeights
    const[saved,csaved]=await Promise.all([_fetchAllW('char_weights'),_fetchAllW('char_const_weights')]);
    _W.saved={};saved.forEach(r=>_W.saved[r.character_id]=r);
    _W.cweights={};csaved.forEach(r=>{(_W.cweights[r.character_id]=_W.cweights[r.character_id]||{})[r.mindscape]=r.manual_weight;});
  }
  if(!_W.tmplLoaded)await _tmplLoad();                    // шаблоны для пометки «вне шаблонов»
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
// ===== Скорер составов: ортогональные источники в шкале винрейта (см. модель) =====
// Валюта — доля 0..1 (0.5 = средний). Соло/пара/трио — из одного источника (пики),
// tagSyn — из тегов, эмпирика входит ТОЛЬКО как остаток → нет двойного счёта.
const _SC={synK:0.10,nSol:8,nPair:6,nTrio:5,manW:0.12,pickW:0.5,gateW:0.35}; // synK: фолбэк-вклад синергии; n*: сила усадки остатка; manW/pickW: ручная калибровка vs пики; gateW: гейт по слабейшему
const _scMem=m=>(m&&typeof m==='object')?{cid:m.cid,ms:+m.ms||0}:{cid:m,ms:0};
// соло-сила члена состава: ручная калибровка (конст-версия при ms>0, иначе база) — главный сигнал,
// байес-винрейт пиков — вторичный. В валюте винрейта. Astra M1 > M0 при разных cweights.
function _scSolo(id,ms){
  const r=(_W.tmStats&&_W.tmStats.solo||{})[String(id)];
  const bwr=r?(r.w+_SC.nSol*0.5)/(r.g+_SC.nSol):0.5;
  const cwv=ms>0?((_W.cweights&&_W.cweights[id])||{})[ms]:null; // конст-вес только если задан явно
  const man=cwv??(((_W.saved&&_W.saved[id])||{}).manual_weight??50);
  return{g:r?r.g:0,wr:0.5+_SC.manW*(man-50)/50+_SC.pickW*(bwr-0.5)};
}
const _scNames=cids=>cids.map(id=>(_W.tmCharMap[id]||{}).name).filter(Boolean);
// боевая синергия (Synergy.score.total, в очках винрейта, cap ±.15, С КОНФЛИКТАМИ). Фолбэк — теги.
function _scSyn(cids){
  if(window.Synergy&&Synergy.ready){
    try{const sc=Synergy.score(_scNames(cids));return sc?sc.total:0;}catch(e){}
  }
  return _SC.synK*_scTagSyn(cids);
}
function _scTagSyn(cids){ // фолбэк-синергия тегов 0..1
  const chars=cids.map(id=>_W.tmCharMap[id]).filter(Boolean);
  if(chars.length<2||typeof _tmTagSyn!=='function')return 0;
  try{return _tmTagSyn(chars)||0;}catch(e){return 0;}
}
// взаимодействуют ли (есть pairFit): гейт для протаскивания парного остатка в трио
function _scInteract(cids){
  if(window.Synergy&&Synergy.ready){
    try{const sc=Synergy.score(_scNames(cids));return!!(sc&&sc.parts&&sc.parts.pair>0);}catch(e){}
  }
  return _scTagSyn(cids)>0;
}
// ролевой штраф валидности — боевой DraftSim.compPenalty (трио-only; пары не штрафует). Фолбэк — 0.
function _scCompPen(cids){
  if(window.DraftSim&&DraftSim.compPenalty){
    try{return DraftSim.compPenalty(cids.map(c=>({cid:c})),{charMap:_W.tmCharMap});}catch(e){}
  }
  return 0;
}
// база = средний соло-винрейт участников (с конст-калибровкой) + гейт по слабейшему + боевая синергия.
// Гейт: сила состава упирается в нижний тир (слабейшего члена не компенсировать средним).
function _scPredBase(mems){
  const sol=mems.map(m=>_scSolo(m.cid,m.ms));
  let base=sol.reduce((s,x)=>s+x.wr,0)/sol.length;
  const mn=Math.min(...sol.map(x=>x.wr));
  base-=_SC.gateW*(base-mn);
  return base+_scSyn(mems.map(m=>m.cid));
}
// пара: {pred,emp,cal,resid,residShr,g,unc}. residShr — усаженный остаток (для протаскивания в трио)
function _scPair(mems){
  mems=mems.map(_scMem);const cids=mems.map(m=>m.cid);
  const pred=_scPredBase(mems);
  const w=_tmWr(cids);const g=w?w.g:0;const emp=w?w.wr:pred;
  const resid=emp-pred;const shr=g/(g+_SC.nPair);
  const residShr=shr*resid;
  return{pred,emp,cal:pred+residShr+_scCompPen(cids),resid,residShr,g,unc:_scUnc(g,resid,_SC.nPair),bad:_scBad(cids)};
}
// структурно/модельно плохой состав: нет кэрри ИЛИ ролевой штраф ИЛИ отрицательная синергия (конфликт).
// крит+аномалик тут НЕ плохой — движок считает это main+sub (см. Synergy.score), это осознанно.
function _scBad(cids){
  return !_tmHasCarry(cids) || _scCompPen(cids)<=-0.15 || _scSyn(cids)<=-0.02;
}
// трио: база + синергия трио + сумма усаженных парных остатков; сверху — свой остаток + ролевой штраф
// парный остаток входит ТОЛЬКО для взаимодействующих пар (tagSyn>0), иначе ложное
// приписывание синергии невзаимодействующим (Люси+Ликаон и т.п.) — как в synergy.js
function _scTrio(mems){
  mems=mems.map(_scMem);const cids=mems.map(m=>m.cid);
  const pred0=_scPredBase(mems);
  let pairAdj=0;
  for(let i=0;i<mems.length;i++)for(let j=i+1;j<mems.length;j++){
    const p=[mems[i],mems[j]];
    if(_scInteract(p.map(m=>m.cid)))pairAdj+=_scPair(p).residShr;
  }
  const pred=pred0+pairAdj;
  const w=_tmWr(cids);const g=w?w.g:0;const emp=w?w.wr:pred;
  const resid=emp-pred;const shr=g/(g+_SC.nTrio);
  return{pred,emp,cal:pred+shr*resid+_scCompPen(cids),resid,residShr:shr*resid,g,unc:_scUnc(g,resid,_SC.nTrio),bad:_scBad(cids)};
}
function _scScore(mems){return mems.length===3?_scTrio(mems):_scPair(mems);} // mems: [{cid,ms}] или [cid]
// конст-гейтнутый член: у персонажа есть явная конст-калибровка, отличная от базы →
// состав стоит пересчитать/проверить в констовых версиях (ключ team_ratings уже cid:ms)
function _scConstGated(mems){
  return mems.some(m=>{const cw=(_W.cweights||{})[_scMem(m).cid];
    if(!cw)return false;
    const base=(((_W.saved||{})[_scMem(m).cid])||{}).manual_weight??50;
    return Object.values(cw).some(v=>Math.abs(v-base)>=10);});
}
// спорность 0..1 = расхождение модели с ФАКТОМ (не голод данных — редкие пары не «жёлтые» просто так).
// нет факта → resid≈0 → 0 (зелёный). есть факт и расходится → высокий (жёлтый).
function _scUnc(g,resid,n){
  return g>0?Math.min(1,Math.abs(resid)/0.2):0;
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
      <button class="btn" onclick="_tmAutofill(${size})">Заполнить из статистики</button>
      <button class="btn" onclick="_tmPurgeBad(${size})">Убрать невалидные</button>
      <button class="btn" onclick="_tmPurgeInert(${size})">Убрать невзаимодействующие</button>
      <span id="tm-status" style="font-size:12px;color:var(--sub)"></span>
    </div>
    <div style="font-size:11px;color:var(--sub);margin-top:8px">Клик по бейджу M — смена майндскейпа (A-ранги всегда M6). Дубликаты по составу+констам не создаются.</div>
  </div>${picker()}`;
  // список сохранённых
  // сортировка по выбору; порядок пересчитывается только при смене режима — правка звёзд не двигает строки
  const sortKey=_W.tmSort||'games',sortDir=_W.tmSortDir||-1;
  const rows=Object.values(_W.tmRows).filter(r=>r.size===size);
  if(_W.tmOrderFor!==size+'|'+sortKey+'|'+sortDir){
    const wrOf=r=>{const w=_tmWr((r.members||[]).map(m=>m.cid));return w?w.wr:-1;};
    const gOf=r=>{const w=_tmWr((r.members||[]).map(m=>m.cid));return w?w.g:-1;};
    // приоритет проверки: проблемные (нет кэрри/конфликт) сверху, затем расхождение с фактом
    // конст-гейтнутые члены — небольшой буст: пересмотреть в констовых версиях
    const prioOf=r=>{if(r.reviewed)return -1;const s=_scScore(r.members||[]);return(s.bad?1:0)+s.unc*0.5+(_scConstGated(r.members||[])?0.25:0);};
    const cmp={
      games:(a,b)=>gOf(b)-gOf(a),
      wr:(a,b)=>wrOf(b)-wrOf(a),
      power:(a,b)=>b.stars_power-a.stars_power,
      synergy:(a,b)=>b.stars_synergy-a.stars_synergy,
      calc:(a,b)=>prioOf(b)-prioOf(a), // проблемные + спорные сверху = очередь ручной проверки
    }[sortKey];
    rows.sort((a,b)=>cmp(a,b)*(sortDir<0?1:-1)||a.key.localeCompare(b.key));
    _W.tmOrder=rows.map(r=>r.key);_W.tmOrderFor=size+'|'+sortKey+'|'+sortDir;
  }else{
    const pos={};_W.tmOrder.forEach((k,i)=>pos[k]=i);
    rows.sort((a,b)=>(pos[a.key]??1e9)-(pos[b.key]??1e9));
    _W.tmOrder=rows.map(r=>r.key); // новые составы уходят в конец
  }
  const rowHTML=r=>{
    const mem=r.members||[];
    const chips=mem.map(m=>{const c=_W.tmCharMap[m.cid]||{name:'?'};
      return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px">${iconChar(c,26)}<span style="font-size:13px;font-weight:600">${escapeHtml(c.name||'?')}</span>${_tmMsBadge(c,m.ms,'')}</span>`;}).join('');
    const wr=_tmWr(mem.map(m=>m.cid));
    const wrTxt=wr?`<span title="байес-винрейт по реальным пикам (прайор ${_KB_TM})" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:${wr.wr>=0.5?'#3ddc84':'#ff8a8a'}">${Math.round(wr.wr*100)}% · ${wr.g} игр</span>`
      :'<span style="font-size:11px;color:var(--sub)">нет пиков</span>';
    const cids=mem.map(m=>m.cid);
    const sc=_scScore(mem);
    const rv=!!r.reviewed;
    const uc=rv?'#4a5568':(sc.bad?'#ff6b6b':sc.unc>=0.4?'#f5c842':'#3ddc84');
    const badTip=sc.bad?'ПРОБЛЕМНАЯ: нет кэрри / ролевой штраф / конфликт синергии. ':'';
    const dot=`<span onclick="_tmReview('${r.key}')" title="${badTip}${rv?'проверено вручную — клик снимает отметку':'клик — отметить проверенным (сбросить спорность)'}" style="cursor:pointer;width:12px;height:12px;border-radius:50%;background:${uc};display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff">${rv?'✓':''}</span>`;
    const offTmpl=(_W.tmpl&&_W.tmpl.length&&!_tmplFit(cids))?`<span title="вне заданных шаблонов валидных комбинаций (мягкая подсказка)" style="color:#f5a623;font-size:11px;margin-left:4px">⚑</span>`:'';
    const scTxt=`<span title="расчёт (соло+синергия+остаток). Спорность ${Math.round(sc.unc*100)}% · факт ${sc.g} игр&#10;пред ${Math.round(sc.pred*100)}% → итог ${Math.round(sc.cal*100)}%" style="display:inline-flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:12px">
      ${dot}${Math.round(sc.cal*100)}%${offTmpl}</span>`;
    // модельные ориентиры звёзд: синергия из тегов, сила из расчётного винрейта
    const mSyn=Math.min(5,Math.round(_scTagSyn(cids)*5));
    const mPow=_tmStarsFromWr(sc.cal);
    return `<tr style="border-top:1px solid var(--line)">
      <td style="padding:9px 14px">${chips}</td>
      <td style="padding:9px 8px;text-align:center;white-space:nowrap">${_stars(r.stars_synergy,`_tmStar('${r.key}','stars_synergy',{v})`)}<div style="margin-top:2px">${_tmDir(mSyn,r.stars_synergy)}</div></td>
      <td style="padding:9px 8px;text-align:center;white-space:nowrap">${_stars(r.stars_power,`_tmStar('${r.key}','stars_power',{v})`)}<div style="margin-top:2px">${_tmDir(mPow,r.stars_power)}</div></td>
      <td style="padding:9px 8px;text-align:center">${wrTxt}</td>
      <td style="padding:9px 8px;text-align:center">${scTxt}</td>
      <td style="padding:9px 8px;min-width:160px"><input value="${escapeHtml(r.note||'')}" placeholder="заметка" onchange="_tmNote('${r.key}',this.value)" style="${inSt};width:100%;font-size:12px"></td>
      <td style="padding:9px 10px;text-align:center"><button class="btn" style="padding:2px 9px" onclick="_tmDel('${r.key}')">✕</button></td></tr>`;
  };
  const fq=(_W.tmFilter||'').toLowerCase().trim();
  const shown=fq?rows.filter(r=>(r.members||[]).some(m=>((_W.tmCharMap[m.cid]||{}).name||'').toLowerCase().includes(fq))):rows;
  const list=shown.length?`<div class="card" style="padding:0;overflow:hidden"><table style="width:100%;border-collapse:collapse">
    <thead><tr style="font-size:11px;color:var(--sub);text-transform:uppercase;text-align:left">
      <th style="padding:10px 14px">Состав</th>
      ${_tmTh('Синергия','synergy',sortKey)}${_tmTh('Сила','power',sortKey)}
      ${_tmTh(sortKey==='wr'?'Факт · винрейт':'Факт · игры','__fact',sortKey,['games','wr'].includes(sortKey))}
      ${_tmTh('Расчёт','calc',sortKey)}
      <th style="padding:10px 8px">Заметка</th><th></th></tr></thead>
    <tbody>${shown.map(rowHTML).join('')}</tbody></table></div>`
    :`<div class="card" style="padding:18px;color:var(--sub);font-size:13px">${fq?'Ничего не найдено по фильтру.':`Пока нет сохранённых ${label}. Собери первую выше.`}</div>`;
  const searchBox=`<input placeholder="фильтр по персонажу…" value="${escapeHtml(_W.tmFilter||'')}" oninput="_tmFilterSet(this.value)" style="${inSt};min-width:220px">`;
  html(`${_analyticsTabs()}${createForm}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <span class="count-chip">${fq?shown.length+' / '+rows.length:rows.length} ${label}</span>
      ${searchBox}
      <span style="font-size:12px;color:var(--sub)">Точка «Расчёт» — клик отмечает проверенным (сбрасывает спорность). Стрелки под звёздами — куда модель предлагает сдвинуть.</span></div>
    ${list}`);
}
function _tmSlot(i,cid){const n=_W.tmNew;n.slots[i]=cid;
  const c=_W.tmCharMap[cid];n.ms[i]=(c&&c.rarity==='A')?6:0;_W.tmPickOpen=null;_W.tmPickQ='';_renderWeights();}
// стрелка «куда модель тянет относительно отмеченной звезды»: ▲/▼ + величина, ✓ если совпало
function _tmDir(model,manual){
  model=+model||0;manual=+manual||0;
  if(!manual)return `<span style="font-size:9px;color:var(--sub)" title="модель предлагает ${model}★">·${model}</span>`;
  const d=model-manual;
  if(!d)return `<span style="font-size:9px;color:#3ddc84" title="совпадает с моделью">✓</span>`;
  const up=d>0;
  return `<span style="font-size:9px;font-family:'JetBrains Mono',monospace;color:${up?'#3ddc84':'#ff8a8a'}" title="модель: ${model}★ (${up?'выше':'ниже'} на ${Math.abs(d)})">${up?'▲':'▼'}${Math.abs(d)}</span>`;
}
// отметка «проверено вручную»: сбрасывает спорность и убирает из очереди
async function _tmReview(key){
  const r=_W.tmRows[key];if(!r)return;
  const nv=!r.reviewed;
  const{error}=await sb.from('team_ratings').update({reviewed:nv,updated_at:new Date().toISOString()}).eq('key',key);
  if(dbErr(error,'отметка проверки'))return;
  r.reviewed=nv;_W.tmOrderFor=null;_renderWeights();
}
function _tmFilterSet(v){_W.tmFilter=v;_renderWeights();
  const inp=document.querySelector('#page-content input[placeholder="фильтр по персонажу…"]');
  if(inp){inp.focus();inp.setSelectionRange(v.length,v.length);}}
// заголовок-сортировка; для «Факта» next переключает игры↔винрейт
function _tmTh(label,next,cur,active){
  const on=active!==undefined?active:cur===next;
  const arr=on?((_W.tmSortDir||-1)<0?' ▼':' ▲'):'';
  return `<th onclick="_tmSetSort('${next}')" title="Клик — сортировка, повторный — обратный порядок" style="padding:10px 8px;text-align:center;cursor:pointer;user-select:none;${on?'color:var(--accent)':''}">${label}${arr}</th>`;
}
// тот же столбец — переворот направления, другой — сортировка по убыванию
function _tmSetSort(v){
  if(v==='__fact'){ // игры▼ → игры▲ → винрейт▼ → винрейт▲ → …
    const cur=_W.tmSort,d=_W.tmSortDir||-1;
    if(cur!=='games'&&cur!=='wr'){_W.tmSort='games';_W.tmSortDir=-1;}
    else if(d<0)_W.tmSortDir=1;
    else{_W.tmSort=cur==='games'?'wr':'games';_W.tmSortDir=-1;}
    _W.tmOrderFor=null;return _renderWeights();
  }
  if(_W.tmSort===v)_W.tmSortDir=(_W.tmSortDir||-1)*-1;
  else{_W.tmSort=v;_W.tmSortDir=-1;}
  _W.tmOrderFor=null;_renderWeights();}
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
// автозаполнение: все сыгранные составы (без границы по числу пиков) + чисто синергирующие по тегам
// коста для автосоздания: нижняя коста первого тира калибровки → типовой M из пиков → A=6/S=0
function _tmCalibMs(c){
  const t=_spTiers?_spTiers(c):null;
  if(t&&t.length)return t[0].ms;
  return c.rarity==='A'?6:0;
}
// чёрный список: мусорные составы. Ключ — отсортированные cid без конст.
const _blKey=cids=>cids.map(String).sort().join('|');
// состав мусорный, если он сам в списке или содержит мусорную пару
function _blHas(cids){
  const bl=_W.blRows||{};const c=cids.map(String).sort();
  if(bl[c.join('|')])return true;
  for(let i=0;i<c.length;i++)for(let j=i+1;j<c.length;j++)if(bl[c[i]+'|'+c[j]])return true;
  return false;
}
async function _blLoad(){
  const rows=await _fetchAllW('team_blacklist');
  _W.blRows={};rows.forEach(r=>_W.blRows[r.key]=r);_W.blLoaded=true;
}
async function _blAdd(cids,note){
  const c=cids.map(String).sort();const key=_blKey(c);
  if(_W.blRows&&_W.blRows[key])return true;
  const row={key,size:c.length,cids:c,note:note||'',created_at:new Date().toISOString()};
  const{error}=await sb.from('team_blacklist').upsert(row,{onConflict:'key'});
  if(dbErr(error,'пометка мусорного состава'))return false;
  (_W.blRows=_W.blRows||{})[key]=row;return true;
}
// состав валиден, если существует раскладка ролей из _SP_COMPS (≤1 главный, нужен урон, дуо без двух саппортов)
function _tmRoleOk(chars){
  const caps=chars.map(c=>_spCaps(c));
  return (_SP_COMPS[chars.length]||[]).some(comp=>{
    const used=new Array(caps.length).fill(false);
    const fit=k=>{if(k===comp.length)return true;
      for(let i=0;i<caps.length;i++)if(!used[i]&&caps[i].has(comp[k])){
        used[i]=true;if(fit(k+1))return true;used[i]=false;}
      return false;};
    return fit(0);
  });
}
function _tmStarsFromWr(wr){return wr>=.62?5:wr>=.56?4:wr>=.5?3:wr>=.43?2:1;}
// структурная валидность: нужен хотя бы один кэрри (atk/ano/rupt), как «нет дд» в compPenalty.
// пары двух не-кэрри (Астра+Сет) — это срез тройки, а не команда. cids ИЛИ char-объекты.
const _TM_CARRY=new Set(['atk','ano','rupt']);
function _tmHasCarry(items){
  return items.some(x=>{const c=(x&&x.role!==undefined)?x:_W.tmCharMap[x];return c&&_TM_CARRY.has(c.role);});
}
// комплементарность по тегам: сколько нужд одного закрывает другой (двусторонне), 0..1
function _tmTagSyn(chars){
  const sig=c=>_spTagOf(c);
  let need=0,met=0;
  chars.forEach(c=>{const t=sig(c);if(!t)return;
    const needs=Object.keys(t.needs||{}).filter(k=>t.needs[k]);
    needs.forEach(k=>{need++;
      if(chars.some(o=>o.id!==c.id&&(sig(o)||{}).gives&&sig(o).gives[k]))met++;});});
  return need?met/need:0;
}
const _TM_SYN_MIN=0.4,_TM_SYN_TOP={2:0,3:0}; // порог синергии; 0 = без лимита на число составов
// перебор всех валидных составов из ростера по тег-синергии (без опоры на пики)
function _tmTagCombos(size){
  const pool=_spPool(size).filter(c=>_spTagOf(c));
  const out=[];
  const walk=(start,acc)=>{
    if(acc.length===size){if(_tmRoleOk(acc)&&!_blHas(acc.map(c=>c.id))){const v=_tmTagSyn(acc);if(v>=_TM_SYN_MIN)out.push({chars:acc.slice(),syn:v});}return;}
    for(let i=start;i<pool.length;i++){acc.push(pool[i]);walk(i+1,acc);acc.pop();}
  };
  walk(0,[]);
  out.sort((a,b)=>b.syn-a.syn);
  const lim=_TM_SYN_TOP[size];
  return lim?out.slice(0,lim):out;
}
async function _tmAutofill(size){
  if(!_W.spLoaded){_tmSt('загружаю теги и роли…');await _spLoad();}
  if(!_W.blLoaded)await _blLoad();
  const s=_W.tmStats||{};const src=size===2?s.pair:s.trio;
  const all=Object.entries(src||{})
    .map(([k,v])=>({cids:k.split('|'),g:v.g,wr:(v.w+_KB_TM*0.5)/(v.g+_KB_TM)}))
    // сыгранные составы берём по факту, но нужен ≥1 кэрри — пара двух не-кэрри это срез тройки, не команда
    .filter(x=>x.cids.every(c=>_W.tmCharMap[c])&&!_blHas(x.cids)&&_tmHasCarry(x.cids));
  all.sort((a,b)=>(b.g-a.g)||(b.wr-a.wr));
  const top=all; // без границы по числу пиков — берём все сыгранные составы
  const rows=[],seen=new Set();
  const add=(chars,stars_power,note,syn)=>{
    const members=chars.map(c=>({cid:c.id,ms:_tmCalibMs(c)}));
    const key=_tmKey(members);
    if(_W.tmRows[key]||seen.has(key))return; // ручные правки не трогаем
    seen.add(key);
    rows.push({key,size,members,
      stars_synergy:Math.max(1,Math.round(syn*5)),
      stars_power,note,updated_at:new Date().toISOString()});
  };
  top.forEach(x=>{const chars=x.cids.map(c=>_W.tmCharMap[c]);
    add(chars,_tmStarsFromWr(x.wr),`авто: ${x.g} игр · ${Math.round(x.wr*100)}%`,_tmTagSyn(chars));});
  // добавка по чистой тег-синергии (даже если состав ни разу не пикали)
  _tmTagCombos(size).forEach(x=>add(x.chars,3,`авто-теги: синергия ${Math.round(x.syn*100)}%`,x.syn));
  if(!rows.length)return _tmSt('всё уже добавлено','var(--sub)');
  _tmSt('сохранение '+rows.length+'…');
  const{error}=await sb.from('team_ratings').upsert(rows,{onConflict:'key'});
  if(dbErr(error,'автозаполнение составов'))return _tmSt('ошибка','var(--red)');
  rows.forEach(r=>_W.tmRows[r.key]=r);_renderWeights();toast('Добавлено: '+rows.length);
}
// удаление пачками: .in('key',[...]) с тысячами ключей рвёт URL (Failed to fetch)
async function _tmDelKeys(keys){
  // .in() кладёт ключи в query string → батчи по бюджету длины URL (ключ тройки ~116 символов,
  // фикс. счётчик в 200 штук рвал лимит → 400 Bad Request)
  let batch=[],len=0;
  const flush=async()=>{if(!batch.length)return null;
    const{error}=await sb.from('team_ratings').delete().in('key',batch);
    batch=[];len=0;return error;};
  for(const k of keys){
    if(len+k.length+5>4000){const e=await flush();if(e)return e;}
    batch.push(k);len+=k.length+5;
  }
  return flush();
}
// разовая чистка: удалить составы, не проходящие ролевой фильтр
async function _tmPurgeBad(size){
  if(!_W.spLoaded){_tmSt('загружаю роли…');await _spLoad();}
  const bad=Object.values(_W.tmRows).filter(r=>r.size===size)
    .filter(r=>{const cs=(r.members||[]).map(m=>_W.tmCharMap[m.cid]);
      return cs.every(Boolean)&&(_blHas(cs.map(c=>c.id))||!_tmRoleOk(cs));});
  if(!bad.length)return _tmSt('невалидных нет','var(--sub)');
  if(!confirm(`Удалить ${bad.length} невалидных ${size===2?'пар':'троек'}?`))return;
  const error=await _tmDelKeys(bad.map(r=>r.key));
  if(dbErr(error,'чистка составов'))return _tmSt('ошибка','var(--red)');
  bad.forEach(r=>delete _W.tmRows[r.key]);_W.tmOrderFor=null;_renderWeights();toast('Удалено: '+bad.length);
}
// чистка невзаимодействующих/невалидных: нулевая тег-синергия ИЛИ сильный ролевой штраф,
// при отсутствии факта пиков. Не трогаем проверенные (reviewed) и вручную оценённые (звёзды).
const _INERT_FACT=2;      // «факт есть», если пиков не меньше
const _INERT_PEN=-0.15;   // порог ролевого штрафа для «невалидно»
async function _tmPurgeInert(size){
  if(!_W.spLoaded){_tmSt('загружаю теги…');await _spLoad();}
  const inert=Object.values(_W.tmRows).filter(r=>r.size===size).filter(r=>{
    const cids=(r.members||[]).map(m=>m.cid);
    if(!cids.every(c=>_W.tmCharMap[c]))return false;
    const auto=/^авто/.test(r.note||'');                         // авто-заполнение ставит звёзды всем
    if(r.reviewed||((r.stars_synergy||r.stars_power)&&!auto))return false; // ручное — не трогаем
    if(!_tmHasCarry(cids))return true;                           // нет кэрри — срез тройки, не команда
    const w=_tmWr(cids);if(w&&w.g>=_INERT_FACT)return false;     // есть факт — оставляем
    return !_scInteract(cids) || _scCompPen(cids)<=_INERT_PEN;
  });
  if(!inert.length)return _tmSt('невзаимодействующих нет','var(--sub)');
  if(!confirm(`Удалить ${inert.length} невзаимодействующих ${size===2?'пар':'троек'} (tagSyn=0 и нет пиков)?`))return;
  const error=await _tmDelKeys(inert.map(r=>r.key));
  if(dbErr(error,'чистка невзаимодействующих'))return _tmSt('ошибка','var(--red)');
  inert.forEach(r=>delete _W.tmRows[r.key]);_W.tmOrderFor=null;_renderWeights();toast('Удалено: '+inert.length);
}
// ===== Валидные комбинации: опора-справочник шаблонов составов =====
// team_templates: {size 2|3, slots:[[tok,...],...], note}. tok = "arch:<role>" | "char:<cid>".
// слот = ИЛИ-набор опций; шаблон матчится, если членов состава можно разложить по слотам 1:1.
// МЯГКИЙ сигнал: подсказка «по шаблону / вне шаблонов», не жёсткий фильтр (не доминирует).
const _ARCH=[['main_anomaly','Мейн-аномалист'],['sub_anomaly','Саб-аномалист'],['crit_dps','Крит-ДД'],
  ['sheer_dps','Разрушение'],['sub_dps','Саб-ДД'],['stunner','Стан'],['support','Саппорт']];
const _archLbl=k=>{const a=_ARCH.find(x=>x[0]===k);return a?a[1]:k;};
// иконка роли для архетипа (визуальный намёк, не маппинг ролей)
const _ARCH_IC={main_anomaly:'ano',sub_anomaly:'ano',crit_dps:'atk',sheer_dps:'rupt',sub_dps:'atk',stunner:'stun',support:'sup'};
// архетипы персонажа из тег-ролей (порог 2)
function _archOf(cid){const c=_W.tmCharMap[cid];const t=c&&_spTagOf(c);const r=(t&&t.roles)||{};
  return new Set(_ARCH.map(a=>a[0]).filter(k=>(r[k]||0)>=2));}
function _tokFit(tok,cid){
  if(tok.indexOf('char:')===0)return tok.slice(5)===String(cid);
  if(tok.indexOf('arch:')===0)return _archOf(cid).has(tok.slice(5));
  return false;}
// разложение членов по слотам 1:1 (бэктрекинг, как _tmRoleOk)
function _tmplFitOne(cids,slots){
  if(cids.length!==slots.length)return false;
  const used=new Array(cids.length).fill(false);
  const fit=k=>{if(k===slots.length)return true;
    for(let i=0;i<cids.length;i++)if(!used[i]&&slots[k].some(t=>_tokFit(t,cids[i]))){used[i]=true;if(fit(k+1))return true;used[i]=false;}
    return false;};
  return fit(0);}
function _tmplFit(cids){const c=cids.map(String);return(_W.tmpl||[]).some(t=>_tmplFitOne(c,t.slots||[]));}
async function _tmplLoad(){
  const rows=await _fetchAllW('team_templates');
  _W.tmpl=rows.sort((a,b)=>(a.sort_order-b.sort_order)||String(a.id).localeCompare(String(b.id)));
  _W.tmplLoaded=true;}
function _renderValid(){
  if(!_W.tmLoaded){
    html(`${_analyticsTabs()}<div class="card" style="padding:22px"><span class="spinner"></span> Загружаю персонажей и теги…</div>`);
    _tmLoad().then(()=>_renderWeights()).catch(e=>html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка: ${e.message}</div>`));return;}
  if(!_W.tmplLoaded){
    html(`${_analyticsTabs()}<div class="card" style="padding:22px"><span class="spinner"></span> Загружаю шаблоны…</div>`);
    _tmplLoad().then(()=>_renderWeights()).catch(e=>html(`${_analyticsTabs()}<div class="card" style="padding:22px;color:var(--red)">Ошибка: ${e.message}</div>`));return;}
  const inSt='background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:4px 7px;font-size:13px';
  const n=_W.valNew||(_W.valNew={size:3,slots:[[],[],[]],note:''});
  const tokChip=(tok,onDel)=>{let ic='',lbl;
    if(tok.indexOf('char:')===0){const c=_W.tmCharMap[tok.slice(5)];lbl=c?escapeHtml(c.name):'?';if(c)ic=iconChar(c,18);}
    else{const k=tok.slice(5);lbl=_archLbl(k);ic=iconRole(_ARCH_IC[k],16);}
    return `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--field);border:1px solid var(--border);border-radius:12px;padding:2px 6px;font-size:12px;margin:2px">${ic}${lbl}${onDel?`<span onclick="${onDel}" style="cursor:pointer;color:var(--sub);font-weight:700">×</span>`:''}</span>`;};
  // редактор одного слота: чипы + кнопка-пикер. Слоты равнозначны — порядок в отряде не важен.
  const slotEd=i=>{
    const open=_W.valPickOpen===i;
    return `<div style="border:1px solid ${open?'var(--accent)':'var(--border)'};border-radius:8px;padding:8px;min-width:170px">
      <div style="min-height:24px">${n.slots[i].map(t=>tokChip(t,`_valSlotDel(${i},'${t}')`)).join('')||'<span style="font-size:11px;color:var(--sub)">любой из…</span>'}</div>
      <button class="btn" style="padding:3px 10px;margin-top:6px;${open?'border-color:var(--accent)':''}" onclick="_valPickTgl(${i})">${open?'закрыть':'+ добавить'}</button></div>`;};
  // иконочный пикер: архетипы одной строкой + сетка персонажей (как в Дуо/Трио)
  const picker=()=>{
    const i=_W.valPickOpen;if(i==null)return '';
    const q=(_W.valPickQ||'').toLowerCase();
    const inSlot=new Set(n.slots[i]);
    const archChip=a=>`<span onclick="_valSlotAdd(${i},'arch:${a[0]}')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:14px;cursor:pointer;font-size:12px;border:1px solid ${inSlot.has('arch:'+a[0])?'var(--accent)':'var(--border)'};${inSlot.has('arch:'+a[0])?'background:rgba(83,74,183,.22)':''}">${iconRole(_ARCH_IC[a[0]],16)}${a[1]}</span>`;
    const list=_W.tmChars.filter(c=>!q||(c.name||'').toLowerCase().includes(q));
    const cell=c=>{const on=inSlot.has('char:'+c.id);
      return `<div onclick="_valSlotAdd(${i},'char:${c.id}')" title="${escapeHtml(c.name)}" style="display:flex;flex-direction:column;align-items:center;gap:3px;width:66px;padding:6px 2px;border-radius:8px;cursor:pointer;${on?'background:rgba(83,74,183,.22);border:1px solid var(--accent)':'border:1px solid transparent'}" onmouseover="this.style.background='var(--field)'" onmouseout="this.style.background='${on?'rgba(83,74,183,.22)':'transparent'}'">
      ${iconChar(c,44)}<span style="font-size:10.5px;text-align:center;line-height:1.15;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.name)}${c.rarity==='A'?' (A)':''}</span></div>`;};
    return `<div class="card" style="padding:12px 14px;margin:10px 0 6px;border-color:var(--accent)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:13px;font-weight:600">Добавить в слот (клик — вкл/выкл)</span>
        <input placeholder="поиск персонажа…" value="${escapeHtml(_W.valPickQ||'')}" oninput="_valPickSearch(this.value)" style="${inSt};min-width:180px">
        <button class="btn" style="padding:3px 11px;margin-left:auto" onclick="_valPickTgl(${i})">Закрыть</button></div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">${_ARCH.map(archChip).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:300px;overflow:auto">${list.map(cell).join('')||'<span style="color:var(--sub);font-size:12px">ничего не найдено</span>'}</div></div>`;};
  const sizeBtn=s=>`<button class="tbtn" style="${n.size===s?'border-color:var(--accent);color:#fff':''}" onclick="_valSize(${s})">${s} слота</button>`;
  const form=`<div class="card" style="padding:14px 16px;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span style="font-size:13px;font-weight:600">${n.id?'Правка шаблона':'Новый шаблон'}</span>${sizeBtn(2)}${sizeBtn(3)}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">${n.slots.map((_,i)=>slotEd(i)).join('<span style="color:var(--sub);align-self:center">+</span>')}</div>
    ${picker()}
    <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <input value="${escapeHtml(n.note||'')}" placeholder="заметка (напр. «Панда-разрушение»)" oninput="_W.valNew.note=this.value" style="${inSt};min-width:240px">
      <button class="btn btn-y" onclick="_valAdd()">${n.id?'Сохранить':'Добавить шаблон'}</button>
      ${n.id?`<button class="btn" onclick="_valCancel()">Отмена</button>`:''}
      <span id="val-status" style="font-size:12px;color:var(--sub)"></span></div>
    <div style="font-size:11px;color:var(--sub);margin-top:8px">Слот = «любой из» перечисленного (архетипы и/или персонажи). Слоты равнозначны: порядок не важен, состав раскладывается по слотам один-в-один в любом порядке.</div>
  </div>`;
  const list=(_W.tmpl.length)?_W.tmpl.map(t=>`<div class="card" style="padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;${String(t.id)===String(n.id)?'border-color:var(--accent)':''}">
    <span class="count-chip">${t.size}</span>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1">${(t.slots||[]).map((sl,i)=>`${i?'<span style="color:var(--sub)">+</span>':''}<span style="display:inline-flex;flex-wrap:wrap;align-items:center">${sl.map(tok=>tokChip(tok,null)).join('')||'<span style="font-size:11px;color:var(--sub)">пусто</span>'}</span>`).join('')}</div>
    ${t.note?`<span style="font-size:12px;color:var(--sub)">${escapeHtml(t.note)}</span>`:''}
    <button class="btn" style="padding:2px 9px" title="Редактировать" onclick="_valEdit('${t.id}')">✎</button>
    <button class="btn" style="padding:2px 9px" onclick="_valDel('${t.id}')">✕</button></div>`).join('')
    :`<div class="card" style="padding:18px;color:var(--sub);font-size:13px">Пока нет шаблонов. Собери первый выше — это опора валидности для Дуо/Трио.</div>`;
  html(`${_analyticsTabs()}${form}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="count-chip">${_W.tmpl.length} шаблонов</span>
      <span style="font-size:12px;color:var(--sub)">Опора для валидности составов. В Дуо/Трио строки вне шаблонов помечаются — это мягкая подсказка, не жёсткий фильтр.</span></div>
    ${list}`);}
function _valSt(s,c){const el=document.getElementById('val-status');if(el){el.textContent=s;el.style.color=c||'var(--sub)';}}
function _valSize(s){const n=_W.valNew;n.size=s;n.slots=Array.from({length:s},(_,i)=>n.slots[i]||[]);if(_W.valPickOpen>=s)_W.valPickOpen=null;_renderWeights();}
// клик в пикере — вкл/выкл опцию слота
function _valSlotAdd(i,tok){if(!tok)return;const s=_W.valNew.slots[i];
  _W.valNew.slots[i]=s.includes(tok)?s.filter(t=>t!==tok):s.concat(tok);_renderWeights();}
function _valSlotDel(i,tok){const s=_W.valNew.slots[i];_W.valNew.slots[i]=s.filter(t=>t!==tok);_renderWeights();}
function _valPickTgl(i){_W.valPickOpen=_W.valPickOpen===i?null:i;_W.valPickQ='';_renderWeights();}
function _valPickSearch(v){_W.valPickQ=v;_renderWeights();
  const inp=document.querySelector('#page-content input[placeholder="поиск персонажа…"]');
  if(inp){inp.focus();inp.setSelectionRange(v.length,v.length);}}
// правка существующего: копия в форму, «Сохранить» обновляет по id
function _valEdit(id){const t=(_W.tmpl||[]).find(x=>String(x.id)===String(id));if(!t)return;
  _W.valNew={id:t.id,size:t.size,slots:(t.slots||[]).map(s=>s.slice()),note:t.note||''};
  _W.valPickOpen=null;_renderWeights();}
function _valCancel(){_W.valNew=null;_W.valPickOpen=null;_renderWeights();}
async function _valAdd(){
  const n=_W.valNew;
  if(n.slots.some(s=>!s.length))return _valSt('в каждом слоте нужна хотя бы одна опция','var(--red)');
  _valSt('сохранение…');
  if(n.id){
    const{error}=await sb.from('team_templates').update({size:n.size,slots:n.slots,note:n.note||''}).eq('id',n.id);
    if(dbErr(error,'правка шаблона'))return _valSt('ошибка','var(--red)');
    const t=_W.tmpl.find(x=>String(x.id)===String(n.id));
    if(t){t.size=n.size;t.slots=n.slots;t.note=n.note||'';}
    _W.valNew=null;_renderWeights();toast('Шаблон обновлён');return;
  }
  const row={size:n.size,slots:n.slots,note:n.note||'',sort_order:_W.tmpl.length,created_at:new Date().toISOString()};
  const{data,error}=await sb.from('team_templates').insert(row).select().single();
  if(dbErr(error,'создание шаблона'))return _valSt('ошибка','var(--red)');
  _W.tmpl.push(data);_W.valNew={size:n.size,slots:Array.from({length:n.size},()=>[]),note:''};_renderWeights();toast('Шаблон добавлен');}
async function _valDel(id){
  if(!confirm('Удалить шаблон?'))return;
  const{error}=await sb.from('team_templates').delete().eq('id',id);
  if(dbErr(error,'удаление шаблона'))return;
  _W.tmpl=_W.tmpl.filter(t=>String(t.id)!==String(id));_renderWeights();}
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
// sparring_votes → Брэдли-Терри (MM). Единица = состав на калибровочном M ("cid:ms|…").
function _btKey(team){return (team||[]).map(m=>m.cid+':'+(m.ms||0)).sort().join('|');}
// games=[{w:key,l:key}] → {key:{score 0-100, games}}
// Регуляризованный Брэдли-Терри (MM): a псевдо-игр против «среднего» (p=1) тянут малоданные юниты к 50,
// иначе непобеждённый/невыигравший с 1-2 играми улетает в крайности (кейс Чжао).
function _btRank(games,a){
  a=a==null?2:a;
  const ids=[...new Set(games.flatMap(g=>[g.w,g.l]))];
  if(ids.length<2)return {};
  const wins={},opp={};ids.forEach(i=>{wins[i]=0;opp[i]=[];});
  games.forEach(g=>{wins[g.w]++;opp[g.w].push(g.l);opp[g.l].push(g.w);});
  let p={};ids.forEach(i=>p[i]=1);
  for(let it=0;it<300;it++){
    const np={};
    ids.forEach(i=>{
      let d=a/(p[i]+1);                       // псевдо-игры против среднего
      opp[i].forEach(j=>d+=1/(p[i]+p[j]));
      np[i]=(wins[i]+a/2)/d;                  // +a/2 псевдо-побед
    });
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
function _spCmpRoleSet(r){_W.spCmpRole=(_W.spCmpRole===r)?'':r;_renderWeights();}
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
    let items=Object.entries(rank).sort((a,b)=>b[1].score-a[1].score);
    items=items.filter(([key])=>parseKey(key).every(m=>!_spHide(_W.tmCharMap[m.cid]||{})));
    const rf=_W.spCmpRole;
    if(rf)items=items.filter(([key])=>parseKey(key).some(m=>_spFRole(_W.tmCharMap[m.cid])===rf));
    items=items.slice(0,30);
    if(!items.length)return `<div style="color:var(--sub);font-size:12px;padding:8px 0">${rf?'Нет составов этой роли.':'Пока нет голосов — калибруй во вкладке «Спарринг».'}</div>`;
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
  const rf=_W.spCmpRole||'';
  const rbtn=(v,l)=>`<button class="tbtn" style="${rf===v?'border-color:var(--accent);color:#fff':''}" onclick="_spCmpRoleSet('${v}')">${l}</button>`;
  const roleFilter=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
    <span style="font-size:12px;color:var(--sub);margin-right:2px">Роль:</span>
    ${rbtn('','Все')}${_SP_FROLES.map(([v,l])=>rbtn(v,l)).join('')}</div>`;
  html(`${_analyticsTabs()}
  <div style="font-size:12px;color:var(--sub);margin-bottom:12px;line-height:1.5">Рейтинг из парных голосов «Спарринга» (Брэдли-Терри, шкала 0-100). Единица — состав на калибровочном майндскейпе, поэтому M0 и M6 одного перса — разные строки. Это НЕ ручная калибровка — чистый результат сравнений.</div>
  ${roleFilter}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
    <div style="${cardSt}">${hd('Соло','· '+nGames(1)+' голосов')}${col(1,'var(--grad)')}</div>
    <div style="${cardSt}">${hd('Дуо','· '+nGames(2)+' голосов')}${col(2,'#b18cff')}</div>
    <div style="${cardSt}">${hd('Трио','· '+nGames(3)+' голосов')}${col(3,'#5b9dff')}</div>
  </div>`);
}

// ===== Спарринг-калибровка =====
// парные сравнения вариантов, подобранных по ролям (правая повторяет ролевой профиль левой).
// клик по стороне → голос в sparring_votes; «Сложно/ничья» → замена без записи.
const _SP_ROLE_LBL={atk:'ДД',stun:'Стан',sup:'Саппорт',ano:'Аномалия',rupt:'Разлом',def:'Защита'};
async function _spLoad(){
  if(!_W.tmLoaded)await _tmLoad();                       // ростер + карта персонажей
  if(!_W.tagsLoaded)await _loadTags();                   // теги для подбора похожих пар
  const[votes,cfg,picks]=await Promise.all([
    _fetchAllW('sparring_votes'),_fetchAllW('sparring_config'),_fetchAllW('match_picks')]);
  _W.spVotesAll=votes;                                   // полный лог для активного подбора
  _W.spCounts={1:0,2:0,3:0};votes.forEach(v=>_W.spCounts[v.size]=(_W.spCounts[v.size]||0)+1);
  _W.spCfg={};cfg.forEach(r=>_W.spCfg[r.character_id]={ms_groups:r.ms_groups||null,caps:r.caps||null,in_game:r.in_game!==false});
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
  if(!_W.blLoaded)await _blLoad();                         // мусорные составы — не предлагать в спарринге
  _W.spRecent=_W.spRecent||[];
  _W.spLoaded=true;
}
// авто-M: самый частый из пиков → A=6/S=0
function _spAutoMs(c){const rep=_W.spRepMs&&_W.spRepMs[c.id];return rep!=null?rep:(c.rarity==='A'?6:0);}
// группы майндскейпа (ms_groups): каждый массив консты = один юнит, консты внутри равны.
function _spGroups(c){
  const cf=_W.spCfg&&_W.spCfg[c.id];
  const g=cf&&Array.isArray(cf.ms_groups)?cf.ms_groups:[];
  return g.map(a=>[...new Set(a)].sort((x,y)=>x-y)).filter(a=>a.length).sort((a,b)=>a[0]-b[0]);
}
// тиры: группы → юниты (rep = нижняя коста); нет групп → один юнит на типовом (авто) M.
function _spTiers(c){
  const gs=_spGroups(c);
  if(!gs.length)return[{ms:_spAutoMs(c),members:null}];
  return gs.map(g=>({ms:g[0],members:g}));
}
function _spTierLbl(t){
  const m=t.members;if(!m)return 'M'+t.ms;
  if(m.length===1)return 'M'+m[0];
  const contig=m[m.length-1]-m[0]===m.length-1;
  return contig?('M'+m[0]+'–'+m[m.length-1]):('M'+m.join('/'));
}
// M конкретного инстанса состава (c._ms) → фолбэк rep первого тира
function _spMs(c){return c._ms!=null?c._ms:_spTiers(c)[0].ms;}
// synergy_tags ключатся по enka_id, а не UUID — единый резолвер тегов персонажа
const _spTagKey=c=>c&&c.enka_id!=null?String(c.enka_id).split('_')[0]:null;
const _spTagOf=c=>{const k=_spTagKey(c);return k&&_W.tags?_W.tags[k]:null;};
// элемент персонажа (из тегов — единый формат)
const _spElem=c=>{const t=_spTagOf(c);return t&&t.element||'';};
const _spInGame=c=>!(_W.spCfg&&_W.spCfg[c.id]&&_W.spCfg[c.id].in_game===false);
// 3 бакета ролей для подбора состава
const _SP_CAPS=[['main','Главный'],['sub','Саб-ДД'],['sup','Саппорт']];
const _SP_CAP_LBL={main:'Главный',sub:'Саб-ДД',sup:'Саппорт'};
// тег синергии → бакет роли
const _SP_TAG_CAP={crit_dps:'main',main_anomaly:'main',sheer_dps:'main',sub_dps:'sub',sub_anomaly:'sub',stunner:'sup',support:'sup'};
// фолбэк по specialty, если тегов нет
const _SP_ROLE_CAP={atk:'main',ano:'main',rupt:'main',stun:'sup',sup:'sup',def:'sup'};
// роли персонажа (набор бакетов): ручной оверрайд из панели → иначе из тегов → фолбэк по specialty
function _spCaps(c){
  const ov=_W.spCfg&&_W.spCfg[c.id]&&_W.spCfg[c.id].caps;
  if(ov&&ov.length)return new Set(ov);
  const t=_spTagOf(c);const s=new Set();
  if(t&&t.roles)Object.keys(t.roles).forEach(r=>{const b=_SP_TAG_CAP[r];if(b&&t.roles[r])s.add(b);});
  if(!s.size)s.add(_SP_ROLE_CAP[c.role]||'sup');
  return s;
}
const _spHas=(c,role)=>_spCaps(c).has(role);
// роль для фильтра сравнения (оборону показываем как саппорт)
const _spFRole=c=>c&&c.role==='def'?'sup':(c&&c.role)||'';
const _SP_FROLES=[['atk','ДД'],['ano','Аномалия'],['rupt','Разлом'],['stun','Стан'],['sup','Саппорт']];
// уникальны в соло — честно не с кем сравнить, из соло-подбора убираем
const _spSoloOut=c=>/nangong/i.test(c.name||'');
// ещё не вышли — скрываем из всех сравнений
const _spHide=c=>/sigrid|remielle|ramiel/i.test(c.name||'');
function _spPool(size){return _W.tmChars.filter(c=>c.role&&_spInGame(c)&&!_spHide(c)&&!(size===1&&_spSoloOut(c)));}
const _spPick=arr=>arr[Math.floor(Math.random()*arr.length)];
const _spShuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
// валидные ролевые составы: ≤1 главный, нужен урон (main/sub), дуо — без двух саппортов
const _SP_COMPS={
  2:[['main','sub'],['main','sup'],['sub','sub'],['sub','sup']],
  3:[['main','sub','sup'],['main','sup','sup'],['main','sub','sub'],
     ['sub','sub','sup'],['sub','sup','sup'],['sub','sub','sub']]
};
function _spComp(size){const c=_SP_COMPS[size];return c?_spShuffle(_spPick(c).slice()):null;}
// похожесть кандидата x к левому персонажу lc: теги (Жаккар) + элемент + близость консты
function _spSim(lc,x){
  const A=_W.spSig[_spTagKey(lc)],B=_W.spSig[_spTagKey(x)];let tj=0;
  if(A&&B&&A.size&&B.size){let inter=0;A.forEach(k=>{if(B.has(k))inter++;});tj=inter/(A.size+B.size-inter);}
  const le=_spElem(lc),xe=_spElem(x);const el=(le&&xe&&le===xe)?1:0;
  const lm=lc._ms!=null?lc._ms:_spAutoMs(lc),xm=_spAutoMs(x);const mc=1-Math.abs(lm-xm)/6;
  return 0.5*tj+0.3*el+0.2*mc;                            // теги важнее, элемент и коста — доп. притяжение
}
const _spRecentHas=id=>(_W.spRecent||[]).includes(String(id));
// взвешенно-случайный выбор с приоритетом кандидата (вес>0)
function _spWeighted(cands,weightFn){
  const w=cands.map(weightFn);const tot=w.reduce((a,b)=>a+b,0);
  if(tot<=0)return _spPick(cands);
  let r=Math.random()*tot;for(let i=0;i<cands.length;i++){r-=w[i];if(r<=0)return cands[i];}
  return cands[cands.length-1];
}
// инстанс перса: случайный тир майндскейпа (rep M + подпись) + сыгранная роль
const _spInst=(c,pr)=>{const t=_spPick(_spTiers(c));return{...c,_ms:t.ms,_mlbl:_spTierLbl(t),_pr:pr||null};};
// сколько раз перс участвовал в сравнениях данного размера (для активного подбора)
function _spSeen(size){
  const m={};(_W.spVotesAll||[]).filter(v=>v.size===size).forEach(v=>{
    [...(v.left_team||[]),...(v.right_team||[])].forEach(u=>{m[u.cid]=(m[u.cid]||0)+1;});
  });
  return m;
}
// вес недосэмплированности: реже сравнивали → выше приоритет (плотнее и объективнее модель)
const _spRareW=(seen,id)=>1/(1+(seen[id]||0));
// команда по ролевой последовательности gseq (null для соло = без ограничений). left — для похожести правой.
function _spSide(size,gseq,pool,exclude,left,seen){
  const used=new Set(exclude||[]);const team=[];
  for(let i=0;i<size;i++){
    const role=gseq&&gseq[i];
    let cand=pool.filter(c=>!used.has(c.id)&&(!role||_spHas(c,role)));
    if(!cand.length)return null;
    const fresh=cand.filter(c=>!_spRecentHas(c.id));if(fresh.length)cand=fresh;
    const c=left
      ? _spWeighted(cand,x=>Math.pow(_spRareW(seen,x.id),2)*(1+0.3*_spSim(left[i],x))) // редкость доминирует, схожесть — лёгкий нудж
      : _spWeighted(cand,x=>Math.pow(_spRareW(seen,x.id),2));
    used.add(c.id);team.push(_spInst(c,role));
  }
  return team;
}
// ключ матчапа (без учёта стороны) для дедупа повторных пар
function _spMKey(left,right){
  const s=t=>t.map(c=>c.id).sort().join(',');
  return [s(left),s(right)].sort().join(' vs ');
}
const _spRecentM=k=>(_W.spRecentM||[]).includes(k);
// инстанс из конкретного тир-юнита (M фиксирован, без случайного тира)
const _spInstU=u=>({...u.c,_ms:u.ms,_mlbl:u.mlbl,_pr:null});
// соло: модельно-осознанный подбор — недосэмплированные тир-юниты × близость рейтингов × новизна пары.
// (не тянем по киту, иначе перс всегда встречает похожих и не пересекается с теми, кого реально надо сравнить)
function _spGenSolo(pool){
  const votes=(_W.spVotesAll||[]).filter(v=>v.size===1);
  const games=[],pairS={};
  votes.forEach(v=>{const a=_btKey(v.left_team),b=_btKey(v.right_team);if(a===b)return;
    games.push(v.winner==='left'?{w:a,l:b}:{w:b,l:a});
    pairS[[a,b].sort().join('#')]=(pairS[[a,b].sort().join('#')]||0)+1;});
  const rank=_btRank(games);
  const gamesOf=k=>rank[k]?rank[k].games:0, scoreOf=k=>rank[k]?rank[k].score:null;
  const units=[];pool.forEach(c=>_spTiers(c).forEach(t=>units.push({c,ms:t.ms,mlbl:_spTierLbl(t),role:_spFRole(c),key:c.id+':'+t.ms})));
  if(units.length<2)return null;
  const recU=_W.spRecentU||[];const notRec=u=>!recU.includes(u.key);
  let fallback=null;
  for(let tries=0;tries<200;tries++){
    let lc=units.filter(notRec);if(!lc.length)lc=units;
    const L=_spWeighted(lc,u=>1/(1+gamesOf(u.key)));         // левый: реже всего сыгранный юнит
    let rc=units.filter(u=>u.c.id!==L.c.id&&u.role===L.role);
    if(!rc.length)continue;
    const rcf=rc.filter(notRec);if(rcf.length)rc=rcf;
    const gL=scoreOf(L.key);
    const R=_spWeighted(rc,u=>{
      const gR=scoreOf(u.key);
      const close=(gL!=null&&gR!=null)?1/(1+Math.abs(gL-gR)/8):1.3;  // близкий рейтинг информативнее; неизвестный тоже
      const nov=1/(1+(pairS[[L.key,u.key].sort().join('#')]||0));    // новизна пары (Чжао↔Рина, если не встречались)
      const rare=1/(1+gamesOf(u.key));                                // недосэмплированность правого
      return close*nov*rare*(1+0.25*_spSim(L.c,u.c));                 // кит — лёгкий нудж, не доминанта
    });
    const m={left:[_spInstU(L)],right:[_spInstU(R)]};
    fallback=fallback||m;
    if(!_spRecentM(_spMKey(m.left,m.right)))return m;
  }
  return fallback;
}
function _spGen(){
  const size=_W.sparSize||1;
  const pool=_spPool(size);if(pool.length<size+1)return null;
  if(size<2)return _spGenSolo(pool);
  const seen=_spSeen(size);                                // приоритет редко сравниваемым
  let fallback=null;
  for(let tries=0;tries<160;tries++){
    const gseq=_spComp(size);                              // одна ролевая раскладка на обе стороны
    const left=_spSide(size,gseq,pool,[],null,seen);if(!left)continue;
    const right=_spSide(size,gseq,pool,left.map(c=>c.id),left,seen);if(!right)continue;
    const lk=left.map(c=>c.id).sort().join('|'),rk=right.map(c=>c.id).sort().join('|');
    if(lk===rk)continue;                                   // полностью одинаковые составы
    if(_blHas(left.map(c=>c.id))||_blHas(right.map(c=>c.id)))continue; // помечен мусором (в т.ч. мусорная пара внутри трио)
    const m={left,right};fallback=fallback||m;
    if(!_spRecentM(_spMKey(left,right)))return m;          // не повторяем недавний матчап
  }
  return fallback;                                          // пул мал — отдаём хоть что-то
}
// запомнить показанных: персонажей, тир-юниты и матчап целиком (чтобы пара/юнит не всплывали слишком часто)
function _spRemember(cur){
  if(!cur)return;const all=[...cur.left,...cur.right];
  _W.spRecent=[...all.map(c=>String(c.id)),...(_W.spRecent||[])].slice(0,40);      // ~20 пар × 2 стороны
  _W.spRecentU=[...all.map(c=>c.id+':'+_spMs(c)),...(_W.spRecentU||[])].slice(0,30); // тир-юниты (M0 и M1 независимо)
  _W.spRecentM=[_spMKey(cur.left,cur.right),...(_W.spRecentM||[])].slice(0,25);      // ~25 матчапов
}
// пометить состав(ы) мусором: больше не предлагать и не автодобавлять (пара блокирует и тройки с ней)
async function _spTrash(which){
  const cur=_W.spCur;if(!cur)return;
  const sides=which==='both'?['left','right']:[which];
  const st=document.getElementById('sp-status');
  if(st){st.textContent='помечаю…';st.style.color='var(--sub)';}
  let n=0;
  for(const s of sides){
    const cids=cur[s].map(c=>c.id);
    const names=cur[s].map(c=>c.name).join(' + ');
    if(await _blAdd(cids,names))n++;
  }
  if(st){st.textContent=n?`✓ в мусор: ${n}`:'ошибка';st.style.color=n?'var(--accent)':'var(--red)';}
  if(n)_spNext();
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
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${_spMs(c)?'#f5c842':'var(--sub)'}">${c._mlbl||('M'+_spMs(c))}</span>
      </span></div>`).join('');
    return `<div onclick="_spVote('${side}')" title="Клик — этот вариант сильнее"
      style="flex:1;min-width:250px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px 18px;cursor:pointer;transition:border-color .12s,transform .12s"
      onmouseover="this.style.borderColor='var(--accent)';this.style.transform='translateY(-2px)'"
      onmouseout="this.style.borderColor='var(--border)';this.style.transform=''">
      <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap">${chips}</div>
      <div style="text-align:center;margin-top:14px;font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:13px;letter-spacing:.04em;color:var(--sub)">Сильнее ${side==='left'?'левый':'правый'}</div>
    </div>`;
  };
  const seen=_spSeen(size);
  const rare=_spPool(size).slice().sort((a,b)=>((seen[a.id]||0)-(seen[b.id]||0))).slice(0,6);
  const suggest=rare.length?`<div style="font-size:11.5px;color:var(--sub);margin-bottom:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
    <span>Реже всего сравнивались (подбор смещён к ним):</span>
    ${rare.map(c=>`<span style="display:inline-flex;align-items:center;gap:4px;background:var(--field);border:1px solid var(--border);border-radius:6px;padding:1px 6px">${iconChar(c,16)}<span>${escapeHtml(c.name)}</span><b style="color:var(--sub)">${seen[c.id]||0}</b></span>`).join('')}</div>`:'';
  html(`${_analyticsTabs()}${tabs}
  <div style="font-size:12px;color:var(--sub);margin-bottom:14px;line-height:1.5">Кликни вариант, который кажется сильнее (в вакууме, без учёта врагов). Роли сторон совпадают. «Сложно / ничья» — заменить пару без записи. Система смещает подбор к редко сравниваемым персонажам — так модель становится плотнее и объективнее.</div>
  ${suggest}
  <div style="display:flex;gap:16px;align-items:stretch;flex-wrap:wrap">
    ${sideCard(cur.left,'left')}
    <div style="display:flex;flex-direction:column;justify-content:center;gap:10px;align-self:center">
      <span style="font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:22px;color:var(--sub);text-align:center">VS</span>
      <button class="btn" style="padding:8px 14px" onclick="_spSkip()">Сложно / ничья</button>
      <button class="btn" style="padding:8px 14px" onclick="_spNext()">Новая пара</button>
      ${size>=2?`<button class="btn" style="padding:6px 12px;font-size:12px" onclick="_spTrash('left')">🚫 левый — мусор</button>
      <button class="btn" style="padding:6px 12px;font-size:12px" onclick="_spTrash('right')">🚫 правый — мусор</button>
      <button class="btn" style="padding:6px 12px;font-size:12px" onclick="_spTrash('both')">🚫 оба мусор</button>`:''}
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
    const autoM=rep!=null?rep:(c.rarity==='A'?6:0);
    const groups=Array.isArray(cf.ms_groups)?cf.ms_groups:[];
    const inSel=m=>groups.some(g=>g.includes(m));
    const sameG=m=>{let gi=-1,gj=-1;groups.forEach((g,i)=>{if(g.includes(m))gi=i;if(g.includes(m+1))gj=i;});return gi>=0&&gi===gj;};
    const isAuto=groups.length===0;
    const tiers=_spTiers(c);
    const chipSt=on=>`font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent)':'transparent'};color:${on?'#fff':'var(--sub)'};border-radius:5px;padding:2px 6px;cursor:pointer`;
    const autoChip=`<button onclick="_spCfgMsAuto('${c.id}')" title="Авто = один юнит на типовом M из пиков" style="font-size:11px;font-weight:600;border:1px solid ${isAuto?'var(--accent)':'var(--border)'};background:${isAuto?'var(--accent)':'transparent'};color:${isAuto?'#fff':'var(--sub)'};border-radius:5px;padding:2px 8px;cursor:pointer">авто M${autoM}</button>`;
    let chips='';
    for(let m=0;m<=6;m++){
      chips+=`<button onclick="_spCfgMsToggle('${c.id}',${m})" style="${chipSt(inSel(m))}">M${m}</button>`;
      if(m<6){const both=inSel(m)&&inSel(m+1),lk=both&&sameG(m);
        chips+=both
          ? `<button onclick="_spCfgMsLink('${c.id}',${m})" title="${lk?'Разъединить':'Объединить'} M${m} и M${m+1}" style="border:none;background:none;cursor:pointer;font-size:13px;line-height:1;padding:0 1px;color:${lk?'#f5c842':'var(--sub)'}">${lk?'🔗':'·'}</button>`
          : `<span style="display:inline-block;width:5px"></span>`;
      }
    }
    const tierPills=tiers.map(t=>`<span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:#f5c842;background:var(--field);border:1px solid var(--border);border-radius:4px;padding:1px 5px">${_spTierLbl(t)}</span>`).join('');
    const eff=_spCaps(c);const capOv=Array.isArray(cf.caps)&&cf.caps.length;
    const roleAuto=`<button onclick="_spCfgCapAuto('${c.id}')" title="Роли авто из тегов синергии" style="font-size:11px;font-weight:600;border:1px solid ${capOv?'var(--border)':'var(--accent)'};background:${capOv?'transparent':'var(--accent)'};color:${capOv?'var(--sub)':'#fff'};border-radius:5px;padding:2px 8px;cursor:pointer">авто</button>`;
    const roleChips=_SP_CAPS.map(([v,l])=>`<button onclick="_spCfgCap('${c.id}','${v}')" style="font-size:11px;font-weight:600;border:1px solid ${eff.has(v)?'var(--accent)':'var(--border)'};background:${eff.has(v)?'var(--accent)':'transparent'};color:${eff.has(v)?'#fff':'var(--sub)'};border-radius:5px;padding:2px 8px;cursor:pointer">${l}</button>`).join('');
    return `<div style="padding:8px 10px;border-radius:8px;background:${inGame?'transparent':'rgba(255,80,80,.06)'};border:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        ${iconChar(c,34)}
        <div style="min-width:0;flex:1"><div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.name)}</div>
          <div style="font-size:10.5px;color:var(--sub)">${_SP_ROLE_LBL[c.role]||c.role}${rep==null?' · нет пиков':''}</div></div>
        <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--sub);cursor:pointer;white-space:nowrap" title="Выключить — не показывать в спарринге (напр. ещё не вышел)">
          <input type="checkbox" ${inGame?'checked':''} onchange="_spCfgGame('${c.id}',this.checked)">в игре</label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center"><span style="font-size:10px;color:var(--sub);margin-right:2px" title="Выбери косты для сравнения; 🔗 между соседними — склеить в один тир">Косты:</span>${autoChip}${chips}<span style="margin-left:6px;font-size:10px;color:var(--sub)">→</span>${tierPills}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:6px"><span style="font-size:10px;color:var(--sub);margin-right:2px">Роль:</span>${roleAuto}${roleChips}</div>
    </div>`;
  };
  return `<div class="card" style="padding:14px 16px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <span style="font-size:13px;font-weight:600">Майндскейп, роли и «в игре»</span>
      <input placeholder="поиск…" value="${escapeHtml(_W.spCfgQ||'')}" oninput="_spCfgSearch(this.value)" style="${inSt};min-width:180px">
      <span id="sp-cfg-status" style="font-size:12px;color:var(--sub);margin-left:auto"></span></div>
    <div style="font-size:11px;color:var(--sub);margin-bottom:10px;line-height:1.5"><b>Косты:</b> «авто» — один юнит на типовом M. Выбери нужные консты (не обязательно все), 🔗 между соседними склеивает их в один тир, где консты считаются равными (Джейн: M0🔗M1, отдельно M2). Каждый тир — отдельный юнит сравнения. <b>Роль:</b> «авто» — из тегов синергии; можно задать вручную и мультиролью (Главный/Саб-ДД/Саппорт). Дуо/трио: ≤1 главный, нужен урон, дуо без двух саппортов. Сними «в игре» у ещё не вышедших. Сохраняется сразу.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:6px">${chars.map(cell).join('')}</div></div>`;
}
function _spCfgTgl(){_W.spCfgOpen=!_W.spCfgOpen;_renderWeights();}
function _spCfgSearch(v){_W.spCfgQ=v;_renderWeights();
  const inp=document.querySelector('#page-content input[placeholder="поиск…"]');if(inp){inp.focus();inp.setSelectionRange(v.length,v.length);}}
function _spCfgStatus(s,c){const el=document.getElementById('sp-cfg-status');if(el){el.textContent=s;el.style.color=c||'var(--sub)';}}
async function _spCfgSave(cid){
  const cf=_W.spCfg[cid]||{in_game:true};
  const row={character_id:cid,ms_groups:(cf.ms_groups&&cf.ms_groups.length)?cf.ms_groups:null,caps:(cf.caps&&cf.caps.length)?cf.caps:null,in_game:cf.in_game!==false,updated_at:new Date().toISOString()};
  _spCfgStatus('сохранение…');
  const{error}=await sb.from('sparring_config').upsert(row,{onConflict:'character_id'});
  if(dbErr(error,'сохранение калибровки')){_spCfgStatus('ошибка','var(--red)');return;}
  _spCfgStatus('✓ сохранено','var(--accent)');
}
// нормализация групп: uniq+sort внутри, sort по нижней консте, drop пустых, [] → null
function _spNormG(gs){const out=gs.map(g=>[...new Set(g)].sort((x,y)=>x-y)).filter(g=>g.length).sort((a,b)=>a[0]-b[0]);return out.length?out:null;}
// разбить набор на связные диапазоны (группы держим контагиозными)
function _spSplitContig(arr){const a=[...arr].sort((x,y)=>x-y);const out=[];let run=[];a.forEach(m=>{if(run.length&&m!==run[run.length-1]+1){out.push(run);run=[];}run.push(m);});if(run.length)out.push(run);return out;}
// клик по консте — вкл/выкл в выборе (новая = одиночный тир, не слита с соседями)
function _spCfgMsToggle(cid,m){
  const cf=_W.spCfg[cid]=_W.spCfg[cid]||{in_game:true};
  let gs=(cf.ms_groups||[]).map(a=>a.slice());
  let gi=-1;gs.forEach((g,i)=>{if(g.includes(m))gi=i;});
  if(gi>=0)gs.splice(gi,1,...(_spSplitContig(gs[gi].filter(x=>x!==m))));
  else gs.push([m]);
  cf.ms_groups=_spNormG(gs);
  _W.spCur=null;_spCfgSave(cid);_renderWeights();
}
// тумблер связи m ↔ m+1 (оба выбраны): одна группа → разъединить, разные → объединить
function _spCfgMsLink(cid,m){
  const cf=_W.spCfg[cid]=_W.spCfg[cid]||{in_game:true};
  let gs=(cf.ms_groups||[]).map(a=>a.slice());
  let gi=-1,gj=-1;gs.forEach((g,i)=>{if(g.includes(m))gi=i;if(g.includes(m+1))gj=i;});
  if(gi<0||gj<0)return;
  if(gi===gj){const g=gs[gi];gs.splice(gi,1,g.filter(x=>x<=m),g.filter(x=>x>m));}
  else{const merged=[...gs[gi],...gs[gj]];gs=gs.filter((_,i)=>i!==gi&&i!==gj);gs.push(merged);}
  cf.ms_groups=_spNormG(gs);
  _W.spCur=null;_spCfgSave(cid);_renderWeights();
}
// сброс в авто
function _spCfgMsAuto(cid){const cf=_W.spCfg[cid]=_W.spCfg[cid]||{in_game:true};cf.ms_groups=null;_W.spCur=null;_spCfgSave(cid);_renderWeights();}
// тумблер роли (мультивыбор); первый клик стартует с авто-набора из тегов
function _spCfgCap(cid,role){
  const cf=_W.spCfg[cid]=_W.spCfg[cid]||{in_game:true};
  let arr=(Array.isArray(cf.caps)&&cf.caps.length)?cf.caps.slice():[..._spCaps(_W.tmCharMap[cid]||{id:cid})];
  const i=arr.indexOf(role);if(i>=0)arr.splice(i,1);else arr.push(role);
  cf.caps=arr.length?arr:null;         // пусто → снова авто из тегов
  _W.spCur=null;_spCfgSave(cid);_renderWeights();
}
function _spCfgCapAuto(cid){const cf=_W.spCfg[cid]=_W.spCfg[cid]||{in_game:true};cf.caps=null;_W.spCur=null;_spCfgSave(cid);_renderWeights();}
function _spCfgGame(cid,on){const cf=_W.spCfg[cid]=_W.spCfg[cid]||{};cf.in_game=!!on;_W.spCur=null;_spCfgSave(cid);_renderWeights();}
function _spMode(v){_W.sparSize=v;_W.spCur=null;_W.spSession=0;_renderWeights();}
function _spSkip(){_spNext();}
function _spSt(s,c){const el=document.getElementById('sp-status');if(el){el.textContent=s;el.style.color=c||'var(--sub)';}}
async function _spVote(side){
  const cur=_W.spCur;if(!cur)return;
  const size=_W.sparSize||1;
  const pack=t=>t.map(c=>({cid:c.id,ms:_spMs(c)}));
  const row={size,left_team:pack(cur.left),right_team:pack(cur.right),winner:side};
  (_W.spVotesAll=_W.spVotesAll||[]).push(row);            // учитываем голос сразу (просмотренность/подбор)
  _spNext();                                             // мгновенно следующая пара
  _W.spSession=(_W.spSession||0)+1;
  const{error}=await sb.from('sparring_votes').insert(row);
  if(dbErr(error,'запись голоса')){_W.spSession--;_spSt('голос НЕ записан (нет таблицы/авторизации?)','var(--red)');return;}
  _W.spCounts[size]=(_W.spCounts[size]||0)+1;_spSt('✓ записано','var(--accent)');
}
