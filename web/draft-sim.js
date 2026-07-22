// draft-sim.js — движок симулятора драфта: кост-ростеры, оценка силы, бот пик/бан.
// Зависит от глобалов Synergy (web/synergy.js) и Predict (web/predict.js).
// Всё чистые функции над переданными данными — состояние живёт в draft-sim.html.
(function(g){
'use strict';

// ---- кост-система ----
// costRows: [{character_id,mindscape,cost,is_allowed}] одного турнира.
// Возвращает {costOf(cid,ms), allowed:Set, minCostOf(cid), byChar}.
function buildCostSystem(costRows, limit){
  limit=limit||1605;
  const byChar={}; // cid -> {ms:{cost,allowed}}
  (costRows||[]).forEach(r=>{
    const m=byChar[r.character_id]||(byChar[r.character_id]={});
    m[r.mindscape]={cost:r.cost,allowed:r.is_allowed!==false};
  });
  // базовая (мин. майндскейп) цена персонажа
  const minCostOf=cid=>{
    const m=byChar[cid];if(!m)return null;
    const ms=Object.keys(m).map(Number).sort((a,b)=>a-b);
    for(const k of ms){const e=m[k];if(e.allowed&&e.cost>0&&e.cost<limit)return{ms:k,cost:e.cost};}
    return null;
  };
  const costOf=(cid,ms)=>{
    const m=byChar[cid];if(!m)return null;
    if(m[ms]&&m[ms].allowed&&m[ms].cost<limit)return m[ms].cost;
    const b=minCostOf(cid);return b?b.cost:null;
  };
  // доступные (не-заглушка) майндскейпы персонажа: [{ms,cost}] по возрастанию ms
  const msOptions=cid=>{
    const m=byChar[cid];if(!m)return[];
    return Object.keys(m).map(Number).sort((a,b)=>a-b)
      .filter(k=>m[k].allowed&&m[k].cost>0&&m[k].cost<limit).map(k=>({ms:k,cost:m[k].cost}));
  };
  // персонаж играбелен, если у него есть валидная базовая цена
  const allowed=new Set();
  Object.keys(byChar).forEach(cid=>{if(minCostOf(cid))allowed.add(cid);});
  return{byChar,costOf,minCostOf,msOptions,allowed,limit};
}

// ---- ценность персонажа в текущем контексте (шиюй + статистика) ----
// stats: cstats из Predict.charStats (cid->{bwr}). buffTag/rooms — shiyu_data.
// Возвращает поправку в очках винрейта поверх 0.5 (примерно [-.2..+.3]).
const BUFF_W=0.5, MOB_W=1.0;
function elemOf(cid,charMap){return((charMap[cid]&&charMap[cid].element)||'').toLowerCase();}

// доля hp мобов, уязвимых/резистящих к элементу
function mobElemBias(rooms){
  const mons=(rooms||[]).flatMap(r=>r.monsters||[]);
  const H=mons.reduce((s,m)=>s+Math.max(1,m.hp||0),0)||1;
  const weak={},res={};
  mons.forEach(m=>{const w=Math.max(1,m.hp||0)/H;
    (m.weak||[]).forEach(e=>weak[e.toLowerCase()]=(weak[e.toLowerCase()]||0)+w);
    (m.res||[]).forEach(e=>res[e.toLowerCase()]=(res[e.toLowerCase()]||0)+w);});
  return{weak,res};
}
function buffElems(buffTag){
  if(!buffTag)return[];
  return(buffTag.elems||(buffTag.elem?[buffTag.elem]:[])).map(e=>e.toLowerCase());
}
// базовый WR персонажа: статистика турнира (средне) с прайором = общая (слабо)
const baseWr=(cid,ctx)=>ctx.baseOf?ctx.baseOf(cid):((ctx.gen&&ctx.gen[cid]&&ctx.gen[cid].bwr)||0.5);
// WR с учётом майндскейпа: монотонный максимум по m<=ms из статистики (cid:m), пол = base
function msWr(cid,ms,ctx){
  const base=baseWr(cid,ctx),c=ctx.charMap[cid];
  if(c&&c.rarity==='A')return base;         // A-ранги без разреза по M
  let v=base;
  for(let m=0;m<=(ms||0);m++){const s=ctx.msStats&&ctx.msStats[cid+':'+m];
    if(s&&s.games){const val=(s.wEq+4*base)/(s.games+4);if(val>v)v=val;}}
  return v;
}
const USAGE_W=0.05;   // вклад пикрейта (частоты использования): чаще берут → надёжнее
// entry = {cid,ms}. Ценность = WR(M) + баф-элемент + матчап по мобам + пикрейт.
function charValue(entry,ctx){
  const cid=entry.cid, wr=msWr(cid,entry.ms||0,ctx), el=elemOf(cid,ctx.charMap);
  let v=wr-0.5;
  if(el){
    if(ctx.buffE.includes(el))v+=BUFF_W*0.06;                 // баф Шиюй
    v+=MOB_W*0.08*((ctx.bias.weak[el]||0)-(ctx.bias.res[el]||0)); // слабости/резисты мобов
  }
  const u=ctx.usage;                                          // частота использования
  if(u&&u.max>0)v+=USAGE_W*((u.count[cid]||0)/u.max-u.meanFrac);
  return v;
}
// ---- модель банов из истории ----
// Учит: как часто перса банят, КОГДА он доступен в ростере соперника (реальный «порог бана»).
// Это и есть ответ «с такими ростерами — что банили»: для каждого доступного бота-жертвы
// известна эмпирическая частота его бана в реальных драфтах.
// matches: [{id,encounter_id,...}], encById: id→{player1_id,player2_id,tournament_id},
// rosterOf(pid,tid) → Set(cid) — ростер игрока на турнире. bans: [{match_id,player_id,character_id}].
function buildBanModel(matches,encById,rosterOf,bans){
  const exp={},hit={};let totExp=0,totHit=0; // exp: перс был доступен к бану; hit: реально забанен
  const bump=(o,k)=>{o[k]=(o[k]||0)+1;};
  (matches||[]).forEach(m=>{
    const e=encById[m.encounter_id];if(!e)return;
    // каждый матч = 2 возможности бана (обе стороны), жертвы = ростер соперника
    [[e.player1_id,e.player2_id],[e.player2_id,e.player1_id]].forEach(([,opp])=>{
      const r=rosterOf(opp,e.tournament_id);if(!r)return;
      r.forEach(cid=>{bump(exp,cid);totExp++;});
    });
  });
  (bans||[]).forEach(b=>{bump(hit,b.character_id);totHit++;});
  // если банов перса больше, чем экспозиций (неполный ростер соперника) — добьём экспозиции, чтоб rate≤1
  Object.keys(hit).forEach(cid=>{if((hit[cid]||0)>(exp[cid]||0)){totExp+=hit[cid]-(exp[cid]||0);exp[cid]=hit[cid];}});
  const mean=totExp?totHit/totExp:0;
  const K=6; // байес-сглаживание частоты бана
  const rate=cid=>{const x=exp[cid]||0,h=hit[cid]||0;return(h+K*mean)/(x+K);};
  // угроза = отклонение сглаженной частоты бана от средней (центрировано)
  const threat=cid=>rate(cid)-mean;
  return{rate,threat,mean,exp,hit};
}
// вес истории банов в решении бота (в очках винрейта). rate ~[0..0.6], threat ~[-.18..+.42].
let BAN_HIST_W=0.6;

// контекст оценки. gen = общая статистика (cid→{games,wEq,bwr}), tour = статистика турнира.
function makeCtx(gen,tour,charMap,buffTag,rooms,msStats,banModel){
  gen=gen||{};tour=tour||{};
  const PRIOR=6;
  const genBwr=cid=>{const s=gen[cid];return(s&&s.bwr)||0.5;};
  // турнирный WR с байес-прайором = общий → турнир средне, общий слабо
  const baseOf=cid=>{const t=tour[cid],g=genBwr(cid);return t&&t.games?(t.wEq+PRIOR*g)/(t.games+PRIOR):g;};
  // пикрейт: суммарные использования (турнир+общая) на персонажа
  const count={};let max=0,sum=0,n=0;
  const add=(cid,g)=>{count[cid]=(count[cid]||0)+g;};
  for(const cid in gen)add(cid,gen[cid].games||0);
  for(const cid in tour)add(cid,(tour[cid].games||0));
  for(const cid in count){const g=count[cid];if(g>max)max=g;sum+=g;n++;}
  const usage={count,max:max||1,meanFrac:max&&n?(sum/n)/max:0};
  const banThreat=banModel?cid=>banModel.threat(cid):null;
  return{gen,tour,charMap,msStats:msStats||{},buffTag,rooms,buffE:buffElems(buffTag),bias:mobElemBias(rooms),baseOf,usage,banThreat};
}

// ---- оценка команды из 3 (в очках винрейта поверх 0.5) ----
// SYN_MULT — вес синергии состава: базовый Synergy.score.total мал (cap ±0.15) относительно
// разброса WR, из-за чего бот собирал несвязные тройки. Усиливаем, чтобы состав был когерентным.
let SYN_MULT=4;
// entries = [{cid,ms}]
// Synergy резолвит по ИМЕНАМ/тег-id, а не по DB-uuid — маппим cid→name (ctx.charMap)
const namesOf=(cids,ctx)=>cids.map(c=>ctx.charMap[c]&&ctx.charMap[c].name).filter(Boolean);
function teamScore(entries,ctx){
  const e=entries.filter(Boolean);if(!e.length)return 0;
  const names=namesOf(e.map(x=>x.cid),ctx);
  const str=e.reduce((s,x)=>s+msWr(x.cid,x.ms||0,ctx),0)/e.length-0.5;
  let syn=0,buff=0,mob=0;
  if(g.Synergy&&Synergy.ready&&names.length){
    const sc=Synergy.score(names);if(sc)syn=sc.total;
    buff=Synergy.buffMatchup(names,ctx.buffTag)||0;
    if(ctx.rooms&&ctx.rooms.length){const agg={monsters:ctx.rooms.flatMap(r=>r.monsters||[])};
      const m=Synergy.elementMatchup(names,agg);if(m)mob=m.pts;}
  }
  return str+SYN_MULT*syn+buff+mob;
}
// пул до 6 entries → лучшее разбиение на две тройки (перс гибко встаёт в любую тройку)
function poolSplit(entries,ctx){
  const e=entries.filter(Boolean);
  if(e.length<=3)return{teams:[e,[]],score:teamScore(e,ctx)};
  const n=e.length;let best=null;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)for(let k=j+1;k<n;k++){
    const t1=[e[i],e[j],e[k]],t2=e.filter((_,x)=>x!==i&&x!==j&&x!==k);
    const sc=teamScore(t1,ctx)+teamScore(t2,ctx);
    if(!best||sc>best.score)best={teams:[t1,t2],score:sc};
  }
  return best;
}
const poolScore=(entries,ctx)=>poolSplit(entries,ctx).score;
// сила стороны = лучшее разбиение сфилженного пула (6) на две тройки
function sideScore(field,ctx){return poolScore(field,ctx);}

// ---- построение ростера под кост ----
// mode: 'optimal' — жадно по ценности + апгрейд констелляций на остаток бюджета;
//       'random' — случайно (и майндскейп случайный из доступных), но валидно.
// Условия: count>=minChars, суммарный кост<=limit. Ростер = [{cid,ms}].
// майндскейп по умолчанию: A-ранг всегда максимальный доступный (M6), S-ранг — минимальный
function defaultMs(cs,ctx,cid){
  const opts=cs.msOptions(cid);if(!opts.length)return 0;
  const c=ctx.charMap[cid];
  return(c&&c.rarity==='A')?opts[opts.length-1].ms:opts[0].ms;
}
const isAcid=(ctx,cid)=>{const c=ctx.charMap[cid];return c&&c.rarity==='A';};
function buildRoster(cs,ctx,opt){
  opt=opt||{};
  const minChars=opt.minChars||17, limit=cs.limit;
  const pool=[...cs.allowed].map(cid=>{const ms=defaultMs(cs,ctx,cid),cost=cs.costOf(cid,ms);
    return{cid,ms,cost,val:charValue({cid,ms},ctx)};});
  if(pool.length<minChars)return{roster:pool.map(p=>({cid:p.cid,ms:p.ms})),cost:pool.reduce((s,p)=>s+p.cost,0),ok:false};
  const cheapest=pool.slice().sort((a,b)=>a.cost-b.cost);
  const chosen=[];const used=new Set();let cost=0;
  const remainCheap=(k,excl)=>{let s=0,n=0;for(const p of cheapest){if(used.has(p.cid)||excl===p.cid)continue;s+=p.cost;if(++n>=k)break;}return n>=k?s:Infinity;};
  let order;
  if(opt.mode==='random'){
    order=pool.slice();for(let i=order.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[order[i],order[j]]=[order[j],order[i]];}
    order.sort((a,b)=>(b.val+Math.random()*0.3)-(a.val+Math.random()*0.3));
  }else{ // optimal; jitter — лёгкий шум для вариативности ростера между запусками
    const j=opt.jitter?0.03:0;
    order=pool.slice().sort((a,b)=>(b.val+(j?Math.random()*j:0))-(a.val+(j?Math.random()*j:0)));
  }
  for(const p of order){
    if(used.has(p.cid))continue;
    const need=Math.max(0,minChars-(chosen.length+1));
    if(cost+p.cost+remainCheap(need,p.cid)>limit)continue;
    chosen.push({cid:p.cid,ms:p.ms,cost:p.cost});used.add(p.cid);cost+=p.cost;
    if(chosen.length>=minChars && opt.mode!=='random' && cost>limit*0.9)break;
  }
  for(const p of cheapest){
    if(chosen.length>=minChars)break;
    if(used.has(p.cid)||cost+p.cost>limit)continue;
    chosen.push({cid:p.cid,ms:p.ms,cost:p.cost});used.add(p.cid);cost+=p.cost;
  }
  // апгрейд констелляций: тратим остаток бюджета на прирост силы (лучший gain/costDelta)
  const upgrade=(rnd)=>{
    for(;;){
      let best=null,br=-1e9;
      for(const e of chosen){
        const opts=cs.msOptions(e.cid);
        for(const o of opts){
          if(o.ms<=e.ms)continue;const dc=o.cost-e.cost;if(dc<=0||cost+dc>limit)continue;
          const gain=charValue({cid:e.cid,ms:o.ms},ctx)-charValue({cid:e.cid,ms:e.ms},ctx);
          if(gain<=0)continue;
          const ratio=gain/dc*(rnd?(0.5+Math.random()):1);
          if(ratio>br){br=ratio;best={e,o,dc};}
        }
      }
      if(!best)break;
      best.e.ms=best.o.ms;best.e.cost=best.o.cost;cost+=best.dc;
    }
  };
  if(opt.mode!=='random'||opt.upgrade)upgrade(opt.mode==='random');
  return{roster:chosen.map(e=>({cid:e.cid,ms:e.ms})),cost,ok:chosen.length>=minChars&&cost<=limit};
}

// стоимость ростера ([{cid,ms}])
function rosterCost(roster,cs){return roster.reduce((s,e)=>s+(cs.costOf(e.cid,e.ms)||0),0);}

// ---- бот: бан и пик (работают с entries [{cid,ms}]) ----
// ban: банит наилучший для ИГРОКА вариант — ценность (статистика турнира+общая, пикрейт,
// баф/мобы) + маржинальная синергия с пулом игрока + КРИТИЧНОСТЬ для игрока.
// По умолчанию не банит доступных боту (баны глобальны — денит и себя), НО банит в себя, если
// персонаж игроку в разы важнее: единственный под половину (комнату Шиюй) / единственный саппорт
// или дд / большой разрыв в костах (его M у игрока >> у бота). И НЕ банит, если может украсть его
// сам следующим пиком (canSteal). botAvail = доступные боту; playerPool = пики игрока.
const roleOfCid=(ctx,cid)=>ctx.charMap[cid]&&ctx.charMap[cid].role;
const DD_ROLES=new Set(['atk','ano']);
// лучший пул бота (6) из доступного — что бот собирается выставить
function botBest6(botAvail,ctx){
  const pool=[];for(let i=0;i<6;i++){const av=botAvail.filter(e=>!pool.some(x=>x.cid===e.cid));
    const e=botPickPool(av,pool,ctx);if(!e)break;pool.push(e);}return pool;}
function botBan(targetAvail,ctx,botAvail,playerPool,canSteal){
  playerPool=playerPool||[];botAvail=botAvail||[];
  const botMs={};botAvail.forEach(e=>botMs[e.cid]=e.ms);
  const botCids=new Set(botAvail.map(e=>e.cid));
  // план бота (лучшие 6 с учётом синергии) — его ядро; их бот выставит, значит НЕ банит в себя.
  const plan=botBest6(botAvail,ctx);
  const planSet=new Set(plan.map(e=>e.cid));
  const base=playerPool.length?poolScore(playerPool,ctx):0;
  const playerGain=e=>charValue(e,ctx)+(baseWr(e.cid,ctx)-0.5)
    +(playerPool.length?(poolScore(playerPool.concat(e),ctx)-base):0);
  // критичность для игрока (гейт по качеству, чтобы филлеры вроде Корин не считались важными)
  const roleCnt={},pickedRole={};
  targetAvail.forEach(e=>{const r=roleOfCid(ctx,e.cid);if(r)roleCnt[r]=(roleCnt[r]||0)+1;});
  playerPool.forEach(e=>{const r=roleOfCid(ctx,e.cid);if(r)pickedRole[r]=(pickedRole[r]||0)+1;});
  const rooms=ctx.rooms||[];
  const effRoom=rooms.map(rm=>{const agg={monsters:rm.monsters||[]},set=new Set();
    targetAvail.forEach(e=>{const nn=ctx.charMap[e.cid]&&ctx.charMap[e.cid].name;
      const m=(nn&&g.Synergy&&Synergy.ready)?Synergy.elementMatchup([nn],agg):null;if(m&&m.pts>0)set.add(e.cid);});return set;});
  const halfCrit=cid=>effRoom.some(s=>s.size===1&&s.has(cid));
  const roleCrit=e=>{const r=roleOfCid(ctx,e.cid);return(r==='sup'||DD_ROLES.has(r))&&roleCnt[r]===1&&(pickedRole[r]||0)<2;};
  const constGap=e=>Math.max(0,(e.ms||0)-(botMs[e.cid]!=null?botMs[e.cid]:0));
  const quality=cid=>Math.max(0,Math.min(1,(baseWr(cid,ctx)-0.45)/0.12));
  const playerCrit=e=>quality(e.cid)*((halfCrit(e.cid)?0.4:0)+(roleCrit(e)?0.35:0)+0.06*constGap(e));
  // ущерб себе: 0 если бот его не выставит (не в ростере или излишек — банить свободно, денит игрока);
  // 1.0 если в ЯДРЕ бота (best-6) — не банить в себя, кроме disproportionate-важности игроку (playerCrit
  // до ~1.1 у экстремального линчпина перекроет). canSteal → заберёт сам.
  const selfHarm=e=>{
    if(!botCids.has(e.cid))return 0;
    if(canSteal)return 2;
    return planSet.has(e.cid)?1.0:0;
  };
  // история банов: эмпирический порог бана перса, когда он есть в ростере соперника
  const banHist=e=>ctx.banThreat?BAN_HIST_W*ctx.banThreat(e.cid):0;
  let best=null,bv=-1e9;
  targetAvail.forEach(e=>{const v=playerGain(e)+playerCrit(e)+banHist(e)-selfHarm(e);if(v>bv){bv=v;best=e.cid;}});
  return best;
}
// pick: лучший entry в ПУЛ (с учётом гибкого разбиения на две тройки) → {cid,ms}
function botPickPool(avail,pool,ctx){
  const cur=pool.filter(Boolean);let best=null,bg=-1e9;
  avail.forEach(e=>{const sc=poolScore(cur.concat(e),ctx);if(sc>bg){bg=sc;best=e;}});
  return best;
}

g.DraftSim={buildCostSystem,makeCtx,buildBanModel,charValue,teamScore,sideScore,poolSplit,poolScore,buildRoster,rosterCost,botBan,botPickPool,defaultMs,mobElemBias,buffElems,
  get synMult(){return SYN_MULT;},set synMult(v){SYN_MULT=v;},
  get banHistW(){return BAN_HIST_W;},set banHistW(v){BAN_HIST_W=v;}};
})(typeof window!=='undefined'?window:globalThis);
