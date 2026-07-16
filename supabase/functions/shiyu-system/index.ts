// Edge Function: shiyu-system
// Прокси для shiyu.darte.gg REST (CORS залочен на их origin), чтобы админка могла
// вживую тянуть ruleset системы по одной кнопке — без скрипта fetch_system.py и без
// коммита web/data/shiyu_systems.json. Порт логики tools/fetch_system.py на Deno.
//
// GET /functions/v1/shiyu-system?system=<system_id>
//   → {title,costLimit,restart:{free,paid},agents:{enka:[7]},engines:{enka:{base,bis:{enka:[]}}}}
// GET /functions/v1/shiyu-system?draft=<draft_id>&key=<session_key>
//   → то же, но system_id резолвится из socket-init драфта (у ссылки его нет).
//
// Деплой: Supabase Dashboard → Edge Functions → Create function "shiyu-system" →
//   вставить этот файл → Deploy. В настройках функции ОТКЛЮЧИТЬ "Verify JWT"
//   (данные публичные, read-only — токен не нужен).

import { io } from "https://esm.sh/socket.io-client@4.7.5";

const API = "https://shiyu.darte.gg/api/shiyu";

// draft_id(+session_key) → system_id через socket init (порт tools/fetch_system.py).
function systemFromDraft(draftId: string, key: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = io("https://shiyu.darte.gg/draft", {
      path: "/socket.io/draft",
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      query: key ? { session_id: draftId, session_key: key } : { session_id: draftId },
    });
    const done = (fn: () => void) => { clearTimeout(timer); sock.close(); fn(); };
    const timer = setTimeout(() => done(() => reject(new Error("timeout init от darte (ссылка протухла?)"))), 10000);
    sock.on("init", (d: { system?: string }) => {
      if (d?.system) done(() => resolve(d.system!));
      else done(() => reject(new Error("в init нет system")));
    });
    sock.on("connect_error", (e: Error) => done(() => reject(new Error("socket: " + e.message))));
  });
}
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
    const q = new URL(req.url).searchParams;
    let systemId = q.get("system");
    if (!systemId) {
      const draft = q.get("draft");
      if (!draft) return json({ error: "missing ?system=<id> or ?draft=<id>&key=<key>" }, 400);
      systemId = await systemFromDraft(draft, q.get("key"));
    }

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
