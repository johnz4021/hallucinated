// Growth's content rotation, decided in code (state lives in the X ledger, not the LLM's memory).
// One original post per run (ad = a reviewed ad from the Creative agent, right after new_design):
//   new_design  whenever an agent design is published and not yet announced (always first)
//   else rotate agents_log -> spotlight -> reply_bait -> joke, skipping a pillar with nothing to say
//   (agents_log: nothing new in the design ledger since the last agents_log post; spotlight: no product to show).
// Link rule: at most 1 in 3 original posts carries the store link. new_design announcements are exempt (they always link)
// and don't count toward the window.
export const ROTATION = ["agents_log", "spotlight", "reply_bait", "joke"];
export const PILLARS = ["new_design", "ad", ...ROTATION];

// ads first (John, Sat 17:40: "focus everything on growth ads"), then new_design, then the rotation
export function nextPillar({ lastRotation, hasNewDesign, hasAd, agentsLogNew, spotlightAvailable }) {
  if (hasAd) return "ad";
  if (hasNewDesign) return "new_design";
  const can = { agents_log: !!agentsLogNew, spotlight: !!spotlightAvailable, reply_bait: true, joke: true };
  const start = ROTATION.indexOf(lastRotation) + 1;   // -1 + 1 = 0 when nothing has run yet
  for (let i = 0; i < ROTATION.length; i++) { const p = ROTATION[(start + i) % ROTATION.length]; if (can[p]) return p; }
  return "joke";
}

const originals = (ledger) => (ledger.posts || []).filter((p) => p.kind === "post" && !p.thread);
export const lastOriginal = (ledger) => originals(ledger).at(-1) || null;
export const LINK_WINDOW = 3;
// a non-announcement post may link only if none of the previous LINK_WINDOW-1 non-announcement originals did
export const linkAllowed = (ledger, pillar) => pillar === "new_design"
  || !originals(ledger).filter((p) => p.pillar !== "new_design").slice(-(LINK_WINDOW - 1)).some((p) => p.has_link);
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
