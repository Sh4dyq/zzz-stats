/* Админка → Рейтинг: пересчёт, ручные правки, константы системы.
   Формула — web/js/rating.js, сборка сезона — web/js/rating-build.js,
   спецификация — docs/rating-system.md. Здесь только UI и запись в БД. */

let RT = { adjust: [], cfg: {}, rows: [] };

// Постраничная выборка: PostgREST режет ответ на 1000 строк без предупреждения.
async function pageAll(makeQuery){
  const N=1000,out=[];let from=0;
  for(;;){
    const{data,error}=await makeQuery().range(from,from+N-1);
    if(error)return{data:null,error};
    out.push(...(data||[]));
    if(!data||data.length<N)break;
    from+=N;
  }
  return{data:out,error:null};
}

/* Пересчёт всего сезона с нуля и запись в player_ratings.
   Зовётся и со страницы «Турниры» — оттуда удобнее сразу после турнира. */
async function recalcRating(statusId){
  const st=document.getElementById(statusId||'rt-status');
  const say=t=>{if(st)st.textContent=t;};
  if(typeof RatingBuild==='undefined')return toast('Не загружен web/js/rating-build.js','err');
  say('Считаю…');
  const[{data:tours},{data:players},{data:encounters,error:eErr},{data:cache},{data:cfgRow},{data:adj}]=await Promise.all([
    sb.from('tournaments').select('id,name,event_date,sort_order,rating_category'),
    sb.from('players').select('id,nickname'),
    pageAll(()=>sb.from('encounters').select('tournament_id,player1_id,player2_id,winner_id,stage_key,sort_order,created_at')),
    sb.from('bracket_cache').select('tournament_id,json'),
    sb.from('rating_config').select('cfg').eq('id',1).maybeSingle(),
    sb.from('rating_adjustments').select('nickname,delta,reason')
  ]);
  if(dbErr(eErr,'загрузка встреч'))return say('');
  const{rows,season}=RatingBuild.compute({
    tournaments:tours||[],players:players||[],encounters:encounters||[],cache:cache||[],
    config:(cfgRow&&cfgRow.cfg)||null,adjustments:adj||[]
  });
  if(!season.length){say('');return toast('Ни одному турниру не проставлена категория','err');}
  if(!rows.length){say('');return toast('Нет встреч для расчёта','err');}

  const{error:delErr}=await sb.from('player_ratings').delete().neq('nickname','');
  if(dbErr(delErr,'очистка рейтинга'))return say('');
  const stamp=new Date().toISOString();
  const{error:insErr}=await sb.from('player_ratings').insert(rows.map(r=>({...r,updated_at:stamp})));
  if(dbErr(insErr,'запись рейтинга'))return say('');
  say(`Готово: ${rows.length} игроков, турниров в зачёте ${season.length}`);
  toast(`Рейтинг пересчитан — ${season.map(s=>s.name).join(', ')}`);
  return rows;
}

