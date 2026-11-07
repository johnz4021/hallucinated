import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { MAX_MEDIA_BYTES, MEDIA_TYPES, mediaPath } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/upload-token {"name":"<id>","content_type":"video/mp4"}
// -> {pathname, client_token, valid_until}: a 15-minute token that can only write that one path (≤50 MB).
// Then: put(pathname, file, { access: "public", token: client_token, contentType, multipart: true }) from @vercel/blob.
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; content_type?: unknown };
  const type = typeof body.content_type === "string" ? body.content_type.toLowerCase() : "";
  const ext = MEDIA_TYPES[type];
  if (!ext) return NextResponse.json({ error: `content_type must be one of ${Object.keys(MEDIA_TYPES).join(", ")}` }, { status: 400 });
  const pathname = mediaPath(typeof body.name === "string" ? body.name : "upload", ext);
  const validUntil = Date.now() + 15 * 60_000;
  const client_token = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathname,
    allowedContentTypes: [type],
    maximumSizeInBytes: MAX_MEDIA_BYTES,
    validUntil,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return NextResponse.json({ pathname, client_token, valid_until: new Date(validUntil).toISOString() });
}
