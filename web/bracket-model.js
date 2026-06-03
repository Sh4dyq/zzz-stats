// bracket-model.js — построение КАРКАСА сетки по формату и числу участников.
// Используется и публичной страницей (bracket.html), и админкой (редактор сетки).
// Возвращает нормализованную модель {rounds:[{name,matches:[{a,b,played}]}]},
// ту же форму, что modelFromEncounters / будущий Challonge-прокси → renderRounds общий.
(function(g){
  const NAMES={1:'Финал',2:'Полуфинал',4:'1/4 финала',8:'1/8 финала',16:'1/16 финала',32:'1/32 финала',64:'1/64 финала'};
  const nextPow2=n=>{let p=1;while(p<n)p*=2;return Math.max(2,p);};
  const roundName=m=>NAMES[m]||(m+' матчей');
  // именование раундов как на Challonge: Раунд 1, Раунд 2, … , Полуфиналы, Финал
  function nameRounds(rounds){
    const R=rounds.length;
    rounds.forEach((r,i)=>{r.name=i===R-1?'Финал':i===R-2&&R>1?'Полуфиналы':'Раунд '+(i+1);});
    return rounds;
  }

  // стандартный порядок сеяния для сетки размера size (степень двойки): [1,size,...]
  function seedSlots(size){
    let arr=[1];
    while(arr.length<size){
      const n=arr.length*2,next=[];
      arr.forEach(s=>{next.push(s);next.push(n+1-s);});
      arr=next;
    }
    return arr;
  }
  // seed (TBD-плейсхолдер либо имя из seeds[seedNo-1]); seedNo>n → BYE (null)
  function mkSeed(seedNo,n,seeds){
    if(seedNo>n) return {name:null,bye:true,seed:''};       // пустой слот (проход)
    const nm=seeds&&seeds[seedNo-1]?seeds[seedNo-1]:null;     // имени может не быть
    return {name:nm,seed:String(seedNo),win:false};
  }

  // SINGLE ELIMINATION каркас. n = число участников, seeds = опц. массив ников (по сеянию).
  function seModel(n,seeds){
    n=Math.max(2,n|0);
    const size=nextPow2(n);
    const order=seedSlots(size);
    const rounds=[];
    // раунд 1 — пары по порядку сеяния
    const r1=[];
    for(let i=0;i<size;i+=2){
      r1.push({a:mkSeed(order[i],n,seeds),b:mkSeed(order[i+1],n,seeds),played:false});
    }
    rounds.push({name:'',matches:r1});
    // последующие раунды — пустые матчи (TBD vs TBD)
    for(let m=size/4;m>=1;m/=2){
      const arr=[];for(let i=0;i<m;i++)arr.push({a:{name:null},b:{name:null},played:false});
      rounds.push({name:'',matches:arr});
    }
    nameRounds(rounds);
    return {rounds};
  }

  // DOUBLE ELIMINATION каркас: верхняя сетка (как SE) + нижняя + гранд-финал.
  function deModel(n,seeds){
    n=Math.max(2,n|0);
    const size=nextPow2(n);
    const up=seModel(n,seeds).rounds.map((r,i)=>({name:'Верхняя · '+r.name,matches:r.matches}));
    // нижняя сетка: пары раундов с числом матчей size/4,size/4, size/8,size/8, ... ,1,1
    const lower=[];let li=1;
    for(let c=size/4;c>=1;c/=2){
      for(let k=0;k<2;k++){
        const arr=[];for(let i=0;i<c;i++)arr.push({a:{name:null},b:{name:null},played:false});
        lower.push({name:'Нижняя R'+(li++),matches:arr});
      }
    }
    const gf=[{name:'Гранд-финал',matches:[{a:{name:null},b:{name:null},played:false}]}];
    return {rounds:up.concat(lower,gf)};
  }

  // главный вход: модель каркаса по формату турнира
  function skeletonModel(bracketType,n,seeds){
    if(!n||n<2) return null;
    return bracketType==='DE'?deModel(n,seeds):seModel(n,seeds);
  }

  g.BracketModel={nextPow2,roundName,seedSlots,seModel,deModel,skeletonModel};
})(typeof window!=='undefined'?window:globalThis);
