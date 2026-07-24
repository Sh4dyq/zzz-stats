// draft-import.js — импорт драфта с nexus-shiyu по ссылке.
// Поток: ссылка → GET /api/drafts/<id>/draftinfo?adminToken=… → нормализация по nameEn → префилл формы матча.
// БД-матчинг персонажей: nameEn нексуса → имя в БД через NEX2DB (имена не 1:1);
// амплификаторы: nameEn совпадает с signatures.name (официальные EN-названия).
// ВАЖНО: cuid'ы нексуса (characterId/amplifierId) нестабильны между версиями их БД — только имена.

// nameEn нексуса → characters.name БД (перечислены только несовпадающие).
const NEX2DB={
  'Nekomiya Mana':'Nekomata','Orphie Magnusson & Magus':'Orphie','Soldier 0 - Anby':'S Anby',
  'Asaba Harumasa':'Harumasa','Evelyn Chevalier':'Evelyn','Ellen Joe':'Ellen','Anton Ivanov':'Anton',
  'Billy Kid':'Billy','Corin Wickes':'Corin','Koleda Belobog':'Koleda','Von Lycaon':'Lycaon',
  'Pulchra Fellini':'Pulchra','Anby Demara':'Anby','Burnice White':'Burnice','Vivian Banshee':'Vivian',
  'Grace Howard':'Grace','Hoshimi Miyabi':'Miyabi','Alice Thymefield':'Alice','Tsukishiro Yanagi':'Yanagi',
  'Astra Yao':'Astra','Lucia Elowen':'Lucia','Alexandrina Sebastiane':'Rina','Ukinami Yuzuha':'Yuzuha',
  'Luciana de Montefio':'Lucy','Nicole Demara':'Nicole','Caesar King':'Caesar','Seth Lowell':'Seth',
  'Starlight - Billy':'S Billy','Yidhari Murphy':'Yidhari','Komano Manato':'Manato',
  'Norma Hollowell':'Norma','Velina Airgid':'Velina'};

const _nrm=s=>(s||'').trim().toLowerCase();
function dbCharByNameEn(nameEn){
  const want=_nrm(NEX2DB[nameEn]||nameEn);
  return D.chars.find(c=>_nrm(c.name)===want)||null;
}
function dbSigByNameEn(nameEn){
  const want=_nrm(nameEn);
  return D.sigs.find(s=>_nrm(s.name)===want)||null;
}

// Легаси-интерфейс для matches.js: ключи norm теперь — id из НАШЕЙ БД (раньше enka).
function charByEnka(key){return D.chars.find(c=>c.id===key)||null;}
function sigByEngineEnka(key){if(!key)return null;return D.sigs.find(s=>s.id===key)||null;}

// Разбор ссылки → дескриптор {kind}. Поддерживаются ДВА источника в одном поле:
//   nexus — есть adminToken (эндпоинт /api/drafts/<id>/draftinfo?adminToken=…)
//   darte — [НЕ ДЛЯ ПЕРЕНОСА] есть draft_id/session_id (shiyu.darte.gg, socket.io)
function parseDraftLink(url){
  try{
    const u=new URL(url.trim());
    const token=u.searchParams.get('adminToken');
    if(token){
      if(/\/draftinfo$/.test(u.pathname))return {kind:'nexus',endpoint:u.href};
      const m=u.pathname.match(/\/drafts?\/([a-z0-9]+)/i);
      if(m&&m[1]!=='api')return {kind:'nexus',endpoint:`${u.origin}/api/drafts/${m[1]}/draftinfo?adminToken=${token}`};
      return null;
    }
    const id=u.searchParams.get('draft_id')||u.searchParams.get('session_id');
    if(id)return {kind:'darte',id,key:u.searchParams.get('session_key')};
  }catch(e){}
  return null;
}

// [НЕ ДЛЯ ПЕРЕНОСА] Отдельный парсер darte для tournaments.js (импорт костов через edge-fn).
function parseDarteLink(url){
  try{
    const u=new URL(url.trim());
    const id=u.searchParams.get('draft_id')||u.searchParams.get('session_id');
    if(!id)return null;
    return {id,key:u.searchParams.get('session_key')};
  }catch(e){return null;}
}

