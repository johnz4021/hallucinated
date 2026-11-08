// Unit checks for the ad pipeline: the reviewer verdict rule, hashtags, daily caps (test vs live kept apart), agents_log
// events, and the ad pillar's priority. Pure; a temp folder stands in for the repo root.
//   node creative/creative_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verdict, badHashtags, reviewBrief } from "./tools.mjs";
import { savePlan, latestPlan, loadAds, saveAds, adsToday, videosStartedToday, queuedAds, creativeEvents } from "./ledger.mjs";
import { nextPillar } from "../growth/pillars.mjs";

// reviewer verdict: code decides from the flags, not just the model's "pass"
const ok = { pass: true, product_accurate: true, text_legible: true, real_person: false, real_names: false, other_logos: false, slurs_or_protected_group: false, tragedy: false, quality: "good", reasons: "fine" };
assert.equal(verdict(ok).pass, true);
assert.equal(verdict({ ...ok, product_accurate: null, text_legible: null }).pass, true);          // no product / no text shown
for (const k of ["real_person", "real_names", "other_logos", "slurs_or_protected_group", "tragedy"]) assert.equal(verdict({ ...ok, [k]: true }).pass, false, k);
assert.deepEqual(verdict({ ...ok, other_logos: true }).hard_lines, ["other_logos"]);
assert.equal(verdict({ ...ok, text_legible: false }).pass, false);
assert.equal(verdict({ ...ok, product_accurate: false }).pass, false);
assert.equal(verdict({ ...ok, quality: "bad" }).pass, false);
assert.equal(verdict({ ...ok, pass: false }).pass, false);
assert.equal(verdict(null).pass, false);
assert.match(reviewBrief({ kind: "video", files: ["fil_a", "fil_b"], refs: [], concept: "c", caption: "x" }), /3 frames/);

// hashtags: only #hallucinated
assert.deepEqual(badHashtags("new drop #hallucinated"), []);
assert.deepEqual(badHashtags("lol #AI #Waymo ok #Hallucinated"), ["#AI", "#Waymo"]);
assert.deepEqual(badHashtags("no tags, a # alone, C# is fine?"), []);

// caps per Pacific day, test and live kept apart
const root = fs.mkdtempSync(path.join(os.tmpdir(), "creative-test-"));
const now = new Date().toISOString();
const l = loadAds(root);
l.ads = { a: { id: "a", kind: "image", created_at: now, test: true, state: "queued" }, b: { id: "b", kind: "image", created_at: now, test: false, state: "queued" },
  c: { id: "c", kind: "video", created_at: now, test: true, state: "posted" }, d: { id: "d", kind: "image", created_at: "2026-01-01T20:00:00Z", test: true, state: "queued" } };
l.videos = { j1: { started_at: now, test: true }, j2: { started_at: now, test: false } };
saveAds(root, l);
process.env.ADS_TEST = "1";
assert.equal(adsToday(loadAds(root), "image").length, 1);          // a (b is live, d another day)
assert.equal(adsToday(loadAds(root), "video").length, 1);
assert.equal(videosStartedToday(loadAds(root)).length, 1);
assert.deepEqual(queuedAds(loadAds(root)).map((x) => x.id), ["d", "a"]);   // oldest first, test only
process.env.ADS_TEST = "0";
assert.deepEqual(queuedAds(loadAds(root)).map((x) => x.id), ["b"]);       // the live server never sees test ads

// plan versions + agents_log events
savePlan(root, { themes: ["Waymo honk choir"], push_products: ["git-reset-hard-tee"], ad_seeds: [], notes: "n" }, "ceo");
savePlan(root, { themes: ["demo day"], push_products: [], ad_seeds: [], notes: "" }, "ceo");
assert.equal(latestPlan(root).version, 2);
const ev = creativeEvents(root, "2026-01-01T00:00:00Z");
assert.deepEqual(ev.filter((e) => e.type === "ceo_plan").map((e) => e.version), [1, 2]);
assert.ok(ev.some((e) => e.type === "ad_made" && e.caption === undefined || e.type === "ad_made"));

// pillar priority: new_design > ad > rotation
assert.equal(nextPillar({ hasNewDesign: true, hasAd: true }), "new_design");
assert.equal(nextPillar({ hasNewDesign: false, hasAd: true, lastRotation: "joke" }), "ad");
assert.equal(nextPillar({ hasNewDesign: false, hasAd: false, lastRotation: "joke", agentsLogNew: true }), "agents_log");
console.log("creative pipeline checks: OK");
