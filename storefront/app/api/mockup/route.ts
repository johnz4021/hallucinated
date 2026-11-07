import sharp from "sharp";
import { config } from "@/lib/config";
import { FLAT_BOX, MOCKUP, PRINT_BOX, flatSvg, teeSvg } from "@/lib/tee-svg";

export const runtime = "nodejs";

const MAX_BYTES = 8_000_000;
const bad = (msg: string, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });

// GET /api/mockup?print=<our Blob URL under /media/>&side=back|front|flat -> PNG 1200×1500:
// back/front = black tee with the print placed as printed; flat = the print alone on shirt black.
// Only our own Blob store is accepted, so this can't be used as an open image proxy.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get("side") ?? "back";
  const side = raw === "front" || raw === "back" || raw === "flat" ? raw : null;
  if (!side) return bad("side must be back, front or flat");
  let print: URL;
  try {
    print = new URL(q.get("print") ?? "");
  } catch {
    return bad("print must be a URL");
  }
  if (print.protocol !== "https:" || print.hostname !== config.blobHost || !print.pathname.startsWith("/media/") || print.search || print.username || print.port) {
    return bad("print must be an image in our own Blob store (https://<store>.public.blob.vercel-storage.com/media/...)");
  }

  let buf: Buffer;
  try {
    const res = await fetch(print, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return bad(`print fetch failed (${res.status})`, 404);
    const type = res.headers.get("content-type") ?? "";
    if (!/^image\/(png|jpeg|webp)$/.test(type)) return bad("print must be png, jpeg or webp", 415);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return bad("print too large", 413);
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return bad("print too large", 413);
  } catch {
    return bad("print fetch failed", 502);
  }

  try {
    const box = side === "flat" ? FLAT_BOX : PRINT_BOX[side];
    const art = await sharp(buf, { limitInputPixels: 50_000_000 })
      .trim({ threshold: 1 })
      .resize({ width: box.width, height: box.height, fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true });
    const left = box.left + Math.round((box.width - art.info.width) / 2);
    const top = side === "flat" ? box.top + Math.round((box.height - art.info.height) / 2) : box.top;
    const png = await sharp(Buffer.from(side === "flat" ? flatSvg() : teeSvg(side)))
      .resize(MOCKUP.width, MOCKUP.height)
      .composite([{ input: art.data, left, top }])
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        // Print URLs are immutable (random suffix), so the mockup is too.
        "cache-control": "public, max-age=31536000, immutable",
        "cdn-cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return bad("print is not a readable image", 422);
  }
}
