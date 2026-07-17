// Squad synergy scorer (порт tools/synergy_model.py). Аналитика: поправка в очках
// винрейта. Данные: web/data/synergy_tags.json + characters_synergy.json.
(function(g){
'use strict';
let TAGS=null, SYN=null, NAME2ID={};
const MAX=4.0;

// short DB names -> our full tag names (characters table uses short forms)
const ALIAS={Nicole:'Nicole Demara',Lycaon:'Von Lycaon',Lucy:'Luciana de Montefio',
 Astra:'Astra Yao',Alice:'Alice Thymefield',Burnice:'Burnice White',Vivian:'Vivian Banshee',
 Evelyn:'Evelyn Chevalier',Ellen:'Ellen Joe',Rina:'Alexandrina Sebastiane',
 Yuzuha:'Ukinami Yuzuha',Orphie:'Orphie Magnusson & Magus',Caesar:'Caesar King',
 Yidhari:'Yidhari Murphy',Miyabi:'Hoshimi Miyabi',Pulchra:'Pulchra Fellini',
 'S Anby':'Soldier 0 - Anby',Yanagi:'Tsukishiro Yanagi',Grace:'Grace Howard',
 Koleda:'Koleda Belobog',Seth:'Seth Lowell',Lucia:'Lucia Elowen',
 'S Billy':'Starlight - Billy',Harumasa:'Asaba Harumasa',Nekomata:'Nekomiya Mana',
 Manato:'Komano Manato',Anby:'Anby Demara',Billy:'Billy Kid'};

const REWARD=new Set(['ether_veil','aftershock','abloom','anomaly_assist','decibel','def_shred','pen_buff']);
const SOFT=new Set(['atk_buff','dmg_buff','crit_buff','anomaly_buff','sheer_dmg_buff','amp_on_stun']);
const SOFT_W=0.4;
const tagW=t=>REWARD.has(t)?1.0:(SOFT.has(t)?SOFT_W:0.0);

const MAIN=['crit_dps','sheer_dps','main_anomaly'];
const DMG=MAIN.concat(['sub_dps','sub_anomaly']);
const PREMIUM_SUPPORT=new Set(['Ukinami Yuzuha','Lucia Elowen','Astra Yao','Sunna','Nicole Demara']);

const CAP=0.15;
const W={scale:0.012,crit_conflict:-0.05,sheer_conflict:-0.08,anomaly_conflict:-0.012,
 premium_support:0.01,hugo_extra_stun:0.015};

// element matchup layer (Shiyu)
const ELEM_W={main:1.0,sub:0.85,stunner:0.4,anom_support:0.1};
const MATCHUP_CAP=0.10;

const roleOf=(id,r)=>((TAGS[id].roles||{})[r]||0);
const giveOf=(id,t)=>((TAGS[id].gives||{})[t]||0);

function rid(x){ // accept tag id, full name or short/DB name
  if(TAGS[x])return x;
  const n=ALIAS[x]||x;
  return NAME2ID[n]!=null?NAME2ID[n]:null;
}
const isDmg=id=>Math.max(...DMG.map(k=>roleOf(id,k)),0)>=2;

function gateActive(id,team){
  const me=SYN[id],gt=me&&me.trigger;if(!gt)return false;
  for(const o of team){ if(o===id)continue; const oo=SYN[o];if(!oo)continue;
    if(gt.faction&&oo.faction&&oo.faction===me.faction)return true;
    if(gt.attribute&&oo.element&&oo.element===me.element)return true;
    if(gt.spec&&gt.spec.length&&gt.spec.includes(oo.specialty))return true;
    if(gt.elem&&gt.elem.length&&gt.elem.includes(oo.element))return true;
  } return false;
}
function pairFit(a,b){
  let s=0;
  for(const[x,y]of[[a,b],[b,a]]){
    const needs=TAGS[y].needs||{};
    for(const t in needs) s+=tagW(t)*Math.min(giveOf(x,t),needs[t]);
  } return s/MAX;
}
function committed(id,role){
  const r=TAGS[id].roles||{};
  if((r[role]||0)<3||(r.off_field||0)>=3)return false;
  return Math.max(r.sub_dps||0,r.sub_anomaly||0,r.support||0)<2;
}
function anomWeight(id){
  const r=TAGS[id].roles||{};
  if((r.main_anomaly||0)<3)return 0;
  const flex=(r.off_field||0)>=3||Math.max(r.sub_dps||0,r.sub_anomaly||0,r.support||0)>=2;
  return flex?0.5:1.0;
}

// score a team of ids/names -> winrate-point correction + parts
function score(members){
  const team=members.map(rid).filter(Boolean);
  if(!team.length)return null;
  const names=team.map(c=>TAGS[c].name);
  let pairSum=0;const pd=[];
  for(let i=0;i<team.length;i++)for(let j=i+1;j<team.length;j++){
    const a=team[i],b=team[j];
    if(!(isDmg(a)||isDmg(b)))continue;
    const pf=pairFit(a,b);
    if(pf){pairSum+=pf;pd.push([TAGS[a].name,TAGS[b].name,+pf.toFixed(2)]);}
  }
  const pair=W.scale*pairSum;
  let aa=0;team.forEach(c=>{if(gateActive(c,team))aa+=(TAGS[c].passive_use||0)/MAX;});
  aa*=W.scale;
  const critC=team.filter(c=>committed(c,'crit_dps'));
  const sheerC=team.filter(c=>committed(c,'sheer_dps'));
  const anomW=team.reduce((s,c)=>s+anomWeight(c),0);
  const cores=new Set([...critC,...sheerC,...team.filter(c=>anomWeight(c))]);
  let conflict;
  if(sheerC.length&&cores.size>=2){
    conflict=W.sheer_conflict*(cores.size-1);
  }else{
    conflict=W.crit_conflict*Math.max(0,critC.length-1);
    if(!names.includes('Hoshimi Miyabi'))conflict+=W.anomaly_conflict*Math.max(0,anomW-1);
  }
  const prem=W.premium_support*Math.min(2,names.filter(n=>PREMIUM_SUPPORT.has(n)).length);
  let hugo=0;
  if(names.includes('Hugo Vlad')){
    const st=team.filter(c=>roleOf(c,'stunner')>=3).length;
    hugo=W.hugo_extra_stun*Math.max(0,st-1);
  }
  let total=pair+aa+conflict+prem+hugo;
  total=Math.max(-CAP,Math.min(CAP,total));
  return{members:names,total:+total.toFixed(3),
    parts:{pair:+pair.toFixed(3),aa:+aa.toFixed(3),conflict:+conflict.toFixed(3),
           premium:+prem.toFixed(3),hugo:+hugo.toFixed(3)},pair_detail:pd};
}

// best team-of-3 among the selected members (draft side holds up to 6)
function bestTeam(members){
  const ids=members.map(rid).filter(Boolean);
  if(ids.length<=3)return score(ids);
  let best=null;
  for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)for(let k=j+1;k<ids.length;k++){
    const r=score([ids[i],ids[j],ids[k]]);
    if(r&&(!best||r.total>best.total))best=r;
  } return best;
}

// split a draft side (up to 6) into its two halves of 3. Drafts play 6v6 as two
// teams, so we pick the 3+3 partition that maximises total synergy and return
// both halves. <6 selected -> a single best team (or whatever is there).
function splitSide(members){
  const ids=members.map(rid).filter(Boolean);
  if(ids.length<3){const s=score(ids);return{scores:s?[s]:[],total:s?s.total:0};}
  if(ids.length<6){const s=bestTeam(ids);return{scores:s?[s]:[],total:s?s.total:0};}
  const six=ids.slice(0,6);let best=null;
  for(let i=1;i<6;i++)for(let j=i+1;j<6;j++){
    const t1=[six[0],six[i],six[j]],t2=six.filter(x=>!t1.includes(x));
    const s1=score(t1),s2=score(t2),tot=(s1?s1.total:0)+(s2?s2.total:0);
    if(!best||tot>best.total)best={scores:[s1,s2],total:+tot.toFixed(3)};
  } return best;
}

// --- Shiyu element matchup (enemy vuln/res, hp-weighted) ---
function anomSupport(id){
  const r=TAGS[id].roles||{},gv=TAGS[id].gives||{};
  return Math.max(r.support||0,r.off_field||0)>=2 &&
    ((r.sub_anomaly||0)>=1||['anomaly_assist','anomaly_buff','abloom'].some(t=>(gv[t]||0)>=1));
}
function elementWeight(id){
  const r=TAGS[id].roles||{};
  if(Math.max(...MAIN.map(k=>r[k]||0))>=3)return ELEM_W.main;
  if(Math.max(r.sub_dps||0,r.sub_anomaly||0)>=2)return ELEM_W.sub;
  if((r.stunner||0)>=3)return ELEM_W.stunner;
  if(anomSupport(id))return ELEM_W.anom_support;
  return 0;
}
// room = {monsters:[{hp,weak:[],res:[]}], weakness:[]}
function elementMatchup(members,room){
  const team=members.map(rid).filter(Boolean);
  const prof={};
  team.forEach(c=>{const w=elementWeight(c);if(!w)return;
    const el=((SYN[c]&&SYN[c].element)||TAGS[c].element||'').toLowerCase();
    if(el)prof[el]=(prof[el]||0)+w;});
  const total=Object.values(prof).reduce((a,b)=>a+b,0);
  if(!total)return{pts:0,detail:null};
  const mons=room.monsters||[];const hps=mons.map(m=>Math.max(1,m.hp||0));
  const H=hps.reduce((a,b)=>a+b,0)||1;
  const weakW={},resW={};
  mons.forEach((m,i)=>{const w=hps[i]/H;
    (m.weak||[]).forEach(e=>weakW[e.toLowerCase()]=(weakW[e.toLowerCase()]||0)+w);
    (m.res||[]).forEach(e=>resW[e.toLowerCase()]=(resW[e.toLowerCase()]||0)+w);});
  let raw=0;for(const e in prof)raw+=(prof[e]/total)*((weakW[e]||0)-(resW[e]||0));
  const pts=Math.max(-MATCHUP_CAP,Math.min(MATCHUP_CAP,MATCHUP_CAP*raw));
  return{pts:+pts.toFixed(3),detail:{profile:prof,weakW,resW,raw:+raw.toFixed(2)}};
}
// --- Shiyu frontier buff fit ---
// Баф ротации бустит команды по элементу и/или архетипу (sheer/anomaly/stun/crit).
// Возвращает бонус [0..BUFF_CAP]·strength (всегда ≥0 — в предикте берётся как разница A−B,
// значит важно лишь относительное попадание в баф). Считается ОТДЕЛЬНО от enemy weak/res.
const BUFF_CAP=0.10;
function mechMatch(id,mech){
  const r=TAGS[id].roles||{},gv=TAGS[id].gives||{};
  if(mech==='sheer')return(r.sheer_dps||0)>=2;
  if(mech==='anomaly')return(r.main_anomaly||0)>=2||(r.sub_anomaly||0)>=1||
    ['anomaly_assist','anomaly_buff','abloom'].some(t=>(gv[t]||0)>=1);
  if(mech==='stun')return(r.stunner||0)>=2;
  if(mech==='crit')return(r.crit_dps||0)>=2;
  return false;
}
// баф Шиюй как «виртуальный тиммейт»: ценность = Σ по эффектам tagW·mag·gate·need.
// - mag: сила эффекта, уже нормирована по семейному диапазону при парсинге (parseBuffTag).
// - gate (кому применимо): element-DMG проходит через долю отряда в баф-элементах (dmg_buff —
//   частично универсален: RES-shred/DMG-taken помогают всем → пол 0.5); sheer/anomaly-бафы — через
//   долю архетипа; pen/def/atk — универсальны (=1); crit — пол 0.5 + доля крит-дпс.
// - need: 0.5 + 0.5·доля дпс-членов, у кого тег в needs (баф, закрывающий дыру, ценнее дубля).
function buffMatchup(members,tag){
  if(!tag)return 0;
  const elems=tag.elems||(tag.elem?[tag.elem]:[]);
  if(!elems.length&&!tag.mech&&!(tag.effects&&tag.effects.length))return 0;
  const team=members.map(rid).filter(Boolean);
  const prof={};let total=0;const mechW={sheer:0,anomaly:0,stun:0,crit:0};
  team.forEach(c=>{const w=elementWeight(c);if(!w)return;total+=w;
    const el=((SYN[c]&&SYN[c].element)||TAGS[c].element||'').toLowerCase();
    if(el)prof[el]=(prof[el]||0)+w;
    ['sheer','anomaly','stun','crit'].forEach(m=>{if(mechMatch(c,m))mechW[m]+=w;});});
  if(!total)return 0;
  const elemFit=elems.reduce((s,e)=>s+(prof[e]||0),0)/total; // доля урона в баф-элементах
  // фолбэк: старый тег без effects → чистое попадание elem/mech
  if(!tag.effects||!tag.effects.length){
    let raw=elemFit;if(tag.mech)raw+=mechW[tag.mech]/total;
    return +(BUFF_CAP*Math.min(1,raw)*(tag.strength||1)).toFixed(3);
  }
  // доли отряда по типу скейла урона (для гейтов по формуле урона ZZZ)
  const sheerFrac=mechW.sheer/total, critFrac=mechW.crit/total, anomFrac=mechW.anomaly/total;
  const dmg=team.filter(isDmg);
  const needFrac=t=>dmg.length?dmg.filter(c=>((TAGS[c].needs||{})[t]||0)>0).length/dmg.length:0;
  let val=0;
  tag.effects.forEach(e=>{
    // нужды элемент/кнопка-DMG берём от базового dmg_buff
    const needTag=(e.tag==='dmg_buff_elem'||e.tag==='dmg_buff_skill')?'dmg_buff':e.tag;
    const base=tagW(needTag)||0.3, mag=e.mag||0.5;
    // gate = доля отряда, кому эффект реально помогает (по мультипликаторам формулы):
    let gate=1;
    if(e.tag==='dmg_buff_elem')gate=elemFit;                 // RES/элемент-DMG: только урон баф-элемента
    else if(e.tag==='dmg_buff')gate=1;                       // универс. DMG-Bonus/RES-shred — всем (в т.ч. шир)
    else if(e.tag==='dmg_buff_skill')gate=0.5;               // по кнопке: заглушка (нужна раскладка урона per-char)
    else if(e.tag==='sheer_dmg_buff')gate=sheerFrac;
    else if(e.tag==='anomaly_buff')gate=anomFrac;            // AP/аномалия-DMG: только аномальный урон
    else if(e.tag==='crit_buff')gate=critFrac;               // CRIT-множитель ≈1 у аномалы/шир → 0
    else if(e.tag==='pen_buff'||e.tag==='def_shred')gate=1-sheerFrac; // шир игнорит DEF → PEN/DEF-shred бесполезны
    // atk_buff, прочее → gate=1 (ATK кормит все формулы: стандарт/аномалия/шир)
    const need=0.5+0.5*needFrac(needTag);
    val+=base*mag*gate*need;
  });
  return +Math.min(BUFF_CAP,BUFF_CAP*val).toFixed(3);
}
// best team-of-3 matchup vs a set of rooms (aggregated): returns best team's pts
function bestMatchup(members,rooms){
  if(!rooms||!rooms.length)return null;
  const agg={monsters:rooms.flatMap(r=>r.monsters||[])};
  const ids=members.map(rid).filter(Boolean);
  if(ids.length<=3)return elementMatchup(ids,agg).pts;
  let best=null;
  for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)for(let k=j+1;k<ids.length;k++){
    const p=elementMatchup([ids[i],ids[j],ids[k]],agg).pts;
    if(best==null||Math.abs(p)>Math.abs(best))best=p;
  } return best;
}

// pre — необязательный уже загруженный объект тегов (напр. из Supabase synergy_tags).
// Без него берём статический web/data/synergy_tags.json (фолбэк/офлайн).
async function load(pre){
  if(TAGS)return;
  const sP=fetch('web/data/characters_synergy.json').then(r=>r.json());
  const t=pre||await fetch('web/data/synergy_tags.json').then(r=>r.json());
  const s=await sP;
  TAGS=t;SYN=s.agents||s;
  NAME2ID={};for(const id in TAGS)NAME2ID[TAGS[id].name]=id;
}

g.Synergy={load,score,bestTeam,splitSide,elementMatchup,bestMatchup,buffMatchup,rid:x=>rid(x),
  get ready(){return !!TAGS;},get tags(){return TAGS;}};
})(typeof window!=='undefined'?window:globalThis);