async function pgRating(){
  const[{data:adj},{data:cfgRow},{data:rows}]=await Promise.all([
    sb.from('rating_adjustments').select('*').order('created_at',{ascending:false}),
    sb.from('rating_config').select('cfg').eq('id',1).maybeSingle(),
    sb.from('player_ratings').select('*').order('rating',{ascending:false})
  ]);
  RT={adjust:adj||[],cfg:(cfgRow&&cfgRow.cfg)||{},rows:rows||[]};
  const C=Rating.configure(RT.cfg);          // эффективные значения: дефолт + патч
  const noCat=(D.tours||[]).filter(t=>!t.rating_category&&t.status!=='upcoming');

  const num=(id,val,step)=>`<input id="${id}" type="number" step="${step||1}" value="${val}">`;
  const adjRows=RT.adjust.length?RT.adjust.map(a=>`
    <div class="row-item">
      <span style="min-width:170px;font-weight:600">${escapeHtml(a.nickname)}</span>
      <span style="min-width:60px;color:${a.delta<0?'var(--danger,#e06)':'var(--ok,#3c9)'}">${a.delta>0?'+':''}${a.delta}</span>
      <span style="flex:1;color:var(--sub);font-size:13px">${escapeHtml(a.reason||'')}</span>
      <span style="color:var(--sub);font-size:12px">${new Date(a.created_at).toLocaleDateString('ru-RU')}</span>
      <button class="icon-btn danger" title="Удалить правку" onclick="delAdjust(${a.id})">✕</button>
    </div>`).join(''):'<p style="color:var(--sub);font-size:14px">Правок нет — рейтинг целиком из формулы</p>';

  const nickList=[...new Set([...(D.players||[]).map(p=>p.nickname),...RT.rows.map(r=>r.nickname)])];

  html(`
  <div class="card" style="margin-bottom:16px">
    <h3>Пересчёт</h3>
    <div style="font-size:12px;color:var(--sub);margin-bottom:10px">
      Сезон считается с нуля: все турниры с категорией в хронологическом порядке, затем ручные правки.
      Итог — вкладка «Рейтинги → Таблица Elo» в статистике.
      ${noCat.length?`<br><b>Без категории (в зачёт не идут):</b> ${noCat.map(t=>escapeHtml(t.name)).join(', ')}`:''}
    </div>
    <button class="btn btn-y" onclick="recalcRating().then(pgRating)">🔄 Пересчитать рейтинг</button>
    <span id="rt-status" style="font-size:13px;color:var(--sub);margin-left:10px">${RT.rows.length?`в таблице ${RT.rows.length} игроков, обновлено ${RT.rows[0].updated_at?new Date(RT.rows[0].updated_at).toLocaleString('ru-RU'):'—'}`:'ещё не считался'}</span>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h3>Ручные правки</h3>
    <div style="font-size:12px;color:var(--sub);margin-bottom:10px">Прибавляются поверх формулы после всех турниров и всегда видны отдельной колонкой с причиной. Тир пересчитывается уже с правкой. Правки суммируются, применяются при следующем пересчёте.</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div style="flex:2;min-width:180px"><label>Игрок</label><input id="adj-nick" list="adj-nicks" type="text" placeholder="ник как в таблице"><datalist id="adj-nicks">${nickList.map(n=>`<option value="${escapeHtml(n)}"></option>`).join('')}</datalist></div>
      <div style="flex:1;min-width:110px"><label>Правка (±)</label><input id="adj-delta" type="number" step="1" placeholder="-25"></div>
      <div style="flex:3;min-width:220px"><label>Причина (обязательно)</label><input id="adj-reason" type="text" placeholder="техническое поражение за неявку"></div>
      <button class="btn btn-y" onclick="addAdjust()">Добавить</button>
    </div>
    <div class="space-y">${adjRows}</div>
  </div>

  <div class="card">
    <h3>Константы системы</h3>
    <div style="font-size:12px;color:var(--sub);margin-bottom:12px">Пустое поле = значение по умолчанию из спецификации. После сохранения рейтинг пересчитывается сразу.</div>

    <h4 style="margin:10px 0 8px">Формула</h4>
    <div class="grid3">
      <div><label>Старт</label>${num('cf-start',C.START)}</div>
      <div><label>SCALE (шкала)</label>${num('cf-scale',C.SCALE)}</div>
      <div><label>K</label>${num('cf-k',C.K)}</div>
    </div>

    <h4 style="margin:18px 0 8px">Множители категорий</h4>
    <div class="grid3">
      <div><label>Фасткап</label>${num('cf-w-fastcap',C.CATEGORY_W.fastcap,0.05)}</div>
      <div><label>Обычный</label>${num('cf-w-main',C.CATEGORY_W.main,0.05)}</div>
      <div><label>Крупный</label>${num('cf-w-major',C.CATEGORY_W.major,0.05)}</div>
    </div>

    <h4 style="margin:18px 0 8px">Множитель состава</h4>
    <div class="grid2">
      <div><label>β (сила поправки)</label>${num('cf-fbeta',C.FIELD_BETA,0.01)}</div>
      <div><label>Разброс, очков рейтинга</label>${num('cf-fspan',C.FIELD_SPAN,10)}</div>
    </div>

    <h4 style="margin:18px 0 8px">Очки за места</h4>
    <div style="overflow-x:auto"><table style="min-width:420px">
      <thead><tr><th>Место</th><th>Фасткап</th><th>Обычный</th><th>Крупный</th></tr></thead>
      <tbody>${[1,2,3,4,5,6].map(pl=>`<tr>
        <td>${pl}</td>
        <td>${num('cf-pl-fastcap-'+pl,C.PLACE.fastcap[pl]||0)}</td>
        <td>${num('cf-pl-main-'+pl,C.PLACE.main[pl]||0)}</td>
        <td>${num('cf-pl-major-'+pl,C.PLACE.major[pl]||0)}</td></tr>`).join('')}</tbody>
    </table></div>

    <h4 style="margin:18px 0 8px">Тиры</h4>
    <div class="grid3">
      ${C.TIERS.filter(t=>isFinite(t.min)).map(t=>`<div><label>${t.name} от</label>${num('cf-tier-'+t.name,t.min)}</div>`).join('')}
      <div><label>Окно понижения</label>${num('cf-guard',C.GUARD)}</div>
    </div>

    <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-y" onclick="saveRatingCfg()">Сохранить и пересчитать</button>
      <button class="btn btn-g" onclick="resetRatingCfg()">Сбросить к значениям из спецификации</button>
    </div>
  </div>`);
}

