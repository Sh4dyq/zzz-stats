// matches.js — встречи (Bo2) и матчи

// Шаблон драфта: 6 банов · 12 пиков (18 слотов)
// Порядок: Б1 Б2 Б2 Б1 | П1 П2 П2 П1 | П1 П2 П2 П1 | Б1 Б2 | П2 П1 П1 П2
const DRAFT_TEMPLATE=(fp,dbl)=>[
  {n:1,pid:fp,type:'ban'},{n:2,pid:dbl,type:'ban'},{n:3,pid:dbl,type:'ban'},{n:4,pid:fp,type:'ban'},
  {n:5,pid:fp,type:'pick'},{n:6,pid:dbl,type:'pick'},{n:7,pid:dbl,type:'pick'},{n:8,pid:fp,type:'pick'},
  {n:9,pid:fp,type:'pick'},{n:10,pid:dbl,type:'pick'},{n:11,pid:dbl,type:'pick'},{n:12,pid:fp,type:'pick'},
  {n:13,pid:fp,type:'ban'},{n:14,pid:dbl,type:'ban'},{n:15,pid:dbl,type:'pick'},{n:16,pid:fp,type:'pick'},
  {n:17,pid:fp,type:'pick'},{n:18,pid:dbl,type:'pick'},
];

// Многоуровневая проверка результата матча (задача P5 из remaining-tasks-plan).
// Проверяет: правильность стороны (фп матча N = «игрок N» встречи), что фп
// действительно фп (пики is_fp принадлежат фп, фп входит во встречу), что
// сторона фп не дублируется внутри встречи (фп чередуется между матчами),
// таймеры>0, согласованность победитель↔таймер и отсутствие дублей персонажей.
// errors — серьёзные (блокируют без подтверждения); warnings — мягкие (инфо).
function validateMatchData(o){
  const{num,p1Id,p2Id,fpId,t1,t2,isDraw,winnerId,picks=[],bans=[],otherFpId}=o;
  const errors=[],warnings=[];
  const dblId=fpId===p1Id?p2Id:p1Id;
  // правильность стороны + «фп действительно фп»
  if([p1Id,p2Id].indexOf(fpId)<0)errors.push('фп не входит в эту встречу');
  else if(fpId!==(+num===1?p1Id:p2Id))errors.push(`фп матча ${num} должен быть «Игрок ${num}» встречи`);
  // сторона фп не дублируется внутри встречи (фп чередуется между матчами)
  if(otherFpId&&otherFpId===fpId)errors.push('этот игрок уже фп в другом матче встречи — сторона дублируется (фп должен чередоваться)');
  // пики с флагом is_fp должны принадлежать именно фп (и наоборот)
  picks.forEach(p=>{
    if(p.is_fp&&p.player_id!==fpId)errors.push('пик помечен как фп, но принадлежит даблу');
    if(p.is_double&&p.player_id===fpId)errors.push('пик фп помечен как дабл');
  });
  // таймеры > 0
  if(t1!=null&&t1<=0)errors.push('таймер фп должен быть > 0');
  if(t2!=null&&t2<=0)errors.push('таймер дабла должен быть > 0');
  // победитель ↔ таймер
  if(!isDraw&&winnerId&&t1!=null&&t2!=null&&t1!==t2){
    if(winnerId!==(t1<t2?fpId:dblId))warnings.push('победитель не совпадает с лучшим таймером');
  }
  // дубли персонажей (один игрок выбрал/забанил персонажа дважды)
  const dup=(rows,lbl)=>{const s={};rows.forEach(r=>{const k=r.player_id+'|'+r.character_id;if(s[k])warnings.push(`${lbl}: персонаж выбран дважды одним игроком`);s[k]=1;});};
  dup(picks,'пики');dup(bans,'баны');
  return{errors,warnings};
}

// Проверка ростер-консистентности (часть задачи P5): сверяет пики игрока
// (персонаж + минскейп) с его ЗАРЕГИСТРИРОВАННЫМ ростером турнира и с его же
// пиками в ДРУГИХ матчах того же турнира (между играми и встречами). Возвращает
// массив строк-предупреждений (мягких — ростер бывает авто/неполный). existingId
// исключаем, чтобы матч не сверялся сам с собой при пересохранении.
async function rosterConsistencyWarnings(encId,picks,existingId){
  if(!picks.length)return[];
  const{data:encRow}=await sb.from('encounters').select('tournament_id').eq('id',encId).maybeSingle();
  const tid=encRow?.tournament_id;if(!tid)return[];
  const chMap={};D.chars.forEach(c=>chMap[c.id]=c);
  const plMap={};D.players.forEach(p=>plMap[p.id]=p);
  const nm=id=>chMap[id]?.name||'?',pn=id=>plMap[id]?.nickname||'?';
  // зарегистрированный ростер турнира
  const{data:rost}=await sb.from('player_rosters').select('player_id,character_id,mindscape').eq('tournament_id',tid);
  const rkey={};(rost||[]).forEach(r=>rkey[r.player_id+'|'+r.character_id]=r.mindscape);
  const rostPlayers=new Set((rost||[]).map(r=>r.player_id));
  // пики в других матчах турнира → минскейп персонажа по игроку (между матчами)
  const{data:encs}=await sb.from('encounters').select('id').eq('tournament_id',tid);
  const encIds=(encs||[]).map(e=>e.id);
  const{data:oMs}=encIds.length?await sb.from('matches').select('id').in('encounter_id',encIds):{data:[]};
  const mIds=(oMs||[]).map(m=>m.id).filter(id=>id!==existingId);
  const{data:oPicks}=mIds.length?await sb.from('match_picks').select('player_id,character_id,mindscape').in('match_id',mIds):{data:[]};
  const seen={};(oPicks||[]).forEach(p=>{const k=p.player_id+'|'+p.character_id;if(seen[k]==null)seen[k]=p.mindscape;});
  const warns=[];
  picks.forEach(p=>{
    const rk=p.player_id+'|'+p.character_id;
    if(rkey[rk]!=null&&rkey[rk]!==p.mindscape)warns.push(`${pn(p.player_id)}: ${nm(p.character_id)} M${p.mindscape} ≠ ростер турнира (M${rkey[rk]})`);
    else if(rkey[rk]==null&&rostPlayers.has(p.player_id))warns.push(`${pn(p.player_id)}: ${nm(p.character_id)} не в зарегистрированном ростере турнира`);
    if(seen[rk]!=null&&seen[rk]!==p.mindscape)warns.push(`${pn(p.player_id)}: ${nm(p.character_id)} M${p.mindscape} ≠ другой матч турнира (M${seen[rk]})`);
  });
  return[...new Set(warns)];
}

