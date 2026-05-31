// --- SIGNATURES ---
async function ensureSigSchema(){
  if(D.hasSigImg!==undefined)return;
  const{error}=await sb.from('signatures').select('image_url').limit(1);
  D.hasSigImg=!error; // колонка image_url (Этап B)
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
    const thumb=D.hasSigImg?`<label title="Загрузить картинку амплификатора" style="cursor:pointer;display:inline-flex">
          ${sigImg(s,28)}
          <input type="file" accept="image/*" style="display:none" onchange="uploadSigImg('${s.id}',this)">
        </label>`:'';
    return`<div class="row-item" id="sig-row-${s.id}">
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          ${thumb}
          <div style="flex:1"><span style="font-weight:600">${s.name}</span><span style="font-size:12px;color:var(--sub);margin-left:8px">→ ${c?.name||'?'}</span></div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-r" onclick="startEditSig('${s.id}')">✎</button>
        <button class="btn-r" onclick="delSig('${s.id}')">✕</button>
      </div>
    </div>`;
  }).join('');

  html(`<div class="card" style="margin-bottom:16px">
    <h3>Добавить амплификатор</h3>
    <div class="grid2">
      <div><label>Название</label><input id="s-name" type="text" placeholder="Deep Sea Visitor"></div>
      <div><label>Персонаж</label>${sel('s-char',D.chars,x=>x.id,x=>x.name)}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-y" onclick="addSig()">Добавить</button>
      <button class="btn" onclick="openBulkAdd()">Добавить список</button>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h4>Быстрый импорт списка</h4>
    <p style="color:var(--sub);font-size:13px;margin:4px 0">Каждая строка: <code>Название | Персонаж</code> — поле персонажа можно опустить.</p>
    <textarea id="s-list" rows="6" style="width:100%" placeholder="Название сигны | Имя персонажа"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-y" onclick="addSigsList()">Добавить список</button>
      <button class="btn" onclick="document.getElementById('s-list').value=''">Очистить</button>
    </div>
  </div>

  <div class="space-y">${list||'<p style="color:var(--sub);font-size:14px">Амплификаторов ещё нет</p>'}</div>`);
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
  const charSelect=selRaw('edit-char-'+id,D.chars,'id','name',s.character_id);
  row.innerHTML=`<div style="flex:1">
      <div style="display:flex;gap:8px;align-items:center">
        <input id="edit-name-${id}" value="${escapeHtml(s.name)}" style="flex:1" />
        <div style="min-width:180px">${charSelect}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-y" onclick="saveEditSig('${id}')">Сохранить</button>
      <button class="btn" onclick="cancelEditSig('${id}')">Отмена</button>
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