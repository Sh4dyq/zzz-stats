// challonge-proxy — Supabase Edge Function (Deno).
//
// ИСТОЧНИК = ГИБРИД. Эта функция отвечает за АВТО-часть:
//   1) тянет сетку активного турнира из Challonge API v2.1 (OAuth2 + JSON:API),
//   2) парсит JSON НА БЭКЕ в нашу нормализованную модель {rounds:[{name,matches}]},
//   3) кэширует модель в bracket_cache (bracket.html рисует её в своих стилях),
//   4) синкает МЕСТА участников (final_rank) в tournament_results как source='challonge'.
//
// Граница ручное/авто (НЕ перетираем ручной ввод):
//   • МЕСТО (place): авто из Challonge, НО строки с source='manual' синк пропускает.
//   • ПРИЗОВЫЕ (prize): всегда ручные — синк их НИКОГДА не пишет.
//   • Сетка (rounds): для турниров с challonge_url авторитет = Challonge; иначе фолбэк на encounters.
//
// Почему v2.1 (а не v1): выбрано в плане (OAuth2/JSON:API). Ключ Challonge нельзя светить в
// статике, поэтому токен живёт в секретах этой функции, а не в браузере.
//
// Секреты (supabase secrets set ...):
//   CHALLONGE_ACCESS_TOKEN     — OAuth2 access token (минимально достаточно).
//   CHALLONGE_REFRESH_TOKEN    — (опц.) refresh token для авто-обновления.
//   CHALLONGE_CLIENT_ID        — (опц., с refresh) client id приложения.
//   CHALLONGE_CLIENT_SECRET    — (опц., с refresh) client secret.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — автоматически доступны в Edge Runtime.
//
// Вызов из админки:  sb.functions.invoke('challonge-proxy',{body:{challonge:'NSPR6',db_id:'<uuid>'}})

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CH_API = "https://api.challonge.com/v2.1";
const CH_OAUTH = "https://api.challonge.com/oauth/token";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---- OAuth: статический токен, при наличии refresh — пробуем обновить ----
async function accessToken(): Promise<string> {
  const refresh = Deno.env.get("CHALLONGE_REFRESH_TOKEN");
  const cid = Deno.env.get("CHALLONGE_CLIENT_ID");
  const secret = Deno.env.get("CHALLONGE_CLIENT_SECRET");
  if (refresh && cid && secret) {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: cid,
        client_secret: secret,
      });
      const r = await fetch(CH_OAUTH, { method: "POST", body });
      if (r.ok) {
        const j = await r.json();
        if (j.access_token) return j.access_token as string;
      }
    } catch (_) { /* падаем на статический токен ниже */ }
  }
  const tok = Deno.env.get("CHALLONGE_ACCESS_TOKEN");
  if (!tok) throw new Error("Нет CHALLONGE_ACCESS_TOKEN (и refresh-флоу не настроен)");
  return tok;
}

async function chGet(path: string, token: string) {
  const r = await fetch(`${CH_API}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/vnd.api+json",
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Challonge ${path} → ${r.status} ${txt.slice(0, 300)}`);
  }
  return r.json();
}

// JSON:API helpers — достаём id связи защитно (формы relationships варьируются).
const relId = (rel: any) => rel?.data?.id ?? rel?.data ?? null;

// ---- Нормализация Challonge → наша модель {rounds, results} ----
function normalize(participantsDoc: any, matchesDoc: any) {
  const parts = new Map<string, { name: string; seed: number | null; rank: number | null }>();
  for (const p of (participantsDoc?.data ?? [])) {
    const a = p.attributes ?? {};
    parts.set(String(p.id), {
      name: a.name ?? a.display_name ?? "—",
      seed: a.seed ?? null,
      rank: a.final_rank ?? a.finalRank ?? null,
    });
  }

  const matches = (matchesDoc?.data ?? []).map((m: any) => {
    const a = m.attributes ?? {};
    const rel = m.relationships ?? {};
    const p1 = relId(rel.player1) ?? a.player1_id ?? a.player1Id;
    const p2 = relId(rel.player2) ?? a.player2_id ?? a.player2Id;
    const win = relId(rel.winner) ?? a.winner_id ?? a.winnerId;
    const round = a.round ?? a.roundNumber ?? 0;
    const scores = a.scores ?? a.scores_csv ?? a.scoresCsv ?? "";
    const ident = a.identifier ?? a.suggested_play_order ?? a.suggestedPlayOrder ?? null;
    return { round, p1: p1 ? String(p1) : null, p2: p2 ? String(p2) : null, win: win ? String(win) : null, scores, ident, state: a.state };
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
  const seat = (id: string | null, win: string | null, played: boolean) => ({
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
        a: seat(m.p1, m.win, !!m.win),
        b: seat(m.p2, m.win, !!m.win),
        played: !!m.win,
        scores: m.scores || "",
      })),
  }));

  const results = [...parts.values()]
    .filter((p) => p.rank != null)
    .map((p) => ({ name: p.name, place: p.rank }));

  return { rounds, results, source: "challonge", fetched_at: new Date().toISOString() };
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

    const token = await accessToken();
    // v2.1: матчи и участники турнира отдельными ресурсами
    const [participantsDoc, matchesDoc] = await Promise.all([
      chGet(`/tournaments/${challonge}/participants.json`, token),
      chGet(`/tournaments/${challonge}/matches.json`, token),
    ]);
    const model = normalize(participantsDoc, matchesDoc);

    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

    let synced = { cached: false, results_written: 0, results_skipped_manual: 0, unmatched: [] as string[] };

    if (db_id) {
      // 1) кэш модели сетки (читается bracket.html напрямую)
      const cw = await admin.from("bracket_cache").upsert({ tournament_id: db_id, json: model, fetched_at: model.fetched_at });
      synced.cached = !cw.error;

      // 2) синк МЕСТ в tournament_results (граница ручное/авто)
      if (model.results.length) {
        // маппинг ник → players.id (как resolvePlayerNick на клиенте)
        const { data: players } = await admin.from("players").select("id,nickname");
        const byNick = new Map((players ?? []).map((p: any) => [String(p.nickname).toLowerCase(), p.id]));
        // существующие строки результата турнира — чтобы не трогать ручные
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
