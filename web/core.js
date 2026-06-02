// core.js — Supabase client, global state, auth, navigation, shared utils

const SB_URL='https://zoavnckfbfiejxfjakue.supabase.co';
const SB_KEY='sb_publishable_37RZBsmdp3O1i795EuEfeg_vFpdPTFZ';
const sb=supabase.createClient(SB_URL,SB_KEY);

let D={tours:[],chars:[],players:[],sigs:[]};

// --- AUTH ---
async function signIn(){
  const{error}=await sb.auth.signInWithPassword({email:v('a-email'),password:v('a-pass')});
  if(error)authMsg(error.message,'err');
}
async function signUp(){
  const{error}=await sb.auth.signUp({email:v('a-email'),password:v('a-pass')});
  if(error)authMsg(error.message,'err');
  else authMsg('Проверь почту для подтверждения!','ok');
}
async function signOut(){await sb.auth.signOut();location.reload();}
function authMsg(t,type){const el=document.getElementById('auth-msg');el.className='alert alert-'+(type==='err'?'err':'ok');el.textContent=t;}

sb.auth.onAuthStateChange((_,session)=>{
  if(session){
    const wasActive=document.getElementById('admin-area').style.display==='flex';
    document.getElementById('login-screen').style.display='none';
    document.getElementById('admin-area').style.display='flex';
    document.getElementById('sidebar').style.display='flex';
    document.getElementById('user-email').textContent=session.user.email;
    if(!wasActive){
      const saved=localStorage.getItem('zzz_page')||'dashboard';
      go(saved);
    }
  }else{
    document.getElementById('login-screen').style.display='flex';
    document.getElementById('admin-area').style.display='none';
    document.getElementById('sidebar').style.display='none';
  }
});

// --- NAV ---
document.querySelectorAll('.nav-a[data-page]').forEach(a=>{
  a.onclick=()=>{document.querySelectorAll('.nav-a').forEach(x=>x.classList.remove('on'));a.classList.add('on');go(a.dataset.page);};
});

async function go(page){
  localStorage.setItem('zzz_page',page);
  document.querySelectorAll('.nav-a[data-page]').forEach(a=>a.classList.toggle('on',a.dataset.page===page));
  document.getElementById('page-title').textContent={dashboard:'Дашборд',tournaments:'Турниры',characters:'Персонажи',signatures:'Амплификаторы',players:'Игроки',matches:'Матчи'}[page]||page;
  await refreshData();
  const fn={dashboard:pgDashboard,tournaments:pgTournaments,characters:pgCharacters,signatures:pgSignatures,players:pgPlayers,matches:pgMatches}[page];
  if(fn)await fn();
}

async function refreshData(){
  const[{data:t},{data:c},{data:p},{data:s}]=await Promise.all([
    sb.from('tournaments').select('*').order('created_at',{ascending:false}),
    sb.from('characters').select('*').order('name'),
    sb.from('players').select('*').order('nickname'),
    sb.from('signatures').select('*').order('name')
  ]);
  // ручной порядок (sort_order) поверх дефолтной сортировки; строки без него — в конец, стабильно.
  const byOrder=arr=>(arr||[]).slice().sort((a,b)=>(a.sort_order??1e9)-(b.sort_order??1e9));
  D.tours=byOrder(t);D.chars=c||[];D.players=byOrder(p);D.sigs=s||[];
}

// Drag-and-drop ручная сортировка списка в админке. listEl — контейнер с детьми
// [draggable="true"][data-id]; при дропе пишет sort_order=индекс в таблицу и перерисовывает.
// Колонка sort_order добавляется миграцией sql/add_sort_order.sql.
let _dragId=null;
function enableReorder(listEl,table,onSaved){
  if(!listEl)return;
  [...listEl.querySelectorAll('[draggable="true"]')].forEach(row=>{
    row.addEventListener('dragstart',e=>{_dragId=row.dataset.id;e.dataTransfer.effectAllowed='move';row.style.opacity='.4';});
    row.addEventListener('dragend',()=>{row.style.opacity='';row.style.outline='';});
    row.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';if(row.dataset.id!==_dragId)row.style.outline='2px solid var(--accent)';});
    row.addEventListener('dragleave',()=>{row.style.outline='';});
    row.addEventListener('drop',async e=>{
      e.preventDefault();row.style.outline='';
      const targetId=row.dataset.id;
      if(!_dragId||_dragId===targetId)return;
      const ids=[...listEl.querySelectorAll('[draggable="true"]')].map(r=>r.dataset.id);
      const from=ids.indexOf(_dragId),to=ids.indexOf(targetId);
      if(from<0||to<0)return;
      ids.splice(to,0,ids.splice(from,1)[0]);
      const res=await Promise.all(ids.map((id,i)=>sb.from(table).update({sort_order:i}).eq('id',id)));
      const bad=res.find(r=>r.error);
      if(bad){dbErr(bad.error,'сохранение порядка');return;}
      await refreshData();toast('Порядок сохранён');if(onSaved)onSaved();
    });
  });
}

