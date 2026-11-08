// Unit checks for Growth's content rotation and the 1-in-3 store-link rule. Pure; no network.
//   node growth/pillars_test.mjs
import assert from "node:assert/strict";
import { nextPillar, linkAllowed, hasStoreLink, agentsLogEvents, pickSpotlight, ROTATION } from "./pillars.mjs";

// rotation (phase 8): ad first; else agents_log at most once a day when something new happened; else reply_bait <-> joke
assert.equal(nextPillar({ hasAd: true, agentsLogNew: true, lastRotation: "joke" }), "ad");
assert.equal(nextPillar({ hasAd: false, agentsLogNew: true, agentsLogToday: false, lastRotation: "joke" }), "agents_log");
assert.equal(nextPillar({ hasAd: false, agentsLogNew: true, agentsLogToday: true, lastRotation: "joke" }), "reply_bait");   // 1/day
assert.equal(nextPillar({ hasAd: false, agentsLogNew: false, lastRotation: "reply_bait" }), "joke");
assert.equal(nextPillar({ hasAd: false, agentsLogNew: false, lastRotation: "agents_log" }), "reply_bait");
assert.equal(nextPillar({ hasAd: false, agentsLogNew: false, lastRotation: undefined }), "reply_bait");
assert.deepEqual(ROTATION, ["reply_bait", "joke"]);
// spotlight and plain new_design are never picked any more
for (const lastRotation of [undefined, "agents_log", "spotlight", "reply_bait", "joke"]) for (const hasAd of [true, false]) for (const agentsLogNew of [true, false])
  assert.ok(!["spotlight", "new_design"].includes(nextPillar({ lastRotation, hasAd, agentsLogNew, hasNewDesign: true, spotlightAvailable: true })));

// link rule: at most 1 in 3 originals; announcements exempt and not counted; replies/threads don't count
const L = (...posts) => ({ posts: posts.map(([pillar, has_link, extra = {}]) => ({ kind: "post", thread: false, pillar, has_link, ...extra })) });
assert.equal(linkAllowed(L(), "joke"), true);
assert.equal(linkAllowed(L(["spotlight", true]), "joke"), false);
assert.equal(linkAllowed(L(["spotlight", true], ["joke", false]), "reply_bait"), false);
assert.equal(linkAllowed(L(["spotlight", true], ["joke", false], ["reply_bait", false]), "agents_log"), true);
assert.equal(linkAllowed(L(["spotlight", true], ["joke", false]), "new_design"), true);                     // exempt
assert.equal(linkAllowed(L(["joke", false], ["new_design", true], ["reply_bait", false]), "spotlight"), true); // announcement not counted
assert.equal(linkAllowed(L(["spotlight", true], ["joke", false], ["x", true, { thread: true }]), "agents_log"), false);
assert.equal(hasStoreLink("see https://hallucinated-store.vercel.app/p/x-tee", "https://hallucinated-store.vercel.app"), true);
assert.equal(hasStoreLink("no link here", "https://hallucinated-store.vercel.app"), false);

// agents_log: only real events of this mode, after `since`, with the CEO's reasons
const props = {
  a: { mode: "live", state: "rejected", title: "Thing", slug: "thing-tee", pitch: "p", trend_summary: "t", proposed_at: "2026-11-08T17:00:00Z", decision: { decision: "reject", reason: "the joke needs a real company to land", at: "2026-11-08T17:01:00Z" } },
  b: { mode: "live", state: "published", title: "Other", slug: "other-tee", pitch: "p", trend_summary: "t", proposed_at: "2026-11-08T18:00:00Z", decision: { decision: "approve", reason: "lands", at: "2026-11-08T18:01:00Z" }, publish: { published_at: "2026-11-08T18:01:30Z", url: "https://hallucinated-store.vercel.app/p/other-tee" } },
  c: { mode: "test", state: "published", title: "Sandbox", slug: "s-tee", proposed_at: "2026-11-08T18:00:00Z" },
  d: { mode: "live", state: "abandoned", title: "Broken", slug: "b-tee", proposed_at: "2026-11-08T18:00:00Z" },
};
const ev = agentsLogEvents(props, "live", "2026-11-08T16:00:00Z");
assert.deepEqual(ev.map((e) => e.type), ["proposed", "ceo_rejected", "proposed", "ceo_approved", "published"]);
assert.equal(ev[1].reason, "the joke needs a real company to land");
assert.equal(agentsLogEvents(props, "live", "2026-11-08T18:01:10Z").length, 1);
assert.equal(agentsLogEvents(props, "live", "2026-11-08T19:00:00Z").length, 0);

// spotlight: least recently featured first
const prods = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];
assert.equal(pickSpotlight(prods, {}).slug, "a");
assert.equal(pickSpotlight(prods, { a: "2026-11-08T10:00:00Z", b: "2026-11-08T09:00:00Z" }).slug, "c");
assert.equal(pickSpotlight(prods, { a: "2026-11-08T10:00:00Z", b: "2026-11-08T09:00:00Z", c: "2026-11-08T11:00:00Z" }).slug, "b");
// ...and never the product a recent post just announced or linked (the 5-cycle dry run spotlighted the fresh announcement)
assert.equal(pickSpotlight(prods, {}, [{ announces: "a", text: "new" }]).slug, "b");
assert.equal(pickSpotlight(prods, {}, [{ text: "see https://hallucinated-store.vercel.app/p/a" }, { text: "x /p/b" }]).slug, "c");
assert.equal(pickSpotlight([{ slug: "a" }], {}, [{ announces: "a" }]).slug, "a");   // only one product: still spotlight it
console.log("growth pillars + link rule: OK");
