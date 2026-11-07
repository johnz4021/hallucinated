import { del, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { Transform } from "node:stream";
import { requireAdmin } from "@/lib/admin";
import { MAX_MEDIA_BYTES, MEDIA_TYPES, mediaPath } from "@/lib/media";
import { IngestError, safeGet } from "@/lib/safe-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/admin/ingest {"url":"https://…","name":"<id>"} -> copies a public image/video (≤50 MB) to our Blob store.
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { url?: unknown; name?: unknown };
  if (typeof body.url !== "string" || body.url.length > 2000) return NextResponse.json({ error: "url (https) required" }, { status: 400 });

  const signal = AbortSignal.timeout(90_000);
  let pathname = "";
  try {
    const { res } = await safeGet(body.url, signal);
    const type = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const ext = MEDIA_TYPES[type];
    if (!ext) {
      res.resume();
      throw new IngestError(`content-type ${type || "(none)"} not allowed; use ${Object.keys(MEDIA_TYPES).join(", ")}`, 415);
    }
    const declared = Number(res.headers["content-length"] ?? 0);
    if (declared > MAX_MEDIA_BYTES) {
      res.resume();
      throw new IngestError("file is larger than 50 MB", 413);
    }
    let seen = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        if (seen > MAX_MEDIA_BYTES) return cb(new IngestError("file is larger than 50 MB", 413));
        cb(null, chunk);
      },
    });
    res.on("error", (e) => limiter.destroy(e));
    pathname = mediaPath(typeof body.name === "string" ? body.name : "ingest", ext);
    const blob = await put(pathname, res.pipe(limiter), {
      access: "public",
      contentType: type,
      addRandomSuffix: false,
      multipart: type.startsWith("video/") || !declared || declared > 8 * 1024 * 1024,
      abortSignal: signal,
    });
    return NextResponse.json({ url: blob.url, pathname: blob.pathname, bytes: seen, content_type: type });
  } catch (e) {
    if (pathname) await del(pathname).catch(() => {});
    const err = e as Error & { status?: number };
    const status = e instanceof IngestError ? err.status ?? 400 : err.name === "TimeoutError" || err.name === "AbortError" ? 504 : 502;
    return NextResponse.json({ error: e instanceof IngestError ? err.message : `ingest failed (${err.name})` }, { status });
  }
}