// ===== [НЕ ДЛЯ ПЕРЕНОСА] darte-источник (socket.io + shiyu_ids.json) =====
// Удалить целиком, когда стата/аналитика полностью переедут на nexus.
let _shiyuIds=null;            // {agents:{oid:enka}, engines:{oid:enka}, restartRules, defaultRestartRule}
async function loadShiyuIds(){
  if(_shiyuIds)return _shiyuIds;
  const r=await fetch('web/data/shiyu_ids.json?v='+Date.now());
  if(!r.ok)throw new Error('shiyu_ids.json не загрузился');
  _shiyuIds=await r.json();return _shiyuIds;
}
const baseEnka=e=>e==null?null:String(e).split('_')[0];   // "1381_1" → "1381"
function _darteCharByEnka(enka){return enka?D.chars.find(c=>baseEnka(c.enka_id)===enka)||null:null;}
function _darteSigByEnka(enka){return enka?D.sigs.find(s=>baseEnka(s.enka_id)===enka)||null:null;}

// socket.io /draft → init (полное состояние драфта).
function fetchDarteState(id,key,timeoutMs=12000){
  return new Promise((resolve,reject)=>{
    if(typeof io==='undefined')return reject(new Error('socket.io не загружен (нет CDN в admin.html)'));
    const sock=io('https://shiyu.darte.gg/draft',{
      path:'/socket.io/draft',transports:['websocket'],
      query:key?{session_id:id,session_key:key}:{session_id:id},reconnection:false,timeout:timeoutMs});
    const done=(err,val)=>{try{sock.disconnect();}catch(_){}err?reject(err):resolve(val);};
    const timer=setTimeout(()=>done(new Error('таймаут: init не пришёл (ссылка истекла?)')),timeoutMs);
    sock.on('init',d=>{clearTimeout(timer);done(null,d);});
    sock.on('connect_error',e=>{clearTimeout(timer);done(new Error('connect_error: '+(e?.message||e)));});
  });
}

// darte init → тот же db-id контракт, что и nexus (см. normalizeDraft).
function normalizeDarte(state,ids){
  const aEnka=o=>baseEnka(ids.agents[o]);
  const eEnka=o=>baseEnka(ids.engines[o]);
  const ruleToArr=r=>r?Array(r.free||0).fill(0).concat(r.paid||[]):[];
  const penalties=ruleToArr((ids.restartRules||{})[state.system]||ids.defaultRestartRule);
  const penSum=r=>{let s=0;for(let i=0;i<(r||0)&&i<penalties.length;i++)s+=(+penalties[i]||0);return s;};
  const missing=[];
  const side=p=>{
    const ms={},eng={},ref={};
    (p.roster?.agents||[]).forEach(a=>{const ch=_darteCharByEnka(aEnka(a.agent));if(ch)ms[ch.id]=a.mindscape||0;});
    (p.teams||[]).forEach(t=>{
      if(!t.agent||!t.engine)return;
      const ch=_darteCharByEnka(aEnka(t.agent.agent));if(!ch)return;
      const sg=_darteSigByEnka(eEnka(t.engine.engine));if(sg)eng[ch.id]=sg.id;
      ref[ch.id]=t.engine.refinement||1;
    });
    return {name:p.fullName,clearTime:p.clearTime??null,
      finalTime:p.clearTime==null?null:p.clearTime+penSum(p.restarts), // darte без готового finalTime → базируем сами
      restarts:p.restarts||0,mindscapeByEnka:ms,engineEnkaByAgentEnka:eng,refByAgentEnka:ref};
  };
  const players={player0:side(state.players[0]),player1:side(state.players[1])};
  const slots=(state.selectedAgents||[]).map((s,i)=>{
    const ch=_darteCharByEnka(aEnka(s.agent));
    if(!ch&&s.agent)missing.push(`слот ${i+1}: enka ${aEnka(s.agent)} нет в БД`);
    return {n:i+1,type:s.type==='BAN'?'ban':'pick',actor:s.actor,enka:ch?ch.id:null};
  });
  const pIndex=Array.isArray(state.pIndex)&&state.pIndex.length>=2?state.pIndex:[0,1];
  return {players,slots,firstActor:'player'+pIndex[0],penalties,missing,
    hasResults:state.players.some(p=>p.clearTime!=null)};
}

