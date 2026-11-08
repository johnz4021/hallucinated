// Phase 8 unit checks (no network, no model spend): kind alternation within caps, new designs featured first, the video
// headline rules, the composer on a synthetic clip (ffmpeg), and the reviewer brief for a composed video.
//   node creative/phase8_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pickKind, unadvertised } from "./ledger.mjs";
import { wrapHeadline, headlineCheck, composeVideo, VIDEO_NO_TEXT, STORE_HOST } from "./video_compose.mjs";
import { reviewBrief } from "./tools.mjs";

delete process.env.ADS_TEST;
// kind: alternate video <-> image, starting with video; fall back to whichever still has room; null when both are full
assert.equal(pickKind({ last: null, imageLeft: 10, videoLeft: 5 }), "video");
assert.equal(pickKind({ last: "video", imageLeft: 10, videoLeft: 5 }), "image");
assert.equal(pickKind({ last: "image", imageLeft: 10, videoLeft: 5 }), "video");
assert.equal(pickKind({ last: "image", imageLeft: 3, videoLeft: 0 }), "image");     // video cap full (or spend guard)
assert.equal(pickKind({ last: "video", imageLeft: 0, videoLeft: 2 }), "video");
assert.equal(pickKind({ last: "video", imageLeft: 0, videoLeft: 0 }), null);
console.log("kind alternation within caps: OK");

// new designs first: agent designs no ad (of this mode, not withdrawn) has featured yet
const catalog = [{ slug: "drop-1-tee", by_agents: false }, { slug: "git-blame-ai-tee", by_agents: true }, { slug: "npm-install-debt-tee", by_agents: true }];
const l = { ads: { a: { featured_products: ["git-blame-ai-tee"], state: "posted" }, b: { featured_products: ["npm-install-debt-tee"], state: "withdrawn" }, c: { featured_products: ["npm-install-debt-tee"], test: true, state: "queued" } } };
assert.deepEqual(unadvertised(catalog, l).map((p) => p.slug), ["npm-install-debt-tee"]);
assert.deepEqual(unadvertised(catalog, { ads: {} }).map((p) => p.slug), ["git-blame-ai-tee", "npm-install-debt-tee"]);
console.log("unadvertised designs: OK");

// headline: 1-8 words, <= 48 chars, ASCII, no links/hashtags; wraps into <= 2 lines
assert.equal(headlineCheck("Your agent shipped to prod on Friday"), null);
assert.match(headlineCheck("one two three four five six seven eight nine"), /8 words/);
assert.match(headlineCheck("it’s fine"), /ASCII/);
assert.match(headlineCheck("see hallucinated-store.vercel.app https://x"), /links/);
assert.match(headlineCheck("#vibecoding forever"), /hashtags/);
assert.deepEqual(wrapHeadline("Your agent shipped to prod on Friday"), ["Your agent shipped to", "prod on Friday"]);
assert.equal(wrapHeadline("a".repeat(30) + " " + "b".repeat(30) + " " + "c".repeat(30)), null);
assert.match(VIDEO_NO_TEXT, /No text of any kind/);
console.log("headline rules: OK");

// composer on a synthetic 9:16 clip: H.264, 720 wide, clip + 1.3 s end card, poster JPEG, under X's limits
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p8-"));
const src = path.join(tmp, "src.mp4");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=24:d=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", src]);
const r = await composeVideo({ input: src, out: path.join(tmp, "out.mp4"), poster: path.join(tmp, "out.jpg"), headline: "Your agent shipped to prod on Friday", position: "top" });
assert.equal(r.width, 720); assert.equal(r.height, 1280);
assert.ok(Math.abs(r.duration - 6.3) < 0.15, `duration ${r.duration}`);
assert.ok(r.bytes > 50_000 && r.bytes < 15_000_000);
assert.ok(fs.statSync(r.poster).size > 5_000);
const codec = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "csv=p=0", r.out]).toString().trim();
assert.equal(codec, "h264,yuv420p");
console.log(`composer: OK (${r.width}x${r.height}, ${r.duration.toFixed(2)} s, ${Math.round(r.bytes / 1024)} KB)`);

// the reviewer brief for a composed video names the headline, the end card and "no other text"
const brief = reviewBrief({ kind: "video", files: ["fil_1", "fil_2", "fil_3"], refs: [], concept: "c", caption: "cap", featured: null, text_in_image: "Your agent shipped to prod on Friday", composite: true });
assert.match(brief, /FINAL video/); assert.match(brief, new RegExp(STORE_HOST.replace(/\./g, "\\."))); assert.match(brief, /NO text anywhere/);
assert.match(brief, /"Your agent shipped to prod on Friday"/);
assert.doesNotMatch(reviewBrief({ kind: "image", files: ["fil_1"], refs: [], concept: "c", caption: "cap", featured: null }), /FINAL video/);
console.log("reviewer brief (composed video): OK");
console.log("phase 8 tests: all OK");

// photoreal (John, Sat 18:00): every ad features a product, worn; new designs first, else catalog rotation
{
  const { pickFeature } = await import("./ledger.mjs");
  const { verdict } = await import("./tools.mjs");
  const { AD_FORMATS, AD_PHOTO_STYLES } = await import("../designs/styles.mjs");
  const cat = [{ slug: "drop-1-tee" }, { slug: "hoodie" }, { slug: "git-blame-ai-tee", by_agents: true }];
  assert.equal(pickFeature(cat, { ads: {} }).product.slug, "git-blame-ai-tee");
  const used = { ads: { a: { featured_products: ["git-blame-ai-tee"], created_at: "2026-11-08T01:00:00Z", state: "posted" }, b: { featured_products: ["drop-1-tee"], created_at: "2026-11-08T02:00:00Z", state: "queued" } } };
  assert.equal(pickFeature(cat, used).product.slug, "hoodie");   // never featured -> first in the rotation
  assert.equal(pickFeature([], { ads: {} }), null);
  assert.ok(!Object.keys(AD_FORMATS).some((k) => /billboard|tabloid|poster|placard|slide|terminal|incident|trading/.test(k)));
  assert.ok(Object.values(AD_PHOTO_STYLES).every((t) => /photo|film|iPhone/i.test(t)));
  const good = { pass: true, photorealistic: true, garment_worn_centre: true, print_matches: true, no_extra_text: true, product_accurate: true, text_legible: true, real_person: false, real_names: false, other_logos: false, slurs_or_protected_group: false, tragedy: false, quality: "good" };
  assert.equal(verdict(good).pass, true);
  for (const k of ["photorealistic", "garment_worn_centre", "print_matches", "no_extra_text", "no_third_party_branding"]) assert.equal(verdict({ ...good, [k]: false }).pass, false, k);
  const b = reviewBrief({ kind: "image", files: ["fil_1"], refs: [], concept: "c", caption: "cap", featured: { name: "x", slug: "x" } });
  assert.match(b, /PHOTOREALISTIC/); assert.match(b, /garment_worn_centre/); assert.match(b, /print_matches/);
  console.log("photoreal: feature rotation, scenarios, reviewer checks: OK");
}
