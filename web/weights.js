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

let _W={rows:[],saved:{},sortKey:'power',sortDir:-1,wman:0.5,roleFilter:'all',expanded:new Set(),
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
    const cb=(v,l,on)=>`<button class="tbtn" style="${_W.calib===v?'border-color:var(--accent);color:#fff':''}${on?'':';opacity:.5;cursor:not-allowed'}" ${on?`onclick="_anaCalib('${v}')"`:'disabled'}>${l}</button>`;
    sub=`<div style="display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px">
      <span style="font-size:12px;color:var(--sub);align-self:center;margin-right:4px">Состав:</span>
      ${cb('solo','Соло',true)}${cb('duo','Дуо',false)}${cb('trio','Трио',false)}</div>`;
  }
  return `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">
    ${secBtn('power','Калибровка силы персонажей')}${secBtn('shiyu','Влияние бафов Шиюй')}${secBtn('consts','Теги + майндскейпы')}
  </div>${sub}`;
}
function _anaSection(v){_W.section=v;_renderWeights();}
function _anaCalib(v){_W.calib=v;_renderWeights();}
// заглушка-раздел (пока не реализован)
function _anaStub(title,note){
  html(`${_analyticsTabs()}<div class="card" style="padding:22px"><h3 style="margin:0 0 8px">${title}</h3>
    <p style="color:var(--sub);font-size:13px;line-height:1.6;margin:0">${note}</p></div>`);
}
function _renderWeights(){
  if(_W.section==='shiyu')return _renderShiyuBuffs();
  if(_W.section==='consts')return _renderTagsEditor();
  // section='power'
  if(_W.calib!=='solo')return _anaStub('Калибровка силы — '+(_W.calib==='duo'?'Дуо':'Трио'),'Раздел в разработке.');
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
  _W.wman=+val/100;document.getElementById('wman-out').textContent=_W.wman.toFixed(2);
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
function _charByName(name){
  if(!_W.charIdx){
    _W.charIdx={};
    (D.chars||[]).forEach(c=>{if(!c||!c.name)return;_W.charIdx[c.name]=c;
      const full=_NAME_ALIAS[c.name];if(full)_W.charIdx[full]=c;});
  }
  return _W.charIdx[name]||{name};
}
function _tagChar(id){
  const t=_W.tags[id]||{};
  return _charByName(t.name);
}

async function _loadTags(){
  const[base,rows]=await Promise.all([
    fetch('web/data/synergy_tags.json?v='+Date.now()).then(r=>r.json()).catch(()=>({})),
    _fetchAllW('synergy_tags')
  ]);
  const map={};
  for(const cid in base)map[cid]=JSON.parse(JSON.stringify(base[cid]));
  _W.tagDb=new Set();
  rows.forEach(r=>{map[r.character_id]=r.data;_W.tagDb.add(String(r.character_id));});
  _W.tags=map;_W.tagsLoaded=true;
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
  <p style="color:var(--sub);font-size:12px;margin:0 0 12px;line-height:1.5">Клик по персонажу — редактор. Базовые роли/даёт/нужно — шкала 0-4 (M0). Майндскейпы: «даёт себе»/«даёт команде» строками (тег · сила · с какого M), сила может быть больше 4. Урон M1–M6 — множитель к M0. Сохраняется автоматически.</p>
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
  const msN=t.ms?(Object.keys(t.ms.gives_self||{}).length+Object.keys(t.ms.gives||{}).length):0;
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
  const ms=t.ms||(t.ms={gives_self:{},gives:{},dmg:{},note:'',a_rank:false});
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

  // Мидскейпы: таблица Тег | Сила | С M | ✕
  const msTable=(which)=>{
    const obj=ms[which]||{};const keys=Object.keys(obj);
    const rows=keys.map(tag=>{
      const v=obj[tag]||{mag:1,at:1};
      const tagOpts=_TAGVOCAB.map(([k,l])=>`<option value="${k}" ${k===tag?'selected':''}>${l}</option>`).join('');
      const atOpts=[1,2,3,4,5,6].map(m=>`<option value="${m}" ${+v.at===m?'selected':''}>M${m}</option>`).join('');
      const inSt='background:var(--field);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:12px';
      return `<tr>
        <td style="${cellSt}"><select onchange="_tagMsKey('${id}','${which}','${tag}',this.value)" style="${inSt};min-width:150px">${tagOpts}</select></td>
        <td style="${cellSt};text-align:center"><input type="number" step="0.5" value="${v.mag}" onchange="_tagMsSet('${id}','${which}','${tag}','mag',this.value)" style="${inSt};width:60px;text-align:center"></td>
        <td style="${cellSt};text-align:center"><select onchange="_tagMsSet('${id}','${which}','${tag}','at',this.value)" style="${inSt}">${atOpts}</select></td>
        <td style="${cellSt};text-align:center"><button class="btn" style="padding:2px 9px" onclick="_tagMsDel('${id}','${which}','${tag}')">✕</button></td></tr>`;}).join('')
      ||`<tr><td colspan="4" style="${cellSt};color:var(--sub);font-size:12px">— пусто —</td></tr>`;
    return `<table style="border-collapse:collapse;width:100%">
      <thead><tr style="font-size:11px;color:var(--sub);text-transform:uppercase">
        <th style="text-align:left;padding:4px 10px">Тег</th><th style="padding:4px 10px">Сила</th>
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
    <div style="font-size:12px;color:var(--sub);margin-top:6px">Сила майндскейпов может быть больше 4 (шкала 0-4 — только для базовых тегов M0). «С M» — с какого майндскейпа эффект активен.</div>
    ${H('Множитель урона по майндскейпам (× к M0)')}${dmgRow}
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
function _tagMs(id){const t=_W.tags[id];return t.ms||(t.ms={gives_self:{},gives:{},dmg:{},note:'',a_rank:false});}
function _tagMsAdd(id,which){const m=_tagMs(id);m[which]=m[which]||{};const free=_TAGVOCAB.map(x=>x[0]).find(k=>!(k in m[which]))||'dmg_buff';m[which][free]={mag:1,at:1};_tagQueueSave(id);_renderTagsEditor();}
function _tagMsKey(id,which,oldTag,newTag){const m=_tagMs(id);if(newTag===oldTag||!m[which])return;m[which][newTag]=m[which][oldTag];delete m[which][oldTag];_tagQueueSave(id);_renderTagsEditor();}
function _tagMsSet(id,which,tag,field,v){const m=_tagMs(id);if(!m[which]||!m[which][tag])return;m[which][tag][field]=field==='at'?+v:parseFloat(v);_tagQueueSave(id);}
function _tagMsDel(id,which,tag){const m=_tagMs(id);if(m[which])delete m[which][tag];_tagQueueSave(id);_renderTagsEditor();}
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
      fetch('web/data/synergy_tags.json?v='+Date.now()).then(r=>r.json()).catch(()=>({}))])
      .then(([rows,tj])=>{_W.shyTours=rows;
        _W.shyRoster=Object.entries(tj).map(([id,v])=>({id,name:v.name})).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
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

  // (1) справочник семейств: авто-разбор из % даёт стартовую силу 0-4, дальше правится руками
  const famRows=_BUFF_FAMILIES.map(([k,l,band,gate,desc])=>`<tr>
    <td style="${td}"><b>${l}</b><div style="font-size:11px;color:var(--sub)">${desc}</div></td>
    <td style="${td};text-align:center;font-family:'JetBrains Mono',monospace">${band[0]}–${band[1]}%</td>
    <td style="${td};text-align:center;font-family:'JetBrains Mono',monospace">2–4</td>
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
  const perTour=tours.length?`<div style="${card}">${H('Бафы по турнирам')}
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
    const partCard=(e,i)=>{
      const chars=e.chars||[];
      const chips=chars.map(cid=>`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:rgba(83,74,183,.18);color:#b3aaf0;border-radius:10px;padding:1px 8px;margin:2px 4px 2px 0">${escapeHtml(rosterName[cid]||cid)}<span style="cursor:pointer;opacity:.7" onclick="_shyPartCharTgl(${i},'${cid}')">✕</span></span>`).join('')
        ||'<span style="font-size:11px;color:var(--sub)">— не выбраны → авто-гейт по элементу/архетипу —</span>';
      let picker='';
      if(_W.shyPartOpen===i){
        const list=(_W.shyRoster||[])
          .map(r=>`<label style="display:flex;align-items:center;gap:6px;padding:2px 4px;font-size:12px;cursor:pointer">
            <input type="checkbox" ${chars.map(String).includes(String(r.id))?'checked':''} onchange="_shyPartCharTgl(${i},'${r.id}')">${escapeHtml(r.name)}</label>`).join('');
        picker=`<div style="margin-top:8px;border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--card)">
          <input placeholder="поиск…" oninput="_shyFilterPicker(this)" style="${inSt};width:200px;margin-bottom:8px">
          <div style="max-height:220px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:2px 10px">${list}</div>
          <button class="btn" style="padding:2px 10px;margin-top:8px" onclick="_shyPartTgl(${i})">Готово</button></div>`;
      }
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--card)">
        <input value="${escapeHtml(e.desc||'')}" onchange="_shyPartField(${i},'desc',this.value)" placeholder="описание части бафа" style="${inSt};width:100%;margin-bottom:10px">
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--sub)">Тип <select onchange="_shyPartField(${i},'tag',this.value)" style="${inSt};margin-left:4px">${tagOpt(e)}</select></label>
          <span style="font-size:12px;color:var(--sub)">Сила ${_seg(e.w!=null?e.w:_w04(e.mag),`_shyEffW(${i},{v})`)}</span>
          <label style="font-size:12px;color:var(--sub)">Работает <input type="number" min="0" max="100" step="5" value="${e.apply!=null?e.apply:100}" onchange="_shyPartField(${i},'apply',this.value)" style="${inSt};width:60px;text-align:center">%</label>
          <label style="font-size:12px;color:var(--sub);display:inline-flex;align-items:center;gap:5px"><input type="checkbox" ${e.cond?'checked':''} onchange="_shyPartField(${i},'cond',this.checked)">условный</label>
          <button class="btn" style="padding:2px 10px;margin-left:auto" onclick="_shyEffDel(${i})">✕ удалить</button>
        </div>
        ${e.pct!=null?`<div style="font-size:11px;color:var(--sub);margin-top:6px">из текста: ${e.pct}${e.flat?'pts':'%'}</div>`:''}
        <div style="margin-top:10px"><div style="font-size:12px;color:var(--sub);margin-bottom:4px">Для кого работает
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
      <div style="font-size:12px;color:var(--sub);margin:-4px 0 10px;line-height:1.5">Каждую клаузу бафа можно вынести отдельной частью: тип, сила 0-4, «работает» % и список персонажей, для кого она реально применяется (если пусто — авто-гейт по элементу/архетипу/формуле урона).</div>
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
  if(field==='desc'||field==='apply')return; // текст/число по blur — без ре-рендера
  _renderShiyuBuffs();}
function _shyEffDel(i){_W.shyDraft.effects.splice(i,1);if(_W.shyPartOpen===i)_W.shyPartOpen=null;_renderShiyuBuffs();}
function _shyEffAdd(){_W.shyDraft.effects.push({tag:'dmg_buff',pct:null,flat:false,cond:false,w:2,mag:0.5,apply:100,chars:[],desc:''});_renderShiyuBuffs();}
// выбор персонажей для части
function _shyPartTgl(i){_W.shyPartOpen=_W.shyPartOpen===i?null:i;_renderShiyuBuffs();}
// фильтр списка персонажей без ре-рендера (иначе теряется фокус в поиске)
function _shyFilterPicker(inp){const q=inp.value.toLowerCase();const grid=inp.parentElement.querySelector('div');
  if(grid)grid.querySelectorAll('label').forEach(l=>{l.style.display=l.textContent.toLowerCase().includes(q)?'':'none';});}
function _shyPartCharTgl(i,id){const e=_W.shyDraft.effects[i];e.chars=e.chars||[];
  const j=e.chars.map(String).indexOf(String(id));j<0?e.chars.push(id):e.chars.splice(j,1);_renderShiyuBuffs();}
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