// Загрузка драфта по дескриптору (nexus | darte). Возвращает {kind,state,ids?}.
async function fetchDraftState(desc){
  if(desc&&desc.kind==='darte'){                       // [НЕ ДЛЯ ПЕРЕНОСА]
    const ids=await loadShiyuIds();
    const state=await fetchDarteState(desc.id,desc.key);
    if(!state||!state.players)throw new Error('пустой init (darte)');
    return {kind:'darte',state,ids};
  }
  const endpoint=(desc&&desc.endpoint)||desc;          // толерантность к «сырому» endpoint-строке
  let r;
  try{r=await fetch(endpoint,{headers:{Accept:'application/json'}});}
  catch(e){throw new Error('fetch не прошёл (CORS не включён на API? '+e.message+')');}
  if(!r.ok)throw new Error('HTTP '+r.status);
  const d=await r.json();
  if(!d||!d.players)throw new Error('пустой/чужой JSON');
  return {kind:'nexus',state:d};
}

// draftinfo → нормализованная структура (тот же контракт, что раньше: см. matches.js).
// player0 всегда ходит первым (первый шаг sequence) = фп; player1 = дабл.
function normalizeDraft(fetched){
  if(fetched&&fetched.kind==='darte')return normalizeDarte(fetched.state,fetched.ids); // [НЕ ДЛЯ ПЕРЕНОСА]
  const d=fetched&&fetched.kind?fetched.state:fetched;  // {kind,state} или «сырой» draftinfo
  const missing=[];
  const charInfo={},ampInfo={};
  for(const side of Object.values(d.rosters||{})){
    (side.characters||[]).forEach(c=>charInfo[c.characterId]=c);
    (side.amplifiers||[]).forEach(a=>ampInfo[a.amplifierId]=a);
  }
  const cidToDb={};
  const dbId=cid=>{
    if(cid in cidToDb)return cidToDb[cid];
    const info=charInfo[cid];
    const ch=info?dbCharByNameEn(info.nameEn):null;
    if(!ch)missing.push(info?`${info.nameEn} нет в БД`:`characterId ${cid} нет в ростерах`);
    return cidToDb[cid]=ch?ch.id:null;
  };
  const results=d.results||{};
  const side=key=>{
    const p=d.players[key],roster=d.rosters[key],sq=d.squads[key],res=results[key]||{};
    const ms={},eng={},ref={};
    (roster.characters||[]).forEach(c=>{const id=dbCharByNameEn(c.nameEn)?.id;if(id)ms[id]=c.mindscape||0;});
    [...(sq.amps1||[]),...(sq.amps2||[])].forEach(a=>{
      const id=dbId(a.charId);if(!id)return;
      const amp=ampInfo[a.ampId];
      // в БД signatures только сигнатурные движки: несигнатурный → null (has_signature=false)
      const sig=amp?dbSigByNameEn(amp.nameEn):null;
      if(sig)eng[id]=sig.id;
      ref[id]=a.rankLevel||amp?.rankLevel||1;
    });
    return {name:p.nick||p.name,
      clearTime:res.timeLimit??null,finalTime:res.finalTime??null,
      restarts:res.restarts??d.matchSettings?.[key]?.restarts??0,
      mindscapeByEnka:ms,engineEnkaByAgentEnka:eng,refByAgentEnka:ref};
  };
  const seq=d.debug?.draftSystem?.sequence||[];
  const firstSide=seq[0]?.side||'creator';
  const actorOf=s=>s===firstSide?'player0':'player1';
  const players={player0:side(firstSide),player1:side(firstSide==='creator'?'opponent':'creator')};
  const slots=(d.debug?.picks||[]).slice().sort((a,b)=>a.stepIndex-b.stepIndex)
    .map(p=>({n:p.stepIndex+1,type:p.type,actor:actorOf(p.side),enka:dbId(p.characterId)}));
  const penalties=d.debug?.draftSystem?.restartPenalties||[];
  return {players,slots,firstActor:'player0',penalties,missing,hasResults:!!results.gameWinner};
}

