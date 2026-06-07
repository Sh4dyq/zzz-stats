// tournaments.js — турниры и косты

const TOUR_STATUSES=[['live','🔴 Идёт сейчас'],['upcoming','🗓 Анонс'],['finished','✓ Завершён']];
const BRACKET_TYPES=[['SE','Single Elimination'],['DE','Double Elimination'],['RR','Round Robin'],['SWISS','Swiss'],['GROUPS','Группы']];
const FMT_FULL={SE:'Single Elimination',DE:'Double Elimination',RR:'Round Robin',GROUPS:'Группы',SWISS:'Swiss'};
// полное имя формата турнира; многоэтапный «RR->DE» → «Round Robin → Double Elimination»
const fmtFullName=bt=>String(bt||'').split(/\s*->\s*/).filter(Boolean).map(c=>FMT_FULL[c]||c).join(' → ')||'—';
// два селекта: формат этапа 1 + опциональный этап 2 (хранится в bracket_type как «fmt1->fmt2»)
function fmtSelects(p,bt){
  const [s1='SE',s2='']=String(bt||'SE').split(/\s*->\s*/);
  const opt=(sel)=>BRACKET_TYPES.map(([v,l])=>`<option value="${v}" ${sel===v?'selected':''}>${l}</option>`).join('');
  return`<div><label>Формат (этап 1)</label><select id="${p}fmt">${opt(s1)}</select></div>
    <div><label>Формат этапа 2 (опц.)</label><select id="${p}fmt2"><option value="">— один этап —</option>${opt(s2)}</select></div>`;
}
const fmtTourDates=t=>{
  if(!t.event_date)return'—';
  const d=x=>new Date(x).toLocaleDateString('ru',{day:'2-digit',month:'short'});
  return t.event_date_end&&t.event_date_end!==t.event_date?`${d(t.event_date)} – ${d(t.event_date_end)}`:d(t.event_date);
};
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
        <div style="font-size:12px;color:var(--sub)">${fmtFullName(t.bracket_type)} · ${fmtTourDates(t)} · уч.: ${t.expected_players||'—'}${t.stages_count>1?` · этапов: ${t.stages_count}`:''}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      ${statusSel}
      <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openTourSettings('${t.id}','${t.name.replace(/'/g,"\\'")}')">⚙ Настройки</button>
      <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openParticipants('${t.id}','${t.name.replace(/'/g,"\\'")}')">Участники</button>
      <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openBracketEditor('${t.id}','${t.name.replace(/'/g,"\\'")}')">Сетка</button>
      <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openCosts('${t.id}','${t.name.replace(/'/g,"\\'")}')">Косты</button>
      <button class="btn-r" onclick="delTour('${t.id}')">✕</button>
    </div>
  </div>`;}).join('');
  html(`<div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent)">
    <div style="font-size:13px;line-height:1.5">💡 <b>После турнира:</b> поставь ему статус <b>«✓ Завершён»</b>, а новому — <b>«🔴 Идёт сейчас»</b>. Этого достаточно — на главной и в статистике «текущим» автоматически станет live-турнир, а в блоке «Топ турнира» — последний завершённый. <span style="color:var(--sub)">SQL править больше не нужно.</span></div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <h3>Новый турнир</h3>
    <div class="grid2">
      <div><label>Название</label><input id="t-name" type="text" placeholder="Nexus Shiyu Proxy Rush 6"></div>
      ${fmtSelects('t-','SE')}
      <div><label>Дата начала</label><input id="t-date" type="date"></div>
      <div><label>Дата конца (опц.)</label><input id="t-date2" type="date"></div>
      <div><label>Участников (предполагаемо)</label><input id="t-exp" type="number" min="2" placeholder="30"></div>
      <div><label>Этапов (группы→плейофф)</label><input id="t-stages" type="number" min="1" value="1"></div>
      <div style="grid-column:1/-1"><label>Ссылка на Challonge</label><input id="t-ch" type="text" placeholder="https://challonge.com/ru/NSPR6"></div>
      <div style="grid-column:1/-1"><label>Ссылка на Шиюй (nanoka, Frontier 4)</label><input id="t-shiyu" type="text" placeholder="https://zzz.nanoka.cc/shiyu/620531"></div>
    </div>
    <div style="font-size:11px;color:var(--sub);margin-top:6px">Ротацию подтянем после создания — в «⚙ Настройки» турнира кнопкой «Импорт ротации».</div>
    <button class="btn btn-y" style="margin-top:12px" onclick="addTour()">Добавить</button>
  </div>
  <div class="space-y" id="tour-list">${list||'<p style="color:var(--sub);font-size:14px">Турниров ещё нет</p>'}</div>`);
  if(typeof enableReorder==='function')enableReorder(document.getElementById('tour-list'),'tournaments',pgTournaments);
}
function tourFormPatch(p){
  const fmt=document.getElementById(p+'fmt')?.value||'SE';
  const fmt2=document.getElementById(p+'fmt2')?.value||'';
  const bracket=fmt2?`${fmt}->${fmt2}`:fmt;
  const d1=document.getElementById(p+'date')?.value||null;
  const d2=document.getElementById(p+'date2')?.value||null;
  const exp=document.getElementById(p+'exp')?.value;
  const stg=document.getElementById(p+'stages')?.value;
  const ch=document.getElementById(p+'ch')?.value?.trim()||null;
  const shy=document.getElementById(p+'shiyu')?.value?.trim()||null;
  return{bracket_type:bracket,event_date:d1,event_date_end:d2,expected_players:exp?+exp:null,stages_count:stg?+stg:(fmt2?2:1),challonge_url:ch,shiyu_url:shy};
}
async function addTour(){
  const n=v('t-name');if(!n)return toast('Впиши название','err');
  const{error}=await sb.from('tournaments').insert({name:n,status:'upcoming',...tourFormPatch('t-')});
  if(dbErr(error,'добавление турнира'))return;
  toast('Турнир добавлен (статус: Анонс)');await refreshData();pgTournaments();
}
// Редактор параметров существующего турнира (формат/даты/участники/этапы/challonge)
async function openTourSettings(id,name){
  const t=D.tours.find(x=>x.id===id)||{};
  const p='ts-';
  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('tournaments')">← Назад</button>
  <div class="card" style="margin-bottom:16px">
    <h3>Настройки — ${escapeHtml(name)}</h3>
    <div class="grid2">
      <div><label>Название</label><input id="${p}name" type="text" value="${escapeHtml(t.name||'')}"></div>
      ${fmtSelects(p,t.bracket_type)}
      <div><label>Дата начала</label><input id="${p}date" type="date" value="${t.event_date||''}"></div>
      <div><label>Дата конца (опц.)</label><input id="${p}date2" type="date" value="${t.event_date_end||''}"></div>
      <div><label>Участников (предполагаемо)</label><input id="${p}exp" type="number" min="2" value="${t.expected_players??''}"></div>
      <div><label>Этапов</label><input id="${p}stages" type="number" min="1" value="${t.stages_count??1}"></div>
      <div style="grid-column:1/-1"><label>Ссылка на Challonge</label><input id="${p}ch" type="text" value="${escapeHtml(t.challonge_url||'')}"></div>
      <div style="grid-column:1/-1"><label>Ссылка на Шиюй (nanoka, Frontier 4)</label><input id="${p}shiyu" type="text" value="${escapeHtml(t.shiyu_url||'')}" placeholder="https://zzz.nanoka.cc/shiyu/620531"></div>
    </div>
    <button class="btn btn-y" style="margin-top:12px" onclick="saveTourSettings('${id}')">Сохранить</button>
  </div>
  <div class="card" style="margin-bottom:16px">
    <h3>Ротация Шиюй (Frontier 4)</h3>
    <div style="font-size:12px;color:var(--sub);margin-bottom:10px">Вставь ссылку на актуальную Шиюй выше и жми «Импорт». Картинки мобов берутся с nanoka на лету — в базе хранятся только данные и имена файлов.</div>
    <div id="${p}shiyu-status" style="font-size:13px;margin-bottom:10px">${shiyuStatusHTML(t.shiyu_data)}</div>
    <button class="btn btn-y" onclick="importShiyuRotation('${id}')">📥 Импорт ротации с nanoka</button>
    ${t.shiyu_data?`<button class="btn-r" style="margin-left:8px;font-size:12px;padding:6px 12px" onclick="clearShiyuRotation('${id}')">Очистить ротацию</button>`:''}
  </div>`);
}
// краткий статус сохранённой ротации (для карточки настроек)
function shiyuStatusHTML(sd){
  if(!sd)return '<span style="color:var(--sub)">Ротация не загружена.</span>';
  const rooms=sd.rooms||[];
  const mon=rooms.reduce((s,r)=>s+(r.monsters?.length||0),0);
  const upd=sd.fetched_at?new Date(sd.fetched_at).toLocaleString('ru'):'';
  return `<span style="color:#3ddc84;font-weight:600">✓ Загружено:</span> ${escapeHtml(sd.frontier||sd.name||'Frontier')}${sd.level?` (Lv.${sd.level})`:''} · бафф «${escapeHtml(sd.buff?.title||'—')}» · комнат ${rooms.length}, мобов ${mon}${upd?` <span style="color:var(--sub)">· ${upd}</span>`:''}`;
}
// ===== Импорт ротации Shiyu с nanoka =====
// Версия датамайна (VER) зашита только в CORS-закрытый HTML nanoka → берём через
// edge-функцию nanoka-ver. Если она не задеплоена — фолбэк: спросить VER вручную
// (меняется лишь в игровой патч ~раз в 6 недель). Сам JSON ротации тянем напрямую (CORS=*).
const SHIYU_ELEMS=['ice','fire','electric','ether','physical','wind'];
function _shyImgBase(image){return String(image||'').split('/').pop().replace(/\.(png|webp|jpe?g)$/i,'')||null;}
function _shyColor(s){ // <color=#hex>txt</color> → подсветка; \n уже разбивается выше
  return String(s||'').replace(/<color=#?[0-9a-fA-F]{6,8}>(.*?)<\/color>/g,'<span class="hl">$1</span>');
}
// nanoka shiyu JSON → наша модель {id,name,frontier,level,buff,rooms,...}. Берём зону stage_num===4.
function normalizeShiyu(doc,srcUrl,ver){
  const zones=doc.zone||{};
  let zone=Object.values(zones).find(z=>z.stage_num===4);
  if(!zone)zone=Object.values(zones).sort((a,b)=>(b.stage_num||0)-(a.stage_num||0))[0]; // фолбэк: топ-frontier
  if(!zone)throw new Error('в JSON нет зон');
  // бафф: единственная непустая запись layer_buff
  const bEntry=Object.values(zone.layer_buff||{}).find(b=>b.title||b.desc)||{};
  // nanoka иногда оставляет title неразрешённым ключом локализации (напр. «62001522_Title») → прячем
  const rawTitle=String(bEntry.title||'').trim();
  const title=/(^\d|_Title$)/i.test(rawTitle)?'':rawTitle;
  // ведущий маркер «· » убираем — буллет рисует CSS .bl::before (иначе двойная точка)
  const buff={title,lines:String(bEntry.desc||'').split('\n').map(l=>_shyColor(l.trim().replace(/^[·•]\s*/,''))).filter(Boolean)};
  // комнаты: по ключам layer_room по возрастанию (1-я, 2-я половина)
  const rooms=Object.keys(zone.layer_room||{}).sort().map(rk=>{
    const room=zone.layer_room[rk];
    const weakness=Object.values(room.monster_weakness||{}).map(s=>String(s).toLowerCase()).filter(e=>SHIYU_ELEMS.includes(e));
    const monsters=Object.values(room.monster_list||{}).map(m=>{
      const el=m.element||{},st=m.stats||{};
      return{
        name:m.name||'—',img:_shyImgBase(m.image),
        hp:Math.round(st.hp||0),atk:Math.round(st.attack||0),def:Math.round(st.defence||0),
        stun:Math.round(st.stun||0),anomaly:Math.round(st.attribute_infliction||0),
        weak:SHIYU_ELEMS.filter(e=>el[e]===1),res:SHIYU_ELEMS.filter(e=>el[e]===-1)
      };
    });
    return{waves:room.waves_num||1,weakness,monsters};
  });
  return{id:doc.id,name:doc.name||'',frontier:zone.name||'',level:zone.monster_level||null,
    buff,rooms,source_url:srcUrl,ver,fetched_at:new Date().toISOString()};
}
async function getNanokaVer(){
  try{
    const{data,error}=await sb.functions.invoke('nanoka-ver');
    if(!error&&data&&data.ver)return data.ver;
  }catch(_){/* функция не задеплоена → фолбэк ниже */}
  const man=prompt('Не удалось получить версию датамайна автоматически (edge-функция nanoka-ver не задеплоена?).\n\nВпиши версию вручную — она в адресе любых картинок на zzz.nanoka.cc, формат вроде 3.0.4+16078270:');
  return man?man.trim():null;
}
async function importShiyuRotation(tourId){
  const url=document.getElementById('ts-shiyu')?.value?.trim();
  if(!url)return toast('Сначала впиши ссылку на Шиюй','err');
  const m=url.match(/(\d{5,})/);
  if(!m)return toast('В ссылке не найден id Шиюй (ожидаю …/shiyu/<число>)','err');
  const id=m[1];
  toast('Получаю версию датамайна…');
  const ver=await getNanokaVer();
  if(!ver)return toast('Импорт отменён (нет версии)','err');
  toast('Тяну ротацию с nanoka…');
  let doc;
  try{
    const r=await fetch(`https://static.nanoka.cc/zzz/${ver}/en/shiyu/${id}.json`);
    if(!r.ok)throw new Error('HTTP '+r.status);
    doc=await r.json();
  }catch(e){return toast('Не удалось скачать JSON ротации: '+e.message,'err');}
  let data;
  try{data=normalizeShiyu(doc,url,ver);}catch(e){return toast('Разбор ротации не удался: '+e.message,'err');}
  const{error}=await sb.from('tournaments').update({shiyu_url:url,shiyu_data:data}).eq('id',tourId);
  if(dbErr(error,'сохранение ротации'))return;
  toast(`Ротация загружена: ${data.frontier||'Frontier'} · мобов ${data.rooms.reduce((s,r)=>s+r.monsters.length,0)}`);
  await refreshData();
  const st=document.getElementById('ts-shiyu-status');if(st)st.innerHTML=shiyuStatusHTML(data);
}
async function clearShiyuRotation(tourId){
  if(!confirm('Очистить сохранённую ротацию Шиюй?'))return;
  const{error}=await sb.from('tournaments').update({shiyu_data:null}).eq('id',tourId);
  if(dbErr(error,'очистка ротации'))return;
  toast('Ротация очищена');await refreshData();
  const t=D.tours.find(x=>x.id===tourId);openTourSettings(tourId,t?.name||'');
}
async function saveTourSettings(id){
  const name=document.getElementById('ts-name')?.value?.trim();
  if(!name)return toast('Название не может быть пустым','err');
  const{error}=await sb.from('tournaments').update({name,...tourFormPatch('ts-')}).eq('id',id);
  if(dbErr(error,'сохранение настроек турнира'))return;
  toast('Настройки сохранены');await refreshData();go('tournaments');
}
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
async function delTour(id){if(!confirm('Удалить турнир?'))return;const{error}=await sb.from('tournaments').delete().eq('id',id);if(dbErr(error,'удаление турнира'))return;pgTournaments();}

// ===== Редактор сетки турнира =====
// Правка/добавление результатов встреч (когда с Challonge не подтянулось или нужна корректировка).
// Победителя встречи можно выставить вручную (для сеток-результатов), а драфт/таймеры — через «Матч 1/2».
// Компактный каркас сетки для админки — визуально как реальная сетка, влезает на страницу.
// seeds = массив ников по посеву (из участников). Модель из общего BracketModel.
// Автопродвижение победителей по результатам встреч (только Single Elimination — цепочка
// раундов, где матч i раунда R кормит матч ⌊i/2⌋ раунда R+1). DE с дропом в нижнюю сетку не трогаем.
// Мутирует model: проставляет .name в слотах поздних раундов и .win у победителей.
function applyBracketResults(model,parts,encs,plMap){
  const seedToPid={};(parts||[]).forEach(p=>{if(p.seed!=null)seedToPid[p.seed]=p.player_id;});
  const encByPair={};
  (encs||[]).forEach(e=>{if(e.player1_id&&e.player2_id)encByPair[[e.player1_id,e.player2_id].sort().join('|')]=e;});
  let prevWin=null; // pid победителя по каждому матчу предыдущего раунда (или null)
  model.rounds.forEach((r,ri)=>{
    r.matches.forEach((m,mi)=>{
      let aPid=null,bPid=null;
      if(ri===0){
        aPid=m.a&&m.a.seed?seedToPid[m.a.seed]:null;
        bPid=m.b&&m.b.seed?seedToPid[m.b.seed]:null;
      }else{
        aPid=prevWin?prevWin[mi*2]:null;
        bPid=prevWin?prevWin[mi*2+1]:null;
        m.a={name:aPid?plMap[aPid]?.nickname:null};
        m.b={name:bPid?plMap[bPid]?.nickname:null};
      }
      let win=null;
      const aBye=m.a&&m.a.bye,bBye=m.b&&m.b.bye;
      if(aPid&&bPid){const e=encByPair[[aPid,bPid].sort().join('|')];if(e&&e.winner_id)win=e.winner_id;}
      else if(aPid&&bBye)win=aPid;    // проход (соперник BYE)
      else if(bPid&&aBye)win=bPid;
      if(win){if(win===aPid&&m.a)m.a.win=true;if(win===bPid&&m.b)m.b.win=true;}
      m._winPid=win;
    });
    prevWin=r.matches.map(m=>m._winPid||null);
  });
  return model;
}
// draggable=true → слоты 1-го раунда можно перетаскивать для смены посева (не-Challonge).
// res={parts,encs,plMap} → подставляет продвинувшихся победителей в поздние раунды (SE).
function compactSkeletonHTML(t,seeds,draggable,res){
  if(typeof BracketModel==='undefined')return'';
  const bt=t.bracket_type||'SE';
  const n=Math.max((seeds&&seeds.length)||0,t.expected_players||0);
  const model=BracketModel.skeletonModel(bt,n,seeds);
  if(!model)return'<p style="color:var(--sub);font-size:13px">Укажи формат и число участников в «⚙ Настройки», либо добавь участников — и тут появится каркас.</p>';
  if(res&&bt!=='DE')applyBracketResults(model,res.parts,res.encs,res.plMap);
  const seed=(s,r1)=>{
    if(!s||s.bye)return`<div class="sk-s sk-bye"><span>BYE</span></div>`;
    const nm=s.name||'TBD';
    // в 1-м раунде реальные посевы делаем перетаскиваемыми (только не-Challonge)
    const drag=draggable&&r1&&s.seed?` draggable="true" data-seed="${s.seed}"`:'';
    return`<div class="sk-s${s.name?'':' sk-tbd'}${s.win?' sk-win':''}${drag?' sk-drag':''}"${drag}><span class="sk-sd">${s.seed||''}</span><span class="sk-nm">${escapeHtml(nm)}</span></div>`;
  };
  let id=0; // сквозная нумерация встреч (как в Challonge)
  const cols=model.rounds.map((r,ri)=>`<div class="sk-r"><div class="sk-rh">${escapeHtml(r.name)}</div>
    ${r.matches.map(m=>`<div class="sk-m"><span class="sk-id">${++id}</span>${seed(m.a,ri===0)}${seed(m.b,ri===0)}</div>`).join('')}</div>`).join('');
  return`<style>
    .sk-wrap{overflow-x:auto;padding:6px 2px 10px}
    .sk-b{display:flex;gap:34px;align-items:flex-start;min-width:min-content}
    .sk-r{display:flex;flex-direction:column;justify-content:space-around;gap:10px;min-width:150px}
    .sk-rh{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--sub);text-align:center;border-bottom:1px solid var(--border);padding-bottom:5px;margin-bottom:2px}
    .sk-m{position:relative;background:#11131a;border:1px solid var(--border);border-radius:8px;overflow:hidden}
    .sk-id{position:absolute;left:-22px;top:50%;transform:translateY(-50%);font-family:monospace;font-size:10px;color:#4d4d55;width:18px;text-align:center}
    .sk-s{display:flex;align-items:center;gap:7px;padding:6px 9px 6px 0;min-height:30px;font-size:13px}
    .sk-s+.sk-s{border-top:1px solid var(--border)}
    .sk-sd{font-family:monospace;font-size:10px;color:#7a7a85;width:22px;text-align:center;flex-shrink:0;align-self:stretch;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.03);border-right:1px solid var(--border);margin-right:4px}
    .sk-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sk-tbd .sk-nm{color:#55555e;font-style:italic}
    .sk-win{background:rgba(255,59,107,.10)}
    .sk-win .sk-nm{color:#fff;font-weight:600}
    .sk-win .sk-sd{color:var(--accent)}
    .sk-bye{justify-content:center;color:#44444c;font-size:11px;font-style:italic}
    .sk-drag{cursor:grab}
    .sk-drag:active{cursor:grabbing}
    .sk-drag.sk-over{outline:2px solid var(--accent);outline-offset:-2px}
  </style>
  <div class="sk-wrap"><div class="sk-b">${cols}</div></div>`;
}
// названия раундов из BracketModel — для дропдауна стадии встречи
function bracketRoundNames(t,seeds){
  if(typeof BracketModel==='undefined')return[];
  const n=Math.max((seeds&&seeds.length)||0,t.expected_players||0);
  const m=BracketModel.skeletonModel(t.bracket_type||'SE',n,seeds);
  return m?m.rounds.map(r=>r.name):[];
}
async function openBracketEditor(tourId,tourName){
  document.getElementById('page-title').textContent=`Сетка — ${tourName}`;
  const{data:encsRaw}=await sb.from('encounters').select('*').eq('tournament_id',tourId).order('created_at',{ascending:false});
  const{data:parts}=await sb.from('tournament_participants').select('*').eq('tournament_id',tourId).order('seed',{ascending:true});
  const encs=(encsRaw||[]).slice().sort((a,b)=>(a.sort_order??1e9)-(b.sort_order??1e9));
  const plMap={};D.players.forEach(p=>plMap[p.id]=p);
  const seeds=(parts||[]).map(pt=>plMap[pt.player_id]?.nickname).filter(Boolean);
  const t=D.tours.find(x=>x.id===tourId)||{};
  const isCh=!!t.challonge_url; // у Challonge посев/продвижение тянет синк — drag отключаем
  // своя сетка (Фаза 2) — независимый движок
  const{data:brk}=await sb.from('brackets').select('*').eq('tournament_id',tourId).maybeSingle();
  let ownNodes=[];
  if(brk){const{data:nd}=await sb.from('bracket_nodes').select('*').eq('bracket_id',brk.id);ownNodes=nd||[];}
  const tnEsc=tourName.replace(/'/g,"\\'");
  const ownSection=brk
    ? ownBracketHTML(brk,ownNodes,plMap,tourId,tourName,encs)
    : `<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div><h3 style="margin:0 0 4px">Своя сетка (движок)</h3><div style="font-size:11px;color:var(--sub)">Полностью своя сетка с авто-продвижением, независимо от Challonge. Берёт участников и формат турнира.</div></div>
        <button class="btn btn-y" style="font-size:12px;padding:6px 14px" onclick="genOwnBracket('${tourId}','${tnEsc}')">⚙ Сгенерировать сетку</button>
      </div></div>`;
  const roundNames=bracketRoundNames(t,seeds);
  const skeleton=`<div class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
      <h3 style="margin:0">Каркас сетки <span style="color:var(--sub);font-weight:400;font-size:13px">${t.bracket_type||'SE'} · ${seeds.length?seeds.length+' уч.':((t.expected_players||0)+' уч. (предпол.)')}</span></h3>
      <div style="display:flex;gap:8px">
        <button class="btn btn-y" style="font-size:12px;padding:5px 12px" onclick="syncChallonge('${tourId}','${tourName.replace(/'/g,"\\'")}')">⟳ Синк с Challonge</button>
        <a class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openParticipants('${tourId}','${tourName.replace(/'/g,"\\'")}')">Править участников</a>
      </div>
    </div>
    ${isCh?`<div style="font-size:11px;color:var(--sub);margin-bottom:8px">Синк тянет сетку и МЕСТА из Challonge (авто). Призовые и строки результата, помеченные «вручную», синк не трогает.</div>`
        :`<div style="font-size:11px;color:var(--sub);margin-bottom:8px">Перетащи участников 1-го раунда, чтобы поменять посев.</div>`}
    ${compactSkeletonHTML(t,seeds,!isCh,{parts,encs,plMap})}
  </div>`;
  // дропдаун стадии из раундов модели + текущее значение (если кастомное/из Challonge)
  const stageSel=e=>{
    const cur=e.stage||'';
    const opts=roundNames.map(rn=>`<option ${cur===rn?'selected':''}>${escapeHtml(rn)}</option>`).join('');
    const extra=cur&&!roundNames.includes(cur)?`<option selected>${escapeHtml(cur)}</option>`:'';
    return`<select onchange="updateEncMeta('${e.id}',{stage:this.value||null})" style="font-size:12px;padding:5px 8px;width:100%" title="Стадия / раунд">
      <option value="">— раунд —</option>${opts}${extra}
    </select>`;
  };
  const rows=encs.map(e=>{
    const p1=plMap[e.player1_id],p2=plMap[e.player2_id];
    const opts=[['','— не задан —'],[e.player1_id,p1?.nickname||'Игрок 1'],[e.player2_id,p2?.nickname||'Игрок 2']];
    return`<div class="enc-card">
      <div class="enc-head"><span class="enc-vs">${escapeHtml(p1?.nickname||'?')} <span style="color:var(--sub)">vs</span> ${escapeHtml(p2?.nickname||'?')}</span><button class="btn-r" onclick="delEnc('${e.id}')" title="Удалить встречу">✕</button></div>
      ${stageSel(e)}
      <select onchange="setEncWinner('${e.id}',this.value)" style="font-size:12px;padding:5px 8px;width:100%" title="Победитель">
        ${opts.map(([val,l])=>`<option value="${val}" ${String(e.winner_id||'')===String(val)?'selected':''}>${escapeHtml(l)}</option>`).join('')}
      </select>
      <div class="enc-acts">
        <button class="btn btn-g" style="font-size:12px;padding:5px 10px;flex:1" onclick="openMatch('${e.id}',1,'${e.player1_id}','${e.player2_id}')">Матч 1</button>
        <button class="btn btn-g" style="font-size:12px;padding:5px 10px;flex:1" onclick="openMatch('${e.id}',2,'${e.player1_id}','${e.player2_id}')">Матч 2</button>
      </div>
    </div>`;
  }).join('');
  const plDatalist=`<datalist id="be-pl-list">${D.players.map(p=>`<option value="${escapeHtml(p.nickname)}"></option>`).join('')}</datalist>`;
  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('tournaments')">← Назад</button>
  ${plDatalist}
  ${ownSection}
  ${brk?'':skeleton}
  <div class="card" style="margin-bottom:16px">
    <h3>Добавить встречу в сетку</h3>
    <div class="grid2" style="margin-bottom:8px">
      <div><label>Игрок 1 (фп матч 1)</label><input id="be-p1" type="text" list="be-pl-list" placeholder="ник"></div>
      <div><label>Игрок 2 (фп матч 2)</label><input id="be-p2" type="text" list="be-pl-list" placeholder="ник"></div>
    </div>
    <div style="font-size:11px;color:var(--sub);margin-bottom:8px">Драфт и таймеры — через «Матч 1/2». Победителя можно выставить и вручную справа.</div>
    <button class="btn btn-y" onclick="addEncTo('${tourId}','${tourName.replace(/'/g,"\\'")}')">Создать встречу</button>
  </div>
  <style>
    .enc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;align-items:start}
    .enc-card{background:var(--card,#11131a);border:1px solid var(--border);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:7px}
    .enc-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .enc-vs{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .enc-acts{display:flex;gap:6px}
  </style>
  <div class="enc-grid">${rows||'<p style="color:var(--sub);font-size:14px">Встреч ещё нет</p>'}</div>
  ${await resultsEditorHTML(tourId)}`);
  if(!isCh)enableSeedDrag(tourId,tourName,parts||[]);
  if(brk)setupOwnBracket(brk,tourId,tourName,encs,ownNodes,plMap);
}
// Перетаскивание слотов 1-го раунда → меняет посев (participants.seed) местами. Только не-Challonge.
function enableSeedDrag(tourId,tourName,parts){
  const seedToPid={};parts.forEach(p=>{if(p.seed!=null)seedToPid[p.seed]=p.player_id;});
  let dragSeed=null;
  document.querySelectorAll('.sk-drag').forEach(el=>{
    el.addEventListener('dragstart',e=>{dragSeed=el.dataset.seed;e.dataTransfer.effectAllowed='move';el.style.opacity='.4';});
    el.addEventListener('dragend',()=>{el.style.opacity='';el.classList.remove('sk-over');});
    el.addEventListener('dragover',e=>{e.preventDefault();if(el.dataset.seed!==dragSeed)el.classList.add('sk-over');});
    el.addEventListener('dragleave',()=>el.classList.remove('sk-over'));
    el.addEventListener('drop',async e=>{
      e.preventDefault();el.classList.remove('sk-over');
      const targetSeed=el.dataset.seed;
      if(!dragSeed||dragSeed===targetSeed)return;
      const a=seedToPid[dragSeed],b=seedToPid[targetSeed];
      if(!a&&!b)return;
      // меняем местами значения seed у двух участников (b может отсутствовать → просто переносим)
      const ops=[];
      if(a)ops.push(sb.from('tournament_participants').update({seed:+targetSeed}).eq('tournament_id',tourId).eq('player_id',a));
      if(b)ops.push(sb.from('tournament_participants').update({seed:+dragSeed}).eq('tournament_id',tourId).eq('player_id',b));
      const res=await Promise.all(ops);
      const bad=res.find(r=>r.error);
      if(bad){dbErr(bad.error,'смена посева');return;}
      toast('Посев обновлён');openBracketEditor(tourId,tourName);
    });
  });
}
// ===== СОБСТВЕННЫЙ ДВИЖОК СЕТОК (Фаза 2, независимо от Challonge) =====
// Генерирует сетку из участников турнира, продвигает игроков по рёбрам при выборе
// победителя. Полностью своя — не зависит от challonge_url, drag/правки доступны всегда.
async function genOwnBracket(tourId,tourName){
  if(typeof BracketEngine==='undefined')return toast('Движок не загружен','err');
  const t=D.tours.find(x=>x.id===tourId)||{};
  const type=t.bracket_type==='DE'?'DE':'SE';
  const{data:parts}=await sb.from('tournament_participants').select('*').eq('tournament_id',tourId).order('seed',{ascending:true});
  if(!parts||parts.length<2)return toast('Нужно минимум 2 участника (добавь/импортируй)','err');
  if(!confirm(`Сгенерировать ${type}-сетку на ${parts.length} участ.? Текущая своя сетка (если есть) будет перезаписана.`))return;
  // перенумеровываем посев в 1..N по текущему порядку (challonge-посев/фолбэк-значения → плотный 1..N)
  const ranked=parts.map((p,i)=>({player_id:p.player_id,seed:i+1}));
  const size=BracketEngine.nextPow2(ranked.length);
  const nodes=BracketEngine.generate(type,size);
  BracketEngine.seed(nodes,ranked,size);
  // ключи генератора → uuid
  const idMap={};nodes.forEach(n=>idMap[n.id]=(crypto.randomUUID?crypto.randomUUID():'x'+Math.random().toString(36).slice(2)+Date.now()));
  const{data:br,error:be}=await sb.from('brackets').upsert({tournament_id:tourId,type,size,settings:{}},{onConflict:'tournament_id'}).select().single();
  if(dbErr(be,'создание сетки'))return;
  await sb.from('bracket_nodes').delete().eq('bracket_id',br.id);
  const rows=nodes.map(n=>({
    id:idMap[n.id],bracket_id:br.id,part:n.part,round:n.round,slot:n.slot,identifier:n.identifier,
    player1_id:n.player1_id,player2_id:n.player2_id,seed1:n.seed1,seed2:n.seed2,is_bye:n.is_bye,winner_id:n.winner_id,
    next_win_node:n.next_win_node?idMap[n.next_win_node]:null,next_win_slot:n.next_win_slot,
    next_lose_node:n.next_lose_node?idMap[n.next_lose_node]:null,next_lose_slot:n.next_lose_slot}));
  const{error:ne}=await sb.from('bracket_nodes').insert(rows);
  if(dbErr(ne,'создание узлов сетки'))return;
  toast(`Сетка ${type} создана (${nodes.length} узлов)`);
  openBracketEditor(tourId,tourName);
}
// Выбор победителя узла → applyWinner толкает игроков по рёбрам → апдейт изменённых узлов.
async function setNodeWinner(bracketId,nodeId,winnerId,tourId,tourName){
  const{data:nd}=await sb.from('bracket_nodes').select('*').eq('bracket_id',bracketId);
  const by={};(nd||[]).forEach(n=>by[n.id]=n);
  const node=by[nodeId];if(!node)return;
  const changed=BracketEngine.applyWinner(by,node,winnerId||null);
  for(const c of changed){
    const{error}=await sb.from('bracket_nodes').update({
      player1_id:c.player1_id,player2_id:c.player2_id,winner_id:c.winner_id}).eq('id',c.id);
    if(dbErr(error,'продвижение по сетке'))return;
  }
  toast('Победитель учтён, игроки продвинуты');
  openBracketEditor(tourId,tourName);
}
async function clearOwnBracket(tourId,tourName){
  if(!confirm('Удалить свою сетку этого турнира?'))return;
  const{error}=await sb.from('brackets').delete().eq('tournament_id',tourId);
  if(dbErr(error,'удаление сетки'))return;
  toast('Своя сетка удалена');openBracketEditor(tourId,tourName);
}
// Привязка узла сетки к встрече (encounter) → из узла открываются драфт/таймеры матча.
async function linkNodeEncounter(nodeId,encId,tourId,tourName){
  const{error}=await sb.from('bracket_nodes').update({encounter_id:encId||null}).eq('id',nodeId);
  if(dbErr(error,'привязка встречи к узлу'))return;
  toast(encId?'Встреча привязана к узлу':'Встреча отвязана');
  openBracketEditor(tourId,tourName);
}
// Создаёт встречу из игроков узла и сразу привязывает её к узлу.
async function createEncFromNode(nodeId,p1,p2,tourId,tourName){
  if(!p1||!p2)return toast('В узле должны быть оба игрока','err');
  const{data:e,error}=await sb.from('encounters').insert({tournament_id:tourId,player1_id:p1,player2_id:p2}).select().single();
  if(dbErr(error,'создание встречи из узла'))return;
  await sb.from('bracket_nodes').update({encounter_id:e.id}).eq('id',nodeId);
  toast('Встреча создана и привязана');
  openBracketEditor(tourId,tourName);
}
// Рендер узлов своей сетки: колонки по (part,round), карточка матча с выбором победителя.
// ПОМЕТКА НА БУДУЩЕЕ (НЕ здесь, в админке): результат матча будет открываться в
// ПУБЛИЧНЫХ сетках — окном внутри bracket.html по клику на узел, либо по отдельной
// ссылке (deep-link), если сайт разобьём на много мелких URL. Привязка encounter_id
// к узлу (ниже) — её источник данных.
function ownBracketHTML(brk,nodes,plMap,tourId,tourName,encs){
  const tn=tourName.replace(/'/g,"\\'");
  const model=BracketView.nodesToModel(nodes,pid=>plMap[pid]?.nickname);
  const body=model?BracketView.renderBracketBody(model.rounds,brk.type):'<p style="color:var(--sub)">Узлов нет</p>';
  return`<div class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <h3 style="margin:0">Своя сетка <span style="color:var(--sub);font-weight:400;font-size:13px">${brk.type} · ${brk.size} слотов</span></h3>
      <div style="display:flex;gap:8px">
        <button class="btn btn-y" style="font-size:12px;padding:5px 12px" onclick="genOwnBracket('${tourId}','${tn}')">⟳ Перегенерировать</button>
        <button class="btn-r" style="font-size:12px;padding:5px 12px" onclick="clearOwnBracket('${tourId}','${tn}')">Удалить</button>
      </div>
    </div>
    <div style="font-size:11px;color:var(--sub);margin-bottom:6px">Клик по игроку в матче = победитель (продвигается автоматически). Клик по карточке матча — привязать встречу/открыть матчи. В 1-м раунде участников можно перетаскивать. Независимо от Challonge.</div>
    <div id="bv-bar" style="min-height:0;margin-bottom:6px"></div>
    <div class="bracket-wrap bv-edit">${body}</div>
  </div>`;
}
// Интерактив своей сетки: клик-победитель, выбор матча (тулбар встречи), drag посева 1-го
// раунда с быстрым ЛОКАЛЬНЫМ ре-рендером (без перезагрузки всего редактора — фикс тормозов).
function setupOwnBracket(brk,tourId,tourName,encs,nodes,plMap){
  if(typeof BracketView==='undefined')return;
  BracketView.injectCSS();
  const wrap=document.querySelector('.bracket-wrap.bv-edit');if(!wrap)return;
  const ctx=window.__ownbk={brk,tourId,tourName,encs,nodes:nodes.slice(),plMap,sel:null};
  const repaint=()=>BracketView.paint(document);
  requestAnimationFrame(repaint);
  // локальный ре-рендер только области сетки
  const rerender=()=>{
    const m=BracketView.nodesToModel(ctx.nodes,pid=>plMap[pid]?.nickname);
    wrap.innerHTML=m?BracketView.renderBracketBody(m.rounds,brk.type):'';
    ctx.sel=null;renderBvBar();requestAnimationFrame(repaint);
  };
  ctx._rerender=rerender;
  // клики: победитель (по игроку) либо выбор матча (по карточке)
  wrap.addEventListener('click',e=>{
    const seed=e.target.closest('.seed');
    const match=e.target.closest('.match');if(!match)return;
    const node=match.dataset.node;if(!node)return;
    if(seed&&!seed.classList.contains('tbd')&&seed.dataset.pid){
      setNodeWinner(brk.id,node,seed.dataset.pid,tourId,tourName);return;
    }
    wrap.querySelectorAll('.match.bv-sel').forEach(x=>x.classList.remove('bv-sel'));
    match.classList.add('bv-sel');ctx.sel=node;renderBvBar();
  });
  // drag посева 1-го раунда (свап игроков двух слотов) — локально + апдейт 2 узлов
  let drag=null;
  wrap.querySelectorAll('.seed.bv-drag').forEach(el=>{
    el.addEventListener('dragstart',e=>{const m=el.closest('.match');drag={node:m.dataset.node,slot:+el.dataset.slot,pid:el.dataset.pid};e.dataTransfer.effectAllowed='move';el.style.opacity='.4';});
    el.addEventListener('dragend',()=>{el.style.opacity='';wrap.querySelectorAll('.bv-over').forEach(x=>x.classList.remove('bv-over'));});
    el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('bv-over');});
    el.addEventListener('dragleave',()=>el.classList.remove('bv-over'));
    el.addEventListener('drop',async e=>{
      e.preventDefault();el.classList.remove('bv-over');
      const m=el.closest('.match'),tgt={node:m.dataset.node,slot:+el.dataset.slot,pid:el.dataset.pid};
      if(!drag||(drag.node===tgt.node&&drag.slot===tgt.slot))return;
      await swapSeed(ctx,drag,tgt);
    });
  });
  renderBvBar();
}
// тулбар выбранного матча: привязка/открытие встречи
function renderBvBar(){
  const ctx=window.__ownbk;const bar=document.getElementById('bv-bar');if(!bar)return;
  if(!ctx||!ctx.sel){bar.innerHTML='';return;}
  const n=ctx.nodes.find(x=>x.id===ctx.sel);if(!n){bar.innerHTML='';return;}
  const{plMap,encs,tourId,tourName}=ctx,tn=tourName.replace(/'/g,"\\'");
  const p1=plMap[n.player1_id]?.nickname,p2=plMap[n.player2_id]?.nickname;
  if(n.is_bye||!n.player1_id||!n.player2_id){bar.innerHTML=`<div style="font-size:12px;color:var(--sub);padding:6px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px">Матч ${n.identifier}: участники ещё не определены</div>`;return;}
  const e=(encs||[]).find(x=>x.id===n.encounter_id);
  let acts;
  if(e){
    acts=`<button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openMatch('${e.id}',1,'${e.player1_id}','${e.player2_id}')">Матч 1</button>
      <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="openMatch('${e.id}',2,'${e.player1_id}','${e.player2_id}')">Матч 2</button>
      <button class="btn-r" style="font-size:12px;padding:5px 10px" onclick="linkNodeEncounter('${n.id}','','${tourId}','${tn}')">Отвязать встречу</button>`;
  }else{
    const opts=(encs||[]).map(x=>`<option value="${x.id}">${escapeHtml(plMap[x.player1_id]?.nickname||'?')} vs ${escapeHtml(plMap[x.player2_id]?.nickname||'?')}</option>`).join('');
    acts=`<select onchange="if(this.value)linkNodeEncounter('${n.id}',this.value,'${tourId}','${tn}')" style="font-size:12px;padding:5px 8px"><option value="">привязать встречу…</option>${opts}</select>
      <button class="btn btn-y" style="font-size:12px;padding:5px 12px" onclick="createEncFromNode('${n.id}','${n.player1_id}','${n.player2_id}','${tourId}','${tn}')">＋ Создать встречу из матча</button>`;
  }
  bar.innerHTML=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;background:var(--card);border:1px solid var(--accent);border-radius:8px">
    <b style="font-size:13px">Матч ${n.identifier}: ${escapeHtml(p1||'?')} vs ${escapeHtml(p2||'?')}</b>${acts}</div>`;
}
// свап двух слотов посева: пишем в БД оба узла и обновляем локально (без полной перезагрузки)
async function swapSeed(ctx,a,b){
  const na=ctx.nodes.find(x=>x.id===a.node),nb=ctx.nodes.find(x=>x.id===b.node);if(!na||!nb)return;
  const fa='player'+a.slot+'_id',sa='seed'+a.slot,fb='player'+b.slot+'_id',sb2='seed'+b.slot;
  [na[fa],nb[fb]]=[nb[fb],na[fa]];[na[sa],nb[sb2]]=[nb[sb2],na[sa]];
  const ops=[sb.from('bracket_nodes').update({[fa]:na[fa],[sa]:na[sa]}).eq('id',na.id)];
  if(nb!==na||fb!==fa)ops.push(sb.from('bracket_nodes').update({[fb]:nb[fb],[sb2]:nb[sb2]}).eq('id',nb.id));
  const res=await Promise.all(ops);const bad=res.find(r=>r.error);
  if(bad){dbErr(bad.error,'смена посева');return;}
  toast('Посев обновлён');ctx._rerender();
}
// ===== ГИБРИД: синк с Challonge (авто) + ручной редактор результатов =====
function challongeSlug(url){if(!url)return null;const m=String(url).match(/challonge\.com\/(?:[a-z]{2}\/)?([A-Za-z0-9_]+)/);return m?m[1]:String(url).replace(/^.*\//,'');}
async function syncChallonge(tourId,tourName){
  const t=D.tours.find(x=>x.id===tourId)||{};
  let slug=challongeSlug(t.challonge_url);
  if(!slug){
    const inp=prompt('У турнира не задана ссылка Challonge. Впиши ссылку или slug (напр. NSPR6):');
    slug=challongeSlug(inp);
    if(!slug)return toast('Синк отменён','err');
    // запоминаем ссылку в турнире, чтобы дальше не спрашивать
    await sb.from('tournaments').update({challonge_url:inp.includes('challonge.com')?inp:('https://challonge.com/'+slug)}).eq('id',tourId);
    await refreshData();
  }
  toast('Синкаю с Challonge…');
  const{data,error}=await sb.functions.invoke('challonge-proxy',{body:{challonge:slug,db_id:tourId}});
  if(error||data?.error){return toast('Синк не удался: '+(data?.error||error.message||error),'err');}
  const s=data.sync||{};
  if(s.cacheError)return toast('Кэш сетки НЕ записан: '+s.cacheError,'err');
  let msg=`Сетка ${s.cached?'обновлена':'НЕ записана'} · мест записано: ${s.results_written||0}`;
  if(s.results_skipped_manual)msg+=` · ручных пропущено: ${s.results_skipped_manual}`;
  if((s.unmatched||[]).length)msg+=` · не сматчено: ${s.unmatched.join(', ')}`;
  toast(msg,s.cached?'':'err');
  openBracketEditor(tourId,tourName);
}
// Ручной редактор мест/призовых. Строки, сохранённые здесь → source='manual' (синк их не трогает).
async function resultsEditorHTML(tourId){
  const{data:res}=await sb.from('tournament_results').select('*').eq('tournament_id',tourId).order('place',{ascending:true});
  const plMap={};D.players.forEach(p=>plMap[p.id]=p);
  const rows=(res||[]).map(r=>`<div class="enc-card">
    <div class="enc-head"><span class="enc-vs">${escapeHtml(plMap[r.player_id]?.nickname||'—')}</span>
      <span style="font-size:10px;padding:1px 7px;border-radius:99px;${r.source==='manual'?'background:#1a1d27;border:1px solid var(--border);color:var(--sub)':'background:linear-gradient(90deg,#ff3b6b,#ff8a5b);color:#fff;font-weight:700'}">${r.source==='manual'?'вручную':'Challonge'}</span></div>
    <div style="display:flex;gap:6px">
      <input id="rp-${r.id}" type="number" value="${r.place??''}" placeholder="место" style="font-size:12px;padding:5px 8px;width:50%">
      <input id="rz-${r.id}" type="number" value="${r.prize??''}" placeholder="приз ₽" style="font-size:12px;padding:5px 8px;width:50%">
    </div>
    <button class="btn btn-y" style="font-size:12px;padding:5px 10px" onclick="saveResultRow('${tourId}','${r.id}','${r.player_id}')">Сохранить (вручную)</button>
  </div>`).join('');
  const plDatalist=`<datalist id="re-pl-list">${D.players.map(p=>`<option value="${escapeHtml(p.nickname)}"></option>`).join('')}</datalist>`;
  return`<div class="card" style="margin-bottom:16px">
    <h3>Результаты (места / призовые)</h3>
    <div style="font-size:11px;color:var(--sub);margin-bottom:10px">Места могут прийти авто из Challonge. <b>Призовые — только вручную</b> (в Challonge их нет). Сохранение здесь помечает строку «вручную» — синк её больше не перетирает.</div>
    ${plDatalist}
    <div class="grid2" style="margin-bottom:8px">
      <div><label>Игрок</label><input id="re-nick" type="text" list="re-pl-list" placeholder="ник"></div>
      <div style="display:flex;gap:8px">
        <div style="flex:1"><label>Место</label><input id="re-place" type="number" placeholder="1"></div>
        <div style="flex:1"><label>Приз ₽</label><input id="re-prize" type="number" placeholder="0"></div>
      </div>
    </div>
    <button class="btn btn-y" onclick="addResultRow('${tourId}')">Добавить результат (вручную)</button>
    <div class="enc-grid" style="margin-top:14px">${rows||'<p style="color:var(--sub);font-size:13px">Результатов пока нет</p>'}</div>
  </div>`;
}
async function saveResultRow(tourId,id,playerId){
  const place=document.getElementById('rp-'+id).value,prize=document.getElementById('rz-'+id).value;
  const{error}=await sb.from('tournament_results').update({place:place?+place:null,prize:prize?+prize:null,source:'manual'}).eq('id',id);
  if(dbErr(error,'сохранение результата'))return;
  toast('Результат сохранён (вручную)');
}
async function addResultRow(tourId){
  const nick=v('re-nick'),place=v('re-place'),prize=v('re-prize');
  if(!nick)return toast('Впиши ник','err');
  const pid=await resolvePlayerNick(nick);if(!pid)return;
  const{error}=await sb.from('tournament_results').upsert(
    {tournament_id:tourId,player_id:pid,place:place?+place:null,prize:prize?+prize:null,source:'manual'},
    {onConflict:'tournament_id,player_id'});
  if(dbErr(error,'добавление результата'))return;
  toast('Результат добавлен (вручную)');
  const t=D.tours.find(x=>x.id===tourId);openBracketEditor(tourId,t?.name||'');
}
async function setEncWinner(encId,winnerId){
  const{error}=await sb.from('encounters').update({winner_id:winnerId||null}).eq('id',encId);
  if(dbErr(error,'установка победителя встречи'))return;
  toast('Победитель встречи обновлён');
}
async function addEncTo(tourId,tourName){
  const n1=v('be-p1'),n2=v('be-p2');
  if(!n1||!n2)return toast('Впиши ники обоих игроков','err');
  if(n1.toLowerCase()===n2.toLowerCase())return toast('Игроки должны быть разными','err');
  const p1=await resolvePlayerNick(n1);if(!p1)return;
  const p2=await resolvePlayerNick(n2);if(!p2)return;
  if(p1===p2)return toast('Игроки должны быть разными','err');
  const{error}=await sb.from('encounters').insert({tournament_id:tourId,player1_id:p1,player2_id:p2});
  if(dbErr(error,'создание встречи'))return;
  toast('Встреча добавлена');openBracketEditor(tourId,tourName);
}

// ===== Участники турнира (bulk-add по никам) =====
async function openParticipants(tourId,tourName){
  document.getElementById('page-title').textContent=`Участники — ${tourName}`;
  const{data:parts}=await sb.from('tournament_participants').select('*').eq('tournament_id',tourId).order('seed',{ascending:true});
  const plMap={};D.players.forEach(p=>plMap[p.id]=p);
  const list=(parts||[]).map((pt,i)=>{
    const nm=plMap[pt.player_id]?.nickname||'?';
    return`<div class="row-item"><div style="display:flex;align-items:center;gap:10px">
      <span style="color:var(--sub);font-family:monospace;width:28px">${pt.seed||i+1}</span>
      <span style="font-weight:600">${escapeHtml(nm)}</span></div>
      <button class="btn-r" onclick="delParticipant('${pt.id}','${tourId}','${tourName.replace(/'/g,"\\'")}')">✕</button></div>`;
  }).join('');
  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="go('tournaments')">← Назад</button>
  <div class="card" style="margin-bottom:16px">
    <h3>Добавить участников</h3>
    <div style="font-size:12px;color:var(--sub);margin-bottom:8px">Вставь ники списком — по одному в строке (или через запятую). Несуществующие игроки заведутся автоматически. Порядок строк = посев.</div>
    <textarea id="pa-bulk" rows="8" placeholder="Player1&#10;Player2&#10;Player3" style="width:100%;padding:10px;font-size:14px;font-family:monospace;resize:vertical"></textarea>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-y" onclick="bulkAddParticipants('${tourId}','${tourName.replace(/'/g,"\\'")}')">Добавить в турнир</button>
      <button class="btn btn-g" onclick="importChallongeParticipants('${tourId}','${tourName.replace(/'/g,"\\'")}')">📥 Импорт с Challonge</button>
    </div>
  </div>
  <div class="card" style="margin-bottom:16px"><div style="font-size:13px">Участников: <b>${(parts||[]).length}</b>${(parts||[]).length?` <button class="btn-r" style="margin-left:10px;font-size:11px;padding:3px 10px" onclick="clearParticipants('${tourId}','${tourName.replace(/'/g,"\\'")}')">Очистить всех</button>`:''}</div></div>
  <div class="space-y">${list||'<p style="color:var(--sub);font-size:14px">Участников ещё нет</p>'}</div>`);
}
async function bulkAddParticipants(tourId,tourName){
  const raw=document.getElementById('pa-bulk')?.value||'';
  const nicks=raw.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  if(!nicks.length)return toast('Список пуст','err');
  const{data:cur}=await sb.from('tournament_participants').select('seed').eq('tournament_id',tourId);
  let seed=(cur||[]).reduce((m,r)=>Math.max(m,r.seed||0),0);
  let added=0,fail=0,lastErr=null;
  for(const nick of nicks){
    const pid=await resolvePlayerNick(nick);
    if(!pid){fail++;continue;}
    const{error}=await sb.from('tournament_participants').upsert({tournament_id:tourId,player_id:pid,seed:++seed},{onConflict:'tournament_id,player_id'});
    if(error){fail++;seed--;lastErr=error;}else added++;
  }
  if(lastErr&&!added)return dbErr(lastErr,'добавление участников');
  toast(`Добавлено ${added}${fail?`, пропущено ${fail}`:''}`);
  await refreshData();openParticipants(tourId,tourName);
}
// ===== Импорт участников с Challonge + маппинг ников на существующих игроков =====
// Игроки не всегда регистрируются под своим ником → даём сопоставить каждого
// challonge-участника существующему игроку (или создать нового / пропустить).
async function importChallongeParticipants(tourId,tourName){
  const t=D.tours.find(x=>x.id===tourId)||{};
  let slug=challongeSlug(t.challonge_url);
  if(!slug){
    const inp=prompt('У турнира нет ссылки Challonge. Впиши ссылку или slug (напр. NSPR6):');
    slug=challongeSlug(inp);
    if(!slug)return toast('Импорт отменён','err');
    await sb.from('tournaments').update({challonge_url:inp.includes('challonge.com')?inp:('https://challonge.com/'+slug)}).eq('id',tourId);
    await refreshData();
  }
  toast('Тяну участников с Challonge…');
  const{data,error}=await sb.functions.invoke('challonge-proxy',{body:{challonge:slug,db_id:tourId}});
  if(error||data?.error)return toast('Не удалось: '+(data?.error||error.message||error),'err');
  const ppl=(data.model&&data.model.participants)||[];
  if(!ppl.length)return toast('Challonge не вернул участников','err');
  window.__chImp={tourId,tourName,list:ppl};
  // опции существующих игроков (по нику)
  const optsFor=selId=>D.players.slice().sort((a,b)=>a.nickname.localeCompare(b.nickname))
    .map(p=>`<option value="${p.id}" ${p.id===selId?'selected':''}>${escapeHtml(p.nickname)}</option>`).join('');
  const byNick={};D.players.forEach(p=>byNick[p.nickname.toLowerCase()]=p);
  const rows=ppl.map((p,i)=>{
    const m=byNick[(p.name||'').toLowerCase()];
    const def=m?m.id:'NEW';
    const badge=m?`<span style="font-size:10px;padding:1px 7px;border-radius:99px;background:linear-gradient(90deg,#3ddc84,#1fb15e);color:#04210f;font-weight:700">сматчен</span>`
      :`<span style="font-size:10px;padding:1px 7px;border-radius:99px;background:#1a1d27;border:1px solid var(--border);color:var(--sub)">новый ник</span>`;
    return`<div class="enc-card">
      <div class="enc-head"><span class="enc-vs">${p.seed?`<span style="color:var(--sub);font-family:monospace">#${p.seed}</span> `:''}${escapeHtml(p.name||'—')}</span>${badge}</div>
      <select id="imp-${i}" style="font-size:12px;padding:5px 8px;width:100%">
        <option value="NEW" ${def==='NEW'?'selected':''}>➕ Создать игрока «${escapeHtml(p.name||'')}»</option>
        <option value="SKIP">⏭ Пропустить</option>
        <optgroup label="Сопоставить существующему">${optsFor(def==='NEW'?null:def)}</optgroup>
      </select>
    </div>`;
  }).join('');
  html(`<button class="btn btn-g" style="margin-bottom:16px" onclick="openParticipants('${tourId}','${tourName.replace(/'/g,"\\'")}')">← К участникам</button>
  <div class="card" style="margin-bottom:16px">
    <h3>Импорт с Challonge — ${ppl.length} участ.</h3>
    <div style="font-size:12px;color:var(--sub);margin-bottom:10px">Сматченные по нику игроки выбраны автоматически. Для остальных выбери существующего игрока (если регистрировался под другим ником), оставь «Создать» или «Пропустить». Посев берётся из Challonge.</div>
    <button class="btn btn-y" onclick="applyChallongeImport()">Импортировать выбранных</button>
  </div>
  <div class="enc-grid">${rows}</div>
  <style>.enc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;align-items:start}
    .enc-card{background:var(--card,#11131a);border:1px solid var(--border);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:7px}
    .enc-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .enc-vs{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>`);
}
async function applyChallongeImport(){
  const ctx=window.__chImp;if(!ctx)return;
  const{tourId,tourName,list}=ctx;
  let added=0,skip=0,fail=0,lastErr=null,fallbackSeed=0;
  for(let i=0;i<list.length;i++){
    const sel=document.getElementById('imp-'+i);if(!sel)continue;
    const val=sel.value;
    if(val==='SKIP'){skip++;continue;}
    const pid=val==='NEW'?await resolvePlayerNick(list[i].name):val;
    if(!pid){fail++;continue;}
    const seed=list[i].seed||(++fallbackSeed,1e4+fallbackSeed); // нет посева → в конец
    const{error}=await sb.from('tournament_participants').upsert(
      {tournament_id:tourId,player_id:pid,seed},{onConflict:'tournament_id,player_id'});
    if(error){fail++;lastErr=error;}else added++;
  }
  if(lastErr&&!added)return dbErr(lastErr,'импорт участников');
  toast(`Импортировано ${added}${skip?`, пропущено ${skip}`:''}${fail?`, ошибок ${fail}`:''}`);
  await refreshData();openParticipants(tourId,tourName);
}
async function delParticipant(id,tourId,tourName){
  const{error}=await sb.from('tournament_participants').delete().eq('id',id);
  if(dbErr(error,'удаление участника'))return;openParticipants(tourId,tourName);
}
async function clearParticipants(tourId,tourName){
  if(!confirm('Удалить всех участников турнира?'))return;
  const{error}=await sb.from('tournament_participants').delete().eq('tournament_id',tourId);
  if(dbErr(error,'очистка участников'))return;openParticipants(tourId,tourName);
}

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

// Рулсет (косты+штрафы) тянем вживую через Edge Function shiyu-system — она проксирует
// draft_systems/agents/engines (CORS залочен на shiyu origin) и резолвит ObjectId→enka.
// Так новая система подхватывается одной кнопкой, без fetch_system.py и без коммита.
const _sysCache={};
async function fetchSystemRuleset(systemId){
  if(_sysCache[systemId])return _sysCache[systemId];
  const r=await fetch(`${SB_URL}/functions/v1/shiyu-system?system=${encodeURIComponent(systemId)}`,
    {headers:{apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.error)throw new Error(d.error||`shiyu-system ${r.status}`);
  _sysCache[systemId]=d;return d;
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
    const sys=await fetchSystemRuleset(state.system);
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
    // Косты амплификаторов: R1–R5 = own-role base[0..4]; оффроль = base[5]; bis → отдельные строки.
    let ampFilled=0;
    D.sigs.forEach(s=>{
      const engEnka=s.enka_id?base(s.enka_id):null;
      const ch=D.chars.find(x=>x.id===s.character_id);
      const ownerEnka=ch&&ch.enka_id?base(ch.enka_id):null;
      const e=engEnka?sys.engines?.[engEnka]:null;if(!e)return;
      const bs=e.base||[];
      for(let i=0;i<5;i++){const el=document.querySelector(`.ac-in[data-sig="${s.id}"][data-r="${i}"]`);if(el&&bs[i]!=null){el.value=bs[i];ampFilled++;}}
      // оффроль (флэт base[5])
      const offEl=document.querySelector(`.ac-off[data-sig="${s.id}"]`);
      if(offEl&&bs[5]!=null){offEl.value=bs[5];ampFilled++;}
      // bis: строка на каждого переопределённого агента, ВКЛЮЧАЯ владельца.
      // В рулсете shiyu base[] = кост для обычного агента своей роли (не-владельца),
      // а bis[ownerEnka] = реальный (BIS) кост самого владельца — он ВЫШЕ base и должен
      // резолвиться для пика владельца. Поэтому владельца тоже пишем bis-строкой
      // (statistics.sigCostOf: bis[cid] → own → off), не теряя его настоящий кост.
      const cont=document.getElementById('bis-rows-'+s.id);
      if(cont&&e.bis){
        cont.innerHTML='';
        Object.entries(e.bis).forEach(([agentEnka,costs])=>{
          const bc=byEnka[agentEnka];if(!bc)return;  // агента нет в БД
          cont.insertAdjacentHTML('beforeend',bisRowHtml(s.id,s.character_id,bc.id,costs||[]));
          ampFilled++;
        });
      }
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
  existing.forEach(c=>{if(c.sig_id!=null&&!charSig[c.character_id])charSig[c.character_id]={sig_id:c.sig_id,sig_cost:c.sig_cost,
    sig_costs:Array.isArray(c.sig_costs)?c.sig_costs:[],
    offrole:c.sig_offrole_cost,
    bis:(c.sig_bis&&typeof c.sig_bis==='object')?c.sig_bis:{}};});

  const RN=5;
  const rHeads=Array.from({length:RN},(_,i)=>`<th style="padding:8px 4px;color:var(--sub);text-align:center;min-width:50px">R${i+1}</th>`).join('');
  const sigs=[...D.sigs].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const rows=sigs.map(s=>{
    const c=D.chars.find(x=>x.id===s.character_id);
    if(!c)return'';
    const cur=charSig[c.id]?.sig_id===s.id?charSig[c.id]:null;
    const arr=cur?.sig_costs||[];
    const img=typeof sigImg==='function'?sigImg(s,28):'';
    // R1–R5 (своя роль): из sig_costs; легаси-фолбэк — одиночный sig_cost в R1. Нули показываем как есть.
    const rCells=Array.from({length:RN},(_,i)=>{
      const val=arr.length?arr[i]:(i===0?cur?.sig_cost:undefined);
      return`<td style="padding:6px 4px;text-align:center"><input class="ac-in" data-sig="${s.id}" data-char="${c.id}" data-r="${i}" type="number" min="0" placeholder="—" value="${val??''}" style="width:48px;padding:4px 4px;font-size:13px;text-align:center"></td>`;
    }).join('');
    // Оффроль (флэт base[5]) — единый кост для агента ДРУГОЙ роли, без наложения.
    const offCell=`<td style="padding:6px 4px;text-align:center;border-left:1px solid var(--border)"><input class="ac-off" data-sig="${s.id}" data-char="${c.id}" type="number" min="0" placeholder="—" value="${cur?.offrole??''}" style="width:48px;padding:4px 4px;font-size:13px;text-align:center"></td>`;
    // BIS-строки (другие персонажи / своя спец. для не-сиг той же роли) — отдельный ряд с контейнером.
    const bis=cur?.bis||{};
    const bisRowsHtml=Object.entries(bis).map(([cid,costs])=>bisRowHtml(s.id,c.id,cid,costs||[])).join('');
    return`<tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:8px">${img}<span style="font-weight:500">${s.name}</span></div>
      </td>
      <td style="padding:8px 10px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:8px">${iconChar(c,28)}<span>${c.name}</span></div>
      </td>
      ${rCells}${offCell}
    </tr>
    <tr style="border-top:1px dashed var(--border)">
      <td colspan="${RN+3}" style="padding:4px 10px 10px 24px">
        <div style="font-size:11px;color:var(--sub);margin-bottom:4px">BIS — переопределения для конкретных не-владельцев (R1–R5)</div>
        <div id="bis-rows-${s.id}">${bisRowsHtml}</div>
        <button type="button" class="btn" style="font-size:12px;padding:3px 8px;margin-top:4px" onclick="addBisRow('${s.id}','${c.id}')">+ BIS</button>
      </td>
    </tr>`;
  }).join('');

  return`<div class="card" style="margin-bottom:16px">
    <div style="font-size:12px;color:var(--sub)">Кост сигнатурного амплификатора. <b>R1–R5</b> — своя роль/специальность (владелец + любой агент той же роли). <b>Оффроль</b> — флэт для агента другой роли. <b>BIS</b> — переопределения для конкретных не-владельцев. Пустая ячейка — не котируется (прочерк); 0 — реальный 0. Импорт из ссылки заполняет автоматически.</div>
  </div>
  <div class="card" style="overflow-x:auto;padding:0">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#0b0d14">
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Амплификатор</th>
        <th style="padding:8px 10px;text-align:left;color:var(--sub)">Персонаж</th>
        ${rHeads}
        <th style="padding:8px 4px;color:var(--sub);text-align:center;min-width:50px;border-left:1px solid var(--border)">Офф</th>
      </tr></thead>
      <tbody>${rows||`<tr><td colspan="${RN+3}" style="padding:14px;color:var(--sub)">Сначала добавь амплификаторы в разделе «Амплификаторы»</td></tr>`}</tbody>
    </table>
  </div>
  <button class="btn btn-y" style="margin-top:16px" onclick="saveAmpCosts('${tourId}')">Сохранить косты амплификаторов</button>`;
}

// Опции персонажей для BIS-селекта (кэш HTML).
let _bisCharOptsCache=null;
function bisCharOptions(selected){
  if(_bisCharOptsCache==null)_bisCharOptsCache=[...D.chars].sort((a,b)=>(a.name||'').localeCompare(b.name||''))
    .map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const html=`<option value="">— персонаж —</option>`+_bisCharOptsCache;
  return selected?html.replace(`value="${selected}"`,`value="${selected}" selected`):html;
}
// Одна BIS-строка: персонаж + R1–R5.
function bisRowHtml(sigId,ownerCharId,cid,costs){
  costs=costs||[];
  const rCells=Array.from({length:5},(_,i)=>`<input class="ac-bis" data-r="${i}" type="number" min="0" placeholder="—" value="${costs[i]??''}" style="width:44px;padding:3px;font-size:12px;text-align:center">`).join('');
  return`<div class="bis-row" data-sig="${sigId}" data-char="${ownerCharId}" style="display:flex;align-items:center;gap:6px;margin:3px 0">
    <select class="ac-bis-char" style="font-size:12px;padding:3px;min-width:150px">${bisCharOptions(cid)}</select>
    ${rCells}
    <button type="button" class="btn" style="font-size:12px;padding:2px 7px" onclick="this.closest('.bis-row').remove()">✕</button>
  </div>`;
}
function addBisRow(sigId,ownerCharId){
  const cont=document.getElementById('bis-rows-'+sigId);
  if(cont)cont.insertAdjacentHTML('beforeend',bisRowHtml(sigId,ownerCharId,'',[]));
}

async function saveAmpCosts(tourId){
  // группируем все источники (R1–R5 своей роли, оффроль, bis) по паре (амплификатор, персонаж-владелец)
  const groups={};
  const g=(sig,char)=>groups[sig+'|'+char]||(groups[sig+'|'+char]={sig,char,p:[],off:null,bis:{}});
  document.querySelectorAll('.ac-in').forEach(el=>{g(el.dataset.sig,el.dataset.char).p[+el.dataset.r]=el.value!==''?+el.value:null;});
  document.querySelectorAll('.ac-off').forEach(el=>{g(el.dataset.sig,el.dataset.char).off=el.value!==''?+el.value:null;});
  document.querySelectorAll('.bis-row').forEach(row=>{
    const cid=row.querySelector('.ac-bis-char')?.value;if(!cid)return;
    const arr=[];row.querySelectorAll('.ac-bis').forEach(inp=>{arr[+inp.dataset.r]=inp.value!==''?+inp.value:null;});
    while(arr.length&&arr[arr.length-1]==null)arr.pop();
    if(arr.some(x=>x!=null))g(row.dataset.sig,row.dataset.char).bis[cid]=arr;
  });
  let set=0,cleared=0;
  for(const k in groups){
    const gr=groups[k];
    // массив R1–R5: нормализуем дыры в null, обрезаем хвостовые null (0 сохраняем как есть)
    const arr=[];for(let i=0;i<5;i++)arr[i]=gr.p[i]===undefined?null:gr.p[i];
    while(arr.length&&arr[arr.length-1]==null)arr.pop();
    const hasAny=arr.some(x=>x!=null)||gr.off!=null||Object.keys(gr.bis).length>0;
    const p1=arr.length?arr[0]:null; // зеркало для легаси-читателей sig_cost
    const fields={sig_id:gr.sig,sig_cost:p1,sig_costs:arr,sig_offrole_cost:gr.off,sig_bis:gr.bis};
    if(hasAny){
      // проставляем на строки персонажа; если строк нет — заводим заглушку M0
      const{data:upd,error}=await sb.from('tournament_costs')
        .update(fields).eq('tournament_id',tourId).eq('character_id',gr.char).select('id');
      if(dbErr(error,'сохранение коста амплификатора'))return;
      if(!upd||!upd.length){
        const{error:insErr}=await sb.from('tournament_costs')
          .insert({tournament_id:tourId,character_id:gr.char,mindscape:0,cost:null,is_allowed:true,...fields});
        if(dbErr(insErr,'создание строки коста амплификатора'))return;
      }
      set++;
    }else{
      // снимаем кост только если этот амплификатор был привязан к персонажу
      const{data:upd,error}=await sb.from('tournament_costs')
        .update({sig_id:null,sig_cost:null,sig_costs:[],sig_offrole_cost:null,sig_bis:{}}).eq('tournament_id',tourId).eq('character_id',gr.char).eq('sig_id',gr.sig).select('id');
      if(dbErr(error,'очистка коста амплификатора'))return;
      if(upd&&upd.length)cleared++;
    }
  }
  toast(`Косты амплификаторов: задано ${set}, снято ${cleared}`);
}
