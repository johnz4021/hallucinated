import "server-only";
import { del, list, put } from "@vercel/blob";
import { getCache } from "@vercel/functions";
import agentsFixture from "./hq-agents-fixture.json";
import fixture from "./hq-fixture.json";
import type { Hq, HqAgentsDoc } from "./hq-types";

// Live copy: Vercel Runtime Cache (the publisher pushes every 60 s; one Blob write per push would burn
// through the Hobby plan's Blob operation quota and put the store's own content at risk).
// Durable copy: an immutable Blob snapshot (hq/<env>/v/<ms>-<rand>.json) at most every 10 min, last 20 kept;
// the newest pathname wins, so there is no stale-overwrite problem.
// Blob is shared by production, previews and local dev, so snapshots are kept per environment.
const ENV = process.env.VERCEL_ENV ?? "development";
// Two documents share the same storage pattern: the main board (hq.json) and the per-agent drill-down (hq-agents.json).
export type HqDocName = "main" | "agents";
const STORE: Record<HqDocName, { prefix: string; key: string; snapKey: string }> = {
  main: { prefix: `hq/${ENV}/v/`, key: "hq:latest", snapKey: "hq:last-snapshot-at" },
  agents: { prefix: `hq/${ENV}/agents/v/`, key: "hq-agents:latest", snapKey: "hq-agents:last-snapshot-at" },
};
const KEEP = 20;
const SNAPSHOT_EVERY_MS = 10 * 60_000;
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
  if (d.version !== 1 && d.version !== 2) return "version must be 1 or 2";
  for (const k of ["designs", "timeline", "human", "agents", "flows", "feed"] as const) if (d[k] !== undefined && !Array.isArray(d[k])) return `${k} must be an array`;
  if (d.money !== undefined && (typeof d.money !== "object" || Array.isArray(d.money))) return "money must be an object";
  if (d.counters !== undefined && (typeof d.counters !== "object" || Array.isArray(d.counters))) return "counters must be an object";
  if (d.by_agent !== undefined && (typeof d.by_agent !== "object" || Array.isArray(d.by_agent))) return "by_agent must be an object";
  return null;
}

async function snapshots(prefix: string) {
  const out: { pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix, limit: 1000, cursor });
    out.push(...r.blobs.map((b) => ({ pathname: b.pathname, url: b.url })));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

export async function saveHqDoc(name: HqDocName, doc: unknown, raw: string) {
  const st = STORE[name];
  const received_at = new Date().toISOString();
  await cache().set(st.key, { doc, received_at }, { ttl: 7 * 24 * 3600, tags: ["hq"], name: name === "main" ? "hq.json" : "hq-agents.json" });
  const last = Number((await cache().get(st.snapKey)) ?? 0);
  let snapshot: string | null = null;
  if (Date.now() - last >= SNAPSHOT_EVERY_MS) {
    const pathname = `${st.prefix}${String(Date.now()).padStart(15, "0")}-${Math.random().toString(36).slice(2, 8)}.json`;
    await put(pathname, raw, { access: "public", contentType: "application/json", addRandomSuffix: false });
    await cache().set(st.snapKey, Date.now(), { ttl: 7 * 24 * 3600 });
    snapshot = pathname;
    const all = await snapshots(st.prefix);
    const old = all.slice(0, Math.max(0, all.length - KEEP)).map((b) => b.url);
    if (old.length) await del(old).catch(() => {});
  }
  return { received_at, snapshot };
}
export const saveHq = (doc: Hq, raw: string) => saveHqDoc("main", doc, raw);

async function loadDoc<T>(name: HqDocName): Promise<{ doc: T; source: "live" | "snapshot"; received_at: string | null } | null> {
  const st = STORE[name];
  const hit = (await cache().get(st.key).catch(() => undefined)) as { doc: T; received_at: string } | undefined;
  if (hit?.doc) return { doc: hit.doc, source: "live", received_at: hit.received_at };
  try {
    const latest = (await snapshots(st.prefix)).at(-1);
    if (latest) {
      const res = await fetch(latest.url, { cache: "no-store" });
      if (res.ok) {
        const doc = (await res.json()) as T & { generated_at?: string };
        await cache().set(st.key, { doc, received_at: doc.generated_at ?? null }, { ttl: 3600, tags: ["hq"] }).catch(() => {});
        return { doc, source: "snapshot", received_at: doc.generated_at ?? null };
      }
    }
  } catch (e) {
    console.error(`hq ${name} snapshot read failed:`, (e as Error).message);
  }
  return null;
}

export type HqResult = { doc: Hq; source: "live" | "snapshot" | "fixture" | "empty"; received_at: string | null };

export async function loadHq(): Promise<HqResult> {
  const got = await loadDoc<Hq>("main");
  if (got) return got;
  if (process.env.VERCEL_ENV !== "production") return { doc: shifted(fixture) as Hq, source: "fixture", received_at: null };
  return { doc: { version: 1, designs: [], timeline: [], human: [], by_agent: {}, counters: {} }, source: "empty", received_at: null };
}

export type HqAgentsResult = { doc: HqAgentsDoc; source: "live" | "snapshot" | "fixture" | "empty" };
export async function loadHqAgents(): Promise<HqAgentsResult> {
  const got = await loadDoc<HqAgentsDoc>("agents");
  if (got) return { doc: got.doc, source: got.source };
  if (process.env.VERCEL_ENV !== "production") return { doc: shifted(agentsFixture) as HqAgentsDoc, source: "fixture" };
  return { doc: { version: 1, agents: {} }, source: "empty" };
}

export function agentsShapeProblem(doc: unknown): string | null {
  const d = doc as HqAgentsDoc;
  if (!d || typeof d !== "object" || Array.isArray(d)) return "body must be a JSON object";
  if (d.version !== 1) return "version must be 1";
  if (!d.agents || typeof d.agents !== "object" || Array.isArray(d.agents)) return "agents must be an object keyed by agent";
  for (const [k, a] of Object.entries(d.agents)) {
    if (!a || typeof a !== "object") return `agents.${k} must be an object`;
    for (const f of ["tools", "shipped", "runs"] as const) if ((a as Record<string, unknown>)[f] !== undefined && !Array.isArray((a as Record<string, unknown>)[f])) return `agents.${k}.${f} must be an array`;
  }
  return null;
}

// Sample data is re-dated so its newest event was two minutes ago (relative times read naturally).
function shifted(sample: unknown): unknown {
  const doc = structuredClone(sample) as Record<string, unknown>;
  const offset = Date.now() - 2 * 60_000 - Date.parse(String(doc.generated_at));
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (k === "at" || k.endsWith("_at") || k === "running_since") && typeof x === "string" && !Number.isNaN(Date.parse(x)) ? new Date(Date.parse(x) + offset).toISOString() : walk(x)]));
    }
    return v;
  };
  return walk(doc);
}
