// roster-import.js — массовая загрузка ростеров участников турнира (админка → Игроки).
// Смысл: ростеры нужны ДО первых игр (для сравнения ростеров в прогнозах), а авто-сбор
// из match_picks работает только постфактум. Персонажи не проставляются руками — текст
// или JSON вставляется целиком, разбор и резолв имён на нас.
//
// Понимаемые форматы (можно мешать в одном тексте):
//   Ник: Miyabi M2, Yanagi, Astra Yao
//   Ник — Ellen; Lycaon M6
//   Ник               ← строка без персонажей начинает блок
//   Miyabi M2         ← строки блока
//   {"Ник":["Miyabi M2","Yanagi"]}  |  [{"player":"Ник","chars":[{"name":"Miyabi","ms":2}]}]
// Мидскейп: M2 / М2 / m2 / (2) / +2 после имени; по умолчанию 0.

const _riNorm=s=>String(s||'').toLowerCase().replace(/[^a-zа-яё0-9]/gi,'');

// русские имена агентов (сайт турнира) → имена в БД
const RU2DB={
  'солдат11':'Soldier 11','солдат0энби':'Soldier 0 - Anby','пироис':'Pyrois','харумаса':'Asaba Harumasa',
  'эллен':'Ellen Joe','гашетка':'Trigger','диалинь':'Dialyn','ликаон':'Von Lycaon','цзюйфуфу':'Ju Fufu',
  'цинъи':'Qingyi','пульхра':'Pulchra Fellini','ария':'Aria','астраяо':'Astra Yao','санна':'Sunna',
  'люси':'Luciana de Montefio','николь':'Nicole Demara','сокаку':'Soukaku','эвелин':'Evelyn Chevalier',
  'коляда':'Koleda Belobog','лайтер':'Lighter','норма':'Norma Hollowell','элис':'Alice Thymefield',
  'энби':'Anby Demara','грейс':'Grace Howard','бёрнис':'Burnice White','бернис':'Burnice White',
  'велина':'Velina Airgid','джейн':'Jane Doe','мияби':'Hoshimi Miyabi','рина':'Alexandrina Sebastiane',
  'юдзуха':'Ukinami Yuzuha','антон':'Anton Ivanov','наньгунюй':'Nangong Yu','янаги':'Tsukishiro Yanagi',
  'пайпер':'Piper','сет':'Seth Lowell','сид':'Seed','циссия':'Cissia','билли':'Billy Kid',
  'корин':'Corin Wickes','чжао':'Zhao','ешуньгуан':'Ye Shunguang','хуго':'Hugo Vlad','чжуюань':'Zhu Yuan',
  'нэкомата':'Nekomiya Mana','люсия':'Lucia Elowen','паньиньху':'Pan Yinhu','звёздныйбилли':'Starlight - Billy',
  'звездныйбилли':'Starlight - Billy','исюань':'Yixuan','йидхари':'Yidhari Murphy','манато':'Komano Manato',
  'вивиан':'Vivian Banshee','промея':'Promeia','цезарь':'Caesar King','бен':'Ben Bigger',
  'орфи':'Orphie Magnusson & Magus','орфеяимагус':'Orphie Magnusson & Magus',
  'орфейимагус':'Orphie Magnusson & Magus','орфия':'Orphie Magnusson & Magus','орфей':'Orphie Magnusson & Magus',
  'орфея':'Orphie Magnusson & Magus','магус':'Orphie Magnusson & Magus','баньюэ':'Banyue','банюэ':'Banyue','сигрид':'Sigrid'};

// Разбор HTML со страницы ростеров турнира: карточка игрока = ник в шапке + агенты
// (img из /characters/crops с alt-именем) + бейдж «M6|145». Амплификаторы игнорируем.
function riParseHtml(html){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const cards=[...doc.querySelectorAll('img[src*="characters/crops"]')]
    .map(img=>img.closest('div[style*="border-radius: 10px"]')||img.closest('div'));
  const out=[],seenCard=new Set();
  [...new Set(cards)].forEach(card=>{
    if(!card||seenCard.has(card))return;seenCard.add(card);
    const nick=(card.querySelector('span[style*="font-display"]')||{}).textContent||'';
    const chars=[...card.querySelectorAll('img[src*="characters/crops"]')].map(img=>{
      const box=img.closest('div[style*="flex-direction: column"]')||img.parentElement;
      const badge=box&&box.querySelector('span[style*="font-mono"]');
      const m=/[MМ]\s*([0-6])/.exec((badge&&badge.textContent)||'');
      return {name:(img.getAttribute('alt')||'').replace(/ /g,' ').trim(),ms:m?+m[1]:0};
    });
    if(nick&&chars.length)out.push({nick:nick.trim(),chars});
  });
  return out;
}

