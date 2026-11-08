import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { agentsShapeProblem, piiProblem, saveHqDoc, shapeProblem } from "@/lib/hq";
import type { Hq } from "@/lib/hq-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/admin/hq             Authorization: Bearer $STORE_ADMIN_SECRET  body: hq.json (v1/v2, ≤4 MB)
// PUT /api/admin/hq?doc=agents   same auth                                 body: hq-agents.json v1 (≤2 MB)
export async function PUT(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const which = new URL(req.url).searchParams.get("doc") === "agents" ? "agents" : "main";
  const MAX = which === "agents" ? 2 * 1024 * 1024 : 4 * 1024 * 1024;
  const limit = which === "agents" ? "2 MB" : "4 MB";
  if (Number(req.headers.get("content-length") ?? 0) > MAX) return NextResponse.json({ error: `body larger than ${limit}` }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX) return NextResponse.json({ error: `body larger than ${limit}` }, { status: 413 });
  let doc: Hq;
  try {
    doc = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const shape = which === "agents" ? agentsShapeProblem(doc) : shapeProblem(doc);
  if (shape) return NextResponse.json({ error: shape }, { status: 400 });
  const pii = piiProblem(raw);
  if (pii) return NextResponse.json({ error: `rejected: ${pii}` }, { status: 422 });
  const saved = await saveHqDoc(which, doc, raw);
  return NextResponse.json({ ok: true, doc: which, ...saved, bytes: raw.length });
}
