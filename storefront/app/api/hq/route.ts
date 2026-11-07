import { loadHq } from "@/lib/hq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hq -> latest hq.json (public). Browsers never cache it; Vercel's CDN may hold it for up to 10 s.
export async function GET() {
  const { doc, source, received_at } = await loadHq();
  return new Response(JSON.stringify(doc), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "cdn-cache-control": "public, max-age=10",
      "x-hq-source": source,
      ...(received_at ? { "x-hq-received-at": received_at } : {}),
    },
  });
}