async function addAdjust(){
  const nickname=v('adj-nick'),delta=parseInt(v('adj-delta'),10),reason=v('adj-reason');
  if(!nickname)return toast('Укажи игрока','err');
  if(!delta)return toast('Правка не может быть нулевой','err');
  if(!reason)return toast('Впиши причину — она видна на сайте','err');
  const{error}=await sb.from('rating_adjustments').insert({nickname,delta,reason});
  if(dbErr(error,'добавление правки'))return;
  await recalcRating();
  toast('Правка добавлена, рейтинг пересчитан');
  pgRating();
}

async function delAdjust(id){
  if(!confirm('Удалить правку?'))return;
  const{error}=await sb.from('rating_adjustments').delete().eq('id',id);
  if(dbErr(error,'удаление правки'))return;
  await recalcRating();
  pgRating();
}

// Собирает патч из формы: пишем только то, что отличается от дефолта,
// чтобы правки спецификации подхватывались автоматически.
function ratingCfgFromForm(){
  const D0=Rating.DEFAULTS,n=id=>{const el=document.getElementById(id);if(!el||el.value==='')return null;const x=+el.value;return isFinite(x)?x:null;};
  const cfg={},put=(path,val,def)=>{
    if(val==null||val===def)return;
    let o=cfg;for(let i=0;i<path.length-1;i++)o=o[path[i]]||=({});
    o[path[path.length-1]]=val;
  };
  put(['START'],n('cf-start'),D0.START);
  put(['SCALE'],n('cf-scale'),D0.SCALE);
  put(['K'],n('cf-k'),D0.K);
  ['fastcap','main','major'].forEach(k=>put(['CATEGORY_W',k],n('cf-w-'+k),D0.CATEGORY_W[k]));
  put(['FIELD_BETA'],n('cf-fbeta'),D0.FIELD_BETA);
  put(['FIELD_SPAN'],n('cf-fspan'),D0.FIELD_SPAN);
  ['fastcap','main','major'].forEach(cat=>[1,2,3,4,5,6].forEach(pl=>{
    const val=n(`cf-pl-${cat}-${pl}`)||0,def=D0.PLACE[cat][pl]||0;
    if(val!==def)((cfg.PLACE||={})[cat]||={})[pl]=val;
  }));
  // тиры — массив целиком, иначе не сохранить порядок и границы
  const tiers=D0.TIERS.map(t=>({...t,min:isFinite(t.min)?(n('cf-tier-'+t.name)??t.min):t.min}));
  if(tiers.some((t,i)=>t.min!==D0.TIERS[i].min))cfg.TIERS=tiers;
  put(['GUARD'],n('cf-guard'),D0.GUARD);
  return cfg;
}

async function saveRatingCfg(){
  const cfg=ratingCfgFromForm();
  const{error}=await sb.from('rating_config').upsert({id:1,cfg,updated_at:new Date().toISOString()});
  if(dbErr(error,'сохранение констант'))return;
  await recalcRating();
  toast(Object.keys(cfg).length?'Константы сохранены, рейтинг пересчитан':'Вернулись к значениям из спецификации');
  pgRating();
}

async function resetRatingCfg(){
  if(!confirm('Сбросить все константы к значениям из docs/rating-system.md?'))return;
  const{error}=await sb.from('rating_config').upsert({id:1,cfg:{},updated_at:new Date().toISOString()});
  if(dbErr(error,'сброс констант'))return;
  await recalcRating();
  pgRating();
}
