// Links each posted ad's store campaign to the X post that ran it (CONTENT.md §5 `x_url`: the product page's
// "As seen in" strip links there). x_post calls attachXUrl after posting an ad (never awaited, never fails the post);
// every Growth run (growth_next_pillar) and creative/backfill_x_urls.mjs retry any posted ad whose store copy lacks it.
// The x_url is recorded in ads.json first (ad.x_url), the store result in ad.x_url_store.
// The upsert carries the FULL campaign item plus x_url, so it is correct whether the store merges partial upserts or
// replaces the item. Until the store accepts x_url, a 400 is expected and simply retried later.
import { storeAdmin } from "../designs/publish.mjs";
import { loadAds, mutateAds, testMode } from "./ledger.mjs";

export const xUrlFor = (username, postId) => `https://x.com/${username || "hallucinateddpt"}/status/${postId}`;

// The store's campaigns item for an ad (CONTENT.md §5); shared with publishAdToStore.
export const campaignItem = (ad) => ({ id: ad.id, kind: ad.kind, media_url: ad.media_url, ...(ad.poster_url ? { poster_url: ad.poster_url } : {}), concept: ad.concept, caption: ad.caption,
  event: ad.event, sources: ad.sources, featured_products: ad.featured_products, created_at: ad.created_at, test: !!ad.test, ...(ad.x_url ? { x_url: ad.x_url } : {}) });

// posted (for real), in this mode, with a store copy, whose x_url isn't on the store yet
export const needsXUrl = (ad) => !!ad && ad.state === "posted" && !!ad.posted?.post_id && !!ad.test === testMode() && !!ad.campaign?.ok && !!ad.media_url && !ad.x_url_store?.ok;

// -> { ok, x_url, error? }  Never throws.
export async function attachXUrl({ rootDir, adId, username, postId, admin = storeAdmin(rootDir), log = () => {} }) {
  try {
    const cur = loadAds(rootDir).ads[adId];
    if (!cur) return { ok: false, error: `no ad ${adId}` };
    const x_url = cur.x_url || xUrlFor(username, postId || cur.posted?.post_id);
    if (!cur.x_url) mutateAds(rootDir, (x) => { x.ads[adId].x_url = x_url; });
    const ad = loadAds(rootDir).ads[adId];
    if (!ad.campaign?.ok || !ad.media_url) return { ok: false, x_url, error: "the ad has no store campaign yet (publish_ads.mjs first)" };
    if (admin.error) { mutateAds(rootDir, (x) => { x.ads[adId].x_url_store = { ok: false, error: admin.error, at: new Date().toISOString(), tries: (x.ads[adId].x_url_store?.tries || 0) + 1 }; }); return { ok: false, x_url, error: admin.error }; }
    let res;
    try { await admin.call("PATCH", "/api/admin/content", { json: { op: "upsert", collection: "campaigns", item: campaignItem(ad) } }); res = { ok: true }; }
    catch (e) { res = { ok: false, error: e.message, status: e.status ?? null }; }
    mutateAds(rootDir, (x) => { x.ads[adId].x_url_store = { ...res, at: new Date().toISOString(), tries: (x.ads[adId].x_url_store?.tries || 0) + 1 }; });
    log(`[x_url] ${adId} -> ${x_url}: ${res.ok ? "on the store" : `not yet (${res.error})`}`);
    return { ...res, x_url };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Retry every posted ad still missing its x_url on the store. Sequential; never throws.
export async function backfillXUrls({ rootDir, username, admin = storeAdmin(rootDir), log = () => {} }) {
  const todo = Object.values(loadAds(rootDir).ads).filter(needsXUrl);
  const out = [];
  for (const ad of todo) out.push({ id: ad.id, ...(await attachXUrl({ rootDir, adId: ad.id, username, admin, log })) });
  return out;
}