// Заполнение DOM формы openMatch из нормализованного драфта.
function applyDraftToForm(norm,pen,penOverride){
  const missing=norm.missing.slice();
  const fmt=sec=>sec==null?'':`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
  const ctx=window._matchCtx||{};
  // Ориентация сторон ПО НИКУ; player0 (ходит первым) = фп.
  const ps=[norm.players.player0,norm.players.player1];
  const find=n=>ps.find(p=>_nrm(p.name)===_nrm(n));
  let fp=find(ctx.fpName), dbl=find(ctx.dblName), oriented='по нику';
  if(!fp||!dbl||fp===dbl){fp=norm.players.player0;dbl=norm.players.player1;oriented='по порядку (ник не совпал!)';}
  const sideForActor={player0:fp,player1:dbl};
  // Полный ростер сторон для автозаполнения при сохранении матча (ключи = id БД).
  window._draftRoster={fp:fp.mindscapeByEnka||{},dbl:dbl.mindscapeByEnka||{}};
  // Время: finalTime сайта уже включает штраф. При оверрайде штрафов турнира
  // пересчитываем от чистого времени (timeLimit) по нашей шкале.
  const penSum=r=>{let s=0;for(let i=0;i<(r||0)&&i<pen.length;i++)s+=(+pen[i]||0);return s;};
  const eff=p=>penOverride
    ?(p.clearTime==null?null:p.clearTime+penSum(p.restarts))
    :(p.finalTime??p.clearTime);
  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  set('t1',fmt(eff(fp))); set('r1',fp.restarts);
  set('t2',fmt(eff(dbl))); set('r2',dbl.restarts);

  norm.slots.forEach(slot=>{
    const sel=document.querySelector(`.draft-char[data-slot="${slot.n}"]`);
    if(!sel)return;
    const ch=slot.enka?charByEnka(slot.enka):null;
    sel.value=ch?ch.id:'';
    if(slot.type==='pick'){
      const pl=sideForActor[slot.actor]||fp;
      const ms=document.querySelector(`.draft-ms[data-slot="${slot.n}"]`);
      if(ms)ms.value=String(pl.mindscapeByEnka[slot.enka]??0);
      const sig=document.querySelector(`.draft-sig[data-slot="${slot.n}"]`);
      if(sig){const sg=ch?sigByEngineEnka(pl.engineEnkaByAgentEnka[slot.enka]):null;sig.value=sg?sg.id:'';}
      const ref=document.querySelector(`.draft-ref[data-slot="${slot.n}"]`);
      if(ref)ref.value=String(pl.refByAgentEnka?.[slot.enka]??1);
    }
    const img=document.querySelector(`.pk-img[data-imgslot="${slot.n}"]`);
    if(img&&typeof iconChar==='function')img.innerHTML=iconChar(ch,48);
    if(typeof dcRefreshChar==='function')dcRefreshChar(slot.n);
    const sig2=document.querySelector(`.draft-sig[data-slot="${slot.n}"]`);
    if(sig2&&typeof draftSigChanged==='function')draftSigChanged(sig2);
  });
  return {missing,fpName:fp.name,dblName:dbl.name,oriented};
}

// Точка входа из UI (кнопка в openMatch).
async function importDraftFromLink(){
  const url=v('draft-link');
  if(!url)return toast('Вставь ссылку на драфт','err');
  const desc=parseDraftLink(url);
  if(!desc)return toast('Не разобрал ссылку (nexus: /drafts/<id>+adminToken; darte: draft_id)','err');
  const status=document.getElementById('draft-import-status');
  if(status)status.textContent='Запрашиваю драфт…';
  try{
    const fetched=await fetchDraftState(desc);
    const norm=normalizeDraft(fetched);
    // Штраф за рестарты: оверрайд турнира → из драфта (уже учтён сайтом в finalTime).
    const ctx=window._matchCtx||{};
    const penOverride=!!(ctx.penalties&&ctx.penalties.length);
    const pen=penOverride?ctx.penalties:norm.penalties;
    const penSrc=penOverride?'оверрайд турнира':'с сайта (в finalTime)';
    const{missing,fpName,dblName,oriented}=applyDraftToForm(norm,pen,penOverride);
    if(!norm.hasResults)missing.push('нет results (старый драфт?) — время/победитель не заполнены');
    const warn=oriented.includes('!');
    let msg=`Загружено: ${fpName} (фп) vs ${dblName} · стороны ${oriented} · штраф: ${penSrc} [${pen.join(',')||'нет'}]`;
    if(missing.length)msg+=` · ⚠ ${missing.length} замечаний`;
    if(status)status.textContent=msg+(missing.length?'  ['+missing.join('; ')+']':'');
    toast((missing.length||warn)?'Импорт с предупреждениями':'Драфт импортирован',(missing.length||warn)?'err':'ok');
  }catch(e){
    if(status)status.textContent='Ошибка: '+e.message;
    toast('Ошибка импорта: '+e.message,'err');
  }
}
