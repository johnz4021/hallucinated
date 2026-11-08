// Unit checks for linking posted ads to their X post on the store (CONTENT.md §5 x_url). Temp root, fake store.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachXUrl, backfillXUrls, needsXUrl, campaignItem, xUrlFor } from "./x_urls.mjs";
import { loadAds, saveAds } from "./ledger.mjs";

delete process.env.ADS_TEST;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "xurls-"));
const base = { kind: "image", media_url: "https://b/x.png", concept: "c", caption: "cap", event: false, sources: [], featured_products: [], created_at: "2026-11-07T20:00:00Z", campaign: { ok: true } };
saveAds(root, { ads: {
  ad_posted: { id: "ad_posted", ...base, state: "posted", posted: { post_id: "111", at: "2026-11-08T02:06:00Z" } },
  ad_queued: { id: "ad_queued", ...base, state: "queued" },
  ad_nostore: { id: "ad_nostore", ...base, state: "posted", posted: { post_id: "222" }, campaign: { ok: false } },
  ad_test: { id: "ad_test", ...base, state: "posted", posted: { post_id: "333" }, test: true },
}, reviews: {}, videos: {} });
const store = (fail) => { const calls = []; return { calls, call: async (m, p, { json }) => { calls.push({ m, p, json }); if (fail) { const e = new Error("store PATCH /api/admin/content 400: unknown field x_url"); e.status = 400; throw e; } return { ok: true }; } }; };

assert.equal(xUrlFor("hallucinateddpt", "111"), "https://x.com/hallucinateddpt/status/111");
assert.deepEqual(Object.values(loadAds(root).ads).filter(needsXUrl).map((a) => a.id), ["ad_posted"]);   // not queued, not without a store copy, not test ads in live mode
console.log("needsXUrl: OK");

// store rejects x_url (prod before the phase-6 storefront): recorded locally, no throw, retried later
const s400 = store(true);
const r1 = await attachXUrl({ rootDir: root, adId: "ad_posted", username: "hallucinateddpt", postId: "111", admin: s400 });
assert.equal(r1.ok, false); assert.equal(r1.x_url, "https://x.com/hallucinateddpt/status/111"); assert.equal(r1.status, 400);
let a = loadAds(root).ads.ad_posted;
assert.equal(a.x_url, "https://x.com/hallucinateddpt/status/111"); assert.equal(a.x_url_store.ok, false); assert.equal(a.x_url_store.tries, 1);
// the upsert carries the FULL item plus x_url (safe for merge or replace semantics)
assert.deepEqual(s400.calls[0].json, { op: "upsert", collection: "campaigns", item: campaignItem(a) });
assert.equal(s400.calls[0].json.item.media_url, "https://b/x.png"); assert.equal(s400.calls[0].json.item.x_url, a.x_url);
assert.ok(needsXUrl(a));
console.log("400 recorded, retried later: OK");

// the next Growth run's backfill succeeds once the store accepts it, then stops retrying
const sOk = store(false);
const out = await backfillXUrls({ rootDir: root, username: "hallucinateddpt", admin: sOk });
assert.deepEqual(out.map((o) => [o.id, o.ok]), [["ad_posted", true]]);
a = loadAds(root).ads.ad_posted;
assert.equal(a.x_url_store.ok, true); assert.equal(a.x_url_store.tries, 2); assert.equal(needsXUrl(a), false);
assert.deepEqual(await backfillXUrls({ rootDir: root, username: "hallucinateddpt", admin: sOk }), []);
assert.equal(sOk.calls.length, 1);
console.log("backfill once accepted, then idle: OK");

// never throws: missing ad, store not configured, a store that explodes
assert.equal((await attachXUrl({ rootDir: root, adId: "nope", admin: sOk })).ok, false);
assert.equal((await attachXUrl({ rootDir: root, adId: "ad_nostore", username: "h", admin: sOk })).ok, false);
assert.equal(loadAds(root).ads.ad_nostore.x_url, "https://x.com/h/status/222");   // still recorded locally
assert.equal((await attachXUrl({ rootDir: root, adId: "ad_posted", admin: { error: "STORE_ADMIN_SECRET is not in .env" } })).ok, false);
assert.equal((await attachXUrl({ rootDir: root, adId: "ad_posted", admin: { call: async () => { throw new TypeError("fetch failed"); } } })).ok, false);
console.log("never throws: OK");
console.log("x_url tests: all OK");
