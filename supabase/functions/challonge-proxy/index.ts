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
  const roundName = (r: number) => {
    if (r < 0) return `Нижняя сетка ${Math.abs(r)}`;
    if (r === maxUpper) return "Гранд-финал";
    if (r === maxUpper - 1) return "Финал";
    if (r === maxUpper - 2) return "Полуфинал";
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

  return { rounds, results, participants, source: "challonge", fetched_at: new Date().toISOString() };
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

    const synced = { cached: false, cacheError: null as string | null, results_written: 0, results_skipped_manual: 0, unmatched: [] as string[] };

    if (db_id) {
      // 1) кэш модели сетки (читается bracket.html напрямую)
      const cw = await admin.from("bracket_cache").upsert({ tournament_id: db_id, json: model, fetched_at: model.fetched_at });
      synced.cached = !cw.error;
      synced.cacheError = cw.error ? (cw.error.message || JSON.stringify(cw.error)) : null;

      // 2) синк МЕСТ в tournament_results (граница ручное/авто)
      if (model.results.length) {
        const { data: players } = await admin.from("players").select("id,nickname");
        const byNick = new Map((players ?? []).map((p: any) => [String(p.nickname).toLowerCase(), p.id]));
        const { data: existing } = await admin.from("tournament_results").select("player_id,source").eq("tournament_id", db_id);
        const srcByPlayer = new Map((existing ?? []).map((r: any) => [r.player_id, r.source]));

        for (const r of model.results) {
          const pid = byNick.get(String(r.name).toLowerCase());
          if (!pid) { synced.unmatched.push(r.name); continue; }
          if (srcByPlayer.get(pid) === "manual") { synced.results_skipped_manual++; continue; } // НЕ перетираем ручное
          const up = await admin.from("tournament_results").upsert(
            { tournament_id: db_id, player_id: pid, place: r.place, final_rank: r.place, source: "challonge", synced_at: model.fetched_at },
            { onConflict: "tournament_id,player_id" },
          );
          if (!up.error) synced.results_written++;
        }
      }
    }

    return json({ ok: true, model, sync: synced });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
