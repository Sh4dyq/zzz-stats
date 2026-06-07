// draft-import.js — импорт драфта с shiyu.darte.gg по ссылке.
// Поток: ссылка → socket.io (/draft, событие init) → нормализация по enka_id → префилл формы матча.
// ObjectId→enkaId резолвится из статики web/data/shiyu_ids.json (REST API закрыт CORS из браузера).
// БД-матчинг строго по enka_id (имена API ≠ имена БД 1:1). См. sql/add_enka_id.sql.

let _shiyuIds=null;            // {agents:{oid:enka}, engines:{oid:enka}}
async function loadShiyuIds(){
  if(_shiyuIds)return _shiyuIds;
  const r=await fetch('web/data/shiyu_ids.json?v='+Date.now());
  if(!r.ok)throw new Error('shiyu_ids.json не загрузился');
  _shiyuIds=await r.json();return _shiyuIds;
}

// enkaId варианта (e.g. "1381_1" — S Anby Buffed) сводим к базовому ("1381").
const baseEnka=e=>e==null?null:String(e).split('_')[0];

// Разбор ссылки драфта: ?draft_id=..&session_key=.. (или session_id=..)
function parseDraftLink(url){
  try{
    const u=new URL(url.trim());
    const q=u.searchParams;
    const id=q.get('draft_id')||q.get('session_id');
    const key=q.get('session_key');
    if(id&&key)return{id,key};
  }catch(e){}
  return null;
}

// Подключение к socket.io и получение init (полное состояние драфта).
function fetchDraftState(id,key,timeoutMs=12000){
  return new Promise((resolve,reject)=>{
    if(typeof io==='undefined')return reject(new Error('socket.io не загружен'));
    const sock=io('https://shiyu.darte.gg/draft',{
      path:'/socket.io/draft',transports:['websocket'],
      query:{session_id:id,session_key:key},reconnection:false,timeout:timeoutMs});
    const done=(err,val)=>{try{sock.disconnect();}catch(_){}err?reject(err):resolve(val);};
    const timer=setTimeout(()=>done(new Error('таймаут: init не пришёл (ссылка истекла?)')),timeoutMs);
    sock.on('init',d=>{clearTimeout(timer);done(null,d);});
    sock.on('connect_error',e=>{clearTimeout(timer);done(new Error('connect_error: '+(e?.message||e)));});
  });
}

// init + id-карты → нормализованная структура драфта.
// player0 всегда ходит первым (flow) = фп; player1 = дабл.
function normalizeDraft(state,ids){
  const aEnka=o=>baseEnka(ids.agents[o]);
  const eEnka=o=>baseEnka(ids.engines[o]);
  const side=p=>{
    const roster={}; (p.roster?.agents||[]).forEach(a=>roster[a.agent]=a);
    // Джойн pick→движок: agent oid → enka движка + реальное наложение (refinement R1–R5).
    const engineByAgent={},refByAgent={};
    (p.teams||[]).forEach(t=>{ if(t.agent&&t.engine){engineByAgent[t.agent.agent]=eEnka(t.engine.engine);refByAgent[t.agent.agent]=t.engine.refinement||1;} });
    return {
      name:p.fullName, clearTime:p.clearTime, restarts:p.restarts||0,
      mindscapeByEnka:Object.fromEntries((p.roster?.agents||[]).map(a=>[aEnka(a.agent),a.mindscape||0])),
      engineEnkaByAgentEnka:Object.fromEntries(Object.entries(engineByAgent).map(([oid,e])=>[aEnka(oid),e])),
      refByAgentEnka:Object.fromEntries(Object.entries(refByAgent).map(([oid,r])=>[aEnka(oid),r])),
    };
  };
  const players={player0:side(state.players[0]),player1:side(state.players[1])};
  // selectedAgents идут в порядке flow → слот = index+1 (совпадает с DRAFT_TEMPLATE)
  const slots=(state.selectedAgents||[]).map((s,i)=>({
    n:i+1,type:s.type==='BAN'?'ban':'pick',actor:s.actor,enka:aEnka(s.agent)}));
  // actor = индекс в state.players (см. fetch_draft.py p_id). Слот 1 принадлежит фп
  // (DRAFT_TEMPLATE), поэтому реальный первоходящий = actor первого действия, а НЕ
  // всегда player0 (порядок массива стабилен между играми, фп чередуется).
  const firstActor=(slots[0]&&slots[0].actor)||'player0';
  return {players,slots,firstActor};
}

// Резолв enka → персонаж БД; движок enka + персонаж → has_signature.
function charByEnka(enka){return D.chars.find(c=>baseEnka(c.enka_id)===enka);}
// движок enka → амплификатор из БД (ЛЮБОЙ владелец — нестандартные движки тоже ловим).
function sigByEngineEnka(engineEnka){
  if(!engineEnka)return null;
  return D.sigs.find(s=>baseEnka(s.enka_id)===engineEnka)||null;
}