// имя персонажа → запись БД. Учитывает EN-названия nexus (NEX2DB из draft-import.js).
function riChar(name){
  const want=_riNorm(name);if(!want)return null;
  const cand=D.chars||[];
  const nex=(typeof NEX2DB!=='undefined')?NEX2DB:{};
  const alias={};Object.entries(nex).forEach(([en,db])=>{alias[_riNorm(en)]=_riNorm(db);});
  Object.entries(RU2DB).forEach(([ru,db])=>{alias[ru]=_riNorm(db);});   // русские имена сайта
  // два прохода: русское имя → официальное EN (RU2DB) → имя в БД (NEX2DB)
  let target=alias[want]||want;target=alias[target]||target;
  let hit=cand.find(c=>_riNorm(c.name)===target);
  if(hit)return hit;
  const pre=cand.filter(c=>_riNorm(c.name).startsWith(target)||target.startsWith(_riNorm(c.name)));
  if(pre.length===1)return pre[0];
  const inc=cand.filter(c=>_riNorm(c.name).includes(target)||target.includes(_riNorm(c.name)));
  return inc.length===1?inc[0]:null;
}
// «Miyabi M2» → {name:'Miyabi', ms:2}
function riSplitMs(s){
  const t=String(s||'').trim();
  const m=t.match(/^(.*?)[\s,]*(?:[mмMМ]\s*([0-6])|\(([0-6])\)|\+([0-6]))\s*$/);
  if(!m)return{name:t,ms:0};
  const ms=+(m[2]??m[3]??m[4]??0);
  return{name:m[1].trim(),ms:ms||0};
}
// строка «a, b; c» → [{cid,ms,raw}|{raw,bad}]
function riParseChars(line){
  return String(line||'').split(/[,;|/]+/).map(s=>s.trim()).filter(Boolean).map(raw=>{
    const{name,ms}=riSplitMs(raw);
    const c=riChar(name);
    return c?{cid:c.id,name:c.name,ms}:{raw,bad:true};
  });
}
// игрок по нику: игроки БД + ники Challonge участников турнира
function riPlayer(nick,tid){
  const k=_riNorm(nick);if(!k)return null;
  const p=(D.players||[]).find(x=>_riNorm(x.nickname)===k);
  if(p)return p;
  const part=((D.parts&&D.parts[tid])||[]).find(x=>_riNorm(x.challonge_name)===k);
  if(part)return (D.players||[]).find(x=>x.id===part.player_id)||null;
  const pre=(D.players||[]).filter(x=>_riNorm(x.nickname).startsWith(k)||k.startsWith(_riNorm(x.nickname)));
  return pre.length===1?pre[0]:null;
}

