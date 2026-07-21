// wheel.js — колесо удачи: пул (персонажи/свои варианты), взвешенный рандом, анимация вращения.

const SB_URL='https://zoavnckfbfiejxfjakue.supabase.co';
const SB_KEY='sb_publishable_37RZBsmdp3O1i795EuEfeg_vFpdPTFZ';
const sb=supabase.createClient(SB_URL,SB_KEY);

const W={
  chars:[],            // персонажи из БД
  src:'chars',
  filt:{rarity:new Set(),element:new Set(),role:new Set()},
  pool:[],             // {id,name,weight,img,el}
  hist:[],
  imgs:{},             // кэш загруженных Image по url
  angle:0,             // текущий угол колеса, рад
  spinning:false,
  byElem:false,        // красить секторы по атрибуту персонажа
  hubImg:''            // своя картинка в центр (dataURL)
};

const ELEM_LBL={ice:'Лёд',fire:'Огонь',electric:'Электро',physical:'Физический',ether:'Эфир',wind:'Ветер'};
const ROLE_LBL={atk:'Attack',stun:'Stun',rupt:'Rupture',sup:'Support',def:'Defense',ano:'Anomaly'};
// Палитра секторов — циклическая, читаемая на тёмном фоне.
const SEG_C=['#ff1f44','#ec1862','#a970ff','#3dd9d6','#f5c842','#c4f500','#fb923c','#7dd3fc','#6ee7b7','#f472b6'];

