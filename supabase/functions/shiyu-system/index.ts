// Edge Function: shiyu-system
// Прокси для shiyu.darte.gg REST (CORS залочен на их origin), чтобы админка могла
// вживую тянуть ruleset системы по одной кнопке — без скрипта fetch_system.py и без
// коммита web/data/shiyu_systems.json. Порт логики tools/fetch_system.py на Deno.
//
// GET /functions/v1/shiyu-system?system=<system_id>
//   → {title,costLimit,restart:{free,paid},agents:{enka:[7]},engines:{enka:{base,bis:{enka:[]}}}}
//
// Деплой: Supabase Dashboard → Edge Functions → Create function "shiyu-system" →
//   вставить этот файл → Deploy. В настройках функции ОТКЛЮЧИТЬ "Verify JWT"
//   (данные публичные, read-only — токен не нужен).

const API = "https://shiyu.darte.gg/api/shiyu";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

async function get(path: string) {
  const r = await fetch(`${API}/${path}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`shiyu ${path} → ${r.status}`);
  return r.json();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const systemId = new URL(req.url).searchParams.get("system");
    if (!systemId) return json({ error: "missing ?system=<id>" }, 400);

    const [agentsRaw, enginesRaw, s] = await Promise.all([
      get("agents"),
      get("engines"),
      get(`draft_systems/${systemId}`),
    ]);

    const agents: Record<string, string> = {};
    for (const a of agentsRaw) agents[a._id] = a.enkaId;
    const engines: Record<string, string> = {};
    for (const e of enginesRaw) engines[e._id] = e.enkaId;

    const pm = s.phaseMatch ?? {};
    const c = s.costs ?? {};

    const ag: Record<string, unknown> = {};
    for (const a of c.agents ?? []) {
      const enka = agents[a.agent];
      if (enka) ag[enka] = a.costs ?? [];
    }
    const eng: Record<string, unknown> = {};
    for (const e of c.engines ?? []) {
      const enka = engines[e.engine];
      if (!enka) continue;
      const bis: Record<string, unknown> = {};
      for (const b of e.bis ?? []) {
        const be = agents[b.agent];
        if (be) bis[be] = b.costs ?? [];
      }
      eng[enka] = { base: e.costs ?? [], bis };
    }

    return json({
      title: s.main?.title ?? null,
      costLimit: c.costLimit ?? null,
      restart: { free: pm.freeRestarts ?? 0, paid: pm.paidRestarts ?? [] },
      agents: ag,
      engines: eng,
    });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 502);
  }
});
