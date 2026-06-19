// --- SIGNATURES ---
async function ensureSigSchema(){
  if(D.hasSigImg!==undefined)return;
  const{error}=await sb.from('signatures').select('image_url').limit(1);
  D.hasSigImg=!error; // доступна ли колонка image_url
}

// Мини-картинка амплификатора. Источник: image_url из БД (опц. переопределение)
// ИЛИ статикой из репо по имени: web/icons/amplifiers/<name>.webp (файлы названы как signatures.name).
// Нет файла → onerror → пустой слот.
function sigImg(s,sz){
  sz=sz||28;
  const name=(s&&s.name)||'';
  const fb=`<span style="display:inline-block;width:${sz}px;height:${sz}px;border-radius:6px;background:#1c1f2e;flex-shrink:0"></span>`;
  const url=(s&&s.image_url)||(name?'web/icons/amplifiers/'+encodeURIComponent(name)+'.webp':'');
  if(!url)return fb;
  return`<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" width="${sz}" height="${sz}" loading="lazy" style="width:${sz}px;height:${sz}px;object-fit:cover;border-radius:6px;flex-shrink:0;vertical-align:middle" data-fb="${escapeHtml(fb)}" onerror="this.outerHTML=this.getAttribute('data-fb')">`;
}

// Загрузка картинки амплификатора в Storage и запись url. Путь: amplifiers/{id}.webp.
async function uploadSigImg(id,input){
  const f=input.files&&input.files[0];if(!f)return;
  const url=await uploadStorageImage(f,`amplifiers/${id}.webp`);
  input.value='';
  if(!url)return;
  const{error}=await sb.from('signatures').update({image_url:url}).eq('id',id);
  if(dbErr(error,'сохранение картинки амплификатора'))return;
  await refreshData();toast('Картинка обновлена');pgSignatures();
}

async function pgSignatures(){
  await ensureSigSchema();
  const list=D.sigs.map(s=>{
    const c=D.chars.find(x=>x.id===s.character_id);
    const thumb=D.hasSigImg?`<label title="Загрузить картинку амплификатора" style="cursor:pointer;display:inline-flex;flex-shrink:0">
          ${sigImg(s,30)}
          <input type="file" accept="image/*" style="display:none" onchange="uploadSigImg('${s.id}',this)">
        </label>`:sigImg(s,30);
    return`<div class="gcard" id="sig-row-${s.id}" data-search="${escapeHtml(((s.name||'')+' '+(c?.name||'')).toLowerCase())}">
      <div class="gc-main">
        ${thumb}
        <span class="gc-name">${s.name}</span>
        <span class="gc-sub">→ ${c?.name||'?'}</span>
      </div>
      <div class="gc-acts">
        <button class="icon-btn" title="Изменить" onclick="startEditSig('${s.id}')">✎</button>
        <button class="icon-btn danger" title="Удалить" onclick="delSig('${s.id}')">✕</button>
      </div>
    </div>`;
  }).join('');

  html(`<details class="panel">
    <summary>Добавить амплификатор<span class="chev">▾</span></summary>
    <div class="panel-body">
      <div class="grid2">
        <div><label>Название</label><input id="s-name" type="text" placeholder="Deep Sea Visitor"></div>
        <div><label>Персонаж</label>${sel('s-char',D.chars,x=>x.id,x=>x.name)}</div>
      </div>
      <button class="btn btn-y" style="margin-top:14px" onclick="addSig()">Добавить</button>
    </div>
  </details>

  <details class="panel">
    <summary>Быстрый импорт списком<span class="chev">▾</span></summary>
    <div class="panel-body">
      <p style="color:var(--sub);font-size:13px;margin:0 0 8px">Каждая строка: <code>Название | Персонаж</code> — поле персонажа можно опустить.</p>
      <textarea id="s-list" rows="6" style="width:100%" placeholder="Название сигны | Имя персонажа"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-y" onclick="addSigsList()">Добавить список</button>
        <button class="btn btn-g" onclick="document.getElementById('s-list').value=''">Очистить</button>
      </div>
    </div>
  </details>

  <div class="listbar">
    <div class="search" style="margin:0;flex:1;max-width:380px">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
      <input type="search" data-target="sig-list" oninput="acFilter(this)" placeholder="Поиск амплификатора…">
    </div>
    <span class="count-chip">${D.sigs.length} амп.</span>
  </div>
  <div class="gcards" id="sig-list">${list||''}<p data-empty style="color:var(--sub);font-size:14px;${D.sigs.length?'display:none':''}">Амплификаторов ещё нет</p></div>`);
}

