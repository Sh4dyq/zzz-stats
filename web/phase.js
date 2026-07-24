// Стадии турнира (этап 1 / этап 2) и группы — общий слой для статистики.
// Ничего нового в БД: стадии выводятся из tournaments.bracket_type («GROUPS->DE»),
// состав групп — из bracket_cache.json.groups (Challonge-синк) либо из encounters.stage.
(function(g){
  const FMT={SE:'Single Elimination',DE:'Double Elimination',RR:'Round Robin',GROUPS:'Группы',SWISS:'Swiss'};
  // короткие подписи для переключателя (в шапке место ограничено)
  const SHORT={SE:'Плейофф',DE:'Плейофф',RR:'Round Robin',GROUPS:'Группы',SWISS:'Swiss'};
  const GROUPISH=/^(GROUPS|RR|SWISS)$/;

  // Стадии турнира: [] если этап один, иначе [{key,fmt,label,full}] по порядку.
  function stagesOf(t){
    const parts=String((t&&t.bracket_type)||'').split(/\s*->\s*/).filter(Boolean);
    if(parts.length<2)return[];
    return parts.map((fmt,i)=>({key:'s'+(i+1),fmt,label:SHORT[fmt]||FMT[fmt]||fmt,full:FMT[fmt]||fmt}));
  }

  // Нормализация ника для сопоставления Challonge ↔ БД: lowercase, только буквы/цифры
  // (эмодзи, точки и пр. отбрасываем — «Sambrero🎩» и «.DmiVob.» должны матчиться).
  const normNick=s=>String(s||'').toLowerCase().replace(/[^a-zа-яё0-9]/gi,'');

  // Группы этапа: [{name, ids:Set(player_id), standings|null}].
  // cache = bracket_cache.json; nickToId = ник(lowercase) → player_id; encs — фолбэк по stage.
  function groupsOf(t,cache,nickToId,encs){
    const cg=cache&&cache.groups;
    if(cg&&cg.length){
      // индекс нормализованных ников (Challonge-имена часто отличаются от БД:
      // регистр, эмодзи, усечение «Tetsuya» vs «tetsuyabtw»). Значение — массив id:
      // в БД бывают дубли («Dmivob» и «.DmiVob.») — в группу включаем все.
      const norm={};Object.keys(nickToId||{}).forEach(n=>{const k=normNick(n);if(k)(norm[k]=norm[k]||[]).push(nickToId[n]);});
      const resolve=nm=>{
        const k=normNick(nm);if(!k)return[];
        if(norm[k])return norm[k];
        // префикс/вхождение — единственный кандидат, иначе не гадаем
        const hits=Object.keys(norm).filter(x=>x.startsWith(k)||k.startsWith(x));
        return hits.length===1?norm[hits[0]]:[];
      };
      return cg.map(gr=>{
        const st=(gr.standings||[]).map(s=>{const ids=resolve(s.name);return{nm:s.name,w:s.w||0,l:s.l||0,id:ids[0]||null,_ids:ids};});
        const ids=new Set();st.forEach(s=>s._ids.forEach(i=>ids.add(i)));
        return{name:gr.name,ids,standings:st};
      });
    }
    // фолбэк: ручные турниры — группа = стадия встречи вида «Группа X»
    const by={};
    (encs||[]).forEach(e=>{if(e.stage&&/групп|group/i.test(e.stage))(by[e.stage]=by[e.stage]||[]).push(e);});
    return Object.keys(by).sort().map(name=>{
      const ids=new Set();
      by[name].forEach(e=>{if(e.player1_id)ids.add(e.player1_id);if(e.player2_id)ids.add(e.player2_id);});
      return{name,ids,standings:null};
    });
  }

  // Группа встречи (оба игрока в одном составе) или null.
  function encGroup(enc,groups){
    if(!groups||!groups.length)return null;
    const a=enc.player1_id,b=enc.player2_id;
    if(enc.stage){const byName=groups.find(gr=>gr.name===enc.stage);if(byName)return byName.name;}
    if(!a||!b)return null;
    const gr=groups.find(x=>x.ids.has(a)&&x.ids.has(b));
    return gr?gr.name:null;
  }

  // Ключ стадии встречи: 's1' | 's2' | … Этап 1 определяем позитивно (группа/стадия-текст),
  // всё остальное — следующий этап. Для >2 этапов последний ключ = «всё после первого».
  function encStageKey(enc,t,ctx){
    const stages=stagesOf(t);
    if(stages.length<2)return's1';
    const s1=stages[0];
    if(GROUPISH.test(s1.fmt)){
      if(encGroup(enc,ctx&&ctx.groups))return's1';
      if(enc.stage&&/групп|group|round\s*robin|швейцар|swiss/i.test(enc.stage))return's1';
      return stages[1].key;
    }
    // этап 1 — сетка: относим к нему встречи с раундом из ctx.stage1Rounds
    const r=ctx&&ctx.stage1Rounds;
    if(r&&enc.stage&&r.includes(enc.stage))return's1';
    return stages[1].key;
  }

  // Стендинги группы: из кэша Challonge, иначе считаем W:L по встречам.
  function standingsFor(gr,encs,nickOf){
    if(gr.standings&&gr.standings.length)
      return gr.standings.slice().sort((a,b)=>b.w-a.w||a.l-b.l||String(a.nm).localeCompare(String(b.nm)));
    const st={};
    const seat=pid=>st[pid]||(st[pid]={pid,w:0,l:0});
    encs.forEach(e=>{
      [e.player1_id,e.player2_id].forEach(pid=>{if(pid&&gr.ids.has(pid))seat(pid);});
      if(e.winner_id&&gr.ids.has(e.winner_id)){
        const lo=e.winner_id===e.player1_id?e.player2_id:e.player1_id;
        seat(e.winner_id).w++;if(lo&&gr.ids.has(lo))seat(lo).l++;
      }
    });
    return Object.values(st).sort((a,b)=>b.w-a.w||a.l-b.l||nickOf(a.pid).localeCompare(nickOf(b.pid)))
      .map(s=>({nm:nickOf(s.pid),w:s.w,l:s.l}));
  }

  g.Phase={FMT,stagesOf,groupsOf,encGroup,encStageKey,standingsFor};
})(window);
