// State for the CEO plan and the ad pipeline (repo root, git-ignored):
//   plans.json  { versions: [{ version, at, by, plan }] }      the CEO's daily plan, newest last
//   ads.json    { ads: {id: ad}, reviews: {id: review}, videos: {job_id: video} }
// ADS_TEST=1 (the isolated test server) marks everything test: separate caps, campaigns written with test:true,
// and Growth on the live server never posts a test ad.
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "../lib/state.mjs";
import { ptDay } from "../designs/ledger.mjs";

export const testMode = () => process.env.ADS_TEST === "1";
export const MAX_IMAGE_ADS_PER_DAY = () => Number(process.env.ADS_MAX_IMAGES_PER_DAY || 4);
export const MAX_VIDEO_ADS_PER_DAY = () => Number(process.env.ADS_MAX_VIDEOS_PER_DAY || 1);
export const MAX_EVENT_POSTS_PER_DAY = () => Number(process.env.X_MAX_EVENT_POSTS_PER_DAY || 3);
export const newId = (p) => `${p}_${crypto.randomBytes(5).toString("hex")}`;

const plansFile = (r) => path.join(r, "plans.json");
const adsFile = (r) => path.join(r, "ads.json");
export const loadPlans = (r) => readJson(plansFile(r), { versions: [] });
export const latestPlan = (r) => loadPlans(r).versions.at(-1) || null;
export function savePlan(rootDir, plan, by) {
  const l = loadPlans(rootDir);
  const v = { version: (l.versions.at(-1)?.version || 0) + 1, at: new Date().toISOString(), by, test: testMode(), plan };
  l.versions.push(v); l.versions = l.versions.slice(-60);
  writeJson(plansFile(rootDir), l);
  return v;
}

export const loadAds = (r) => readJson(adsFile(r), { ads: {}, reviews: {}, videos: {} });
export const saveAds = (r, l) => writeJson(adsFile(r), l);
export function mutateAds(rootDir, fn) { const l = loadAds(rootDir); const out = fn(l); saveAds(rootDir, l); return out; }

// ads submitted today (Pacific), by kind, in this mode (test or live)
export const adsToday = (l, kind, now = new Date()) => Object.values(l.ads).filter((a) => a.kind === kind && !!a.test === testMode() && ptDay(a.created_at) === ptDay(now));
// video jobs started today (the 1-a-day video cap also limits generation: a video costs real money)
export const videosStartedToday = (l, now = new Date()) => Object.values(l.videos).filter((v) => !!v.test === testMode() && ptDay(v.started_at) === ptDay(now));
// ads queued for Growth in this mode, oldest first
export const queuedAds = (l) => Object.values(l.ads).filter((a) => a.state === "queued" && !!a.test === testMode()).sort((a, b) => a.created_at.localeCompare(b.created_at));

// For agents_log: the CEO's plans and the ad pipeline's decisions since `since`
export function creativeEvents(rootDir, since) {
  const t = since ? new Date(since).toISOString() : "";
  const ev = [];
  for (const v of loadPlans(rootDir).versions) if (v.at > t && !!v.test === testMode())
    ev.push({ at: v.at, type: "ceo_plan", by: "CEO agent", version: v.version, themes: v.plan.themes, push_products: v.plan.push_products, notes: v.plan.notes });
  const l = loadAds(rootDir);
  for (const r of Object.values(l.reviews)) if (r.done_at && r.done_at > t && !!r.test === testMode())
    ev.push({ at: r.done_at, type: r.pass ? "ad_passed_review" : "ad_rejected_by_reviewer", by: "reviewer agent (vision)", concept: r.concept, kind: r.kind, reasons: r.reasons });
  for (const a of Object.values(l.ads)) if (a.created_at > t && !!a.test === testMode())
    ev.push({ at: a.created_at, type: "ad_made", by: "Creative agent", kind: a.kind, concept: a.concept, caption: a.caption, event: a.event });
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

// ---- phase 8: code picks each ad's kind (video <-> image, within the caps) and features new designs first ----
const modeKey = () => (testMode() ? "test" : "live");
export const lastKind = (l) => (l.last_kind || {})[modeKey()] || null;
export const setLastKind = (l, kind) => { (l.last_kind ||= {})[modeKey()] = kind; };
// Pure: the other kind than last time, if it still has room today; else the one that does; null = both caps are full
export function pickKind({ last, imageLeft, videoLeft }) {
  const order = last === "video" ? ["image", "video"] : ["video", "image"];
  return order.find((k) => (k === "video" ? videoLeft : imageLeft) > 0) || null;
}
// Pure: live agent designs (catalog entries with by_agents) that no ad of this mode has featured yet, oldest catalog order
export function unadvertised(catalog, l) {
  const featured = new Set(Object.values(l.ads || {}).filter((a) => !!a.test === testMode() && a.state !== "withdrawn").flatMap((a) => a.featured_products || []));
  return (catalog || []).filter((p) => p.by_agents && !featured.has(p.slug));
}

// Pure: the product this ad features. Every ad features one (John: our clothes, worn): a new agent design without an ad
// first; else the live catalog in rotation (least recently featured first).
export function pickFeature(catalog, l) {
  const fresh = unadvertised(catalog, l);
  if (fresh.length) return { product: fresh[0], why: "new agent design without an ad yet" };
  const last = {};
  for (const a of Object.values(l.ads || {})) if (!!a.test === testMode() && a.state !== "withdrawn") for (const s of a.featured_products || []) if (!last[s] || a.created_at > last[s]) last[s] = a.created_at;
  const pool = [...(catalog || [])].sort((a, b) => String(last[a.slug] || "").localeCompare(String(last[b.slug] || "")) || String(a.slug).localeCompare(b.slug));
  return pool.length ? { product: pool[0], why: "catalog rotation (least recently featured)" } : null;
}
