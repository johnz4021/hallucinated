// Unit checks for the LinkedIn API tools (no network). node linkedin/tools_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scheduleCheck, textCheck, candidates, resolveOrgs, registerLinkedInTools, SPONSORS } from "./tools.mjs";
import { buildCommentary, postBody, escapeLittle } from "./li.mjs";

const BLOB = "https://x2ww2cgnt2vbaqob.public.blob.vercel-storage.com/media/agents/a.jpg";
const TEXT = "I'm humbled to announce my AI agents fired me from my own clothing company. Here's what I learned about leadership 🧵 Built with @Stripe.";
const now = new Date("2026-11-08T17:30:00Z");
assert.equal(scheduleCheck({ posts: [] }, now), null);
assert.match(scheduleCheck({ paused: true, posts: [] }, now), /paused/);
assert.match(scheduleCheck({ posts: [{ at: "2026-11-08T16:00:00Z" }] }, now), /already 1/);
assert.equal(scheduleCheck({ posts: [{ at: "2026-11-08T16:00:00Z", dry: true }] }, now), null);
assert.equal(textCheck(TEXT + " Thanks Vercel and Naïve."), null);
assert.match(textCheck(TEXT + " as elon would say"), /hard lines/);
assert.match(textCheck("too short"), /too short/);
console.log("schedule + text checks: OK");

const c = candidates({ a: { kind: "image", state: "posted", media_url: BLOB, created_at: "2026-11-08T02:00:00Z", caption: "cap" }, v: { kind: "video", state: "queued", poster_url: BLOB + "?p", created_at: "2026-11-08T03:00:00Z" },
  t: { kind: "image", state: "queued", media_url: BLOB, test: true, created_at: "z" }, w: { kind: "image", state: "withdrawn", media_url: BLOB, created_at: "z" }, e: { kind: "image", state: "posted", media_url: "https://evil.example/x.jpg", created_at: "z" } },
  { designs: { "git-blame-ai-tee": { slug: "git-blame-ai-tee", passes: [{ view: "back", blob_url: BLOB + "?l" }] } } });
assert.deepEqual(c.map((x) => x.id), ["ad:v", "ad:a", "launch:git-blame-ai-tee:back"]);
console.log("candidates: ads first, ours only, no test/withdrawn: OK");

// mentions: exact-name org urns only; unresolved -> plain name; cached
const root = fs.mkdtempSync(path.join(os.tmpdir(), "li-"));
let calls = 0;
const lookup = async (t, vanity) => { calls++; return vanity === "stripe" ? { urn: "urn:li:organization:111", name: "Stripe" } : vanity === "vercel" ? { urn: "urn:li:organization:222", name: "Vercel Inc. Clone" } : { error: "403" }; };
const orgs = await resolveOrgs(root, { access_token: "x" }, { lookup });
assert.deepEqual(orgs.map((o) => [o.name, o.urn]), [["Naïve", null], ["AgentMail", null], ["MobileRun", null], ["Stripe", "urn:li:organization:111"], ["Vercel", null]]);
await resolveOrgs(root, { access_token: "x" }, { lookup }); assert.equal(calls, 5);   // cached (failures retried only after 6 h)
const com = buildCommentary(TEXT, orgs);
assert.match(com, /Built with @\[Stripe\]\(urn:li:organization:111\)/);
assert.match(com, /Thanks to Naïve, AgentMail, MobileRun, Vercel$/);
assert.ok(com.includes("humbled") && !/\(urn:li:organization:\d+\)[^ .,\n]/.test(com.replace(/\)\./g, ") .")));
assert.equal(escapeLittle("a (b) #c @d"), "a \\(b\\) \\#c \\@d");
const one = postBody({ person_urn: "urn:li:person:1" }, { commentary: "x", images: [{ urn: "urn:li:image:1", alt: "a" }] });
const two = postBody({ person_urn: "urn:li:person:1" }, { commentary: "x", images: [{ urn: "urn:li:image:1" }, { urn: "urn:li:image:2" }] });
assert.equal(one.content.media.id, "urn:li:image:1"); assert.equal(two.content.multiImage.images.length, 2);
console.log("mentions (exact names, plain fallback, cache) + little text + multi-image body: OK");

// the tool in dry mode: full payload, nothing uploaded; kill switch respected when live
fs.writeFileSync(path.join(root, "ads.json"), JSON.stringify({ ads: { a: { id: "a", kind: "image", state: "posted", media_url: BLOB, created_at: "2026-11-08T02:00:00Z" } }, reviews: {}, videos: {} }));
const tools = {}; registerLinkedInTools({ registerTool: (n, d, h) => (tools[n] = h) }, { rootDir: root, log: () => {} });
process.env.LI_DRY = "1";
const d = JSON.parse((await tools.linkedin_post({ text: TEXT, image_ids: ["ad:a"] })).content[0].text);
assert.equal(d.dry_run, true); assert.equal(d.body.content.media.id, "urn:li:image:DRY-1"); assert.match(d.commentary, /@\[Stripe\]/);
assert.match(d.commentary, /Written by our AI Growth agent\./);   // disclosure footer, escaped like the rest
delete process.env.LI_DRY;
fs.writeFileSync(path.join(root, "linkedin-ledger.json"), JSON.stringify({ paused: true, reason: "test", posts: [] }));
assert.match((await tools.linkedin_post({ text: TEXT, image_ids: ["ad:a"] })).content[0].text, /paused/);
fs.writeFileSync(path.join(root, "linkedin-ledger.json"), JSON.stringify({ paused: false, posts: [] }));
assert.match((await tools.linkedin_post({ text: TEXT, image_ids: ["ad:zzz"] })).content[0].text, /unknown image/);
assert.match((await tools.linkedin_post({ text: TEXT, image_ids: ["ad:a"], mentions: ["OpenAI"] })).content[0].text, /only our sponsors/);
assert.match((await tools.linkedin_post({ text: TEXT, image_ids: ["ad:a"] })).content[0].text, /isn't connected/);   // no token in the temp root
console.log("tool: dry payload, kill switch, unknown image, sponsor-only mentions, needs a token: OK");
console.log("linkedin tools tests: all OK");
