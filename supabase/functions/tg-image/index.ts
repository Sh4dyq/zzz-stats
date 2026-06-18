// tg-image — Supabase Edge Function (Deno).
//
// Достаёт картинку-анонс из поста Telegram, чтобы карточку турнира на главной
// можно было собирать ПОЛНОСТЬЮ из админки (хватает только ссылки на пост).
//
// Как: телеграм отдаёт публичный виджет поста по `?embed=1&mode=tme` с фото
// внутри `background-image:url('…')`; запасные варианты — og:image / twitter:image.
// CORS у t.me нет, поэтому тянем НА БЭКЕ. Результат (по желанию) кэшируем в
// tournaments.announce_image, чтобы не дёргать телеграм на каждый заход.
//
// Вызов: sb.functions.invoke('tg-image',{body:{url:'https://t.me/nexus_shiyu/1116', db_id:'<uuid>'}})
// Ответ: { image: 'https://cdn…/file/…' | null }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// t.me/<channel>/<id>?... → встраиваемый виджет поста
function embedUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)t\.me$/i.test(u.hostname)) return null;
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!path) return null;
    return `https://t.me/${path}?embed=1&mode=tme`;
  } catch {
    return null;
  }
}

function extractImage(html: string): string | null {
  const pats = [
    /background-image:\s*url\(['"]?(https:\/\/[^'")]+)['"]?\)/i, // фото поста в виджете
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of pats) {
    const m = html.match(re);
    if (m && m[1]) return m[1].replace(/&amp;/g, "&");
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const u = new URL(req.url);
    let url = u.searchParams.get("url") ?? "";
    let db_id = u.searchParams.get("db_id") ?? "";
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      url = b.url ?? url;
      db_id = b.db_id ?? db_id;
    }
    const emb = embedUrl(url);
    if (!emb) return json({ error: "Нужна ссылка на пост Telegram (t.me/<канал>/<id>)" }, 400);

    const r = await fetch(emb, { headers: { "User-Agent": "Mozilla/5.0 (compatible; nexus-stats/1.0)" } });
    if (!r.ok) return json({ image: null, error: `t.me ${r.status}` });
    const html = await r.text();
    const image = extractImage(html);

    // кэш в tournaments.announce_image (под ролью вызывающего — admin залогинен)
    if (image && db_id) {
      const SB_URL = Deno.env.get("SUPABASE_URL")!;
      const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const authHeader = req.headers.get("Authorization");
      const admin = authHeader
        ? createClient(SB_URL, SB_ANON, { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } })
        : createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
      await admin.from("tournaments").update({ announce_image: image }).eq("id", db_id);
    }

    return json({ image });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
