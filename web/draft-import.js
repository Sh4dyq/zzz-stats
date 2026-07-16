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
  'Starlight - Billy':'S Billy','Yidhari Murphy':'Yidhari','Komano Manato':'Manato'};

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

// Разбор ссылки: полный эндпоинт /api/drafts/<id>/draftinfo?adminToken=…
// или любая ссылка того же сайта с /drafts/<id> в пути и adminToken в query.
function parseDraftLink(url){
  try{
    const u=new URL(url.trim());
    const token=u.searchParams.get('adminToken');
    if(!token)return null;
    if(/\/draftinfo$/.test(u.pathname))return u.href;
    const m=u.pathname.match(/\/drafts?\/([a-z0-9]+)/i);
    if(m&&m[1]!=='api')return `${u.origin}/api/drafts/${m[1]}/draftinfo?adminToken=${token}`;
  }catch(e){}
  return null;
}

// Разбор ссылки darte (legacy): shiyu.darte.gg/draft?draft_id=…&session_key=… → {id,key}.
function parseDarteLink(url){
  try{
    const u=new URL(url.trim());
    const id=u.searchParams.get('draft_id')||u.searchParams.get('session_id');
    if(!id)return null;
    return {id,key:u.searchParams.get('session_key')};
  }catch(e){return null;}
}

async function fetchDraftState(endpoint){
  let r;
  try{r=await fetch(endpoint,{headers:{Accept:'application/json'}});}
  catch(e){throw new Error('fetch не прошёл (CORS не включён на API? '+e.message+')');}
  if(!r.ok)throw new Error('HTTP '+r.status);
  const d=await r.json();
  if(!d||!d.players)throw new Error('пустой/чужой JSON');
  return d;
}

// draftinfo → нормализованная структура (тот же контракт, что раньше: см. matches.js).
// player0 всегда ходит первым (первый шаг sequence) = фп; player1 = дабл.
function normalizeDraft(d){
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
  const endpoint=parseDraftLink(url);
  if(!endpoint)return toast('Не разобрал ссылку (нужны /drafts/<id> и adminToken)','err');
  const status=document.getElementById('draft-import-status');
  if(status)status.textContent='Запрашиваю драфт…';
  try{
    const state=await fetchDraftState(endpoint);
    const norm=normalizeDraft(state);
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
