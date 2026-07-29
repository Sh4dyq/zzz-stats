// roster-matchup.js — СРАВНИТЕЛЬНАЯ сила ростеров: не «кто сильнее вообще», а кто сильнее
// ПРОТИВ КОНКРЕТНОГО соперника. Один и тот же ростер может быть отличным против одного
// соперника и беспомощным против другого: важны пересечение ростеров (общего героя заберёт
// тот, чей пик раньше), уязвимость к банам (узкий сильный ростер выбивается тремя банами)
// и покрытие комнат Шиюй.
//
// Метод: прогоняем настоящую последовательность драфта (те же 18 шагов, что в draft-sim)
// ботом за обе стороны и сравниваем силу получившихся составов. Решения пика/бана берём
// из боевого движка DraftSim (botPickPool/botBan) — второй реализации правил нет.
(function(g){
  // порядок шагов Nexus: по 3 бана и 6 пиков у каждой стороны (fp — первый пик)
  const CANON=[
    ['ban','fp'],['ban','sp'],['ban','sp'],['ban','fp'],
    ['pick','fp'],['pick','sp'],['pick','sp'],['pick','fp'],['pick','fp'],['pick','sp'],
    ['pick','sp'],['pick','fp'],
    ['ban','fp'],['ban','sp'],
    ['pick','sp'],['pick','fp'],['pick','fp'],['pick','sp']
  ];

  // один прогон драфта: rosters {a:[{cid,ms}], b:[…]}, fp — кто пикает первым ('a'|'b')
  function runDraft(rosters,ctx,fp){
    const other=s=>s==='a'?'b':'a';
    const sp=other(fp);
    const used=new Set(),picked={a:[],b:[]};
    const seq=CANON.map(([type,role])=>({type,side:role==='fp'?fp:sp}));
    const avail=(side,type)=>(rosters[type==='ban'?other(side):side]||[]).filter(e=>!used.has(e.cid));
    seq.forEach((st,i)=>{
      if(st.type==='ban'){
        const tgt=avail(st.side,'ban');if(!tgt.length)return;
        // сможет ли банящий украсть цель своим пиком раньше соперника
        const nextOwn=seq.findIndex((s,k)=>k>i&&s.type==='pick'&&s.side===st.side);
        const nextOpp=seq.findIndex((s,k)=>k>i&&s.type==='pick'&&s.side!==st.side);
        const canSteal=nextOwn>=0&&(nextOpp<0||nextOwn<nextOpp);
        const cid=DraftSim.botBan(tgt,ctx,avail(st.side,'pick'),picked[other(st.side)],canSteal);
        if(cid)used.add(cid);
      }else{
        const av=avail(st.side,'pick');if(!av.length)return;
        const oppCids=new Set(avail(other(st.side),'pick').map(e=>e.cid));
        const nextOwn=seq.findIndex((s,k)=>k>i&&s.type==='pick'&&s.side===st.side);
        const nextOpp=seq.findIndex((s,k)=>k>i&&s.type==='pick'&&s.side!==st.side);
        const picksLeft=seq.filter((s,k)=>k>=i&&s.type==='pick'&&s.side===st.side).length;
        const e=DraftSim.botPickPool(av,picked[st.side],ctx,
          {atRisk:nextOpp>=0&&(nextOwn<0||nextOpp<nextOwn),playerCids:oppCids,picksLeft});
        if(e){used.add(e.cid);picked[st.side].push(e);}
      }
    });
    return{a:picked.a,b:picked.b,sa:DraftSim.sideScore(picked.a,ctx),sb:DraftSim.sideScore(picked.b,ctx)};
  }

  // Сравнение ростеров A и B. Бот детерминирован → достаточно двух прогонов (кто первый пик).
  // adv > 0 — ростер A выгоднее ПРОТИВ B. Возвращает и разбивку по праву первого пика.
  function compare(rosterA,rosterB,ctx){
    if(!rosterA||!rosterB||rosterA.length<3||rosterB.length<3)return null;
    const R={a:rosterA,b:rosterB};
    const fa=runDraft(R,ctx,'a'),fb=runDraft(R,ctx,'b');
    const adv=((fa.sa-fa.sb)+(fb.sa-fb.sb))/2;
    return{adv,fpA:fa.sa-fa.sb,fpB:fb.sa-fb.sb,
      sa:(fa.sa+fb.sa)/2,sb:(fa.sb+fb.sb)/2,teamsA:fa.a,teamsB:fa.b};
  }

  // Вклад в вероятность победы A в лог-оддсах.
  // Вес откалиброван прекуэнциально на 328 играх (164 встречи, 5 турниров с ростерами)
  // поверх Elo+личных встреч: оптимум W≈0.35, но выигрыш микроскопический
  // (log-loss 0.64636→0.64599). Сырой сигнал ~нулевой: у кого ростер лучше, тот берёт 50%
  // игр (контроль — по разнице Elo 78.9%, т.е. тест рабочий). Абсолютная сила ростера
  // предсказывает ЕЩЁ хуже (0.64636→0.64887 при W=0.35) — сравнение лучше абсолюта.
  // Ростеры для калибровки собраны авто из пиков; после загрузки ЗАЯВЛЕННЫХ ростеров
  // (до игр, полным составом) калибровку имеет смысл повторить.
  let ROSTER_W=0.35;
  const setWeight=w=>{ROSTER_W=w;};
  const delta=cmp=>cmp?ROSTER_W*cmp.adv:0;

  g.RosterMatchup={CANON,runDraft,compare,delta,setWeight,get weight(){return ROSTER_W;}};
  if(typeof module!=='undefined'&&module.exports)module.exports=g.RosterMatchup;
})(typeof window!=='undefined'?window:globalThis);
