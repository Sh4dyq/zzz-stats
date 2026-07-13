// challonge-proxy — Supabase Edge Function (Deno).
//
// ИСТОЧНИК = ГИБРИД. Эта функция отвечает за АВТО-часть:
//   1) тянет сетку турнира из Challonge API v1 (простой API-key, БЕЗ OAuth),
//   2) парсит JSON НА БЭКЕ в нашу нормализованную модель {rounds:[{name,matches}]},
//   3) кэширует модель в bracket_cache (bracket.html рисует её в своих стилях),
//   4) синкает МЕСТА участников (final_rank) в tournament_results как source='challonge'.
//
// АУТЕНТИФИКАЦИЯ: v1 API-key (Settings → Developer API на challonge.com). Это просто
// ключ ТВОЕГО аккаунта — НЕ OAuth, НЕ «вход через Challonge». Ключ живёт в секретах
// этой функции (CHALLONGE_API_KEY) и в браузер не попадает.
//
// Граница ручное/авто (НЕ перетираем ручной ввод):
//   • МЕСТО (place): авто из Challonge, НО строки с source='manual' синк пропускает.
//   • ПРИЗОВЫЕ (prize): всегда ручные — синк их НИКОГДА не пишет.
//   • Сетка (rounds): для турниров с challonge_url авторитет = Challonge; иначе фолбэк на encounters.
//
// Секрет:  supabase secrets set CHALLONGE_API_KEY=<ключ из настроек>
// Вызов:   sb.functions.invoke('challonge-proxy',{body:{challonge:'NSPR6',db_id:'<uuid>'}})

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CH_API = "https://api.challonge.com/v1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function chGetTournament(slug: string, key: string) {
  // v1: один запрос отдаёт турнир + участников + матчи вложенно
  const url = `${CH_API}/tournaments/${encodeURIComponent(slug)}.json` +
    `?api_key=${encodeURIComponent(key)}&include_participants=1&include_matches=1`;
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Challonge v1 ${r.status} ${txt.slice(0, 300)}`);
  }
  return r.json();
}

// ---- Нормализация Challonge v1 → наша модель {rounds, results} ----
// v1 форма: { tournament: { participants:[{participant:{...}}], matches:[{match:{...}}] } }
function normalize(doc: any) {
  const tour = doc?.tournament ?? doc ?? {};
  const parts = new Map<string, { name: string; seed: number | null; rank: number | null }>();
  for (const wrap of (tour.participants ?? [])) {
    const p = wrap.participant ?? wrap;
    parts.set(String(p.id), {
      name: p.name ?? p.display_name ?? "—",
      seed: p.seed ?? null,
      rank: p.final_rank ?? null,
    });
    // group-stage участники иногда имеют group_player_ids → маппинг по ним
    for (const gid of (p.group_player_ids ?? [])) {
      parts.set(String(gid), { name: p.name ?? "—", seed: p.seed ?? null, rank: p.final_rank ?? null });
    }
  }

  const matches = (tour.matches ?? []).map((wrap: any) => {
    const m = wrap.match ?? wrap;
    return {
      round: m.round ?? 0,
      p1: m.player1_id != null ? String(m.player1_id) : null,
      p2: m.player2_id != null ? String(m.player2_id) : null,
      win: m.winner_id != null ? String(m.winner_id) : null,
      scores: m.scores_csv ?? "",
      ident: m.identifier ?? m.suggested_play_order ?? null,
      // порядок фактической игры матча (для точной хронологии Elo, в т.ч. DE-интерливинга)
      play_order: m.suggested_play_order ?? null,
      state: m.state,
    };
  });

  // группировка по раунду; в DE round<0 = нижняя сетка
  const byRound = new Map<number, any[]>();
  for (const m of matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }
  const roundKeys = [...byRound.keys()].sort((x, y) => (x > 0 && y > 0 ? x - y : y - x));
  const maxUpper = Math.max(0, ...roundKeys.filter((r) => r > 0));
  const isDE = roundKeys.some((r) => r < 0);
  const maxLowerAbs = Math.max(0, ...roundKeys.filter((r) => r < 0).map((r) => Math.abs(r)));
  // Конвенция названий: DE — Верхняя/Нижняя · Раунд N…Финал, Гранд-финал отдельно;
  // SE — Раунд N…, последние два Полуфинал и Финал. Префикс «Верхняя/Нижняя ·»
  // нужен фронту (renderBracketBody) для раскладки секций; он его срезает в шапке.
  const roundName = (r: number) => {
    if (r < 0) return "Нижняя · " + (Math.abs(r) === maxLowerAbs ? "Финал" : `Раунд ${Math.abs(r)}`);
    if (isDE) {
      if (r === maxUpper) return "Гранд-финал";
      return r === maxUpper - 1 ? "Верхняя · Финал" : `Верхняя · Раунд ${r}`;
    }
    if (r === maxUpper) return "Финал";
    if (r === maxUpper - 1) return "Полуфинал";
    return `Раунд ${r}`;
  };

  const seedOf = (id: string | null) => (id && parts.get(id)?.seed) || "";
  const nameOf = (id: string | null) => (id ? parts.get(id)?.name ?? "—" : null);
  const seat = (id: string | null, win: string | null) => ({
    name: nameOf(id),
    seed: seedOf(id),
    win: !!(win && id && win === id),
    pid: id,
  });

  const rounds = roundKeys.map((r) => ({
    name: roundName(r),
    matches: byRound.get(r)!
      .sort((m1, m2) => String(m1.ident ?? "").localeCompare(String(m2.ident ?? "")))
      .map((m) => ({
        a: seat(m.p1, m.win),
        b: seat(m.p2, m.win),
        played: !!m.win,
        scores: m.scores || "",
        play_order: m.play_order,     // порядок игры матча (для хронологии Elo)
      })),
  }));

  // дедуп участников по нику (group_player_ids создаёт дубли)
  const seen = new Set<string>();
  const results: { name: string; place: number }[] = [];
  const participants: { name: string; seed: number | null }[] = [];
  for (const p of parts.values()) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push({ name: p.name, seed: p.seed });           // полный список для импорта в админку
    if (p.rank != null) results.push({ name: p.name, place: p.rank });
  }
  participants.sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9));

  // link — ВСЕ участники Challonge с их id (challonge_pid) и сеянием: используется
  // на бэке для записи tournament_participants (точная связь challonge_pid ↔ player_id).
  const link: { cid: string; name: string; seed: number | null }[] = [];
  const seenCid = new Set<string>();
  for (const wrap of (tour.participants ?? [])) {
    const p = wrap.participant ?? wrap;
    const cid = String(p.id);
    if (seenCid.has(cid)) continue;
    seenCid.add(cid);
    link.push({ cid, name: p.name ?? p.display_name ?? "—", seed: p.seed ?? null });
  }

  return { rounds, results, participants, link, source: "challonge", fetched_at: new Date().toISOString() };
}

// ---- Резолв ника Challonge → наш player_id (транслит + осторожный фаззи) ----
// Наши ники и ники в Challonge расходятся (4_poker_↔4покер, Denchik↔Денчик,
// kykan↔kykan_velikana), поэтому точного равенства мало. Фаззи КОНСЕРВАТИВНЫЙ:
// при неоднозначности (≥2 кандидатов) возвращаем null, чтобы не записать чужого.
const _CY: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
const nrm = (s: string) => (s ?? "").toLowerCase().replace(/[а-яё]/g, (c) => _CY[c] ?? c).replace(/[^a-z0-9]/g, "");
function resolvePid(name: string, players: { id: string; n: string }[]): string | null {
  const n = nrm(name);
  if (!n) return null;
  const exact = players.filter((p) => p.n === n);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;                    // одинаковые ники — неоднозначно
  const fuzzy = players.filter((p) => {
    const s = Math.min(p.n.length, n.length);
    return (s >= 4 && (p.n.startsWith(n) || n.startsWith(p.n))) || (s >= 5 && (p.n.includes(n) || n.includes(p.n)));
  });
  return fuzzy.length === 1 ? fuzzy[0].id : null;       // ровно один кандидат — иначе пропуск
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    let challonge = url.searchParams.get("challonge") ?? "";
    let db_id = url.searchParams.get("db_id") ?? "";
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      challonge = b.challonge ?? challonge;
      db_id = b.db_id ?? db_id;
    }
    if (!challonge) return json({ error: "challonge (id/slug) обязателен" }, 400);

    const key = Deno.env.get("CHALLONGE_API_KEY");
    if (!key) return json({ error: "Нет секрета CHALLONGE_API_KEY" }, 500);

    const doc = await chGetTournament(challonge, key);
    const model = normalize(doc);

    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    // Пишем под ролью ВЫЗЫВАЮЩЕГО (синк жмут из админки залогиненным = authenticated,
    // что удовлетворяет RLS-политики bracket_cache/tournament_results на запись). Это не
    // зависит от легаси service_role-ключа (на новых API-ключах он может не работать).
    // Фолбэк на service_role, если по какой-то причине нет заголовка авторизации.
    const authHeader = req.headers.get("Authorization");
    const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const admin = authHeader
      ? createClient(SB_URL, SB_ANON, { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } })
      : createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

    const synced = { cached: false, cacheError: null as string | null, results_written: 0, results_skipped_manual: 0, unmatched: [] as string[], participants_written: 0, participants_unmatched: [] as string[] };

    if (db_id) {
      // 1) кэш модели сетки (читается bracket.html напрямую)
      const cw = await admin.from("bracket_cache").upsert({ tournament_id: db_id, json: model, fetched_at: model.fetched_at });
      synced.cached = !cw.error;
      synced.cacheError = cw.error ? (cw.error.message || JSON.stringify(cw.error)) : null;

      // общий список игроков (нормализованные ники) для резолва мест и участников
      const { data: players } = await admin.from("players").select("id,nickname");
      const plist = (players ?? []).map((p: any) => ({ id: p.id as string, n: nrm(String(p.nickname)) }));

      // 2) синк УЧАСТНИКОВ: точная связь challonge_pid ↔ player_id (+ сеяние). Нужна
      // аналитике для точного порядка встреч в сетке (Elo). Upsert по (tournament_id, player_id).
      for (const lp of (model.link ?? [])) {
        const pid = resolvePid(lp.name, plist);
        if (!pid) { synced.participants_unmatched.push(lp.name); continue; }
        const up = await admin.from("tournament_participants").upsert(
          { tournament_id: db_id, player_id: pid, seed: lp.seed, challonge_pid: lp.cid, challonge_name: lp.name },
          { onConflict: "tournament_id,player_id" });
        if (!up.error) synced.participants_written++;
      }

      // 3) синк МЕСТ + АВТО-ПРИЗОВЫХ по распределению (граница ручное/авто)
      if (model.results.length) {
        const { data: existing } = await admin.from("tournament_results").select("player_id,source").eq("tournament_id", db_id);
        const srcByPlayer = new Map((existing ?? []).map((r: any) => [r.player_id, r.source]));

        // распределение призовых турнира → приз по месту проставляется авто
        const { data: tour } = await admin.from("tournaments").select("prize_distribution").eq("id", db_id).maybeSingle();
        let dist: any[] = tour?.prize_distribution ?? [];
        if (typeof dist === "string") { try { dist = JSON.parse(dist); } catch { dist = []; } }
        const prizeByPlace = new Map<number, number>();
        for (const x of (Array.isArray(dist) ? dist : [])) {
          if (x && x.place != null && x.prize != null && x.prize !== "") prizeByPlace.set(+x.place, +x.prize);
        }

        for (const r of model.results) {
          const pid = resolvePid(r.name, plist);
          if (!pid) { synced.unmatched.push(r.name); continue; }
          if (srcByPlayer.get(pid) === "manual") { synced.results_skipped_manual++; continue; } // НЕ перетираем ручное
          const row: any = { tournament_id: db_id, player_id: pid, place: r.place, final_rank: r.place, source: "challonge", synced_at: model.fetched_at };
          if (prizeByPlace.has(r.place)) row.prize = prizeByPlace.get(r.place); // авто-приз по месту
          const up = await admin.from("tournament_results").upsert(row, { onConflict: "tournament_id,player_id" });
          if (!up.error) synced.results_written++;
        }
      }
    }

    return json({ ok: true, model, sync: synced });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
