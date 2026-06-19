// characters.js — персонажи: список, добавление, редактирование, удаление

const ELEMENTS={ice:'Лёд',fire:'Огонь',electric:'Электро',physical:'Физический',ether:'Эфир',wind:'Ветер'};
const ELEM_C={ice:'#7dd3fc',fire:'#fb923c',electric:'#1e90ff',physical:'#fbbf24',ether:'#f472b6',wind:'#64b5f6'};

async function ensureSchema(){
  if(D.hasElement!==undefined)return;
  const{error}=await sb.from('characters').select('element').limit(1);
  D.hasElement=!error;
  const{error:e2}=await sb.from('characters').select('portrait_url,icon_url').limit(1);
  D.hasImages=!e2; // доступны ли колонки portrait_url/icon_url
}

// Загрузка одной картинки персонажа в Storage и запись url в БД.
// Одно изображение служит и иконкой (уменьшается через CSS), и портретом. Путь: characters/{id}.webp.
async function uploadCharImg(id,input){
  const f=input.files&&input.files[0];if(!f)return;
  const url=await uploadStorageImage(f,`characters/${id}.webp`);
  input.value='';
  if(!url)return;
  const{error}=await sb.from('characters').update({icon_url:url}).eq('id',id);
  if(dbErr(error,'сохранение картинки персонажа'))return;
  await refreshData();toast('Картинка обновлена');pgCharacters();
}
function charPayload(o){
  const p={name:o.name,rarity:o.rarity,role:o.role};
  if(D.hasElement)p.element=o.element||null;
  return p;
}
let _editChar=null;

async function pgCharacters(){
  await ensureSchema();
  const list=D.chars.map(c=>{
    if(c.id===_editChar)return charEditRow(c);
    const thumb=D.hasImages?`<label title="Загрузить картинку персонажа" style="cursor:pointer;display:inline-flex;flex-shrink:0">
        ${iconChar(c,30)}
        <input type="file" accept="image/*" style="display:none" onchange="uploadCharImg('${c.id}',this)">
      </label>`:iconChar(c,30);
    return`<div class="gcard" data-search="${escapeHtml((c.name||'').toLowerCase())}">
      <div class="gc-main">
        ${thumb}
        ${iconRarity(c.rarity,18)}
        <span class="gc-name">${c.name}</span>
        ${iconElement(c.element,16)}
        ${iconRole(c.role,16)}
      </div>
      <div class="gc-acts">
        <button class="icon-btn" title="Изменить" onclick="startEditChar('${c.id}')">✎</button>
        <button class="icon-btn danger" title="Удалить" onclick="delChar('${c.id}')">✕</button>
      </div>
    </div>`;
  }).join('');

  const elField=D.hasElement?`<div><label>Атрибут</label>${icSelect('c-el',icElementItems())}</div>`:'';

  html(`<details class="panel">
    <summary>Добавить персонажа<span class="chev">▾</span></summary>
    <div class="panel-body">
      <div class="${D.hasElement?'grid2':'grid3'}">
        <div><label>Имя (EN)</label><input id="c-name" type="text" placeholder="Ellen Joe"></div>
        ${elField}
        <div><label>Редкость</label>${icSelect('c-rar',icRarityItems())}</div>
        <div><label>Роль</label>${icSelect('c-role',icRoleItems())}</div>
      </div>
      <button class="btn btn-y" style="margin-top:14px" onclick="addChar()">Добавить</button>
      ${D.hasElement?'':`<p style="color:var(--sub);font-size:12px;margin-top:10px">💡 Чтобы хранить атрибут (Лёд/Огонь/…), один раз выполни в Supabase → SQL Editor:<br><code style="color:var(--accent)">alter table characters add column if not exists element text;</code><br>после этого обнови страницу.</p>`}
    </div>
  </details>
  <div class="listbar">
    <div class="search" style="margin:0;flex:1;max-width:380px">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
      <input type="search" data-target="char-list" oninput="acFilter(this)" placeholder="Поиск персонажа…">
    </div>
    <span class="count-chip">${D.chars.length} перс.</span>
  </div>
  <div class="gcards" id="char-list">${list||''}<p data-empty style="color:var(--sub);font-size:14px;${D.chars.length?'display:none':''}">Персонажей ещё нет</p></div>`);
}

function charEditRow(c){
  const elField=D.hasElement?`<div style="min-width:140px">${icSelect('ec-el',icElementItems(),c.element)}</div>`:'';
  return`<div class="row-item" style="grid-column:1/-1;border-color:var(--accent);flex-wrap:wrap;gap:8px">
    <input id="ec-name" type="text" value="${(c.name||'').replace(/"/g,'&quot;')}" style="flex:1;min-width:150px">
    <div style="min-width:90px">${icSelect('ec-rar',icRarityItems(),c.rarity)}</div>
    ${elField}
    <div style="min-width:140px">${icSelect('ec-role',icRoleItems(),c.role)}</div>
    <button class="btn btn-y" style="font-size:12px;padding:5px 12px" onclick="saveEditChar('${c.id}')">Сохранить</button>
    <button class="btn btn-g" style="font-size:12px;padding:5px 12px" onclick="cancelEditChar()">Отмена</button>
  </div>`;
}
function startEditChar(id){_editChar=id;pgCharacters();}
function cancelEditChar(){_editChar=null;pgCharacters();}
async function saveEditChar(id){
  const name=document.getElementById('ec-name').value.trim();
  if(!name)return toast('Имя не может быть пустым','err');
  const payload={name,rarity:document.getElementById('ec-rar').value,role:document.getElementById('ec-role').value};
  if(D.hasElement)payload.element=document.getElementById('ec-el')?.value||null;
  const{error}=await sb.from('characters').update(payload).eq('id',id);
  if(dbErr(error,'редактирование персонажа'))return;
  _editChar=null;await refreshData();toast('Изменения сохранены');pgCharacters();
}

async function addChar(){
  await ensureSchema();
  const n=v('c-name');if(!n)return;
  const{error}=await sb.from('characters').insert(charPayload({name:n,rarity:v('c-rar'),role:v('c-role'),element:v('c-el')}));
  if(dbErr(error,'добавление персонажа'))return;
  await refreshData();toast('Персонаж добавлен');pgCharacters();
}
async function delChar(id){if(!confirm('Удалить?'))return;const{error}=await sb.from('characters').delete().eq('id',id);if(dbErr(error,'удаление персонажа'))return;if(_editChar===id)_editChar=null;await refreshData();pgCharacters();}
