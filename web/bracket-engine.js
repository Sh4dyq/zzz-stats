// bracket-engine.js — собственный движок сеток (независимо от Challonge).
// Чистые функции: generate(структура+рёбра) → seed(расстановка участников+BYE) →
// applyWinner(продвижение победителя/проигравшего по рёбрам). Работает и в браузере
// (window.BracketEngine), и в node (module.exports) для юнит-тестов генератора.
//
// Узел (node) — единая форма для генерации и рантайма:
//   { id, part:'W'|'L'|'GF', round, slot, identifier, is_bye,
//     player1_id, player2_id, seed1, seed2, winner_id,
//     next_win_node, next_win_slot, next_lose_node, next_lose_slot }
// При генерации id = строковый ключ (W-r-s); в БД id заменяется на uuid, ключи в
// рёбрах резолвятся в uuid перед вставкой (см. admin). next_*_slot ∈ {1,2}.
(function(g){
  const nextPow2=n=>{let p=1;while(p<n)p*=2;return Math.max(2,p);};
  const log2=n=>Math.round(Math.log2(n));

  // стандартный порядок сеяния (1,size,...) для сетки размера size (степень 2)
  function seedSlots(size){
    let arr=[1];
    while(arr.length<size){
      const n=arr.length*2,next=[];
      arr.forEach(s=>{next.push(s);next.push(n+1-s);});
      arr=next;
    }
    return arr;
  }

  const key=(part,r,s)=>part+'-'+r+'-'+s;
  const mk=(part,r,s)=>({id:key(part,r,s),part,round:r,slot:s,identifier:null,
    is_bye:false,player1_id:null,player2_id:null,seed1:null,seed2:null,winner_id:null,
    next_win_node:null,next_win_slot:null,next_lose_node:null,next_lose_slot:null});

  // ---- ГЕНЕРАЦИЯ СТРУКТУРЫ + РЁБЕР ----
  // SINGLE ELIMINATION. size — степень двойки (>=2).
  function genSE(size){
    const k=log2(size),nodes=[],by={};
    for(let r=1;r<=k;r++){
      const m=size/Math.pow(2,r);
      for(let s=0;s<m;s++){const n=mk('W',r,s);nodes.push(n);by[n.id]=n;}
    }
    // рёбра победителя: W r s → W r+1 floor(s/2), слот s%2+1
    for(let r=1;r<k;r++){
      const m=size/Math.pow(2,r);
      for(let s=0;s<m;s++){
        const n=by[key('W',r,s)];
        n.next_win_node=key('W',r+1,Math.floor(s/2));
        n.next_win_slot=(s%2)+1;
      }
    }
    return {nodes,by,k};
  }

  // DOUBLE ELIMINATION = верхняя (SE) + нижняя (2(k-1) раундов) + гранд-финал.
  function genDE(size){
    if(size<4) return genSE(size);                 // 2 игрока — DE вырождается в SE
    const {nodes,by,k}=genSE(size);
    const lbRounds=2*(k-1);
    // число матчей в раундах нижней сетки: c,c,c/2,c/2,...,1,1 (c=size/4)
    const cnt=[];let c=size/4;
    for(let j=1;j<=lbRounds;j++){cnt[j]=c;if(j%2===0)c=Math.max(1,c/2);}
    for(let j=1;j<=lbRounds;j++)
      for(let s=0;s<cnt[j];s++){const n=mk('L',j,s);nodes.push(n);by[n.id]=n;}
    const gf=mk('GF',1,0);nodes.push(gf);by[gf.id]=gf;

    // рёбра проигравшего из верхней сетки в нижнюю
    for(let r=1;r<=k;r++){
      const m=size/Math.pow(2,r);
      for(let s=0;s<m;s++){
        const n=by[key('W',r,s)];
        if(r===1){                                  // W R1 → оба слота LB R1
          n.next_lose_node=key('L',1,Math.floor(s/2));
          n.next_lose_slot=(s%2)+1;
        }else{                                      // W Rr (r>=2) → мажорный LB раунд 2(r-1), слот 2
          const j=2*(r-1),rev=cnt[j]-1-s;           // реверс против немедленных реваншей
          n.next_lose_node=key('L',j,rev);
          n.next_lose_slot=2;
        }
        if(r===k) n.next_win_node=gf.id,n.next_win_slot=1; // чемпион верхней → GF слот1
      }
    }
    // рёбра победителя в нижней сетке
    for(let j=1;j<=lbRounds;j++){
      for(let s=0;s<cnt[j];s++){
        const n=by[key('L',j,s)];
        if(j===lbRounds){n.next_win_node=gf.id;n.next_win_slot=2;continue;} // финал низа → GF слот2
        if(j%2===1){                                // минорный → следующий мажорный, слот1
          n.next_win_node=key('L',j+1,s);n.next_win_slot=1;
        }else{                                      // мажорный → следующий минорный, пары
          n.next_win_node=key('L',j+1,Math.floor(s/2));n.next_win_slot=(s%2)+1;
        }
      }
    }
    return {nodes,by,k};
  }

  // DE с ПЛЕЙ-ИНОМ: верхняя сетка на upper (степень 2, сеяные 1..upper), а лишние
  // участники (upper+1..N) стартуют СРАЗУ В НИЖНЕЙ и в предварительном раунде играют
  // с проигравшими верхнего R1. Так строит сетку на 12 (8 наверху + 4 внизу) сайт
  // турнира: байев нет, у стартующих снизу одна жизнь.
  // Структура = genDE(upper), у которого раунды нижней сдвинуты на +1, а раунд L1 —
  // новый: upper/2 матчей (слот1 — лишний участник, слот2 — проигравший верхнего R1).
  function genDEPlayIn(upper){
    const {nodes,k}=genDE(upper);
    const ren={};                                    // старый id → новый (сдвиг L-раундов)
    nodes.forEach(n=>{if(n.part==='L')ren[n.id]=key('L',n.round+1,n.slot);});
    nodes.forEach(n=>{
      ['next_win_node','next_lose_node'].forEach(f=>{if(n[f]&&ren[n[f]])n[f]=ren[n[f]];});
      if(n.part==='L'){n.id=ren[n.id];n.round++;}
    });
    const by={};nodes.forEach(n=>by[n.id]=n);
    const m=upper/2;                                 // матчей в плей-ине
    for(let s=0;s<m;s++){
      const n=mk('L',1,s);nodes.push(n);by[n.id]=n;
      n.next_win_node=key('L',2,Math.floor(s/2));n.next_win_slot=(s%2)+1;
    }
    // проигравший верхнего R1 → плей-ин, в обратном порядке (против ранних реваншей)
    for(let s=0;s<m;s++){
      const w=by[key('W',1,s)];
      w.next_lose_node=key('L',1,m-1-s);w.next_lose_slot=2;
    }
    return {nodes,by,k};
  }

  // план сетки по числу участников: DE с плей-ином, если лишние помещаются в него,
  // иначе обычная сетка ближайшего размера (с байями).
  function plan(type,n){
    n=Math.max(2,n|0);
    if(type!=='DE')return{size:nextPow2(n),playIn:false,extras:0};
    const u=Math.pow(2,Math.floor(Math.log2(n))),extras=n-u;
    if(u>=4&&extras>0&&extras<=u/2)return{size:u,playIn:true,extras};
    return{size:nextPow2(n),playIn:false,extras:0};
  }

  // главный вход: структура сетки по формату и размеру; присваивает identifier.
  // playIn — size трактуется как размер верхней сетки, добавляется раунд плей-ина.
  function generate(type,size,playIn){
    size=nextPow2(size);
    const {nodes}=type!=='DE'?genSE(size):(playIn&&size>=4?genDEPlayIn(size):genDE(size));
    nodes.forEach((n,i)=>n.identifier=i+1);          // сквозная нумерация встреч
    return nodes;
  }

  // сборка «под ключ» по списку участников: plan → generate → seed.
  function build(type,participants){
    const n=participants.length,p=plan(type,n);
    const nodes=generate(type,p.size,p.playIn);
    seed(nodes,participants,p.size,p.playIn);
    return nodes;
  }

  // ---- РАССТАНОВКА УЧАСТНИКОВ + BYE ----
  // participants: [{player_id, seed}] (seed 1..N). size — размер сетки (при playIn —
  // размер ВЕРХНЕЙ сетки). Заполняет первый раунд верхней по seedSlots; seed>N → BYE.
  // При playIn лишние (seed>size) садятся в плей-ин нижней, тоже по порядку сеяния.
  function seed(nodes,participants,size,playIn){
    size=nextPow2(size);
    const by={};nodes.forEach(n=>by[n.id]=n);
    const order=seedSlots(size);                     // позиции → seed
    const bySeed={};participants.forEach(p=>{if(p.seed)bySeed[p.seed]=p;});
    const r1=nodes.filter(n=>n.part==='W'&&n.round===1).sort((a,b)=>a.slot-b.slot);
    r1.forEach((n,i)=>{
      const sa=order[i*2],sb=order[i*2+1];
      const pa=bySeed[sa],pb=bySeed[sb];
      n.seed1=sa;n.seed2=sb;
      n.player1_id=pa?pa.player_id:null;
      n.player2_id=pb?pb.player_id:null;
    });
    const N=participants.length;
    if(playIn){                                      // лишние — в предварительный раунд низа
      const pre=nodes.filter(n=>n.part==='L'&&n.round===1).sort((a,b)=>a.slot-b.slot);
      const ord=seedSlots(pre.length);               // позиция матча → номер лишнего (1..)
      pre.forEach((n,i)=>{
        const sd=size+ord[i],p=bySeed[sd];
        n.seed1=sd;if(p)n.player1_id=p.player_id;
      });
      return nodes;                                  // байев в верхней при плей-ине нет
    }
    // Дропдауны R1 не переставляем: при стандартном посеве BYE (seed>N) выпадают
    // напротив реальных матчей, поэтому в матч LB R1 приходит один проигравший —
    // он ждёт проигравшего из верхнего R2 в LB R2. Так же считает Challonge.
    // резолв BYE: где одна сторона пуста (seed>N) — другая авто-проходит
    r1.forEach(n=>{
      const a=n.seed1<=N,b=n.seed2<=N;
      if(a&&!b&&n.player1_id){n.is_bye=true;applyWinner(by,n,n.player1_id);}
      else if(b&&!a&&n.player2_id){n.is_bye=true;applyWinner(by,n,n.player2_id);}
    });
    return nodes;
  }

  // ---- ПРОДВИЖЕНИЕ ----
  // Ставит winner в node и толкает победителя в next_win_node[slot], проигравшего
  // (DE) в next_lose_node[slot]. by — карта id→node. Возвращает изменённые ноды.
  // Каскадит по BYE (если целевая нода теперь готова авто-продвинуться).
  function applyWinner(by,node,winnerId){
    const changed=new Set([node]);
    node.winner_id=winnerId;
    const loserId=winnerId===node.player1_id?node.player2_id:node.player1_id;
    const put=(tid,slot,pid)=>{
      if(!tid||!pid)return;const t=by[tid];if(!t)return;
      t['player'+slot+'_id']=pid;changed.add(t);
      // авто-BYE: если у целевой ноды теперь заполнена одна сторона, а вторая —
      // фактический пропуск (помечена is_bye), продвинуть дальше.
      if(t.is_bye&&!t.winner_id&&(t.player1_id||t.player2_id))
        applyWinner(by,t,t.player1_id||t.player2_id).forEach(c=>changed.add(c));
    };
    put(node.next_win_node,node.next_win_slot,winnerId);
    put(node.next_lose_node,node.next_lose_slot,loserId);
    return [...changed];
  }

  g.BracketEngine={nextPow2,seedSlots,plan,generate,seed,build,applyWinner};
  if(typeof module!=='undefined'&&module.exports) module.exports=g.BracketEngine;
})(typeof window!=='undefined'?window:globalThis);