// Заполнение DOM формы openMatch из нормализованного драфта.
// Возвращает {filled, missing[]} для отчёта.
function applyDraftToForm(norm,pen){
  pen=pen||[];
  const missing=[];
  const fmt=sec=>sec==null?'':`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
  const ctx=window._matchCtx||{};
  // Ориентация сторон ПО НИКУ: порядок массива players[] в API не привязан к тому,
  // кто фп (особенно в игре 2). Матчим по имени к форме; player0 (ходит первым) = фп.
  const ps=[norm.players.player0,norm.players.player1];
  const nm=s=>(s||'').trim().toLowerCase();
  const find=n=>ps.find(p=>nm(p.name)===nm(n));
  let fp=find(ctx.fpName), dbl=find(ctx.dblName), oriented='по нику';
  if(!fp||!dbl||fp===dbl){fp=norm.players.player0;dbl=norm.players.player1;oriented='по порядку (ник не совпал!)';}
  // actor player0 = первый ходящий = фп формы; player1 = дабл.
  const sideForActor={player0:fp,player1:dbl};
  // Полный ростер сторон (17+ персонажей) для автозаполнения при сохранении матча.
  window._draftRoster={fp:fp.mindscapeByEnka||{},dbl:dbl.mindscapeByEnka||{}};
  // Штраф за рестарты (накопительная сумма первых N инкрементов).
  const penSum=r=>{let s=0;for(let i=0;i<(r||0)&&i<pen.length;i++)s+=(+pen[i]||0);return s;};
  const eff=p=>p.clearTime==null?null:p.clearTime+penSum(p.restarts);

  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  set('t1',fmt(eff(fp))); set('r1',fp.restarts);
  set('t2',fmt(eff(dbl))); set('r2',dbl.restarts);

  norm.slots.forEach(slot=>{
    const sel=document.querySelector(`.draft-char[data-slot="${slot.n}"]`);
    if(!sel)return;
    const ch=slot.enka?charByEnka(slot.enka):null;
    if(slot.enka&&!ch){missing.push(`слот ${slot.n}: enka ${slot.enka} нет в БД`);}
    sel.value=ch?ch.id:'';
    if(slot.type==='pick'){
      const pl=sideForActor[slot.actor]||fp;
      const ms=document.querySelector(`.draft-ms[data-slot="${slot.n}"]`);
      if(ms)ms.value=String(pl.mindscapeByEnka[slot.enka]??0);
      // реальный движок персонажа из драфта → конкретный амплификатор (любой владелец)
      const sig=document.querySelector(`.draft-sig[data-slot="${slot.n}"]`);
      if(sig){const sg=ch?sigByEngineEnka(pl.engineEnkaByAgentEnka[slot.enka]):null;sig.value=sg?sg.id:'';}
      // реальное наложение движка (R1–R5) для коста сигны в статистике
      const ref=document.querySelector(`.draft-ref[data-slot="${slot.n}"]`);
      if(ref)ref.value=String(pl.refByAgentEnka?.[slot.enka]??1);
    }
    // обновить портрет под новый выбор (без авто-M6 из draftCharChanged)
    const img=document.querySelector(`.pk-img[data-imgslot="${slot.n}"]`);
    if(img&&typeof iconChar==='function')img.innerHTML=iconChar(ch,48);
    // обновить кнопку-дропдаун персонажа (иконки ранг/элемент/роль) под выбор
    if(typeof dcRefreshChar==='function')dcRefreshChar(slot.n);
    // обновить мини-иконку амплификатора по выбранному в дропдауне
    const sig2=document.querySelector(`.draft-sig[data-slot="${slot.n}"]`);
    if(sig2&&typeof draftSigChanged==='function')draftSigChanged(sig2);
  });
  return {missing,fpName:fp.name,dblName:dbl.name,oriented};
}

// Точка входа из UI (кнопка в openMatch).
async function importDraftFromLink(){
  const url=v('draft-link');
  if(!url)return toast('Вставь ссылку на драфт','err');
  const parsed=parseDraftLink(url);
  if(!parsed)return toast('Не разобрал ссылку (нужны draft_id и session_key)','err');
  const status=document.getElementById('draft-import-status');
  if(status)status.textContent='Подключаюсь к драфту…';
  try{
    const ids=await loadShiyuIds();
    const state=await fetchDraftState(parsed.id,parsed.key);
    if(!state||!state.players)throw new Error('пустой init');
    const norm=normalizeDraft(state,ids);
    // Штраф за рестарты: оверрайд турнира → правило системы драфта → дефолт.
    const ctx=window._matchCtx||{};
    const ruleToArr=r=>r?Array(r.free||0).fill(0).concat(r.paid||[]):[];
    let pen,penSrc;
    if(ctx.penalties&&ctx.penalties.length){pen=ctx.penalties;penSrc='оверрайд турнира';}
    else{const rule=(ids.restartRules||{})[state.system];
      if(rule){pen=ruleToArr(rule);penSrc='правило системы'+(rule.title?` «${rule.title}»`:'');}
      else{pen=ruleToArr(ids.defaultRestartRule);penSrc='дефолт';}}
    const{missing,fpName,dblName,oriented}=applyDraftToForm(norm,pen);
    const warn=oriented.includes('!');
    let msg=`Загружено: ${fpName} (фп) vs ${dblName} · стороны ${oriented} · штраф: ${penSrc} [${pen.join(',')||'нет'}]`;
    if(missing.length)msg+=` · ⚠ ${missing.length} не сопоставлено`;
    if(status)status.textContent=msg+(missing.length?'  ['+missing.join('; ')+']':'');
    toast((missing.length||warn)?'Импорт с предупреждениями':'Драфт импортирован',(missing.length||warn)?'err':'ok');
  }catch(e){
    if(status)status.textContent='Ошибка: '+e.message;
    toast('Ошибка импорта: '+e.message,'err');
  }
}
