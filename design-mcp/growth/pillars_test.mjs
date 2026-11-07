// Unit checks for Growth's content rotation and the 1-in-3 store-link rule. Pure; no network.
//   node growth/pillars_test.mjs
import assert from "node:assert/strict";
import { nextPillar, linkAllowed, hasStoreLink, agentsLogEvents, pickSpotlight, ROTATION } from "./pillars.mjs";

// rotation: new_design first, else agents_log -> spotlight -> reply_bait -> joke, skipping empty pillars
const all = { agentsLogNew: true, spotlightAvailable: true };
assert.equal(nextPillar({ ...all, hasNewDesign: true, lastRotation: "spotlight" }), "new_design");
assert.equal(nextPillar({ ...all, lastRotation: undefined }), "agents_log");
assert.equal(nextPillar({ ...all, lastRotation: "agents_log" }), "spotlight");
assert.equal(nextPillar({ ...all, lastRotation: "spotlight" }), "reply_bait");
assert.equal(nextPillar({ ...all, lastRotation: "reply_bait" }), "joke");
assert.equal(nextPillar({ ...all, lastRotation: "joke" }), "agents_log");
assert.equal(nextPillar({ agentsLogNew: false, spotlightAvailable: true, lastRotation: "joke" }), "spotlight");    // nothing new in the loop: skip
assert.equal(nextPillar({ agentsLogNew: false, spotlightAvailable: false, lastRotation: "joke" }), "reply_bait");
// a full cycle with everything available visits each pillar once
let last, seen = [];
for (let i = 0; i < 4; i++) { const p = nextPillar({ ...all, lastRotation: last }); seen.push(p); last = p; }
assert.deepEqual(seen, ROTATION);

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