// --- UTILS ---
const v=id=>document.getElementById(id)?.value?.trim()||'';
const vn=id=>+document.getElementById(id)?.value||null;
const html=s=>document.getElementById('page-content').innerHTML=s;
function toast(msg,type='ok'){
  const el=document.createElement('div');
  el.className='alert alert-'+(type==='err'?'err':'ok');el.textContent=msg;
  el.style.cssText='position:fixed;bottom:20px;right:20px;z-index:999;min-width:220px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),6000);
}
function dbErr(error,context){
  if(error){
    console.error('[Supabase]',context,error);
    toast(`Ошибка — ${context}: ${error.message}`,'err');
    return true;
  }
  return false;
}
// Загрузка картинки в Supabase Storage (бакет icons), upsert. Возвращает public URL
// с cache-busting ?v=… (имя файла фиксированное, поэтому без версии браузер кэширует старое).
// Требует логина (RLS на storage.objects); у dev-превью записи нет.
async function uploadStorageImage(file,path){
  const{error}=await sb.storage.from('icons').upload(path,file,{upsert:true,contentType:file.type||'image/webp'});
  if(dbErr(error,'загрузка изображения'))return null;
  const{data}=sb.storage.from('icons').getPublicUrl(path);
  return data.publicUrl+'?v='+Date.now();
}

function sel(id,arr,valF,labelF,blank=''){
  return`<select id="${id}"><option value="">${blank||'— выбери —'}</option>${arr.map(x=>`<option value="${valF(x)}">${labelF(x)}</option>`).join('')}</select>`;
}
const msOpts=Array.from({length:7},(_,i)=>`<option value="${i}">M${i}</option>`).join('');

// --- DASHBOARD ---
async function pgDashboard(){
  html(`<div class="grid3" style="margin-bottom:20px">
    <div class="card"><div style="font-size:12px;color:var(--sub)">Турниры</div><div style="font-size:28px;font-weight:700;color:var(--accent);margin-top:4px">${D.tours.length}</div></div>
    <div class="card"><div style="font-size:12px;color:var(--sub)">Персонажи</div><div style="font-size:28px;font-weight:700;color:var(--accent);margin-top:4px">${D.chars.length}</div></div>
    <div class="card"><div style="font-size:12px;color:var(--sub)">Игроки</div><div style="font-size:28px;font-weight:700;color:var(--accent);margin-top:4px">${D.players.length}</div></div>
  </div>
  <div class="card" id="auth-diag" style="margin-bottom:16px"><div style="font-size:12px;color:var(--sub)">Статус авторизации</div><div style="margin-top:6px"><span class="spinner"></span></div></div>
  <p style="color:var(--sub);font-size:14px">Используй меню слева. Порядок заполнения: Персонажи → Амплификаторы → Игроки → Турниры (+ косты + ростеры) → Матчи.</p>`);
  const{data:{user}}=await sb.auth.getUser();
  const{data:{session}}=await sb.auth.getSession();
  const role=session?.user?.role||user?.role||'—';
  const ok=role==='authenticated';
  const confirmed=user?.email_confirmed_at||user?.confirmed_at;
  const diag=document.getElementById('auth-diag');
  if(diag)diag.innerHTML=`<div style="font-size:12px;color:var(--sub)">Статус авторизации</div>
    <div style="margin-top:6px;font-size:14px">
      <div>Email: <b>${user?.email||'нет'}</b></div>
      <div>Роль: <b style="color:${ok?'#4ade80':'#f87171'}">${role}</b> ${ok?'✓ запись разрешена':'✕ запись через RLS будет заблокирована'}</div>
      <div>Email подтверждён: <b style="color:${confirmed?'#4ade80':'#f87171'}">${confirmed?'да':'нет'}</b></div>
    </div>`;
}

sb.auth.getSession();
