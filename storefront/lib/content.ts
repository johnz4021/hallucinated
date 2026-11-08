import "server-only";
import { del, list, put } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import type { Content } from "./content-schema";

// content.json is stored as immutable versions: content/v/<ms>-<rand>.json. The newest pathname wins.
// (Overwriting one file doesn't work: Blob's CDN keeps serving the old copy for a while.)
export const CONTENT_PREFIX = "content/v/";
const KEEP = 20;

const EMPTY: Content = { version: 1, updated_at: "1970-01-01T00:00:00.000Z", banners: [], lookbook: [], drops: [], designs: [], campaigns: [], launches: [] };

export class ContentConflict extends Error {}

async function versions() {
  const out: { pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix: CONTENT_PREFIX, limit: 1000, cursor });
    out.push(...r.blobs.map((b) => ({ pathname: b.pathname, url: b.url })));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

export async function readContentFresh(): Promise<{ content: Content; version: string | null }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { content: EMPTY, version: null };
  const all = await versions();
  const latest = all.at(-1);
  if (!latest) return { content: EMPTY, version: null };
  const res = await fetch(latest.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`content fetch ${res.status}`);
  return { content: { ...EMPTY, ...(await res.json()) }, version: latest.pathname };
}

// expectedVersion: the version the caller read. If someone wrote since, throws ContentConflict (HTTP 409).
export async function writeContent(content: Content, expectedVersion?: string | null) {
  const before = await versions();
  if (expectedVersion !== undefined && (before.at(-1)?.pathname ?? null) !== expectedVersion) throw new ContentConflict();
  const body = JSON.stringify({ ...content, version: 1, updated_at: new Date().toISOString() }, null, 2);
  const pathname = `${CONTENT_PREFIX}${String(Date.now()).padStart(15, "0")}-${Math.random().toString(36).slice(2, 8)}.json`;
  const blob = await put(pathname, body, { access: "public", contentType: "application/json", addRandomSuffix: false });
  const old = before.slice(0, Math.max(0, before.length + 1 - KEEP)).map((b) => b.url);
  if (old.length) await del(old).catch(() => {});
  return blob;
}

// Site reads: cached for an hour, refreshed on demand by every admin write (tag "content").
export const getContent = unstable_cache(
  async () => {
    try {
      return { ...EMPTY, ...(await readContentFresh()).content };
    } catch (e) {
      console.error("content read failed:", (e as Error).message);
      return EMPTY;
    }
  },
  ["content-v5"],
  { revalidate: 3600, tags: ["content"] },
);

export const activeSorted = <T extends { active?: boolean; sort?: number }>(xs: T[]) =>
  xs.filter((x) => x.active !== false).sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100));

// Campaigns marked test: true never show on production; previews and local dev show them.
export const showTestContent = () => process.env.VERCEL_ENV !== "production";
export function visibleCampaigns(c: Content) {
  const tests = showTestContent();
  return (c.campaigns ?? [])
    .filter((x) => x.active !== false && (tests || !x.test))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

// Launch images for products in this deployment's catalog (test ones only off production), newest first.
export function visibleLaunches(c: Content, liveSlugs: Set<string>) {
  const tests = showTestContent();
  return (c.launches ?? [])
    .filter((l) => l.active !== false && (tests || !l.test) && liveSlugs.has(l.slug) && l.images?.length)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
