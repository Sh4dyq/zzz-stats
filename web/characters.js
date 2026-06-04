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
    const thumb=D.hasImages?`<label title="Загрузить картинку персонажа" style="cursor:pointer;display:inline-flex">
        ${iconChar(c,28)}
        <input type="file" accept="image/*" style="display:none" onchange="uploadCharImg('${c.id}',this)">
      </label>`:'';
    return`<div class="row-item">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        ${thumb}
        ${iconRarity(c.rarity,18)}
        <span style="font-weight:600">${c.name}</span>
        ${iconElement(c.element,18)}
        ${iconRole(c.role,18)}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-g" style="font-size:13px;padding:4px 11px" onclick="startEditChar('${c.id}')">✎</button>
        <button class="btn-r" onclick="delChar('${c.id}')">✕</button>
      </div>
    </div>`;
  }).join('');

  const elField=D.hasElement?`<div><label>Атрибут</label>${icSelect('c-el',icElementItems())}</div>`:'';

  html(`<div class="card" style="margin-bottom:16px">
    <h3>Добавить вручную</h3>
    <div class="${D.hasElement?'grid2':'grid3'}">
      <div><label>Имя (EN)</label><input id="c-name" type="text" placeholder="Ellen Joe"></div>
      ${elField}
      <div><label>Редкость</label>${icSelect('c-rar',icRarityItems())}</div>
      <div><label>Роль</label>${icSelect('c-role',icRoleItems())}</div>
    </div>
    <button class="btn btn-y" style="margin-top:12px" onclick="addChar()">Добавить</button>
    ${D.hasElement?'':`<p style="color:var(--sub);font-size:12px;margin-top:10px">💡 Чтобы хранить атрибут (Лёд/Огонь/…), один раз выполни в Supabase → SQL Editor:<br><code style="color:var(--accent)">alter table characters add column if not exists element text;</code><br>после этого обнови страницу.</p>`}
  </div>
  <div class="space-y">${list||'<p style="color:var(--sub);font-size:14px">Персонажей ещё нет</p>'}</div>`);
}

function charEditRow(c){
  const elField=D.hasElement?`<div style="min-width:140px">${icSelect('ec-el',icElementItems(),c.element)}</div>`:'';
  return`<div class="row-item" style="border-color:var(--accent);flex-wrap:wrap;gap:8px">
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