// Полный аудит всех матчей турнира (для пост-проверки после булк-импорта, где
// были самые опасные проблемы). Перечитывает встречи+матчи+пики/баны из БД и
// гоняет validateMatchData по каждому матчу (с otherFpId соседнего матча), плюс
// сквозную ростер-консистентность по всему турниру (минскейп персонажа должен
// совпадать между матчами и с зарегистрированным ростером). Возвращает
// {errors,warnings} — массивы помеченных строк.
async function auditTournamentMatches(tourId){
  const errors=[],warnings=[];
  const plMap={};D.players.forEach(p=>plMap[p.id]=p);
  const chMap={};D.chars.forEach(c=>chMap[c.id]=c);
  const pn=id=>plMap[id]?.nickname||'?',cn=id=>chMap[id]?.name||'?';
  const{data:encs}=await sb.from('encounters').select('*').eq('tournament_id',tourId);
  if(!encs||!encs.length)return{errors,warnings};
  const{data:ms}=await sb.from('matches').select('*,picks:match_picks(*),bans:match_bans(*)').in('encounter_id',encs.map(e=>e.id));
  const byEnc={};(ms||[]).forEach(m=>{(byEnc[m.encounter_id]=byEnc[m.encounter_id]||[]).push(m);});
  encs.forEach(e=>{
    const list=(byEnc[e.id]||[]).slice().sort((a,b)=>(a.match_number||0)-(b.match_number||0));
    const lbl=`${pn(e.player1_id)} vs ${pn(e.player2_id)}`;
    if(list.length<2)warnings.push(`${lbl}: только ${list.length} матч(ей) из 2 (пара собралась не полностью)`);
    list.forEach(m=>{
      const other=(list.find(x=>x!==m)||{}).fp_player_id||null;
      const onP1=m.fp_player_id===e.player1_id;
      const t1=onP1?m.player1_timer_sec:m.player2_timer_sec; // t1 = таймер фп
      const t2=onP1?m.player2_timer_sec:m.player1_timer_sec;
      const vr=validateMatchData({num:m.match_number,p1Id:e.player1_id,p2Id:e.player2_id,fpId:m.fp_player_id,
        t1,t2,isDraw:m.is_draw,winnerId:m.winner_id,picks:m.picks||[],bans:m.bans||[],otherFpId:other});
      vr.errors.forEach(x=>errors.push(`${lbl} · м${m.match_number}: ${x}`));
      vr.warnings.forEach(x=>warnings.push(`${lbl} · м${m.match_number}: ${x}`));
    });
  });
  // сквозная ростер-консистентность турнира
  const{data:rost}=await sb.from('player_rosters').select('player_id,character_id,mindscape').eq('tournament_id',tourId);
  const rkey={};(rost||[]).forEach(r=>rkey[r.player_id+'|'+r.character_id]=r.mindscape);
  const rostPlayers=new Set((rost||[]).map(r=>r.player_id));
  const seen={};
  (ms||[]).forEach(m=>(m.picks||[]).forEach(p=>{
    const k=p.player_id+'|'+p.character_id;
    if(rkey[k]!=null&&rkey[k]!==p.mindscape)warnings.push(`${pn(p.player_id)}: ${cn(p.character_id)} M${p.mindscape} ≠ ростер турнира (M${rkey[k]})`);
    else if(rkey[k]==null&&rostPlayers.has(p.player_id))warnings.push(`${pn(p.player_id)}: ${cn(p.character_id)} вне зарегистрированного ростера`);
    if(seen[k]!=null&&seen[k]!==p.mindscape)warnings.push(`${pn(p.player_id)}: ${cn(p.character_id)} M${p.mindscape} расходится между матчами (было M${seen[k]})`);
    if(seen[k]==null)seen[k]=p.mindscape;
  }));
  return{errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}

async function pgMatches(){
  const{data:encsRaw}=await sb.from('encounters').select('*').order('created_at',{ascending:false});
  // ручной порядок (sort_order) поверх дефолтной сортировки; строки без него — в конец, стабильно.
  // defensive: запрос по created_at (колонка точно есть), sort_order применяется клиентски.
  const encs=(encsRaw||[]).slice().sort((a,b)=>(a.sort_order??1e9)-(b.sort_order??1e9));
  const{data:ms}=encs?.length?await sb.from('matches').select('*').in('encounter_id',encs.map(e=>e.id)):{data:[]};
  const mByEnc={};(ms||[]).forEach(m=>{if(!mByEnc[m.encounter_id])mByEnc[m.encounter_id]=[];mByEnc[m.encounter_id].push(m);});
  const tourMap={};D.tours.forEach(t=>tourMap[t.id]=t);
  const plMap={};D.players.forEach(p=>plMap[p.id]=p);

  const list=(encs||[]).map(e=>{
    const t=tourMap[e.tournament_id],p1=plMap[e.player1_id],p2=plMap[e.player2_id],win=plMap[e.winner_id];
    const ems=mByEnc[e.id]||[];
    const m1done=ems.find(m=>m.match_number===1)?.winner_id||ems.find(m=>m.match_number===1)?.is_draw;
    const m2done=ems.find(m=>m.match_number===2)?.winner_id||ems.find(m=>m.match_number===2)?.is_draw;
    return`<div class="card" draggable="true" data-id="${e.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="color:var(--sub);cursor:grab;font-size:16px;user-select:none" title="Перетащите для сортировки (порядок и на главной)">⠿</span>
          <span style="font-weight:600">${p1?.nickname||'?'}</span><span style="color:var(--sub);margin:0 6px">vs</span><span style="font-weight:600">${p2?.nickname||'?'}</span>
        </div>
        <span style="font-size:12px;color:var(--sub)">${t?.name||'?'}</span>
      </div>
      ${win?`<div style="font-size:12px;margin-bottom:8px">Победитель встречи: <span style="color:var(--accent);font-weight:600">${win.nickname}</span></div>`:''}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <input id="stage-${e.id}" type="text" value="${escapeHtml(e.stage||'')}" placeholder="стадия (напр. Гранд-финал) — пусто = скрыто" draggable="false"
          onchange="updateEncMeta('${e.id}',{stage:this.value.trim()||null})"
          title="Стадия встречи; показывается на главной в блоке последних матчей" style="font-size:12px;padding:5px 8px;flex:1;min-width:180px">
        <input type="date" id="date-${e.id}" value="${e.played_at||''}" draggable="false"
          onchange="updateEncMeta('${e.id}',{played_at:this.value||null})"
          title="Дата проведения (для актуальности на главной)" style="font-size:12px;padding:4px 8px">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn ${m1done?'btn-g':'btn-y'}" style="font-size:12px;padding:5px 14px" onclick="openMatch('${e.id}',1,'${e.player1_id}','${e.player2_id}')">
          ${m1done?'✓':''} Матч 1</button>
        <button class="btn ${m2done?'btn-g':'btn-y'}" style="font-size:12px;padding:5px 14px" onclick="openMatch('${e.id}',2,'${e.player1_id}','${e.player2_id}')">
          ${m2done?'✓':''} Матч 2</button>
        <button class="btn-r" style="margin-left:auto" onclick="delEnc('${e.id}')">Удалить встречу</button>
      </div>
    </div>`;
  }).join('');

  const plDatalist=`<datalist id="pl-list">${D.players.map(p=>`<option value="${escapeHtml(p.nickname)}"></option>`).join('')}</datalist>`;
  html(`<div class="card" style="margin-bottom:16px">
    <h3>Новая встреча (Bo2)</h3>
    ${plDatalist}
    <div class="grid2" style="margin-bottom:12px">
      <div><label>Турнир</label>${sel('e-tour',D.tours,x=>x.id,x=>x.name)}</div>
      <div><label>Игрок 1 (фп в матче 1)</label><input id="e-p1" type="text" list="pl-list" placeholder="ник игрока — впишите или выберите"></div>
      <div><label>Игрок 2 (фп в матче 2)</label><input id="e-p2" type="text" list="pl-list" placeholder="ник игрока — впишите или выберите"></div>
    </div>
    <div style="font-size:11px;color:var(--sub);margin-bottom:8px">Если ник новый — игрок создастся автоматически.</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
      <input id="e-link1" type="text" placeholder="ссылка драфта shiyu.darte.gg — Матч 1 (для создания с результатом)" style="padding:6px 10px;font-size:13px">
      <input id="e-link2" type="text" placeholder="ссылка драфта shiyu.darte.gg — Матч 2 (для создания с результатом)" style="padding:6px 10px;font-size:13px">
    </div>
    <div id="enc-quick-status" style="font-size:11px;color:var(--sub);min-height:13px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-y" onclick="addEnc()">Создать встречу</button>
      <button class="btn btn-g" onclick="addEncWithResults()" title="Создаёт встречу и сразу импортирует матчи из вставленных ссылок">⚡ Создать с результатами</button>
    </div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <h3>⚡ Массовый импорт по ссылкам</h3>
    <div style="font-size:11px;color:var(--sub);margin-bottom:8px">Вставь ВСЕ ссылки shiyu.darte.gg (по одной на строку, любой порядок). Парами по игрокам соберутся встречи (матч 1 и 2), импортируются результаты И полные ростеры обоих игроков. Существующие встречи переиспользуются (не дублируются).</div>
    <div style="margin-bottom:8px;max-width:340px"><label>Турнир</label>${sel('bulk-tour',D.tours,x=>x.id,x=>x.name)}</div>
    <textarea id="bulk-links" rows="8" placeholder="https://shiyu.darte.gg/draft?draft_id=...&session_key=...&#10;https://shiyu.darte.gg/draft?draft_id=...&session_key=..." style="width:100%;padding:8px 10px;font-size:12px;font-family:'JetBrains Mono',monospace;resize:vertical"></textarea>
    <div id="bulk-status" style="font-size:11px;color:var(--sub);min-height:13px;margin:8px 0"></div>
    <button class="btn btn-g" onclick="bulkImportDrafts()">Импортировать всё</button>
  </div>
  <div class="space-y" id="enc-list">${list||'<p style="color:var(--sub);font-size:14px">Встреч ещё нет</p>'}</div>`);
  // авто-подстановка актуального (live) турнира в селект новой встречи
  const liveT=D.tours.find(t=>t.status==='live');
  if(liveT){['e-tour','bulk-tour'].forEach(id=>{const es=document.getElementById(id);if(es)es.value=liveT.id;});}
  // drag-and-drop ручная сортировка встреч (порядок отражается и на главной)
  enableReorder(document.getElementById('enc-list'),'encounters',pgMatches);
}

// Точечное обновление метаданных встречи (стадия / дата). Тихо игнорирует ошибку
// отсутствующей колонки до запуска sql/add_match_meta.sql, но сообщит при иной проблеме.
async function updateEncMeta(id,patch){
  const{error}=await sb.from('encounters').update(patch).eq('id',id);
  if(error){dbErr(error,'сохранение метаданных встречи');return;}
  toast('Сохранено');
}

// Ник → id игрока: ищет существующего (без учёта регистра) или создаёт нового.
async function resolvePlayerNick(nick){
  nick=(nick||'').trim();
  if(!nick)return null;
  const ex=D.players.find(p=>p.nickname.toLowerCase()===nick.toLowerCase());
  if(ex)return ex.id;
  const{data,error}=await sb.from('players').insert({nickname:nick}).select().single();
  if(error){dbErr(error,'создание игрока «'+nick+'»');return null;}
  D.players.push(data);
  return data.id;
}

async function addEnc(){
  const t=v('e-tour'),n1=v('e-p1'),n2=v('e-p2');
  if(!t)return toast('Выбери турнир','err');
  if(!n1||!n2)return toast('Впиши ники обоих игроков','err');
  if(n1.toLowerCase()===n2.toLowerCase())return toast('Игроки должны быть разными','err');
  const p1=await resolvePlayerNick(n1);if(!p1)return;
  const p2=await resolvePlayerNick(n2);if(!p2)return;
  if(p1===p2)return toast('Игроки должны быть разными','err');
  const{error}=await sb.from('encounters').insert({tournament_id:t,player1_id:p1,player2_id:p2});
  if(dbErr(error,'создание встречи'))return;
  toast('Встреча создана');pgMatches();
}
async function delEnc(id){if(!confirm('Удалить встречу и все матчи?'))return;const{error}=await sb.from('encounters').delete().eq('id',id);if(dbErr(error,'удаление встречи'))return;pgMatches();}

// «Создать с результатами» в один клик: создаёт встречу и сразу импортирует матч 1/2
// из вставленных ссылок драфта (без открытия борда). Хватает одной ссылки.
async function addEncWithResults(){
  const t=v('e-tour'),n1=v('e-p1'),n2=v('e-p2');
  const set=m=>{const el=document.getElementById('enc-quick-status');if(el)el.textContent=m;};
  if(!t)return toast('Выбери турнир','err');
  if(!n1||!n2)return toast('Впиши ники обоих игроков','err');
  if(n1.toLowerCase()===n2.toLowerCase())return toast('Игроки должны быть разными','err');
  const l1=v('e-link1'),l2=v('e-link2');
  if(!l1&&!l2)return toast('Вставь хотя бы одну ссылку (иначе жми «Создать встречу»)','err');
  const p1=await resolvePlayerNick(n1);if(!p1)return;
  const p2=await resolvePlayerNick(n2);if(!p2)return;
  if(p1===p2)return toast('Игроки должны быть разными','err');
  set('Создаю встречу…');
  const{data:enc,error}=await sb.from('encounters').insert({tournament_id:t,player1_id:p1,player2_id:p2}).select().single();
  if(dbErr(error,'создание встречи'))return;
  const{data:tRow}=await sb.from('tournaments').select('restart_penalties').eq('id',t).maybeSingle();
  const pen=tRow?.restart_penalties||[];
  let ok=0;const errs=[];
  for(const[num,link]of[[1,l1],[2,l2]]){
    if(!link)continue;
    set(`Импорт матча ${num}…`);
    try{await importMatchFromLink(enc.id,num,p1,p2,link,pen);ok++;}
    catch(e){errs.push(`матч ${num}: ${e.message}`);}
  }
  set(`Готово: импортировано ${ok} матч(ей)`+(errs.length?` · ⚠ ${errs.join('; ')}`:''));
  toast(errs.length?'Создано с предупреждениями':'Встреча с результатами создана',errs.length?'err':'ok');
  pgMatches();
}

// Встреча по паре игроков в турнире: переиспользует существующую (в любом
// порядке игроков) или создаёт новую. Возвращает строку encounters.
async function findOrCreateEncounter(tourId,p1,p2){
  const{data:exist}=await sb.from('encounters').select('*').eq('tournament_id',tourId);
  const e=(exist||[]).find(x=>(x.player1_id===p1&&x.player2_id===p2)||(x.player1_id===p2&&x.player2_id===p1));
  if(e)return e;
  const{data,error}=await sb.from('encounters').insert({tournament_id:tourId,player1_id:p1,player2_id:p2}).select().single();
  if(error)throw error;
  return data;
}

// Массовый импорт: textarea со ВСЕМИ ссылками → встречи (пары игроков) + матчи
// + полные ростеры. Каждую ссылку читаем для имён игроков, группируем по паре,
// затем importMatchFromLink (он же пишет матч/пики/ростеры). Номер матча по тому,
// чей фп: фп==player1 встречи → матч 1, иначе матч 2.
async function bulkImportDrafts(){
  const t=v('bulk-tour');
  if(!t)return toast('Выбери турнир','err');
  const raw=document.getElementById('bulk-links')?.value||'';
  const links=raw.split(/\s+/).map(s=>s.trim()).filter(s=>/(?:draft_id|session_id)=/.test(s));
  if(!links.length)return toast('Вставь ссылки (по одной на строку)','err');
  const set=m=>{const el=document.getElementById('bulk-status');if(el)el.textContent=m;};
  const{data:tRow}=await sb.from('tournaments').select('restart_penalties').eq('id',t).maybeSingle();
  const pen=tRow?.restart_penalties||[];
  const ids=await loadShiyuIds();
  // 1) читаем драфты → имена игроков (player0=фп, player1=дабл)
  const metas=[],errs=[];
  for(let i=0;i<links.length;i++){
    set(`Читаю драфты… ${i+1}/${links.length}`);
    try{
      const parsed=parseDraftLink(links[i]);if(!parsed)throw new Error('не разобрал ссылку');
      const state=await fetchDraftState(parsed.id,parsed.key);
      if(!state?.players)throw new Error('пустой драфт');
      const norm=normalizeDraft(state,ids);
      metas.push({url:links[i],fp:norm.players.player0.name,dbl:norm.players.player1.name});
    }catch(e){errs.push(`ссылка #${i+1}: ${e.message}`);}
  }
  // 2) группируем по неупорядоченной паре ников
  const groups={};
  metas.forEach(m=>{const k=[m.fp,m.dbl].map(x=>(x||'').toLowerCase()).sort().join('|');(groups[k]||(groups[k]=[])).push(m);});
  const keys=Object.keys(groups);let ok=0;
  for(let g=0;g<keys.length;g++){
    const grp=groups[keys[g]];
    set(`Импорт встреч… ${g+1}/${keys.length}`);
    try{
      const p1=await resolvePlayerNick(grp[0].fp),p2=await resolvePlayerNick(grp[0].dbl);
      if(!p1||!p2||p1===p2)throw new Error('не сопоставил игроков');
      const e=await findOrCreateEncounter(t,p1,p2);
      for(const m of grp){
        const fpId=await resolvePlayerNick(m.fp);
        const num=fpId===e.player1_id?1:2;
        await importMatchFromLink(e.id,num,e.player1_id,e.player2_id,m.url,pen);
        ok++;
      }
    }catch(e){errs.push(`пара ${grp[0].fp}/${grp[0].dbl}: ${e.message}`);}
  }
  // ОБЯЗАТЕЛЬНАЯ пост-проверка ВСЕГО турнира после импорта (в булке были самые
  // опасные ошибки): сторона/фп/дубли/таймеры/победитель + ростер-консистентность.
  await refreshData();
  set(`Импорт завершён (${ok} матч(ей)) · проверяю турнир…`);
  const audit=await auditTournamentMatches(t);
  const rep=[...audit.errors.map(x=>'⛔ '+x),...audit.warnings.map(x=>'⚠ '+x)];
  const summary=`Готово: ${ok} матч(ей) в ${keys.length} встреч(ах)`
    +(errs.length?` · импорт-ошибки ${errs.length}: ${errs.join('; ')}`:'')
    +(rep.length?` · проверка: ${audit.errors.length} ошибок / ${audit.warnings.length} предупр.`:' · проверка: всё чисто');
  const el=document.getElementById('bulk-status');
  if(el){
    el.innerHTML=escapeHtml(summary)+(rep.length
      ?`<div style="margin-top:6px;max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:6px 9px;line-height:1.5">${rep.map(x=>`<div>${escapeHtml(x)}</div>`).join('')}</div>`
      :'');
  }
  if(rep.length)console.warn('[bulk-import audit]\n'+rep.join('\n'));
  const bad=errs.length||audit.errors.length;
  toast(bad?`Импорт: ${audit.errors.length} ошибок проверки — см. отчёт`:(audit.warnings.length?'Импорт ОК, есть предупреждения':'Импорт завершён, проверка чистая'),bad?'err':'ok');
  // pgMatches() перерисовал бы страницу и стёр отчёт — перерисовываем только когда
  // всё чисто; при проблемах оставляем отчёт на экране (список встреч обновится при
  // следующем заходе на вкладку).
  if(!rep.length)pgMatches();
}

// Headless-импорт: ссылка драфта → матч + пики/баны в БД, без DOM-борда.
// Зеркалит логику applyDraftToForm+saveMatch (ориентация сторон по нику, штрафы,
// победитель по сумме таймеров). Бросает Error при сбое.
async function importMatchFromLink(encId,num,p1Id,p2Id,link,pen){
  pen=pen||[];
  const parsed=parseDraftLink(link);
  if(!parsed)throw new Error('не разобрал ссылку');
  const ids=await loadShiyuIds();
  const state=await fetchDraftState(parsed.id,parsed.key);
  if(!state||!state.players)throw new Error('пустой драфт');
  const norm=normalizeDraft(state,ids);
  const fpId=num===1?p1Id:p2Id,dblId=num===1?p2Id:p1Id;
  const fp=D.players.find(p=>p.id===fpId),dbl=D.players.find(p=>p.id===dblId);
  const ps=[norm.players.player0,norm.players.player1];
  const nm=s=>(s||'').trim().toLowerCase();
  const find=n=>ps.find(p=>nm(p.name)===nm(n));
  let sFp=find(fp?.nickname),sDbl=find(dbl?.nickname);
  if(!sFp||!sDbl||sFp===sDbl){sFp=norm.players.player0;sDbl=norm.players.player1;}
  const penSum=r=>{let s=0;for(let i=0;i<(r||0)&&i<pen.length;i++)s+=(+pen[i]||0);return s;};
  const eff=p=>p.clearTime==null?null:p.clearTime+penSum(p.restarts);
  const fpT=eff(sFp),dblT=eff(sDbl);
  const p1Timer=fpId===p1Id?fpT:dblT,p2Timer=fpId===p1Id?dblT:fpT;
  const p1R=fpId===p1Id?(sFp.restarts||0):(sDbl.restarts||0);
  const p2R=fpId===p1Id?(sDbl.restarts||0):(sFp.restarts||0);
  let winnerId=null;
  if(fpT!=null&&dblT!=null)winnerId=fpT<=dblT?fpId:dblId;
  // Валидация стороны/фп/дублирования перед записью (см. validateMatchData).
  const{data:otherMs}=await sb.from('matches').select('fp_player_id').eq('encounter_id',encId).neq('match_number',+num);
  const otherFpId=(otherMs||[]).map(m=>m.fp_player_id).find(Boolean)||null;
  const vr=validateMatchData({num,p1Id,p2Id,fpId,t1:fpT,t2:dblT,isDraw:false,winnerId,otherFpId});
  if(vr.errors.length)throw new Error('валидация: '+vr.errors.join('; '));
  const mData={encounter_id:encId,match_number:+num,fp_player_id:fpId,is_draw:false,winner_id:winnerId,
    player1_timer_sec:p1Timer,player2_timer_sec:p2Timer,player1_restarts:p1R,player2_restarts:p2R};
  const{data:exist}=await sb.from('matches').select('id').eq('encounter_id',encId).eq('match_number',+num).maybeSingle();
  let mid=exist?.id;
  if(mid){const{error}=await sb.from('matches').update(mData).eq('id',mid);if(error)throw error;}
  else{const{data,error}=await sb.from('matches').insert(mData).select().single();if(error)throw error;mid=data.id;}
  // баны/пики из шаблона (player_id, порядок) + ростера норм-драфта (минскейп/амп по actor)
  const template=DRAFT_TEMPLATE(fpId,dblId);
  const fpPickOrder=template.filter(s=>s.type==='pick'&&s.pid===fpId).map(s=>s.n);
  const dblPickOrder=template.filter(s=>s.type==='pick'&&s.pid===dblId).map(s=>s.n);
  const teamSlotFor=(pid,slot)=>{const o=pid===fpId?fpPickOrder:dblPickOrder;return o.indexOf(slot)<3?1:2;};
  const sideForActor={player0:sFp,player1:sDbl};
  const slotById={};norm.slots.forEach(s=>slotById[s.n]=s);
  const bans=[],picks=[];
  template.forEach(tp=>{
    const ns=slotById[tp.n];if(!ns||!ns.enka)return;
    const ch=charByEnka(ns.enka);if(!ch)return;
    if(tp.type==='ban'){bans.push({match_id:mid,player_id:tp.pid,character_id:ch.id,ban_order:tp.n});}
    else{
      const pl=sideForActor[ns.actor]||sFp;
      const ms=pl.mindscapeByEnka[ns.enka]??0;
      const sg=sigByEngineEnka(pl.engineEnkaByAgentEnka[ns.enka]);
      const ref=pl.refByAgentEnka?.[ns.enka]??1;
      picks.push({match_id:mid,player_id:tp.pid,character_id:ch.id,mindscape:ms,team_slot:teamSlotFor(tp.pid,tp.n),
        sig_id:sg?sg.id:null,has_signature:!!sg,refinement:ref,pick_order:tp.n,is_fp:tp.pid===fpId,is_double:tp.pid!==fpId});
    }
  });
  await sb.from('match_bans').delete().eq('match_id',mid);
  if(bans.length){const{error}=await sb.from('match_bans').insert(bans);if(error)throw error;}
  await sb.from('match_picks').delete().eq('match_id',mid);
  if(picks.length){const{error}=await sb.from('match_picks').insert(picks);if(error)throw error;}
  const{data:allMs}=await sb.from('matches').select('*').eq('encounter_id',encId);
  if(allMs&&allMs.length>=2){let a=0,b=0;allMs.forEach(m=>{a+=m.player1_timer_sec||0;b+=m.player2_timer_sec||0;});
    await sb.from('encounters').update({winner_id:a<=b?p1Id:p2Id}).eq('id',encId);}
  // Автозаполнение ростеров обоих игроков из их ПОЛНОГО ростера в драфте
  // (p.roster.agents → norm mindscapeByEnka: 17+ персонажей, что игрок принёс),
  // а не из 6 пикнутых. Резолвим enka→персонаж БД; нерезолвленных пропускаем.
  const rosterAgents=[];
  [[fpId,sFp],[dblId,sDbl]].forEach(([pid,side])=>{
    Object.entries(side.mindscapeByEnka||{}).forEach(([enka,ms])=>{
      const ch=charByEnka(enka);if(!ch)return;
      rosterAgents.push({player_id:pid,character_id:ch.id,mindscape:ms||0});
    });
  });
  const{data:encRow}=await sb.from('encounters').select('tournament_id').eq('id',encId).maybeSingle();
  if(encRow?.tournament_id)await autofillRostersFromMatch(encRow.tournament_id,rosterAgents);
}

// ===== Автозаполнение ростеров из результатов =====
// Заполняет ростеры ДВУХ игроков из их ПОЛНОГО ростера в драфте (источник —
// ссылка shiyu.darte.gg): agents — массив {player_id, character_id, mindscape}
// со ВСЕМИ персонажами, что игроки принесли в этот матч (17+), не только пикнутыми.
// Пишет в player_rosters
// с source='auto', сливая с уже имеющимся авто-ростером (новые персонажи
// добавляются, по существующим берётся больший минскейп — чтобы матчи
// накапливали ростер, а не затирали друг друга).
// Ростеры, помеченные source='manual' (правились вручную), НЕ трогаются —
// это «флаг защиты от перетира». Тихо выходит, если колонки source ещё нет
// (до запуска sql/add_roster_source.sql).
async function autofillRostersFromMatch(tournamentId,agents){
  if(!tournamentId||!agents?.length)return;
  // персонаж → макс. минскейп этого матча, по каждому игроку
  const byPlayer={};
  agents.forEach(p=>{
    const m=byPlayer[p.player_id]||(byPlayer[p.player_id]={});
    if(m[p.character_id]==null||(p.mindscape||0)>m[p.character_id])m[p.character_id]=p.mindscape||0;
  });
  for(const pid of Object.keys(byPlayer)){
    const{data:ex,error:exErr}=await sb.from('player_rosters').select('character_id,mindscape,source').eq('tournament_id',tournamentId).eq('player_id',pid);
    if(exErr)return; // колонки source ещё нет (миграция не применена) — выходим тихо
    if((ex||[]).some(r=>r.source==='manual'))continue; // защита ручного ростера
    // слияние: имеющиеся авто-строки + пики этого матча (макс минскейп)
    const merged={};
    (ex||[]).forEach(r=>merged[r.character_id]=r.mindscape||0);
    Object.entries(byPlayer[pid]).forEach(([cid,msv])=>{if(merged[cid]==null||msv>merged[cid])merged[cid]=msv;});
    await sb.from('player_rosters').delete().match({tournament_id:tournamentId,player_id:pid});
    const rows=Object.entries(merged).map(([cid,msv])=>({tournament_id:tournamentId,player_id:pid,character_id:cid,mindscape:msv,source:'auto'}));
    if(rows.length)await sb.from('player_rosters').insert(rows);
  }
}

async function openMatch(encId,num,p1Id,p2Id){
  const fpId=num===1?p1Id:p2Id;
  const dblId=num===1?p2Id:p1Id;
  const fp=D.players.find(p=>p.id===fpId),dbl=D.players.find(p=>p.id===dblId);
  const{data:match}=window.DEV_PREVIEW
    ?{data:window.DEV_MATCH||null}
    :await sb.from('matches').select('*,picks:match_picks(*),bans:match_bans(*)').eq('encounter_id',encId).eq('match_number',num).maybeSingle();
  const mid=match?.id||'';

  const template=DRAFT_TEMPLATE(fpId,dblId);

  const pSec=s=>s?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:'';
  const fpTimer=pSec(fpId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const dblTimer=pSec(dblId===p1Id?match?.player1_timer_sec:match?.player2_timer_sec);
  const fpR=fpId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);
  const dblR=dblId===p1Id?(match?.player1_restarts||0):(match?.player2_restarts||0);

  document.getElementById('page-title').textContent=`Матч ${num} — ${fp?.nickname} (фп) vs ${dbl?.nickname}`;
  window._draftRoster=null; // сбрасываем ростер прошлого матча

  // Контекст для импортёра: ники (для ориентации сторон по имени) + штрафы за рестарты турнира.
  let penalties=[];
  if(!window.DEV_PREVIEW){
    const{data:encRow}=await sb.from('encounters').select('tournament_id').eq('id',encId).maybeSingle();
    if(encRow){const{data:tRow}=await sb.from('tournaments').select('restart_penalties').eq('id',encRow.tournament_id).maybeSingle();penalties=tRow?.restart_penalties||[];}
  }
  window._matchCtx={fpName:fp?.nickname||'',dblName:dbl?.nickname||'',penalties};

  const mlbl='font-size:11px;color:var(--sub);white-space:nowrap';
  const minp='padding:5px 8px;text-align:center;font-size:13px;margin:0';
  html(`<style>
    .mbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .mbar input,.mbar .btn{margin:0}
    .mres{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}
    .mres .side{display:flex;align-items:center;gap:6px}
    .mres .nm{font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:15px;text-transform:uppercase;letter-spacing:.02em;padding-right:.22em;flex-shrink:0}
    .mres .side{gap:7px;flex-shrink:0}
    .mres .div{width:1px;height:26px;background:var(--border)}
  </style>
  <div class="mbar">
    <button class="btn btn-g" style="padding:6px 12px;font-size:13px" onclick="go('matches')">← Встречи</button>
    <input id="draft-link" type="text" placeholder="ссылка shiyu.darte.gg (draft_id + session_key)…" style="flex:1;min-width:200px;padding:6px 10px;font-size:13px">
    <button class="btn btn-g" style="padding:6px 14px;font-size:13px" onclick="importDraftFromLink()">Импорт</button>
    <button class="btn btn-y" style="padding:6px 18px;font-size:13px" onclick="saveMatch('${encId}','${num}','${p1Id}','${p2Id}','${fpId}','${mid}')" style="padding:6px 18px;font-size:13px;white-space:nowrap">Сохранить матч</button>
  </div>
  <div id="draft-import-status" style="font-size:11px;color:var(--sub);min-height:13px;margin-bottom:10px"></div>

  <div class="card" style="padding:10px 14px;margin-bottom:12px">
    <div class="mres">
      <div class="side">
        <span class="nm" style="color:var(--accent)">${fp?.nickname}</span><span style="font-size:9px;color:var(--sub);letter-spacing:.1em">ФП</span>
        <span style="${mlbl}">таймер</span><input id="t1" type="text" value="${fpTimer}" placeholder="3:28" title="Итоговый таймер фп (м:сс)" style="width:72px;${minp};font-family:'JetBrains Mono',monospace">
        <span style="${mlbl}">рест.</span><input id="r1" type="number" value="${fpR}" min="0" title="Рестарты фп" style="width:52px;${minp}">
      </div>
      <span class="div"></span>
      <div class="side">
        <span class="nm">${dbl?.nickname}</span>
        <span style="${mlbl}">таймер</span><input id="t2" type="text" value="${dblTimer}" placeholder="3:45" title="Итоговый таймер (м:сс)" style="width:72px;${minp};font-family:'JetBrains Mono',monospace">
        <span style="${mlbl}">рест.</span><input id="r2" type="number" value="${dblR}" min="0" title="Рестарты" style="width:52px;${minp}">
      </div>
      <span style="flex:1;min-width:8px"></span>
      <label class="cb-label" style="font-size:13px"><input type="checkbox" id="m-draw" ${match?.is_draw?'checked':''}>Ничья</label>
      <div class="side">
        <span style="${mlbl}">победитель</span>
        <select id="m-winner" style="width:auto;padding:5px 8px;font-size:13px">
          <option value="">авто (таймер)</option>
          <option value="${fpId}" ${match?.winner_id===fpId?'selected':''}>${fp?.nickname}</option>
          <option value="${dblId}" ${match?.winner_id===dblId?'selected':''}>${dbl?.nickname}</option>
        </select>
      </div>
    </div>
  </div>

  <div class="card" style="padding:12px 14px">
    ${renderDraftBoard(template,fpId,dblId,fp?.nickname,dbl?.nickname,match)}
  </div>`);
}


// Сигнатурный амплификатор персонажа (по character_id).
function sigForChar(charId){return charId?D.sigs.find(s=>s.character_id===charId)||null:null;}

const DRAFT_CSS=`<style>
/* Драфт-борд в стиле shiyu: сетка-очередь — фп (слева, к центру) · PICKS · дабл (справа). */
.dboard{max-width:1240px;margin:0 auto}
.dgrid{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:stretch}
.dgcol{min-width:0}
.dgname{font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;text-transform:uppercase;font-size:20px;letter-spacing:.02em;color:var(--text);display:flex;align-items:baseline;gap:8px;margin-bottom:8px;min-width:0}
.dgname b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dgname.dbl{justify-content:flex-end;text-align:right}
.dgname .dtag{font-size:10px;font-style:normal;font-weight:700;letter-spacing:.1em;color:#fff;background:var(--grad);border-radius:3px;padding:1px 6px;flex-shrink:0}
.dgcells{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;align-content:start}
.dgmid{display:flex;align-items:center;justify-content:center;min-width:30px}
.dgmid-lbl{font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:14px;letter-spacing:.18em;color:var(--sub);white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg)}

/* универсальная ячейка драфта (бан=ч/б+рамка, пик=оверлеи минскейп/амп) */
.dcell{display:flex;flex-direction:column;gap:4px;min-width:0}
.dcell.empty{visibility:hidden}
.dcell .pk-thumb{position:relative;width:100%;aspect-ratio:1;border-radius:9px;overflow:hidden;background:#11141f;border:1px solid var(--border)}
.dcell .pk-thumb img,.dcell .pk-thumb .pic{width:100%!important;height:100%!important;border-radius:0!important;object-fit:cover;display:block}
.pk-num{position:absolute;top:3px;left:3px;z-index:3;min-width:18px;height:18px;padding:0 4px;border-radius:5px;background:rgba(8,8,12,.8);color:#fff;font-family:'Saira Condensed',sans-serif;font-style:italic;font-weight:900;font-size:13px;line-height:18px;text-align:center}
.dcell.ban .pk-thumb{border-color:#ef4444;box-shadow:inset 0 0 0 3px #ef4444}
.dcell.ban .pk-thumb img,.dcell.ban .pk-thumb .pic{filter:grayscale(1) brightness(.62)}
.dcell.ban .pk-num{background:#dc2626}

/* кнопки-дропдауны драфта (персонаж / амплификатор) — вытянутые кнопочки под портретом */
.ddw{position:relative;width:100%}
.dd-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:6px;min-height:30px;background:#0f1118;border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-family:'Rajdhani',sans-serif;font-size:12px;cursor:pointer;line-height:1;transition:border-color .12s}
.dd-btn:hover{border-color:var(--sub)}
.ddw.open .dd-btn{border-color:var(--accent)}
.dd-cur{display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;flex:1;overflow:hidden}
.dd-cur .dd-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--sub)}
.dd-ph{color:var(--sub);font-size:12px}
.dd-arr{color:var(--sub);font-size:9px;flex-shrink:0}
/* ряд иконок ранг/элемент/роль в кнопке персонажа */
.dd-cur .ic-row{display:flex;align-items:center;gap:5px}
.dd-cur .ic-row img{flex-shrink:0}
/* картинка амплификатора в кнопке */
.dd-cur .amp-im{display:inline-flex;align-items:center;line-height:0;flex-shrink:0}
.dd-cur .amp-im img,.dd-cur .amp-im .pic{width:18px!important;height:18px!important;border-radius:4px!important;object-fit:cover}
/* выпадающий список */
.dd-list{position:absolute;z-index:60;top:calc(100% + 4px);left:0;min-width:100%;width:max-content;max-width:240px;background:#12141d;border:1px solid var(--border);border-radius:8px;padding:5px;display:none;max-height:280px;overflow:auto;box-shadow:0 10px 28px rgba(0,0,0,.5)}
.dd-list.left{left:auto;right:0}
.ddw.open .dd-list{display:block}
.dd-search{width:100%;background:#0d0f18;border:1px solid var(--border);color:var(--text);border-radius:5px;padding:5px 8px;font-size:12px;margin-bottom:5px;font-family:'Rajdhani',sans-serif;position:sticky;top:0}
.dd-opt{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:5px;cursor:pointer;font-size:13px;color:var(--text);white-space:nowrap}
.dd-opt:hover{background:#1c1f2e}
.dd-opt.sel{background:#221019;color:var(--accent)}
.dd-opt.none{color:var(--sub);font-style:italic}
.dd-opt .dd-oic{display:inline-flex;align-items:center;flex-shrink:0;line-height:0}
.dd-opt .dd-oic img,.dd-opt .dd-oic .pic{border-radius:4px}

/* минскейп: бейдж M0..M6 снизу-справа (нативный select без стрелки) */
.pk-ms{position:absolute;right:3px;bottom:3px;z-index:3;appearance:none;-webkit-appearance:none;background:rgba(8,8,12,.82);border:1px solid #2a2d3a;color:#fff;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;padding:2px 5px;width:auto;min-width:0;cursor:pointer;text-align:center;text-align-last:center}
.pk-ms:hover,.pk-ms:focus{border-color:var(--accent)}

/* скрытые input'ы держат значение (совместимость с saveMatch / импортом драфта) */
.dcell .draft-char,.dcell .draft-sig{display:none}

@media(max-width:760px){
  .dgrid{grid-template-columns:1fr;gap:18px}
  .dgmid{display:none}
  .dgname.dbl{justify-content:flex-start;text-align:left}
}
</style>`;

// Раскладка очереди как на сайте (5 колонок, фп зеркалит к центру).
// Последние пики (17 у фп, 18 у дабла) ставим по бокам 2-го ряда, а не на 3-й ряд —
// это экономит вертикаль. Числа — slot.n; null — пустая ячейка-распорка.
const DRAFT_ORDER_FP =[null,8,5,4,1, 17,16,13,12,9];
const DRAFT_ORDER_DBL=[2,3,6,7,null, 10,11,14,15,18];

// Текущее значение минскейпа в общий msOpts.
function _msSel(val){const s=String(val||0);return msOpts.replace(`value="${s}"`,`value="${s}" selected`);}

// HTML «текущего выбора» в кнопке-дропдауне.
// Персонаж: ряд иконок ранг · элемент · роль. Пусто → «—».
function charCurHtml(ch){
  if(!ch)return`<span class="dd-ph">—</span>`;
  return`<span class="ic-row">${iconRarity(ch.rarity,16)}${iconElement(ch.element,16)}${iconRole(ch.role,16)}</span>`;
}
// Амплификатор: его картинка + название. Пусто → «— амп —».
function ampCurHtml(sig){
  if(!sig)return`<span class="dd-ph">— амп —</span>`;
  return`<span class="amp-im">${sigImg(sig,18)}</span><span class="dd-nm">${escapeHtml(sig.name)}</span>`;
}

// Универсальная ячейка драфта. slot===null → пустая распорка.
// Бан: портрет ч/б + красная рамка + №  → кнопка-дропдаун персонажа.
// Пик: + минскейп-оверлей M0..M6, кнопка персонажа и кнопка амплификатора.
function draftCellHtml(slot,banMap,pickMap){
  if(!slot)return`<div class="dcell empty"></div>`;
  const isBan=slot.type==='ban';
  const ex=(isBan?banMap:pickMap)[slot.n]||{};
  const ch=D.chars.find(c=>c.id===ex.character_id)||null;
  let ov='',ampRow='';
  if(!isBan){
    // минскейп — оверлей снизу-справа на портрете
    ov=`<select class="draft-ms pk-ms" data-slot="${slot.n}" title="Минскейп">${_msSel(ex.mindscape||0)}</select>`;
    // амплификатор — кнопка-дропдаун (любой амп на любом персе); картинка показывается в кнопке
    const curSig=ex.sig_id?D.sigs.find(s=>s.id===ex.sig_id):null;
    ampRow=`<div class="ddw" data-kind="amp" data-slot="${slot.n}">
      <input type="hidden" class="draft-sig" data-slot="${slot.n}" value="${ex.sig_id||''}">
      <input type="hidden" class="draft-ref" data-slot="${slot.n}" value="${ex.refinement||1}">
      <button type="button" class="dd-btn" onclick="ddToggle(this,event)" title="Амплификатор (W-движок)"><span class="dd-cur">${ampCurHtml(curSig)}</span><span class="dd-arr">▾</span></button>
      <div class="dd-list"></div>
    </div>`;
  }
  return`<div class="dcell ${isBan?'ban':'pick'}">
    <div class="pk-thumb">
      <span class="pk-img" data-imgslot="${slot.n}">${iconChar(ch,isBan?64:88)}</span>
      <span class="pk-num">${slot.n}</span>
      ${ov}</div>
    <div class="ddw" data-kind="char" data-slot="${slot.n}">
      <input type="hidden" class="draft-char" data-slot="${slot.n}" data-type="${slot.type}" data-pid="${slot.pid}" value="${ex.character_id||''}">
      <button type="button" class="dd-btn" onclick="ddToggle(this,event)" title="Персонаж"><span class="dd-cur">${charCurHtml(ch)}</span><span class="dd-arr">▾</span></button>
      <div class="dd-list"></div>
    </div>
    ${ampRow}
  </div>`;
}

// Борд в духе сайта: одна сетка-очередь, слоты в реальном порядке драфта,
// фп слева (зеркалит к центру) · PICKS · дабл справа. Все элементы редактируемы.
function renderDraftBoard(slots,fpId,dblId,fpName,dblName,match){
  const banMap={},pickMap={};
  (match?.bans||[]).forEach(b=>banMap[b.ban_order]=b);
  (match?.picks||[]).forEach(p=>pickMap[p.pick_order]=p);

  // Данные для ленивых списков дропдаунов (HTML опций строится при первом открытии).
  window._ddCharItems=D.chars.map(c=>({value:c.id,label:c.name,c}));
  window._ddAmpItems=[...D.sigs].sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(s=>{
    const c=D.chars.find(x=>x.id===s.character_id);
    return{value:s.id,label:s.name+(c?' · '+c.name:''),s};
  });

  const byN={};slots.forEach(s=>byN[s.n]=s);
  const cells=order=>order.map(n=>draftCellHtml(n?byN[n]:null,banMap,pickMap)).join('');

  return DRAFT_CSS+`<div class="dboard">
    <div class="dgrid">
      <div class="dgcol">
        <div class="dgname"><b>${fpName||'ФП'}</b><span class="dtag">ФП</span></div>
        <div class="dgcells">${cells(DRAFT_ORDER_FP)}</div>
      </div>
      <div class="dgmid"><span class="dgmid-lbl">PICKS</span></div>
      <div class="dgcol">
        <div class="dgname dbl"><b>${dblName||'Дабл'}</b></div>
        <div class="dgcells">${cells(DRAFT_ORDER_DBL)}</div>
      </div>
    </div>
  </div>`;
}

// ===== Кнопки-дропдауны драфта (персонаж / амплификатор) =====
// Значение хранится в скрытом input.draft-char / .draft-sig (совместимо с saveMatch и импортом).

// Список опций (лениво, при первом открытии). У каждого пункта — иконка + имя.
function buildDdList(kind){
  if(kind==='amp'){
    const items=window._ddAmpItems||[];
    return`<input class="dd-search" placeholder="поиск амплификатора" oninput="ddSearch(this)" onclick="event.stopPropagation()">`+
      `<div class="dd-opt none" data-v="" onclick="ddPick(this)">— без амплификатора —</div>`+
      items.map(it=>`<div class="dd-opt" data-v="${it.value}" onclick="ddPick(this)"><span class="dd-oic">${sigImg(it.s,22)}</span>${escapeHtml(it.label)}</div>`).join('');
  }
  const items=window._ddCharItems||[];
  return`<input class="dd-search" placeholder="поиск персонажа" oninput="ddSearch(this)" onclick="event.stopPropagation()">`+
    `<div class="dd-opt none" data-v="" onclick="ddPick(this)">— пусто —</div>`+
    items.map(it=>`<div class="dd-opt" data-v="${it.value}" onclick="ddPick(this)"><span class="dd-oic">${iconChar(it.c,22)}</span>${escapeHtml(it.label)}</div>`).join('');
}

function ddToggle(btn,ev){
  if(ev)ev.stopPropagation();
  const w=btn.closest('.ddw');if(!w)return;
  const wasOpen=w.classList.contains('open');
  document.querySelectorAll('.ddw.open').forEach(x=>x.classList.remove('open'));
  if(wasOpen)return;
  const list=w.querySelector('.dd-list');
  if(list&&!list.dataset.filled){list.innerHTML=buildDdList(w.dataset.kind);list.dataset.filled='1';}
  const val=w.querySelector('input').value;
  if(list)list.querySelectorAll('.dd-opt').forEach(o=>o.classList.toggle('sel',o.dataset.v===val));
  w.classList.add('open');
  // если список вылезает за правый край вьюпорта — выровнять по правому краю
  list.classList.remove('left');
  if(list.getBoundingClientRect().right>window.innerWidth-8)list.classList.add('left');
  const s=list.querySelector('.dd-search');if(s){s.value='';ddSearch(s);setTimeout(()=>s.focus(),0);}
}

function ddSearch(inp){
  const q=inp.value.trim().toLowerCase();
  inp.closest('.dd-list').querySelectorAll('.dd-opt').forEach(o=>{
    if(o.classList.contains('none')){o.style.display='';return;}
    o.style.display=o.textContent.toLowerCase().includes(q)?'':'none';
  });
}

function ddPick(opt){
  const w=opt.closest('.ddw');if(!w)return;
  w.querySelector('input').value=opt.dataset.v;
  w.classList.remove('open');
  if(w.dataset.kind==='char')onCharPicked(w.dataset.slot);
  else dcRefreshAmp(w.dataset.slot);
}

// Обновить «текущий выбор» в кнопке персонажа из её скрытого input.
function dcRefreshChar(slot){
  const inp=document.querySelector(`.draft-char[data-slot="${slot}"]`);
  const w=inp&&inp.closest('.ddw');if(!w)return;
  const ch=D.chars.find(c=>c.id===inp.value)||null;
  w.querySelector('.dd-cur').innerHTML=charCurHtml(ch);
}
// Обновить картинку амплификатора в его кнопке.
function dcRefreshAmp(slot){
  const inp=document.querySelector(`.draft-sig[data-slot="${slot}"]`);
  const w=inp&&inp.closest('.ddw');if(!w)return;
  const sig=inp.value?D.sigs.find(s=>s.id===inp.value):null;
  w.querySelector('.dd-cur').innerHTML=ampCurHtml(sig);
}

// Выбор персонажа: портрет, авто-M6 для A-ранга, дефолтный сигнатурный амплификатор.
function onCharPicked(slot){
  const inp=document.querySelector(`.draft-char[data-slot="${slot}"]`);
  if(!inp)return;
  const char=D.chars.find(c=>c.id===inp.value)||null;
  const msEl=document.querySelector(`.draft-ms[data-slot="${slot}"]`);
  if(msEl&&char?.rarity==='A')msEl.value='6';
  const img=document.querySelector(`.pk-img[data-imgslot="${slot}"]`);
  if(img)img.innerHTML=iconChar(char,88);
  dcRefreshChar(slot);
  // по умолчанию ставим сигнатурный амплификатор персонажа (частый случай)
  const ampInp=document.querySelector(`.draft-sig[data-slot="${slot}"]`);
  if(ampInp){const own=sigForChar(inp.value);ampInp.value=own?own.id:'';dcRefreshAmp(slot);}
}

// Совместимость со старыми вызовами (в т.ч. из импорта драфта).
function draftCharChanged(el){onCharPicked(el.dataset.slot);}
function draftSigChanged(el){dcRefreshAmp(el.dataset.slot);}

// Закрытие открытого дропдауна по клику вне него.
if(typeof document!=='undefined'&&!window._ddInit){
  window._ddInit=true;
  document.addEventListener('click',e=>{if(!e.target.closest('.ddw'))document.querySelectorAll('.ddw.open').forEach(w=>w.classList.remove('open'));});
}

function parseSec(s){if(!s)return null;const p=s.split(':').map(Number);if(p.length!==2||isNaN(p[0])||isNaN(p[1]))return null;return p[0]*60+p[1];}

async function saveMatch(encId,num,p1Id,p2Id,fpId,existingId){
  const isDraw=document.getElementById('m-draw').checked;
  const t1=parseSec(v('t1')),t2=parseSec(v('t2'));
  const r1=+document.getElementById('r1')?.value||0;
  const r2=+document.getElementById('r2')?.value||0;
  const dblId=fpId===p1Id?p2Id:p1Id;

  const p1Timer=fpId===p1Id?t1:t2;
  const p2Timer=fpId===p1Id?t2:t1;
  const p1R=fpId===p1Id?r1:r2;
  const p2R=fpId===p1Id?r2:r1;

  let winnerId=v('m-winner');
  if(!winnerId&&!isDraw&&t1!=null&&t2!=null){winnerId=t1<=t2?fpId:dblId;}

  const mData={encounter_id:encId,match_number:+num,fp_player_id:fpId,is_draw:isDraw,
    winner_id:isDraw?null:(winnerId||null),
    player1_timer_sec:p1Timer,player2_timer_sec:p2Timer,
    player1_restarts:p1R,player2_restarts:p2R};

  // Собираем баны и пики из драфт-борда (match_id допишем после получения mid).
  // team_slot вычисляем по позиции пика среди пиков этого игрока: первые 3 → T1, следующие 3 → T2
  const template=DRAFT_TEMPLATE(fpId,dblId);
  const fpPickOrder=template.filter(s=>s.type==='pick'&&s.pid===fpId).map(s=>s.n);
  const dblPickOrder=template.filter(s=>s.type==='pick'&&s.pid===dblId).map(s=>s.n);
  const teamSlotFor=(pid,slot)=>{
    const order=pid===fpId?fpPickOrder:dblPickOrder;
    const idx=order.indexOf(slot);
    return idx<3?1:2;
  };

  const bans=[],picks=[];
  document.querySelectorAll('.draft-char').forEach(el=>{
    if(!el.value)return;
    const slot=+el.dataset.slot,type=el.dataset.type,pid=el.dataset.pid;
    if(type==='ban'){
      bans.push({player_id:pid,character_id:el.value,ban_order:slot});
    }else{
      const ms=+document.querySelector(`.draft-ms[data-slot="${slot}"]`)?.value||0;
      const sigId=document.querySelector(`.draft-sig[data-slot="${slot}"]`)?.value||null;
      const ref=+document.querySelector(`.draft-ref[data-slot="${slot}"]`)?.value||1;
      const team=teamSlotFor(pid,slot);
      picks.push({player_id:pid,character_id:el.value,
        mindscape:ms,team_slot:team,sig_id:sigId,has_signature:!!sigId,refinement:ref,pick_order:slot,
        is_fp:pid===fpId,is_double:pid!==fpId});
    }
  });

  // Многоуровневая валидация перед записью: сторона/фп/дубли/таймеры.
  // otherFpId — фп соседнего матча встречи (для проверки, что сторона не дублируется).
  const{data:otherMs}=await sb.from('matches').select('fp_player_id').eq('encounter_id',encId).neq('match_number',+num);
  const otherFpId=(otherMs||[]).map(m=>m.fp_player_id).find(Boolean)||null;
  const vr=validateMatchData({num,p1Id,p2Id,fpId,t1,t2,isDraw,winnerId,picks,bans,otherFpId});
  const rWarn=await rosterConsistencyWarnings(encId,picks,existingId);
  const warnings=[...vr.warnings,...rWarn];
  if(vr.errors.length||warnings.length){
    const msg=[vr.errors.length?'⛔ Ошибки:\n• '+vr.errors.join('\n• '):'',
              warnings.length?'⚠ Предупреждения:\n• '+warnings.join('\n• '):'']
             .filter(Boolean).join('\n\n');
    if(!confirm(msg+'\n\nВсё равно сохранить матч?'))return;
  }

  let mid=existingId;
  if(mid){const{error}=await sb.from('matches').update(mData).eq('id',mid);if(dbErr(error,'обновление матча'))return;}
  else{const{data,error}=await sb.from('matches').insert(mData).select().single();if(dbErr(error,'создание матча'))return;mid=data?.id;}
  if(!mid)return toast('Ошибка сохранения матча','err');
  bans.forEach(b=>b.match_id=mid);picks.forEach(p=>p.match_id=mid);

  {const{error}=await sb.from('match_bans').delete().eq('match_id',mid);if(dbErr(error,'очистка банов'))return;}
  if(bans.length){const{error}=await sb.from('match_bans').insert(bans);if(dbErr(error,'сохранение банов'))return;}

  {const{error}=await sb.from('match_picks').delete().eq('match_id',mid);if(dbErr(error,'очистка пиков'))return;}
  if(picks.length){const{error}=await sb.from('match_picks').insert(picks);if(dbErr(error,'сохранение пиков'))return;}

  // Обновляем победителя встречи по суммарному таймеру
  const{data:allMs}=await sb.from('matches').select('*').eq('encounter_id',encId);
  if(allMs&&allMs.length>=2){
    let p1T=0,p2T=0;
    allMs.forEach(m=>{p1T+=m.player1_timer_sec||0;p2T+=m.player2_timer_sec||0;});
    const encWin=p1T<=p2T?p1Id:p2Id;
    const{error}=await sb.from('encounters').update({winner_id:encWin}).eq('id',encId);
    if(dbErr(error,'обновление победителя встречи'))return;
  }

  // Автозаполнение ростеров из полного ростера драфта (если матч импортировали по ссылке).
  const dr=window._draftRoster;
  if(dr){
    const agents=[];
    Object.entries(dr.fp||{}).forEach(([enka,ms])=>{const ch=charByEnka(enka);if(ch)agents.push({player_id:fpId,character_id:ch.id,mindscape:ms||0});});
    Object.entries(dr.dbl||{}).forEach(([enka,ms])=>{const ch=charByEnka(enka);if(ch)agents.push({player_id:dblId,character_id:ch.id,mindscape:ms||0});});
    const{data:encRow}=await sb.from('encounters').select('tournament_id').eq('id',encId).maybeSingle();
    if(encRow?.tournament_id)await autofillRostersFromMatch(encRow.tournament_id,agents);
  }

  toast('Матч сохранён!');
  setTimeout(()=>go('matches'),800);
}
