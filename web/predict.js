// predict.js — вероятности побед: Elo игроков, драфт vs драфт, Монте-Карло турнира.
(function(g){
  const ELO_START=1000, ELO_K=40;
  const pElo=(ra,rb)=>1/(1+Math.pow(10,(rb-ra)/400));

  // Elo по играм в хронологии: турниры по created_at → встречи по orderMap/sort_order → игры по match_number.
  function buildRatings(tournaments,encounters,matchesByEnc,orderMap){
    const ord=orderMap||{};
    const key=e=>ord[e.id]!=null?ord[e.id]:(e.sort_order!=null?e.sort_order:1e9);
    const tOrd={};(tournaments||[]).slice()
      .sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0))
      .forEach((t,i)=>tOrd[t.id]=i);
    const encs=(encounters||[]).slice().sort((a,b)=>
      (tOrd[a.tournament_id]??999)-(tOrd[b.tournament_id]??999)||
      (key(a)-key(b))||String(a.id).localeCompare(String(b.id)));
    const R={},G={};
    const get=id=>R[id]??ELO_START;
    encs.forEach(e=>{
      const p1=e.player1_id,p2=e.player2_id;if(!p1||!p2)return;
      const ms=((matchesByEnc&&matchesByEnc[e.id])||[]).slice().sort((a,b)=>(a.match_number||0)-(b.match_number||0));
      const games=ms.length?ms:(e.winner_id?[{winner_id:e.winner_id}]:[]);
      games.forEach(m=>{
        if(!m.winner_id&&!m.is_draw)return;
        const s1=m.is_draw?0.5:(m.winner_id===p1?1:0);
        const ra=get(p1),rb=get(p2),ex=pElo(ra,rb);
        R[p1]=ra+ELO_K*(s1-ex);R[p2]=rb+ELO_K*((1-s1)-(1-ex));
        G[p1]=(G[p1]||0)+1;G[p2]=(G[p2]||0)+1;
      });
    });
    return{ratings:R,games:G,get};
  }

  // личные встречи p1 vs p2 по играм: {w,d,l} с точки зрения p1
  function headToHead(p1,p2,encounters,matchesByEnc){
    const r={w:0,d:0,l:0};
    (encounters||[]).forEach(e=>{
      const has=(e.player1_id===p1&&e.player2_id===p2)||(e.player1_id===p2&&e.player2_id===p1);
      if(!has)return;
      const ms=(matchesByEnc&&matchesByEnc[e.id])||[];
      const games=ms.length?ms:(e.winner_id?[{winner_id:e.winner_id}]:[]);
      games.forEach(m=>{
        if(m.is_draw)r.d++;
        else if(m.winner_id===p1)r.w++;
        else if(m.winner_id===p2)r.l++;
      });
    });
    return r;
  }

  // --- драфт vs драфт ---
  const PRIOR_N=6;
  const bayes=(wEq,n)=>(wEq+PRIOR_N*0.5)/((n||0)+PRIOR_N);

  // статистика персонажей по пикам: cid → {games,wEq,bwr}
  function charStats(picks,matchMap){
    const st={};
    (picks||[]).forEach(pk=>{
      const m=matchMap[pk.match_id];if(!m)return;
      if(!m.winner_id&&!m.is_draw)return;
      const s=st[pk.character_id]||(st[pk.character_id]={games:0,wEq:0});
      s.games++;s.wEq+=m.is_draw?0.5:(m.winner_id===pk.player_id?1:0);
    });
    Object.values(st).forEach(s=>s.bwr=bayes(s.wEq,s.games));
    return st;
  }

  // сила драфта = средний байес-винрейт персонажей; шанс — log5
  function draftWinProb(cidsA,cidsB,stats){
    const side=cids=>{
      const v=cids.filter(Boolean).map(c=>(stats[c]&&stats[c].bwr)||0.5);
      return v.length?v.reduce((a,b)=>a+b,0)/v.length:0.5;
    };
    const a=side(cidsA),b=side(cidsB);
    const num=a*(1-b),den=num+b*(1-a);
    return{p:den>0?num/den:0.5,sa:a,sb:b};
  }

  // --- Монте-Карло: своя сетка (bracket_nodes) → pid → {champ,final} ---
  const pairKey=(a,b)=>String(a)<String(b)?a+'|'+b:b+'|'+a;
  // forced: {pairKey: winnerId} — фиксированный победитель пары (ручной выбор в конструкторе)
  function simulateBracket(nodes,ratings,iters,forced){
    iters=iters||5000;
    const ordP={W:0,L:1,GF:2};
    const order=nodes.slice().sort((a,b)=>(ordP[a.part]??3)-(ordP[b.part]??3)||a.round-b.round||a.slot-b.slot);
    const finalNode=order[order.length-1];
    const res={},fin={};
    const get=id=>ratings[id]??ELO_START;
    for(let it=0;it<iters;it++){
      const p1={},p2={},win={};
      order.forEach(n=>{p1[n.id]=n.player1_id;p2[n.id]=n.player2_id;win[n.id]=n.winner_id;});
      order.forEach(n=>{
        let a=p1[n.id],b=p2[n.id],w=win[n.id];
        if(!w){
          if(a&&b){const f=forced&&forced[pairKey(a,b)];w=f!=null?f:(Math.random()<pElo(get(a),get(b))?a:b);}
          else if(n.is_bye)w=a||b;
          if(!w)return;
          win[n.id]=w;
        }
        const l=w===a?b:a;
        if(n.next_win_node&&w){if(n.next_win_slot===1)p1[n.next_win_node]=w;else p2[n.next_win_node]=w;}
        if(n.next_lose_node&&l){if(n.next_lose_slot===1)p1[n.next_lose_node]=l;else p2[n.next_lose_node]=l;}
      });
      const c=win[finalNode.id];
      if(c)res[c]=(res[c]||0)+1;
      [p1[finalNode.id],p2[finalNode.id]].forEach(p=>{if(p)fin[p]=(fin[p]||0)+1;});
    }
    const out={};
    const add=(pid,k,v)=>{(out[pid]=out[pid]||{champ:0,final:0})[k]=v;};
    Object.keys(res).forEach(p=>add(p,'champ',res[p]/iters));
    Object.keys(fin).forEach(p=>add(p,'final',fin[p]/iters));
    return out;
  }

  // --- Монте-Карло: SE/DE без своей сетки (приближение по выбыванию, жеребьёвка по раундам) ---
  function simulateElimination(players,losses,type,ratings,iters){
    iters=iters||5000;
    const de=type==='DE';
    const get=id=>ratings[id]??ELO_START;
    const res={},fin={};
    const bump=(o,p)=>{if(p)o[p]=(o[p]||0)+1;};
    const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];}return a;};
    const play=(a,b)=>Math.random()<pElo(get(a),get(b))?a:b;
    // раунд: пары по жребию, победители дальше, нечётный — bye
    const round=(arr,losersOut)=>{
      const next=[];shuffle(arr);
      for(let i=0;i+1<arr.length;i+=2){const w=play(arr[i],arr[i+1]);next.push(w);if(losersOut)losersOut.push(w===arr[i]?arr[i+1]:arr[i]);}
      if(arr.length%2)next.push(arr[arr.length-1]);
      return next;
    };
    const alive0=players.filter(p=>(losses[p]||0)===0);
    const alive1=de?players.filter(p=>(losses[p]||0)===1):[];
    if(alive0.length+alive1.length===0)return{};
    for(let it=0;it<iters;it++){
      if(!de){
        let a=alive0.slice();
        if(a.length===1){bump(res,a[0]);bump(fin,a[0]);continue;}
        while(a.length>2)a=round(a);
        bump(fin,a[0]);bump(fin,a[1]);
        bump(res,a.length===2?play(a[0],a[1]):a[0]);
      }else{
        let up=alive0.slice(),lo=alive1.slice(),guard=64;
        while(guard--){
          if(up.length>1){const drop=[];up=round(up,drop);lo=lo.concat(drop);}
          if(lo.length>Math.max(1,up.length))lo=round(lo);
          if(up.length<=1&&lo.length<=1)break;
        }
        const a=up[0],b=lo[0];
        if(a&&b){bump(fin,a);bump(fin,b);bump(res,play(a,b));}
        else{const w=a||b;bump(fin,w);bump(res,w);}
      }
    }
    const out={};
    const add=(pid,k,v)=>{(out[pid]=out[pid]||{champ:0,final:0})[k]=v;};
    Object.keys(res).forEach(p=>add(p,'champ',res[p]/iters));
    Object.keys(fin).forEach(p=>add(p,'final',fin[p]/iters));
    return out;
  }

  // --- Монте-Карло: группа / round robin (один круг) → pid → {expPlace, placeP:[...]} ---
  function simulateRoundRobin(players,encounters,ratings,iters){
    iters=iters||5000;
    const n=players.length;if(n<2)return{};
    const idx={};players.forEach((p,i)=>idx[p]=i);
    const get=id=>ratings[id]??ELO_START;
    const basePts=new Array(n).fill(0);
    const pending=[]; // [ia,ib,pA]
    const seen=new Set();
    (encounters||[]).forEach(e=>{
      const a=idx[e.player1_id],b=idx[e.player2_id];
      if(a==null||b==null)return;
      seen.add(Math.min(a,b)+'-'+Math.max(a,b));
      if(e.winner_id&&idx[e.winner_id]!=null)basePts[idx[e.winner_id]]++;
      else pending.push([a,b,pElo(get(e.player1_id),get(e.player2_id))]);
    });
    for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)
      if(!seen.has(a+'-'+b))pending.push([a,b,pElo(get(players[a]),get(players[b]))]);
    const placeCnt=players.map(()=>new Array(n).fill(0));
    const pts=new Array(n),ord=players.map((_,i)=>i);
    for(let it=0;it<iters;it++){
      for(let i=0;i<n;i++)pts[i]=basePts[i];
      pending.forEach(([a,b,p])=>{if(Math.random()<p)pts[a]++;else pts[b]++;});
      const tie=ord.map(()=>Math.random()); // тайбрейк — жребий

      ord.sort((x,y)=>pts[y]-pts[x]||tie[x]-tie[y]);
      ord.forEach((pi,place)=>placeCnt[pi][place]++);
    }
    const out={};
    players.forEach((pid,i)=>{
      const pp=placeCnt[i].map(c=>c/iters);
      out[pid]={placeP:pp,expPlace:pp.reduce((s,p,k)=>s+p*(k+1),0)};
    });
    return out;
  }

  g.Predict={ELO_START,pElo,pairKey,buildRatings,headToHead,charStats,draftWinProb,simulateBracket,simulateRoundRobin,simulateElimination,bayes};
  if(typeof module!=='undefined'&&module.exports)module.exports=g.Predict;
})(typeof window!=='undefined'?window:globalThis);
