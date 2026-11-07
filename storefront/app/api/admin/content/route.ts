import { NextResponse } from "next/server";
import { requireAdmin, revalidateAll } from "@/lib/admin";
import { ContentConflict, readContentFresh, writeContent } from "@/lib/content";
import { COLLECTIONS, type Collection, type Content, validateContent, validateItem } from "@/lib/content-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    -> current content.json
// PUT    -> replace the whole document (validated)
// PATCH  -> {"op":"upsert","collection":"banners"|"lookbook"|"drops","item":{...}}
//           {"op":"remove","collection":...,"id":"..."}
//           {"op":"announcement","text":"..."}
// Every write revalidates the site. A PATCH that races another write gets 409; just retry it.
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { content, version } = await readContentFresh();
  return NextResponse.json({ version, content });
}

export async function PUT(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const doc = (await req.json().catch(() => null)) as Content | null;
  const err = validateContent(doc);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  await writeContent({ ...doc!, version: 1 });
  revalidateAll("content");
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { op?: string; collection?: Collection; item?: Record<string, unknown>; id?: string; text?: string };
  const { content, version } = await readContentFresh();
  const next: Content = structuredClone(content);

  if (body.op === "announcement") {
    if (typeof body.text !== "string" || body.text.length > 200) return NextResponse.json({ error: "text max 200 chars ('' clears it)" }, { status: 400 });
    next.announcement = body.text || undefined;
  } else if (body.op === "upsert" || body.op === "remove") {
    if (!body.collection || !COLLECTIONS.includes(body.collection)) return NextResponse.json({ error: `collection: ${COLLECTIONS.join("|")}` }, { status: 400 });
    const list = next[body.collection] as unknown as Record<string, unknown>[];
    if (body.op === "upsert") {
      const item = body.item ?? {};
      const err = validateItem(body.collection, item);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = { ...list[i], ...item };
      else list.push(item);
    } else {
      const i = list.findIndex((x) => x.id === body.id);
      if (i < 0) return NextResponse.json({ error: `no ${body.collection} item with id ${body.id}` }, { status: 404 });
      list.splice(i, 1);
    }
  } else {
    return NextResponse.json({ error: "op: upsert | remove | announcement" }, { status: 400 });
  }

  try {
    await writeContent(next, version);
  } catch (e) {
    if (e instanceof ContentConflict) return NextResponse.json({ error: "content changed meanwhile; retry" }, { status: 409 });
    throw e;
  }
  revalidateAll("content");
  return NextResponse.json({ ok: true, op: body.op, collection: body.collection ?? null });
}
