// icons.js — единая иконочная система zzz-stats.
// Подключается И в публичной части (index.html), И в админке (admin.html).
// Все имена с префиксом IC_/iconXxx, чтобы не конфликтовать с ELEMENTS/ROLE_LBL/ROLES
// и пр., объявленными в characters.js и index.html.
//
// Принцип: каждая функция возвращает <img>, который при отсутствии файла (onerror)
// заменяет себя на текущий текст/цвет-fallback. Поэтому сайт не ломается, пока
// картинки не подложены в web/icons/.

const IC_BASE = 'web/icons/';
const IC_EXT  = '.webp'; // расширение статических иконок (rarity/role/element)

// Перечисления (дублируем здесь, чтобы модуль был самодостаточным)
const IC_ELEM_LBL = {ice:'Лёд',fire:'Огонь',electric:'Электро',physical:'Физический',ether:'Эфир',wind:'Ветер'};
const IC_ELEM_C   = {ice:'#7dd3fc',fire:'#fb923c',electric:'#1e90ff',physical:'#fbbf24',ether:'#f472b6',wind:'#64b5f6'};
const IC_ROLE_LBL = {atk:'Attack',stun:'Stun',rupt:'Rupture',sup:'Support',def:'Defense',ano:'Anomaly'};
const IC_ROLE_C   = {atk:{bg:'#3b1010',fg:'#fca5a5'},stun:{bg:'#0f1f3b',fg:'#93c5fd'},rupt:{bg:'#2d1a00',fg:'#fcd34d'},sup:{bg:'#0a2218',fg:'#6ee7b7'},def:{bg:'#0a2218',fg:'#86efac'},ano:{bg:'#1a0d3b',fg:'#c4b5fd'}};

