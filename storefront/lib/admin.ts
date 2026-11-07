import "server-only";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

// Bearer STORE_ADMIN_SECRET. Returns a 401 response, or null when authorized.
export function requireAdmin(req: Request): NextResponse | null {
  const secret = process.env.STORE_ADMIN_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || secret.length < 16) return NextResponse.json({ error: "admin API is not configured" }, { status: 503 });
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

export function revalidateAll(what: "catalog" | "content" | "all" = "all") {
  if (what === "catalog" || what === "all") revalidateTag("catalog", { expire: 0 });
  if (what === "content" || what === "all") revalidateTag("content", { expire: 0 });
  revalidatePath("/", "layout");
}