async function addSig(){
  const n=v('s-name'),c=v('s-char');if(!n||!c)return;
  if(window.DEV_PREVIEW){
    // local-only add for dev preview
    const id='dev-'+Math.random().toString(36).slice(2,9);
    D.sigs.push({id,name:n,character_id:c});
    toast('Амплификатор добавлен (dev)');pgSignatures();return;
  }
  const{error}=await sb.from('signatures').insert({name:n,character_id:c});if(dbErr(error,'добавление амплификатора'))return;toast('Амплификатор добавлен');await refreshData();pgSignatures();
}

// Bulk add: parse textarea lines and insert multiple rows
async function addSigsList(){
  const raw=v('s-list');if(!raw)return;const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(!lines.length){toast('Нет строк для добавления');return}
  const toInsert=[];
  for(const ln of lines){
    // support formats: name | char  or name -> char or just name
    let parts2=ln.split('|').map(p=>p.trim());
    if(parts2.length===1) parts2=ln.split('->').map(p=>p.trim());
    const name=parts2[0];
    let charId=null;
    if(parts2[1]){
      const ch= D.chars.find(x=>x.id===parts2[1] || (x.name && x.name.toLowerCase()===parts2[1].toLowerCase()));
      if(ch) charId=ch.id; else if(/^[0-9-]+$/.test(parts2[1])) charId=parts2[1];
    }
    if(!name) continue;
    toInsert.push({name,character_id:charId});
  }
  if(!toInsert.length){toast('Нечего добавлять');return}
  if(window.DEV_PREVIEW){
    toInsert.forEach((r,i)=>D.sigs.push({id:'dev-'+Math.random().toString(36).slice(2,9),...r}));
    toast(`Добавлено ${toInsert.length} амплификаторов (dev)`);pgSignatures();return;
  }
  const {error} = await sb.from('signatures').insert(toInsert);
  if(dbErr(error,'добавление списка амплификаторов'))return;toast(`Добавлено ${toInsert.length} амплификаторов`);await refreshData();pgSignatures();
}

async function delSig(id){if(!confirm('Удалить?'))return;
  if(window.DEV_PREVIEW){D.sigs=D.sigs.filter(x=>x.id!==id);toast('Удалено (dev)');pgSignatures();return}
  const{error}=await sb.from('signatures').delete().eq('id',id);if(dbErr(error,'удаление амплификатора'))return;await refreshData();pgSignatures();}

// --- Edit in place ---
function startEditSig(id){
  const s=D.sigs.find(x=>x.id===id); if(!s) return;
  const row=document.getElementById(`sig-row-${id}`);
  row.style.gridColumn='1 / -1';
  row.style.borderColor='var(--accent)';
  const charSelect=selRaw('edit-char-'+id,D.chars,'id','name',s.character_id);
  row.innerHTML=`<div style="flex:1">
      <div style="display:flex;gap:8px;align-items:center">
        <input id="edit-name-${id}" type="text" value="${escapeHtml(s.name)}" style="flex:1" />
        <div style="min-width:180px">${charSelect}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-y" onclick="saveEditSig('${id}')">Сохранить</button>
      <button class="btn btn-g" onclick="cancelEditSig('${id}')">Отмена</button>
    </div>`;
}

async function saveEditSig(id){
  const name=document.getElementById(`edit-name-${id}`).value.trim();
  const char=document.getElementById(`edit-char-${id}`).value||null;
  if(!name){toast('Название не может быть пустым');return}
  if(window.DEV_PREVIEW){
    const s=D.sigs.find(x=>x.id===id); if(s){s.name=name;s.character_id=char;}toast('Сигна обновлена (dev)');pgSignatures();return;
  }
  const {error} = await sb.from('signatures').update({name,character_id:char}).eq('id',id);
  if(dbErr(error,'обновление амплификатора'))return;toast('Сигна обновлена');
  await refreshData();
  pgSignatures();
}

function cancelEditSig(id){
  pgSignatures();
}

// small helpers used above when sel() helper not desirable
function selRaw(id,items,valFn,labelFn,selected){
  const opts = (items||[]).map(it=>{
    const v = typeof valFn==='function' ? valFn(it) : it[valFn];
    const l = typeof labelFn==='function' ? labelFn(it) : it[labelFn];
    const sel = selected==v ? ' selected' : '';
    return `<option value="${v}"${sel}>${escapeHtml(l)}</option>`;
  }).join('');
  return `<select id="${id}"><option value="">—</option>${opts}</select>`;
}

function escapeHtml(str){
  return (str+'').replace(/[&<>"']/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[s]);
}

function openBulkAdd(){
  const el=document.getElementById('s-list'); if(!el) return; el.focus();
}
