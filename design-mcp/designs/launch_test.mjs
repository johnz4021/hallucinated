// Offline checks for designs/launch.mjs (no network, no spend): shot plan, verdict rules, store item shape (CONTENT.md §6).
//   node designs/launch_test.mjs
import assert from "node:assert/strict";
import { shotPlan, shotPrompt, launchVerdict, launchItem, altFor, isTest, costOf, gensToday } from "./launch.mjs";

const info = { slug: "git-blame-ai-tee", title: "Git blame AI", text: "> git blame --ai", print_line: "terminal command over a shrugging ghost", mode: "live" };
const plan = shotPlan(info.slug);
assert.equal(plan.length, 3);
assert.deepEqual(plan.map((s) => s.view), ["back", "front", "candid"]);
assert.equal(new Set(plan.map((s) => s.setting)).size, 3, "three different settings");
assert.equal(new Set(plan.map((s) => s.person)).size, 3, "three different people");
assert.deepEqual(shotPlan(info.slug), plan, "stable per slug");
assert.match(shotPrompt(plan[0], info), /"> git blame --ai"/);
assert.match(shotPrompt(plan[1], info), /"hallucinated"/);
assert.match(shotPrompt(plan[0], info, "the ghost is missing"), /rejected by our reviewer: the ghost is missing/);

const good = { pass: true, product_accurate: true, text_legible: true, photo_believable: true, real_person: false, real_names: false, other_logos: false, slurs_or_protected_group: false, tragedy: false, quality: "good", reasons: "ok" };
assert.equal(launchVerdict(good).pass, true);
assert.equal(launchVerdict({ ...good, photo_believable: false }).pass, false);
assert.equal(launchVerdict({ ...good, product_accurate: null }).pass, false, "accuracy must be a definite yes");
assert.equal(launchVerdict({ ...good, other_logos: true }).pass, false);
assert.equal(launchVerdict({ ...good, quality: "bad" }).pass, false);
assert.equal(launchVerdict(null).pass, false);

const img = { url: "https://x2ww2cgnt2vbaqob.public.blob.vercel-storage.com/media/agents/git-blame-ai-tee-launch-1-abc.jpg", alt: altFor(plan[0], info) };
const item = launchItem(info, [img, img, img, img, img, img, img], true, "2026-11-08T00:00:00.000Z");
assert.equal(item.slug, "git-blame-ai-tee");
assert.equal(item.images.length, 6);
assert.ok(item.images.every((i) => i.kind === "on_model" && i.alt.length <= 300 && i.alt.length > 0));
assert.equal(item.test, true);
assert.ok(altFor(plan[0], info).includes("fictional"));

assert.equal(isTest({ mode: "live" }), process.env.LAUNCH_TEST === "1" || process.env.ADS_TEST === "1");
assert.equal(isTest({ mode: "test" }), true);
assert.equal(isTest({ mode: "live" }, true), true);
assert.ok(costOf("gpt-image-1", { input_tokens: 1000, output_tokens: 6000, input_tokens_details: { image_tokens: 800, text_tokens: 200 } }) > 0.2);
assert.equal(gensToday({ gens: [{ at: new Date().toISOString() }, { at: "2020-01-01T00:00:00Z" }] }), 1);
console.log("launch_test: all good");
