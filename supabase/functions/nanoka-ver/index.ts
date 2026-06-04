// nanoka-ver — Supabase Edge Function (Deno).
//
// ЗАЧЕМ: версия датамайна ZZZ (напр. "3.0.4+16078270") зашита ТОЛЬКО в HTML
// страниц zzz.nanoka.cc, а этот домен НЕ отдаёт CORS-заголовков → браузер не может
// прочитать его HTML. Сервер CORS не ограничивает: эта функция заходит на nanoka,
// вытаскивает версию из атрибута data-url и отдаёт её админке (со своими CORS-заголовками).
// Сам JSON ротации (static.nanoka.cc, CORS=*) браузер качает уже напрямую — прокси не нужен.
//
// Вызов:  sb.functions.invoke('nanoka-ver')  →  { ver: "3.0.4+16078270" }
// Деплой: supabase functions deploy nanoka-ver   (секреты не нужны)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// На любой странице nanoka в HTML есть несколько data-url="https://static.nanoka.cc/zzz/<VER>/...".
// Берём первый и вытаскиваем сегмент версии.
async function fetchVer(): Promise<string> {
  const r = await fetch("https://zzz.nanoka.cc/", {
    headers: { "User-Agent": "Mozilla/5.0 (zzz-stats nanoka-ver)" },
  });
  if (!r.ok) throw new Error(`nanoka HTTP ${r.status}`);
  const html = await r.text();
  const m = html.match(/static\.nanoka\.cc\/zzz\/([^/"']+)\//);
  if (!m) throw new Error("version not found in nanoka HTML");
  return m[1];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const ver = await fetchVer();
    return json({ ver });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502);
  }
});