const $=id=>document.getElementById(id);
const esc=s=>(s+'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

// --- данные ---
async function load(){
  const{data}=await sb.from('characters').select('*');
  W.chars=(data||[]).slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','ru'));
  renderFilters();
  restore();
  // добираем атрибут/картинку для сохранённых записей персонажей (старый формат пула их не хранил)
  W.pool.forEach(it=>{
    if(!it.id.startsWith('c:'))return;
    const c=W.chars.find(x=>'c:'+x.id===it.id);if(!c)return;
    it.el=c.element||'';it.img=it.img||charImg(c);
  });
  renderPool();
}
function charImg(c){
  return (c&&(c.icon_url||c.portrait_url))||
    (c&&c.name?IC_BASE+'characters/'+encodeURIComponent(c.name)+IC_EXT:'');
}

// --- фильтры ---
function chipSet(box,key,items){
  $(box).innerHTML=items.map(([v,l])=>
    `<button class="chip${W.filt[key].has(v)?' on':''}" onclick="togFilt('${key}','${v}')">${esc(l)}</button>`).join('');
}
function renderFilters(){
  const uniq=k=>[...new Set(W.chars.map(c=>c[k]).filter(Boolean))];
  chipSet('f-rarity','rarity',uniq('rarity').sort().reverse().map(v=>[v,v]));
  chipSet('f-element','element',uniq('element').map(v=>[v,ELEM_LBL[v]||v]));
  chipSet('f-role','role',uniq('role').map(v=>[v,ROLE_LBL[v]||v]));
  updFCount();
}
function togFilt(k,v){
  W.filt[k].has(v)?W.filt[k].delete(v):W.filt[k].add(v);
  renderFilters();
}
// Пустой набор фильтра = «любое». Наборы между собой — И, внутри — ИЛИ.
function filtered(){
  return W.chars.filter(c=>
    (!W.filt.rarity.size||W.filt.rarity.has(c.rarity))&&
    (!W.filt.element.size||W.filt.element.has(c.element))&&
    (!W.filt.role.size||W.filt.role.has(c.role)));
}
function updFCount(){$('f-count').textContent='подходит: '+filtered().length;}

function setSrc(s){
  W.src=s;
  $('src-chars').style.display=s==='chars'?'':'none';
  $('src-custom').style.display=s==='custom'?'':'none';
  [...$('src-seg').children].forEach((b,i)=>b.classList.toggle('on',i===(s==='chars'?0:1)));
}

// --- пул ---
function addItem(it){
  if(W.pool.some(x=>x.id===it.id))return false;
  W.pool.push(it);return true;
}
function addFiltered(){
  filtered().forEach(c=>addItem({id:'c:'+c.id,name:c.name,weight:1,img:charImg(c),el:c.element||''}));
  renderPool();
}
function replaceFiltered(){W.pool=[];addFiltered();}
function addCustom(){
  const n=$('c-name').value.trim();if(!n)return;
  const w=Math.max(.1,parseFloat($('c-weight').value)||1);
  addItem({id:'u:'+n+':'+Date.now(),name:n,weight:w,img:''});
  $('c-name').value='';$('c-name').focus();
  renderPool();
}
function addBulk(){
  const lines=$('c-bulk').value.split('\n').map(s=>s.trim()).filter(Boolean);
  lines.forEach((l,i)=>{
    const[n,w]=l.split('|');
    if(!n.trim())return;
    addItem({id:'u:'+n.trim()+':'+(Date.now()+i),name:n.trim(),weight:Math.max(.1,parseFloat(w)||1),img:''});
  });
  $('c-bulk').value='';
  renderPool();
}
function delItem(id){W.pool=W.pool.filter(x=>x.id!==id);renderPool();}
function setWeight(id,v){
  const it=W.pool.find(x=>x.id===id);if(!it)return;
  it.weight=Math.max(.1,parseFloat(v)||1);
  renderPool();
}
// Ручной ввод шанса: вес пересчитывается так, чтобы доля стала ровно p% (остальные веса не трогаем).
function setPct(id,v){
  const it=W.pool.find(x=>x.id===id);if(!it)return;
  const p=Math.min(99,Math.max(.1,parseFloat(v)||0));
  const rest=W.pool.reduce((s,x)=>s+(x.id===id?0:x.weight),0);
  it.weight=rest?rest*p/(100-p):1;
  renderPool();
}
function evenPct(){W.pool.forEach(x=>x.weight=1);renderPool();}
function toggleElemColors(){W.byElem=!W.byElem;renderPool();}
// Цвет сектора: по атрибуту (если есть) либо циклическая палитра.
function segColor(it,i){
  if(W.byElem&&it.el&&IC_ELEM_C[it.el])return IC_ELEM_C[it.el];
  return SEG_C[i%SEG_C.length];
}
function setHubImg(input){
  const f=input.files&&input.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{W.hubImg=r.result;applyHubImg();persist();};
  r.readAsDataURL(f);
  input.value='';
}
function clearHubImg(){W.hubImg='';applyHubImg();persist();}
function applyHubImg(){
  const h=$('hub');
  h.style.backgroundImage=W.hubImg?`url(${W.hubImg})`:'';
  h.classList.toggle('has-img',!!W.hubImg);
}
function clearPool(){W.pool=[];renderPool();}
function shufflePool(){
  for(let i=W.pool.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[W.pool[i],W.pool[j]]=[W.pool[j],W.pool[i]];}
  renderPool();
}

function renderPool(){
  const tot=W.pool.reduce((s,x)=>s+x.weight,0)||1;
  $('pool').innerHTML=W.pool.length?W.pool.map((it,i)=>`
    <div class="pit">
      <span class="swatch" style="background:${segColor(it,i)}"></span>
      ${it.img?`<img src="${esc(it.img)}" width="26" height="26" style="width:26px;height:26px;object-fit:cover;border-radius:6px" onerror="this.style.visibility='hidden'">`:''}
      <span class="nm">${esc(it.name)}</span>
      <input class="w" type="number" min="0.1" step="0.1" value="${(+it.weight.toFixed(2))}" onchange="setWeight('${esc(it.id)}',this.value)" title="Вес">
      <input class="pct" type="number" min="0.1" max="99" step="0.1" value="${(it.weight/tot*100).toFixed(1)}" onchange="setPct('${esc(it.id)}',this.value)" title="Шанс, %">
      <button class="icon-btn" onclick="delItem('${esc(it.id)}')" title="Убрать">✕</button>
    </div>`).join(''):'<div class="empty">Пул пуст — добавь варианты слева</div>';
  $('pool-n').textContent=W.pool.length?'· '+W.pool.length:'';
  $('hub-n').textContent=W.pool.length;
  $('stage-empty').style.display=W.pool.length?'none':'flex';
  $('btn-spin').disabled=W.pool.length<2;
  $('hub').classList.toggle('dis',W.pool.length<2);
  updFCount();persist();
  preload();draw();
}

// --- отрисовка колеса ---
const cv=$('wheel'),ctx=cv.getContext('2d');
function fit(){
  const r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  cv.width=r.width*dpr;cv.height=r.height*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  draw();
}
window.addEventListener('resize',fit);

function preload(){
  W.pool.forEach(it=>{
    if(!it.img||W.imgs[it.img])return;
    const im=new Image();im.crossOrigin='anonymous';
    im.onload=()=>draw();im.onerror=()=>{W.imgs[it.img]=null;};
    im.src=it.img;W.imgs[it.img]=im;
  });
}
function segments(){
  const tot=W.pool.reduce((s,x)=>s+x.weight,0)||1;
  let a=0;
  return W.pool.map(it=>{const sw=it.weight/tot*Math.PI*2,s={it,a0:a,a1:a+sw};a+=sw;return s;});
}
function draw(){
  const w=cv.width/(window.devicePixelRatio||1),h=cv.height/(window.devicePixelRatio||1);
  ctx.clearRect(0,0,w,h);
  if(!W.pool.length)return;
  const cx=w/2,cy=h/2,R=Math.min(w,h)/2-6;
  const segs=segments();
  ctx.save();ctx.translate(cx,cy);ctx.rotate(W.angle);
  segs.forEach((s,i)=>{
    ctx.beginPath();ctx.moveTo(0,0);
    ctx.arc(0,0,R,s.a0-Math.PI/2,s.a1-Math.PI/2);ctx.closePath();
    ctx.fillStyle=segColor(s.it,i);ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,.35)';ctx.lineWidth=2;ctx.stroke();

    const mid=(s.a0+s.a1)/2-Math.PI/2, sw=s.a1-s.a0;
    // Содержимое сектора рисуем «боком»: ось X направлена от центра к ободу,
    // подпись читается вдоль радиуса — так она влезает при любом числе секторов.
    ctx.save();ctx.rotate(mid);
    // на левой половине переворачиваем, чтобы текст не шёл вверх ногами
    const flip=Math.cos(mid)<0, sgn=flip?-1:1;
    if(flip)ctx.rotate(Math.PI);
    const im=W.imgs[s.it.img];
    // размер иконки ограничен и шириной сектора (хорда), и радиусом
    const isz=Math.max(0,Math.min(R*.26,Math.sin(sw/2)*R*1.25));
    const hasIcon=im&&im.complete&&im.naturalWidth&&isz>14;
    if(hasIcon){
      const cxi=sgn*R*.78;
      ctx.save();
      ctx.beginPath();roundRect(cxi-isz/2,-isz/2,isz,isz,isz*.22);ctx.clip();
      // сохраняем пропорции: crop по центру (object-fit:cover)
      const nw=im.naturalWidth,nh=im.naturalHeight,k=Math.max(isz/nw,isz/nh);
      const dw=nw*k,dh=nh*k;
      ctx.drawImage(im,cxi-dw/2,-dh/2,dw,dh);
      ctx.restore();
      ctx.strokeStyle='rgba(0,0,0,.45)';ctx.lineWidth=1.5;
      roundRect(cxi-isz/2,-isz/2,isz,isz,isz*.22);ctx.stroke();
    }
    const fs=Math.max(10,Math.min(19,Math.sin(sw/2)*R*1.1));
    if(fs>=10){
      ctx.fillStyle='#0b0b0d';
      ctx.font=`800 ${fs}px 'Rajdhani',sans-serif`;
      ctx.textAlign=flip?'left':'right';ctx.textBaseline='middle';
      const outer=sgn*(hasIcon?R*.78-isz/2-6:R-14);
      const maxW=Math.abs(outer)-R*.22;
      let t=s.it.name;
      if(ctx.measureText(t).width>maxW){
        while(t.length>2&&ctx.measureText(t+'…').width>maxW)t=t.slice(0,-1);
        t+='…';
      }
      ctx.fillText(t,outer,0);
    }
    ctx.restore();
  });
  ctx.restore();
  // обод
  ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);
  ctx.strokeStyle='#26262c';ctx.lineWidth=5;ctx.stroke();
}
function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}

