import "server-only";
import { del, list, put } from "@vercel/blob";
import { getCache } from "@vercel/functions";
import fixture from "./hq-fixture.json";
import type { Hq } from "./hq-types";

// Live copy: Vercel Runtime Cache (the publisher pushes every 60 s; one Blob write per push would burn
// through the Hobby plan's Blob operation quota and put the store's own content at risk).
// Durable copy: an immutable Blob snapshot (hq/<env>/v/<ms>-<rand>.json) at most every 10 min, last 20 kept;
// the newest pathname wins, so there is no stale-overwrite problem.
// Blob is shared by production, previews and local dev, so snapshots are kept per environment.
const PREFIX = `hq/${process.env.VERCEL_ENV ?? "development"}/v/`;
const KEEP = 20;
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const KEY = "hq:latest";
const SNAP_KEY = "hq:last-snapshot-at";
const cache = () => getCache({ namespace: "hallucinated" });

// Defense in depth against PII (the publisher scrubs too).
const PII: [RegExp, string][] = [
  [/@/, "contains '@' (emails and handles are not allowed)"],
  [/cus_/, "contains a Stripe customer id (cus_)"],
  [/pm_/, "contains a Stripe payment method id (pm_)"],
  [/zhang/i, "contains the founder's surname"],
  [/\d+\s+\w+\s+(St|Ave)\b/i, "looks like a street address"],
];
export function piiProblem(raw: string): string | null {
  for (const [re, why] of PII) if (re.test(raw)) return why;
  return null;
}

export function shapeProblem(doc: unknown): string | null {
  const d = doc as Hq;
  if (!d || typeof d !== "object" || Array.isArray(d)) return "body must be a JSON object";
  if (d.version !== 1) return "version must be 1";
  for (const k of ["designs", "timeline", "human"] as const) if (d[k] !== undefined && !Array.isArray(d[k])) return `${k} must be an array`;
  if (d.counters !== undefined && (typeof d.counters !== "object" || Array.isArray(d.counters))) return "counters must be an object";
  if (d.by_agent !== undefined && (typeof d.by_agent !== "object" || Array.isArray(d.by_agent))) return "by_agent must be an object";
  return null;
}

async function snapshots() {
  const out: { pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix: PREFIX, limit: 1000, cursor });
    out.push(...r.blobs.map((b) => ({ pathname: b.pathname, url: b.url })));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

export async function saveHq(doc: Hq, raw: string) {
  const received_at = new Date().toISOString();
  await cache().set(KEY, { doc, received_at }, { ttl: 7 * 24 * 3600, tags: ["hq"], name: "hq.json" });
  const last = Number((await cache().get(SNAP_KEY)) ?? 0);
  let snapshot: string | null = null;
  if (Date.now() - last >= SNAPSHOT_EVERY_MS) {
    const pathname = `${PREFIX}${String(Date.now()).padStart(15, "0")}-${Math.random().toString(36).slice(2, 8)}.json`;
    await put(pathname, raw, { access: "public", contentType: "application/json", addRandomSuffix: false });
    await cache().set(SNAP_KEY, Date.now(), { ttl: 7 * 24 * 3600 });
    snapshot = pathname;
    const all = await snapshots();
    const old = all.slice(0, Math.max(0, all.length - KEEP)).map((b) => b.url);
    if (old.length) await del(old).catch(() => {});
  }
  return { received_at, snapshot };
}

export type HqResult = { doc: Hq; source: "live" | "snapshot" | "fixture" | "empty"; received_at: string | null };

export async function loadHq(): Promise<HqResult> {
  const hit = (await cache().get(KEY).catch(() => undefined)) as { doc: Hq; received_at: string } | undefined;
  if (hit?.doc) return { doc: hit.doc, source: "live", received_at: hit.received_at };
  try {
    const latest = (await snapshots()).at(-1);
    if (latest) {
      const res = await fetch(latest.url, { cache: "no-store" });
      if (res.ok) {
        const doc = (await res.json()) as Hq;
        await cache().set(KEY, { doc, received_at: doc.generated_at ?? null }, { ttl: 3600, tags: ["hq"] }).catch(() => {});
        return { doc, source: "snapshot", received_at: doc.generated_at ?? null };
      }
    }
  } catch (e) {
    console.error("hq snapshot read failed:", (e as Error).message);
  }
  if (process.env.VERCEL_ENV !== "production") return { doc: shiftedFixture(), source: "fixture", received_at: null };
  return { doc: { version: 1, designs: [], timeline: [], human: [], by_agent: {}, counters: {} }, source: "empty", received_at: null };
}

// The sample day is re-dated so its newest event was two minutes ago (relative times read naturally).
function shiftedFixture(): Hq {
  const doc = structuredClone(fixture) as Hq & Record<string, unknown>;
  const offset = Date.now() - 2 * 60_000 - Date.parse(String(doc.generated_at));
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (k === "at" || k === "generated_at") && typeof x === "string" ? new Date(Date.parse(x) + offset).toISOString() : walk(x)]));
    }
    return v;
  };
  return walk(doc) as Hq;
}
