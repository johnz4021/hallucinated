import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// POST /api/admin/upload?name=banner-drop-2  (raw image bytes, Content-Type image/png|jpeg|webp, max ~4 MB)
// -> { url }  A public Blob URL to use in content.json or as a Stripe product image.
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = TYPES[type];
  if (!ext) return NextResponse.json({ error: "Content-Type must be image/png, image/jpeg or image/webp" }, { status: 415 });
  const name = (new URL(req.url).searchParams.get("name") ?? "image").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60) || "image";
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length < 100 || bytes.length > 4_400_000) return NextResponse.json({ error: "image must be 100 B to 4.4 MB" }, { status: 413 });
  const blob = await put(`media/agents/${name}.${ext}`, bytes, { access: "public", contentType: type, addRandomSuffix: true });
  return NextResponse.json({ url: blob.url, pathname: blob.pathname, bytes: bytes.length });
}