// главный разбор: текст/JSON → [{nick, player, chars:[…], bad:[…]}]
function riParse(text,tid){
  const src=String(text||'').trim();
  if(!src)return[];
  const out=[];
  const push=(nick,list)=>{
    const parsed=[].concat(...list.map(riParseChars));
    const chars=[],bad=[],seen=new Set();
    parsed.forEach(x=>{
      if(x.bad){bad.push(x.raw);return;}
      if(seen.has(x.cid))return;                        // дубль в списке — игнор
      seen.add(x.cid);chars.push(x);
    });
    out.push({nick,player:riPlayer(nick,tid),chars,bad});
  };
  if(/^</.test(src)||/<div|<img/i.test(src.slice(0,400))){   // HTML со страницы ростеров
    riParseHtml(src).forEach(r=>push(r.nick,r.chars.map(c=>c.name+(c.ms?' M'+c.ms:''))));
    return out;
  }
  if(/^[[{]/.test(src)){                                // JSON
    let j=null;try{j=JSON.parse(src);}catch(e){return[{nick:'',player:null,chars:[],bad:['не разобрался JSON: '+e.message]}];}
    const asList=v=>Array.isArray(v)?v:(v==null?[]:[v]);
    const one=(nick,val)=>push(nick,asList(val).map(x=>typeof x==='string'?x:
      (x&&x.name?x.name+(x.ms||x.mindscape?' M'+(x.ms??x.mindscape):''):String(x))));
    if(Array.isArray(j))j.forEach(r=>one(r.player||r.nick||r.name||'',r.chars||r.roster||r.characters||r.agents||[]));
    else Object.entries(j).forEach(([k,v])=>one(k,v));
    return out;
  }
  // текст: «Ник: список» либо блоки «ник \n персонажи…»
  let cur=null,buf=[];
  const flush=()=>{if(cur!==null)push(cur,buf);cur=null;buf=[];};
  src.split(/\r?\n/).forEach(rawLine=>{
    const line=rawLine.trim();
    if(!line)return;
    const m=line.match(/^([^:—]+?)\s*(?::|—|\s-\s)\s*(.+)$/);
    if(m&&riParseChars(m[2]).some(c=>!c.bad)){flush();cur=m[1].trim();buf=[m[2]];flush();return;}
    const asChars=riParseChars(line);
    if(asChars.length&&asChars.every(c=>!c.bad)&&cur!==null){buf.push(line);return;}
    if(asChars.length===1&&asChars[0].bad){flush();cur=line;return;}  // одиночное нераспознанное = ник
    if(cur!==null)buf.push(line);else{cur=line;}
  });
  flush();
  return out.filter(r=>r.nick||r.chars.length);
}

// ===== Сбор ростера этапа из уже загруженных матчей =====
// Полного ростера (17+) в БД нет — он приходит только в момент импорта драфта, поэтому
// здесь собираем то, что реально сыграно: пики матчей выбранного этапа (макс. мидскейп).
// Возвращает {player_id: {character_id: mindscape}}.
async function riStagePicks(tid,stage){
  if(!tid)return{};
  const{data:encs}=await sb.from('encounters').select('*').eq('tournament_id',tid);
  let list=encs||[];
  if(stage&&typeof Phase!=='undefined'){
    const t=(D.tours||[]).find(x=>x.id===tid);
    const{data:bc}=await sb.from('bracket_cache').select('json').eq('tournament_id',tid).maybeSingle();
    const nickToId={};(D.players||[]).forEach(p=>{if(p.nickname)nickToId[p.nickname.toLowerCase()]=p.id;});
    const groups=Phase.groupsOf(t,bc?.json||null,nickToId,list);
    list=list.filter(e=>Phase.encStageKey(e,t,{groups})===stage);
  }
  const encIds=list.map(e=>e.id);if(!encIds.length)return{};
  const{data:ms}=await sb.from('matches').select('id').in('encounter_id',encIds);
  const mIds=(ms||[]).map(m=>m.id);if(!mIds.length)return{};
  const picks=[];
  for(let i=0;i<mIds.length;i+=200){                       // чанки по match_id: и URL короче, и лимит 1000 не ловим
    const{data}=await sb.from('match_picks').select('player_id,character_id,mindscape').in('match_id',mIds.slice(i,i+200));
    (data||[]).forEach(p=>picks.push(p));
  }
  const out={};
  picks.forEach(p=>{
    const m=out[p.player_id]=out[p.player_id]||{};
    if(m[p.character_id]==null||(p.mindscape||0)>m[p.character_id])m[p.character_id]=p.mindscape||0;
  });
  return out;
}

// Массовая запись собранного из пиков ростера этапа (source='auto' — импорт драфта
// потом дополнит недостающими персонажами). Существующие ручные ростеры этапа не трогаем.
async function riSaveFromPicks(tid,stage){
  stage=stage||null;
  const byP=await riStagePicks(tid,stage);
  const pids=Object.keys(byP);
  if(!pids.length)return{saved:0,chars:0};
  const{data:ex,error:exErr}=await sb.from('player_rosters').select('player_id,source,stage').eq('tournament_id',tid);
  if(dbErr(exErr,'чтение ростеров'))return{saved:0,err:true};
  const manual=new Set((ex||[]).filter(r=>(r.stage||null)===stage&&r.source==='manual').map(r=>r.player_id));
  const ids=pids.filter(p=>!manual.has(p));
  if(!ids.length)return{saved:0,chars:0,skipped:pids.length};
  let dq=sb.from('player_rosters').delete().eq('tournament_id',tid).in('player_id',ids);
  dq=stage?dq.eq('stage',stage):dq.is('stage',null);
  const{error:dErr}=await dq;
  if(dbErr(dErr,'очистка ростеров'))return{saved:0,err:true};
  const ins=[];
  ids.forEach(pid=>Object.entries(byP[pid]).forEach(([cid,ms])=>
    ins.push({tournament_id:tid,player_id:pid,character_id:cid,mindscape:ms,source:'auto',stage})));
  const{error}=await sb.from('player_rosters').insert(ins);
  if(dbErr(error,'сохранение ростеров'))return{saved:0,err:true};
  return{saved:ids.length,chars:ins.length,skipped:pids.length-ids.length};
}

// запись в player_rosters: полная замена ростера игрока на турнире, source='manual'.
// stage: null = ростер на весь турнир, 's1'/'s2' = только этот этап (ростеры между
// группами и плей-оффом отличаются) — соседние этапы не затираются.
async function riSave(rows,tid,stage){
  stage=stage||null;
  const ok=rows.filter(r=>r.player&&r.chars.length);
  if(!ok.length)return{saved:0};
  const ids=ok.map(r=>r.player.id);
  let q=sb.from('player_rosters').delete().eq('tournament_id',tid).in('player_id',ids);
  q=stage?q.eq('stage',stage):q.is('stage',null);
  const{error:dErr}=await q;
  if(dbErr(dErr,'очистка ростеров'))return{saved:0,err:true};
  const ins=[];
  ok.forEach(r=>r.chars.forEach(c=>ins.push({tournament_id:tid,player_id:r.player.id,character_id:c.cid,mindscape:c.ms,source:'manual',stage})));
  const{error}=await sb.from('player_rosters').insert(ins);
  if(dbErr(error,'сохранение ростеров'))return{saved:0,err:true};
  return{saved:ok.length,chars:ins.length};
}
