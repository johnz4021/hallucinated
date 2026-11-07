import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { piiProblem, saveHq, shapeProblem } from "@/lib/hq";
import type { Hq } from "@/lib/hq-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 4 * 1024 * 1024;

// PUT /api/admin/hq  Authorization: Bearer $STORE_ADMIN_SECRET  body: hq.json v1 (≤4 MB)
export async function PUT(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (Number(req.headers.get("content-length") ?? 0) > MAX) return NextResponse.json({ error: "body larger than 4 MB" }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX) return NextResponse.json({ error: "body larger than 4 MB" }, { status: 413 });
  let doc: Hq;
  try {
    doc = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const shape = shapeProblem(doc);
  if (shape) return NextResponse.json({ error: shape }, { status: 400 });
  const pii = piiProblem(raw);
  if (pii) return NextResponse.json({ error: `rejected: ${pii}` }, { status: 422 });
  const saved = await saveHq(doc, raw);
  return NextResponse.json({ ok: true, ...saved, bytes: raw.length });
}
