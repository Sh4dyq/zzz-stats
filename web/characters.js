// characters.js — персонажи: список, добавление, редактирование, удаление

const ELEMENTS={ice:'Лёд',fire:'Огонь',electric:'Электро',physical:'Физический',ether:'Эфир',wind:'Ветер'};
const ELEM_C={ice:'#7dd3fc',fire:'#fb923c',electric:'#1e90ff',physical:'#fbbf24',ether:'#f472b6',wind:'#64b5f6'};
const ROLE_LBL={atk:'Attack',stun:'Stun',rupt:'Rupture',sup:'Support',def:'Defense',ano:'Anomaly'};

async function ensureSchema(){
  if(D.hasElement!==undefined)return;
  const{error}=await sb.from('characters').select('element').limit(1);
  D.hasElement=!error;
}
function charPayload(o){
  const p={name:o.name,rarity:o.rarity,role:o.role};
  if(D.hasElement)p.element=o.element||null;
  return p;
}
function roleSelect(id,val){
  return`<select id="${id}">${Object.entries(ROLE_LBL).map(([k,l])=>`<option value="${k}" ${val===k?'selected':''}>${l}</option>`).join('')}</select>`;
}

let _editChar=null;

async function pgCharacters(){
  await ensureSchema();
  const list=D.chars.map(c=>{
    if(c.id===_editChar)return charEditRow(c);
    return`<div class="row-item">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
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
