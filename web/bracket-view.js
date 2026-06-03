// bracket-view.js — общий визуальный рендер сетки в стиле публичной bracket.html:
// раунды с вертикальным центрированием по фидерам + SVG-коннекторы со статус-ромбами.
// Используется админкой (редактор своей сетки); тот же визуал, что у зрителей.
// Модель: {rounds:[{name,matches:[{id,node,feeders:[id..],a,b,played}]}]},
// где a/b = {name,seed,win,pid,bye}. node = uuid узла (для кликов в админке).
(function(g){
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // bracket_nodes → модель. nickOf(pid)→ник. Имена раундов совместимы с renderBracketBody.
  function nodesToModel(nodes,nickOf){
    if(!nodes||!nodes.length)return null;
    const feeders={};nodes.forEach(n=>{[n.next_win_node,n.next_lose_node].forEach(tid=>{if(tid)(feeders[tid]=feeders[tid]||[]).push(n.identifier);});});
    const groups={};nodes.forEach(n=>{const k=n.part+'|'+n.round;(groups[k]=groups[k]||[]).push(n);});
    const ord={W:0,L:1,GF:2};
    const keys=Object.keys(groups).sort((a,b)=>{const[pa,ra]=a.split('|'),[pb,rb]=b.split('|');return ord[pa]-ord[pb]||(+ra-+rb);});
    const seat=(n,w)=>{const pid=n['player'+w+'_id'];return{
      name:pid?(nickOf(pid)||'—'):null,bye:!pid&&n.is_bye,seed:n['seed'+w]||'',
      win:!!(n.winner_id&&n.winner_id===pid),pid:pid||''};};
    const rounds=keys.map(k=>{
      const[part,round]=k.split('|');
      const ms=groups[k].sort((a,b)=>a.slot-b.slot);
      const name=part==='GF'?'Гранд-финал':part==='L'?('Нижняя '+round):('Верхняя '+round);
      return{name,matches:ms.map(n=>({id:n.identifier,node:n.id,feeders:feeders[n.id]||[],a:seat(n,1),b:seat(n,2),played:!!n.winner_id}))};
    });
    return{rounds};
  }

  // ---- раскладка (копия геометрии публичной страницы) ----
  const MATCH_H=50,ROW_GAP=20,UNIT=MATCH_H+ROW_GAP;
  function layoutRounds(rounds){
    let gid=0;rounds.forEach(r=>r.matches.forEach(m=>{if(m.id==null)m.id=++gid;}));
    const byId={};rounds.forEach(r=>r.matches.forEach(m=>byId[m.id]=m));
    const hasFeeders=rounds.some(r=>r.matches.some(m=>(m.feeders||[]).length));
    if(hasFeeders){
      rounds.forEach((r,ri)=>r.matches.forEach((m,i)=>{
        const fd=(m.feeders||[]).map(id=>byId[id]).filter(x=>x&&x._top!=null);
        m._top=(ri>0&&fd.length)?fd.reduce((s,f)=>s+f._top,0)/fd.length:i*UNIT;}));
    }else{
      const base=rounds[0].matches.length||1,totalH=base*UNIT;
      rounds.forEach(r=>{const n=r.matches.length||1,span=totalH/n;
        r.matches.forEach((m,i)=>{m._top=span*(i+0.5)-MATCH_H/2;});});
    }
    return Math.max(MATCH_H,...rounds.flatMap(r=>r.matches.map(m=>m._top+MATCH_H)));
  }
  function seedHTML(s,played,r1,slot){
    if(s&&s.bye)return`<div class="seed tbd" data-slot="${slot}"><span class="sd"></span><span class="av" style="border:none"></span><span class="nm" style="color:#44444c">BYE</span><span class="sc"></span></div>`;
    if(!s||!s.name)return`<div class="seed tbd" data-slot="${slot}"><span class="sd">${s&&s.seed||''}</span><span class="av"></span><span class="nm">TBD</span><span class="sc"></span></div>`;
    const cls=s.win?'win':(played&&s.name!=='—'?'lose':'');
    const init=(s.name||'?').replace(/[^A-Za-zА-Яа-я0-9$]/g,'').slice(0,2).toUpperCase()||'—';
    const sl=(s.name||'').trim().toLowerCase();
    // data-pid/-slot (+ drag в 1-м раунде) — для кликов «победитель» и смены посева в админке
    const drag=r1&&s.pid?' bv-drag':'';
    return`<div class="seed ${cls}${drag}" data-pid="${esc(s.pid||'')}" data-slot="${slot}"${drag?` draggable="true" data-seed="${s.seed}"`:''}>
      <span class="sd">${s.seed||''}</span>
      <span class="av"><img src="web/players/${esc(sl)}.webp" alt="" onerror="this.remove()">${init}</span>
      <span class="nm">${esc(s.name)}</span>
      <span class="sc">${s.win?'✓':''}</span></div>`;
  }
  function matchHTML(m,r1){
    const id=m.id;
    return`<div class="match ${m.played?'played':''}" data-id="${id}" data-node="${esc(m.node||'')}" data-feeders="${(m.feeders||[]).join(',')}" style="top:${Math.round(m._top)}px">
      ${id?`<span class="m-id">${id}</span>`:''}
      ${seedHTML(m.a,m.played,r1,1)}${seedHTML(m.b,m.played,r1,2)}</div>`;
  }
  function renderRounds(rounds){
    const h=layoutRounds(rounds);
    return`<div class="bracket">`+rounds.map((r,ri)=>`
      <div class="bround">
        <div class="bround-h">${esc(r.name)}</div>
        <div class="bcol" style="height:${Math.ceil(h)}px">${r.matches.map(m=>matchHTML(m,ri===0)).join('')}</div>
      </div>`).join('')+`</div>`;
  }
  function renderBracketBody(rounds,bracketType=''){
    const isLower=n=>/нижн|lower|loser/i.test(n||''),isGf=n=>/гранд|grand|finale/i.test(n||'');
    const hasDE=rounds.some(r=>isLower(r.name)||isGf(r.name));
    if(!hasDE)return renderRounds(rounds);
    const strip=arr=>arr.map(r=>({...r,name:(r.name||'').replace(/^(верхняя|нижняя)\s*·?\s*/i,'').trim()||r.name}));
    const lower=strip(rounds.filter(r=>isLower(r.name)));
    if(!lower.length)return renderRounds(strip(rounds));
    const gf=strip(rounds.filter(r=>isGf(r.name)));
    const upper=strip(rounds.filter(r=>!isLower(r.name)&&!isGf(r.name)));
    let left='';
    if(upper.length)left+=`<div class="bsec-title upper">Верхняя сетка</div>${renderRounds(upper)}`;
    if(lower.length)left+=`<div class="bsec-title lower">Нижняя сетка</div>${renderRounds(lower)}`;
    if(!gf.length)return left;
    const gm=gf[0].matches[0]||{a:{},b:{},played:false};gm._top=0;if(gm.id==null)gm.id='';
    const gfHtml=`<div class="de-gf"><div class="bround-h gf-hdr">Гранд-финал</div><div class="gf-body">${matchHTML(gm)}</div></div>`;
    return`<div class="de-grid"><div class="de-left">${left}</div>${gfHtml}</div>`;
  }

  // ---- коннекторы (копия оверлея публичной страницы; вызывается вручную) ----
  const NS='http://www.w3.org/2000/svg';
  const rc=(el,base)=>{const r=el.getBoundingClientRect();return{l:r.left-base.left,r:r.right-base.left,cy:(r.top+r.bottom)/2-base.top};};
  const mstate=m=>m.classList.contains('played')?'done':(m.querySelector('.seed.tbd')?'future':'live');
  function diamond(x,y,st){const s=6.5,p=document.createElementNS(NS,'path');
    p.setAttribute('d',`M${x} ${y-s}L${x+s} ${y}L${x} ${y+s}L${x-s} ${y}Z`);p.setAttribute('class','node '+st);return p;}
  function tagRounds(rounds){rounds.forEach(r=>{const h=r.querySelector('.bround-h'),t=((h&&h.textContent)||'').trim().toLowerCase();
    r.classList.remove('br-lower','br-gf');if(/нижн|lower|loser/.test(t))r.classList.add('br-lower');
    else if(/гранд|grand|finale/.test(t)||t==='финал')r.classList.add('br-gf');});}
  function paintOne(br){
    br.querySelectorAll(':scope > svg.bconn').forEach(s=>s.remove());
    const rounds=[...br.querySelectorAll(':scope > .bround')];if(!rounds.length)return;
    tagRounds(rounds);
    const base=br.getBoundingClientRect();
    const svg=document.createElementNS(NS,'svg');svg.setAttribute('class','bconn');
    const mcol=r=>[...(r.querySelector('.bcol')||r).querySelectorAll(':scope > .match')];
    const mr=rounds.map(mcol),lastIdx=rounds.length-1,all=mr.flat(),byId={};
    all.forEach(m=>byId[m.dataset.id]=m);
    const hasFeeders=all.some(m=>m.dataset.feeders);
    const link=(f,m)=>{const a=rc(f,base),b=rc(m,base),midx=a.r+(b.l-a.r)/2,p=document.createElementNS(NS,'path');
      p.setAttribute('d',`M${a.r} ${a.cy}H${midx}V${b.cy}H${b.l}`);
      p.setAttribute('class','link'+(mstate(f)==='future'?' dim':''));svg.appendChild(p);};
    if(hasFeeders){
      const parent=new Set();
      all.forEach(m=>{(m.dataset.feeders||'').split(',').filter(Boolean).forEach(fid=>{const f=byId[fid];if(!f)return;parent.add(fid);link(f,m);});});
      all.forEach(m=>{const a=rc(m,base),st=mstate(m);
        if((m.dataset.feeders||'').split(',').filter(Boolean).length)svg.appendChild(diamond(a.l,a.cy,st));
        if(parent.has(m.dataset.id))svg.appendChild(diamond(a.r,a.cy,st));});
    }else{
      for(let ri=0;ri<lastIdx;ri++){const cur=mr[ri],nxt=mr[ri+1];if(!cur.length||!nxt.length)continue;
        cur.forEach((m,i)=>{let ti;if(nxt.length===cur.length)ti=i;else if(nxt.length===Math.ceil(cur.length/2))ti=Math.floor(i/2);
          else ti=Math.min(nxt.length-1,Math.floor(i*nxt.length/cur.length));const tgt=nxt[ti];if(tgt)link(m,tgt);});}
      mr.forEach((arr,ri)=>arr.forEach(m=>{const a=rc(m,base),st=mstate(m);
        if(ri<lastIdx)svg.appendChild(diamond(a.r,a.cy,st));if(ri>0)svg.appendChild(diamond(a.l,a.cy,st));}));
    }
    br.prepend(svg);
  }
  function lastMatch(br){const rs=br?[...br.querySelectorAll('.bround')]:[];return rs.length?[...rs[rs.length-1].querySelectorAll('.match')].pop():null;}
  function bracketAfter(title){let el=title&&title.nextElementSibling;while(el&&!(el.classList&&el.classList.contains('bracket')))el=el.nextElementSibling;return el;}
  function linkGrandFinal(wrap){
    wrap.querySelectorAll(':scope > svg.gflink').forEach(s=>s.remove());
    const gfM=wrap.querySelector('.de-gf .match'),upF=lastMatch(bracketAfter(wrap.querySelector('.bsec-title.upper'))),loF=lastMatch(bracketAfter(wrap.querySelector('.bsec-title.lower')));
    if(!gfM||!upF||!loF)return;
    const base=wrap.getBoundingClientRect();
    const off=el=>{const r=el.getBoundingClientRect();return{l:r.left-base.left+wrap.scrollLeft,r:r.right-base.left+wrap.scrollLeft,cy:(r.top+r.bottom)/2-base.top+wrap.scrollTop};};
    const u=off(upF),l=off(loF),gg=off(gfM),busX=gg.l-30;
    const svg=document.createElementNS(NS,'svg');svg.setAttribute('class','bconn gflink');
    svg.style.width=wrap.scrollWidth+'px';svg.style.height=wrap.scrollHeight+'px';
    const path=(d,dim)=>{const p=document.createElementNS(NS,'path');p.setAttribute('d',d);p.setAttribute('class','link'+(dim?' dim':''));svg.appendChild(p);};
    path(`M${u.r} ${u.cy}H${busX}`,mstate(upF)==='future');path(`M${l.r} ${l.cy}H${busX}`,mstate(loF)==='future');
    path(`M${busX} ${u.cy}V${l.cy}`,mstate(upF)==='future'&&mstate(loF)==='future');path(`M${busX} ${gg.cy}H${gg.l}`,mstate(gfM)==='future');
    svg.appendChild(diamond(u.r,u.cy,mstate(upF)));svg.appendChild(diamond(l.r,l.cy,mstate(loF)));svg.appendChild(diamond(gg.l,gg.cy,mstate(gfM)));
    wrap.appendChild(svg);
  }
  function paint(root){const sc=root||document;sc.querySelectorAll('.bracket').forEach(paintOne);sc.querySelectorAll('.bracket-wrap').forEach(linkGrandFinal);}

  // CSS сетки (копия публичной) + фолбэки переменных, которых нет в админке.
  function injectCSS(){
    if(document.getElementById('bv-css'))return;
    const st=document.createElement('style');st.id='bv-css';
    st.textContent=`
    .bracket-wrap{--line:#26262c;--panel-2:#161618;--panel-3:#1d1d22;--red:#ff1f44;--win:#46d369;--purple:#a970ff;--gold:#f5c842;position:relative;overflow:auto;padding:26px 28px 40px}
    .de-grid{display:flex;align-items:stretch;gap:90px;min-width:min-content}
    .de-gf{display:flex;flex-direction:column;min-width:206px;flex-shrink:0;margin-top:44px}
    .de-gf .gf-hdr{position:relative;color:var(--gold);border-color:rgba(245,200,66,.3)}
    .de-gf .gf-hdr::before{content:"";position:absolute;right:100%;width:90px;bottom:0;border-top:1px solid var(--line)}
    .de-gf .gf-body{flex:1;display:flex;align-items:center;justify-content:center}
    .de-gf .gf-body .match{position:relative;top:auto!important;left:auto;right:auto;width:206px;border-color:rgba(245,200,66,.28)}
    .bsec-title{font-weight:800;font-style:italic;text-transform:uppercase;font-size:15px;letter-spacing:.05em;color:var(--sub);margin:6px 0 14px;display:flex;align-items:center;gap:10px}
    .bsec-title::after{content:"";flex:1;height:1px;background:var(--border)}
    .bsec-title.upper{color:#ff7587}.bsec-title.lower{color:var(--purple)}
    .bracket{display:flex;gap:48px;align-items:flex-start;min-width:min-content;padding-bottom:8px;position:relative}
    .bround{display:flex;flex-direction:column;min-width:206px}
    .bcol{position:relative;width:100%}
    .bround-h{font-weight:800;font-style:italic;text-transform:uppercase;font-size:13px;letter-spacing:.05em;color:var(--sub);padding:0 0 9px;margin-bottom:6px;text-align:center;border-bottom:1px solid var(--line)}
    .match{position:absolute;left:0;right:0;z-index:1;background:linear-gradient(180deg,#1d1d22,#161618 70%);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .15s,box-shadow .15s}
    .match .m-id{position:absolute;left:-23px;top:50%;transform:translateY(-50%);font-family:monospace;font-size:10px;font-weight:600;color:#4d4d55;width:20px;text-align:center;pointer-events:none}
    .match:hover{border-color:#43434d;box-shadow:0 6px 20px -8px rgba(0,0,0,.7);z-index:2}
    .match .seed{position:relative;display:flex;align-items:center;gap:8px;padding:0 10px;min-height:23px;cursor:pointer}
    .match .seed.tbd{cursor:default}
    .match .seed+.seed{border-top:1px solid var(--line)}
    .seed .sd{font-family:monospace;font-size:9px;color:#7a7a85;width:18px;flex-shrink:0;text-align:center;align-self:stretch;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.03);border-right:1px solid var(--line);margin:0 3px 0 -10px}
    .seed.win .sd{color:#fff;background:rgba(255,31,68,.12)}
    .seed .av{width:19px;height:19px;border-radius:5px;background:#1d1d22;display:flex;align-items:center;justify-content:center;font-style:italic;font-size:9px;font-weight:900;color:var(--sub);flex-shrink:0;overflow:hidden}
    .seed .av img{width:100%;height:100%;object-fit:cover;display:block}
    .seed .nm{font-weight:600;font-size:12.5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c9c9d0}
    .seed .sc{font-family:monospace;font-weight:600;font-size:12px;color:var(--sub);min-width:16px;text-align:right}
    .seed:hover:not(.tbd){background:rgba(255,255,255,.04)}
    .seed.win{background:linear-gradient(90deg,rgba(255,31,68,.09),rgba(236,24,98,0) 62%)}
    .seed.win .nm{color:#fff;font-weight:700}.seed.win .av{color:#fff}
    .seed.win::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--grad)}
    .seed.win .sc{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;min-width:19px;border-radius:50%;background:rgba(70,211,105,.16);color:var(--win);font-size:13px;font-weight:700;line-height:1}
    .seed.lose .nm{color:#6d6d76}.seed.lose .sc{color:#5a5a62}.seed.lose .av{opacity:.55}
    .seed.tbd .nm{color:#4d4d55;font-style:italic;font-weight:500}.seed.tbd .av{background:transparent;border:1px dashed #34343b}
    .seed.bv-drag{cursor:grab}.seed.bv-over{outline:2px solid var(--accent);outline-offset:-2px}
    .match.played{border-color:#2f2f37;box-shadow:0 0 0 1px rgba(255,31,68,.10),0 4px 16px -10px rgba(255,31,68,.25)}
    .match.bv-sel{border-color:var(--accent)!important;box-shadow:0 0 0 1px var(--accent)}
    svg.bconn{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;overflow:visible}
    svg.bconn path.link{fill:none;stroke:#43434e;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
    svg.bconn path.link.dim{stroke:#2a2a31}
    svg.bconn .node{stroke-width:1.6}
    svg.bconn .node.done{fill:#e9e9ee;stroke:#e9e9ee}
    svg.bconn .node.future{fill:var(--bg);stroke:#ff1f44}
    svg.bconn .node.live{fill:#ff1f44;stroke:#ff8094;filter:drop-shadow(0 0 5px rgba(255,31,68,.85))}
    .bround.br-lower .bround-h{color:var(--purple);border-color:rgba(169,112,255,.25)}
    .bround.br-gf .bround-h{color:var(--gold);border-color:rgba(245,200,66,.3)}
    .bround.br-gf .match,.bround.br-gf .match{border-color:rgba(245,200,66,.28)}`;
    document.head.appendChild(st);
  }

  g.BracketView={nodesToModel,renderBracketBody,renderRounds,paint,injectCSS,esc};
})(typeof window!=='undefined'?window:globalThis);