function _icEsc(s){return (s+'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

// <img> с graceful fallback: при ошибке загрузки заменяет себя на fallbackHtml.
function _icImg(src,size,fallbackHtml,alt,round){
  const s=size||20;
  const r=round?'50%':'4px';
  const fb=_icEsc(fallbackHtml||'');
  return `<img src="${IC_BASE}${src}" alt="${_icEsc(alt||'')}" width="${s}" height="${s}" loading="lazy" `+
    `style="width:${s}px;height:${s}px;object-fit:contain;vertical-align:middle;border-radius:${r};flex-shrink:0" `+
    `data-fb="${fb}" onerror="this.outerHTML=this.getAttribute('data-fb')">`;
}

// --- Редкость (S/A) ---
function iconRarity(rarity,size){
  const r=(rarity||'').toUpperCase();
  if(r!=='S'&&r!=='A')return '';
  const fb=`<span class="${r==='S'?'badge-s':'badge-a'}">${r}</span>`;
  return _icImg('rarity/'+r+IC_EXT,size||20,fb,'Редкость '+r);
}

// --- Роль (atk/stun/rupt/sup/def/ano) ---
function iconRole(role,size){
  const lbl=IC_ROLE_LBL[role]||role||'';
  if(!role)return '';
  const fb=`<span style="font-size:12px;color:var(--sub)">${_icEsc(lbl)}</span>`;
  return _icImg('role/'+role+IC_EXT,size||20,fb,lbl);
}

// --- Элемент (ice/fire/electric/physical/ether/wind) ---
function iconElement(element,size){
  if(!element||!IC_ELEM_LBL[element])return '';
  const lbl=IC_ELEM_LBL[element];
  const c=IC_ELEM_C[element]||'var(--sub)';
  const fb=`<span style="font-size:11px;color:${c}">${_icEsc(lbl)}</span>`;
  return _icImg('element/'+element+IC_EXT,size||20,fb,lbl,true);
}

// --- Малая иконка персонажа ---
// c — объект персонажа {name, role, icon_url?}. icon_url появится на Этапе B (Storage).
function iconChar(c,size){
  const s=size||32;
  const name=(c&&c.name)||'';
  // fallback — нейтральный пустой слот под мини-фото (реальное фото подставится на Этапе B).
  // Никаких 2-буквенных надписей.
  const fb=`<span class="pic" style="display:inline-block;`+
    `width:${s}px;height:${s}px;border-radius:6px;background:#1c1f2e;flex-shrink:0"></span>`;
  // Одна картинка на персонажа. Источник:
  //  1) icon_url/portrait_url из БД (если задан вручную/через Storage),
  //  2) иначе статикой из репо по имени: web/icons/characters/<name>.webp (файлы названы как name в БД).
  // Для иконок картинка просто уменьшается через CSS. Нет файла → onerror → пустой слот.
  const url=(c&&(c.icon_url||c.portrait_url))||
    (name?IC_BASE+'characters/'+encodeURIComponent(name)+IC_EXT:'');
  if(url){
    return `<img src="${_icEsc(url)}" alt="${_icEsc(name)}" width="${s}" height="${s}" loading="lazy" `+
      `style="width:${s}px;height:${s}px;object-fit:cover;border-radius:6px;flex-shrink:0;vertical-align:middle" `+
      `data-fb="${_icEsc(fb)}" onerror="this.outerHTML=this.getAttribute('data-fb')">`;
  }
  return fb;
}

// --- Наборы пунктов для кастомных дропдаунов с иконками ---
function icRarityItems(sz){return [{value:'S',label:'S',icon:iconRarity('S',sz||18)},{value:'A',label:'A',icon:iconRarity('A',sz||18)}];}
function icRoleItems(sz){return Object.entries(IC_ROLE_LBL).map(([k,l])=>({value:k,label:l,icon:iconRole(k,sz||18)}));}
function icElementItems(sz){return Object.entries(IC_ELEM_LBL).map(([k,l])=>({value:k,label:l,icon:iconElement(k,sz||18)}));}

// --- Кастомный дропдаун с иконками ---
// Хранит выбранное значение в скрытом <input id="<id>">, поэтому совместим с v(id).
// items: [{value,label,icon(html)}]. selected — текущее значение.
function icSelect(id,items,selected){
  let cur=items.find(i=>i.value===selected);
  if(!cur)cur=items[0];
  const optHtml=i=>`<span class="icsel-ic">${i.icon||''}</span><span>${_icEsc(i.label)}</span>`;
  const opts=items.map(i=>`<div class="icsel-opt${i.value===(cur&&cur.value)?' sel':''}" data-v="${_icEsc(i.value)}" onclick="icSelectPick('${id}',this)">${optHtml(i)}</div>`).join('');
  return `<div class="icsel" id="icsel-${id}">
    <input type="hidden" id="${id}" value="${_icEsc(cur?cur.value:'')}">
    <button type="button" class="icsel-btn" onclick="icSelectToggle('${id}',event)">
      <span class="icsel-cur">${cur?optHtml(cur):''}</span><span class="icsel-arr">▾</span>
    </button>
    <div class="icsel-list" id="icsel-list-${id}">${opts}</div>
  </div>`;
}
function icSelectToggle(id,ev){
  if(ev)ev.stopPropagation();
  const list=document.getElementById('icsel-list-'+id);if(!list)return;
  const open=list.classList.contains('open');
  document.querySelectorAll('.icsel-list.open').forEach(l=>l.classList.remove('open'));
  if(!open)list.classList.add('open');
}
function icSelectPick(id,el){
  const inp=document.getElementById(id);if(inp)inp.value=el.getAttribute('data-v');
  const wrap=document.getElementById('icsel-'+id);
  if(wrap){
    wrap.querySelector('.icsel-cur').innerHTML=el.innerHTML;
    wrap.querySelectorAll('.icsel-opt').forEach(o=>o.classList.toggle('sel',o===el));
  }
  const list=document.getElementById('icsel-list-'+id);if(list)list.classList.remove('open');
}
if(typeof document!=='undefined'&&!window._icSelInit){
  window._icSelInit=true;
  document.addEventListener('click',e=>{if(!e.target.closest('.icsel'))document.querySelectorAll('.icsel-list.open').forEach(l=>l.classList.remove('open'));});
}

// --- Большой портрет персонажа (для анализатора, Этап B) ---
function iconCharPortrait(c,size){
  const s=size||96;
  if(c&&c.portrait_url){
    return `<img src="${_icEsc(c.portrait_url)}" alt="${_icEsc((c&&c.name)||'')}" width="${s}" height="${s}" `+
      `style="width:${s}px;height:${s}px;object-fit:cover;border-radius:8px;flex-shrink:0">`;
  }
  return iconChar(c,s);
}
