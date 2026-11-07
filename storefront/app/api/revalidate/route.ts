import { NextResponse } from "next/server";
import { requireAdmin, revalidateAll } from "@/lib/admin";

export const dynamic = "force-dynamic";

// POST /api/revalidate  Authorization: Bearer $STORE_ADMIN_SECRET  body: {"what":"catalog"|"content"|"all"}
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const what = ["catalog", "content", "all"].includes(body.what) ? body.what : "all";
  revalidateAll(what);
  return NextResponse.json({ ok: true, revalidated: what, at: new Date().toISOString() });
}
