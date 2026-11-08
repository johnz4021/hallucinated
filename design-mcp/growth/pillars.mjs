// Growth's content rotation, decided in code (state lives in the X ledger, not the LLM's memory).
// Phase 8 (John, Sat): Growth posts hard-hitting ADS, not plain tees. One original post per run:
//   ad          a reviewed ad from the Creative agent (new agent designs are announced THROUGH an ad that features them)
//   agents_log  rare fallback: something new happened in the loop AND no agents_log post yet today (Pacific)
//   else alternate reply_bait <-> joke
// spotlight and plain new_design posts are out of the rotation (the names stay valid for old ledger entries).
// Link rule: at most 1 in 3 original posts carries the store link (new_design announcements, now unused, stay exempt).
export const ROTATION = ["reply_bait", "joke"];
export const PILLARS = ["ad", "agents_log", ...ROTATION, "new_design", "spotlight"];

export function nextPillar({ lastRotation, hasAd, agentsLogNew, agentsLogToday }) {
  if (hasAd) return "ad";
  if (agentsLogNew && !agentsLogToday) return "agents_log";
  return lastRotation === "reply_bait" ? "joke" : "reply_bait";
}

const originals = (ledger) => (ledger.posts || []).filter((p) => p.kind === "post" && !p.thread);
export const lastOriginal = (ledger) => originals(ledger).at(-1) || null;
export const LINK_WINDOW = Number(process.env.X_LINK_WINDOW || 3);   // 1 = every post may link (John Sat 23:45: no link limit)
// a non-announcement post may link only if none of the previous LINK_WINDOW-1 non-announcement originals did
// Announcements (a new_design post, or an ad that announces a new agent design: it MUST carry the product URL) are exempt
// and don't count toward the window (Sat 23:30: the two rules contradicted each other and Growth looped 8x).
const isAnnouncement = (p) => p.pillar === "new_design" || !!p.announces;
export const linkAllowed = (ledger, pillar, { announces = false } = {}) => pillar === "new_design" || announces || LINK_WINDOW <= 1
  || !originals(ledger).filter((p) => !isAnnouncement(p)).slice(-(LINK_WINDOW - 1)).some((p) => p.has_link);
export const hasStoreLink = (text, storeUrl) => {
  const host = (() => { try { return new URL(storeUrl).host; } catch { return "hallucinated-store.vercel.app"; } })();
  return String(text).toLowerCase().includes(host.toLowerCase());
};

// What happened in the design loop since `since` (from design-proposals.json), as plain events Growth may describe.
export function agentsLogEvents(proposals, mode, since) {
  const t = since ? new Date(since).toISOString() : "";
  const ev = [];
  for (const p of Object.values(proposals)) {
    if (p.mode !== mode || p.state === "abandoned") continue;
    if (p.proposed_at > t) ev.push({ at: p.proposed_at, type: "proposed", by: "Product agent", title: p.title, slug: p.slug, pitch: p.pitch, why_now: p.trend_summary });
    const d = p.decision;
    if (d?.at && d.at > t) {
      if (d.overridden_by_code) ev.push({ at: d.at, type: "blocked_by_code", title: p.title, rule: Array.isArray(d.overridden_by_code) ? "brand guardrail (names, marks or tragedies)" : String(d.overridden_by_code) });
      else ev.push({ at: d.at, type: d.decision === "approve" ? "ceo_approved" : "ceo_rejected", by: "CEO agent", title: p.title, reason: d.reason });
    }
    if (p.publish?.published_at && p.publish.published_at > t) ev.push({ at: p.publish.published_at, type: "published", title: p.title, url: p.publish.url, status: "pre-order" });
  }
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

// Least recently spotlighted product first, skipping any product that was in one of the last few posts (e.g. just announced).
export function pickSpotlight(products, history = {}, recentPosts = []) {
  const recent = (s) => recentPosts.some((p) => p.announces === s || String(p.text || "").includes(`/p/${s}`));
  const pool = products.filter((p) => !recent(p.slug));
  return [...(pool.length ? pool : products)].sort((a, b) => String(history[a.slug] || "").localeCompare(String(history[b.slug] || "")) || String(a.slug).localeCompare(b.slug))[0] || null;
}