// --- звук (WebAudio, без файлов) ---
let AC=null;
function tick(){
  if(!$('opt-sound').checked)return;
  try{
    AC=AC||new (window.AudioContext||window.webkitAudioContext)();
    const o=AC.createOscillator(),g=AC.createGain();
    o.type='square';o.frequency.value=880;
    g.gain.setValueAtTime(.05,AC.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+.05);
    o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+.05);
  }catch(e){}
}
function fanfare(){
  if(!$('opt-sound').checked)return;
  try{
    AC=AC||new (window.AudioContext||window.webkitAudioContext)();
    [523,659,784,1047].forEach((f,i)=>{
      const o=AC.createOscillator(),g=AC.createGain(),t=AC.currentTime+i*.09;
      o.type='triangle';o.frequency.value=f;
      g.gain.setValueAtTime(.09,t);g.gain.exponentialRampToValueAtTime(.001,t+.32);
      o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+.32);
    });
  }catch(e){}
}

// --- вращение ---
function durLbl(){$('dur-lbl').textContent=$('opt-dur').value+'с';}

// Победитель выбирается взвешенным рандомом ДО анимации, колесо доводится до него.
function pickWinner(){
  const tot=W.pool.reduce((s,x)=>s+x.weight,0);
  let r=Math.random()*tot;
  for(const it of W.pool){r-=it.weight;if(r<=0)return it;}
  return W.pool[W.pool.length-1];
}
function spin(){
  if(W.spinning||W.pool.length<2)return;
  const win=pickWinner();
  const segs=segments(),s=segs.find(x=>x.it.id===win.id);
  // целевой угол: середина сектора победителя должна встать под указатель (вверх)
  const mid=(s.a0+s.a1)/2;
  const jitter=(Math.random()-.5)*(s.a1-s.a0)*.7;
  const dur=parseInt($('opt-dur').value,10)*1000;
  const turns=4+Math.floor(dur/1600);
  const cur=W.angle%(Math.PI*2);
  let target=-(mid+jitter);
  target=((target-cur)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
  const total=turns*Math.PI*2+target;
  const from=W.angle,t0=performance.now();
  W.spinning=true;$('btn-spin').disabled=true;$('hub').classList.add('dis');
  let lastSeg=-1;

  let done=false;
  const end=()=>{
    if(done)return;done=true;
    W.angle=from+total;draw();
    W.spinning=false;$('btn-spin').disabled=false;$('hub').classList.remove('dis');finish(win);
  };
  // rAF замораживается в фоновой вкладке — страховка, чтобы спин всегда завершался
  const guard=setTimeout(end,dur+600);

  const step=now=>{
    const p=Math.min(1,(now-t0)/dur);
    // ease-out quint — долгое замедление на финише
    const e=1-Math.pow(1-p,5);
    W.angle=from+total*e;
    draw();
    // тик при пересечении границы сектора
    const idx=segs.findIndex(x=>{
      const a=((-W.angle)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
      return a>=x.a0&&a<x.a1;
    });
    if(idx!==lastSeg){lastSeg=idx;tick();}
    if(p<1){if(!done)requestAnimationFrame(step);}
    else{clearTimeout(guard);end();}
  };
  requestAnimationFrame(step);
}

let _lastWin=null;
function finish(it){
  _lastWin=it;
  W.hist.unshift({name:it.name,img:it.img,t:Date.now()});
  W.hist=W.hist.slice(0,50);
  renderHist();persist();
  $('win-nm').textContent=it.name;
  const im=$('win-img');
  if(it.img){im.src=it.img;im.style.display='';im.onerror=()=>im.style.display='none';}
  else im.style.display='none';
  const b=$('btn-rm');b.disabled=false;b.textContent='Убрать из пула';
  $('ovl').classList.add('on');
  fanfare();confetti();
  if($('opt-remove').checked)removeWinner();
}
function closeWin(){$('ovl').classList.remove('on');}
// Окно остаётся открытым — можно посмотреть результат после удаления из пула.
function removeWinner(){
  if(!_lastWin)return;
  delItem(_lastWin.id);
  const b=$('btn-rm');b.disabled=true;b.textContent='Убран из пула';
}

function renderHist(){
  $('hist').innerHTML=W.hist.length?W.hist.map((h,i)=>`
    <div class="hrow">
      <span class="i">${i+1}</span>
      ${h.img?`<img src="${esc(h.img)}" width="22" height="22" style="width:22px;height:22px;object-fit:cover;border-radius:5px" onerror="this.style.visibility='hidden'">`:''}
      <span style="flex:1">${esc(h.name)}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--sub)">${new Date(h.t).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}</span>
    </div>`).join(''):'<div class="empty">Пока пусто</div>';
}
function clearHist(){W.hist=[];renderHist();persist();}

// --- конфетти ---
function confetti(){
  const c=$('conf'),x=c.getContext('2d');
  c.width=innerWidth;c.height=innerHeight;
  const P=Array.from({length:140},()=>({
    x:innerWidth/2,y:innerHeight/2,
    vx:(Math.random()-.5)*16,vy:(Math.random()-.9)*16,
    s:4+Math.random()*6,c:SEG_C[Math.random()*SEG_C.length|0],r:Math.random()*6
  }));
  const t0=performance.now();
  const step=now=>{
    const el=now-t0;
    x.clearRect(0,0,c.width,c.height);
    P.forEach(p=>{
      p.vy+=.35;p.x+=p.vx;p.y+=p.vy;p.r+=.12;
      x.save();x.translate(p.x,p.y);x.rotate(p.r);
      x.globalAlpha=Math.max(0,1-el/2200);
      x.fillStyle=p.c;x.fillRect(-p.s/2,-p.s/2,p.s,p.s*.6);x.restore();
    });
    if(el<2200)requestAnimationFrame(step);else x.clearRect(0,0,c.width,c.height);
  };
  requestAnimationFrame(step);
}

// --- сохранение ---
function persist(){
  try{localStorage.setItem('zzz_wheel',JSON.stringify({pool:W.pool,hist:W.hist,byElem:W.byElem,hubImg:W.hubImg}));}catch(e){}
}
function restore(){
  try{
    const s=JSON.parse(localStorage.getItem('zzz_wheel')||'{}');
    if(Array.isArray(s.pool))W.pool=s.pool;
    if(Array.isArray(s.hist))W.hist=s.hist;
    W.byElem=!!s.byElem;W.hubImg=s.hubImg||'';
  }catch(e){}
  $('opt-elem').checked=W.byElem;
  applyHubImg();renderHist();
}

document.addEventListener('keydown',e=>{
  if(e.code==='Space'&&e.target.tagName!=='INPUT'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();spin();}
  if(e.key==='Escape')closeWin();
});

fit();durLbl();load();
