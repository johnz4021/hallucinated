import { loadHqAgents } from "@/lib/hq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hq/agents/<key> -> one agent's drill-down slice (public). Browsers never cache; CDN up to 10 s.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { doc, source } = await loadHqAgents();
  const agent = doc.agents?.[key];
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "cdn-cache-control": "public, max-age=10", "x-hq-source": source };
  if (!agent) return new Response(JSON.stringify({ error: `no agent '${key}'` }), { status: 404, headers });
  return new Response(JSON.stringify({ generated_at: doc.generated_at ?? null, agent }), { headers });
}
