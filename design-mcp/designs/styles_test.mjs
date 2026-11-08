// Unit checks: the art-style and ad-format rotations, and agent designs batching with drop #1's front. Pure.
//   node designs/styles_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STYLES, STYLE_IDS, AD_FORMAT_IDS, familyOf, pickStyle, issueStyle, recordStyle, loadStyleLedger } from "./styles.mjs";
import { makeableList, planBatches } from "../stripe/tools.mjs";

// every style has a known processing family; at least one photo and one collage style
assert.ok(STYLE_IDS.every((s) => ["ink", "photo", "collage", "color"].includes(familyOf(s))));
assert.ok(STYLE_IDS.some((s) => familyOf(s) === "photo") && STYLE_IDS.some((s) => familyOf(s) === "collage"));
assert.equal(familyOf("terminal_lineart"), "ink"); assert.equal(familyOf("nope"), "ink");

// rotation: never the same twice in a row; prefers styles unused in the last 5
let seq = [], rng = (() => { let x = 7; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); })();
for (let i = 0; i < 200; i++) seq.push(pickStyle(seq, rng));
for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `repeat at ${i}`);
for (let i = 5; i < seq.length; i++) assert.ok(!seq.slice(i - 5, i).includes(seq[i]), `reused within 5 at ${i}`);
assert.equal(new Set(seq).size, STYLE_IDS.length);   // every style gets used
assert.notEqual(pickStyle(["a", "b"], () => 0, ["a", "b"]), "b");   // tiny pool: still never the last one
const fseq = []; for (let i = 0; i < 50; i++) fseq.push(pickStyle(fseq, rng, AD_FORMAT_IDS));
for (let i = 1; i < fseq.length; i++) assert.notEqual(fseq[i], fseq[i - 1]);

// ledger: issue -> pending; record on pass clears pending and keeps the override reason
const root = fs.mkdtempSync(path.join(os.tmpdir(), "styles-test-"));
const st = issueStyle(root, () => 0);
assert.equal(loadStyleLedger(root).pending.style, st);
recordStyle(root, st, "aaaaaaaaaaaa");
recordStyle(root, "y2k_chrome", "bbbbbbbbbbbb", "the joke is a 2001 screensaver");
const l = loadStyleLedger(root);
assert.equal(l.pending, null); assert.equal(l.history.length, 2); assert.equal(l.history[1].override_reason, "the joke is a 2001 screensaver");
assert.notEqual(issueStyle(root, () => 0), "y2k_chrome");

// a published agent design is makeable and batches with drop #1's front (wordmark) + its own back
fs.writeFileSync(path.join(root, "design-proposals.json"), JSON.stringify({ proposals: {
  p1: { mode: "live", state: "published", design_id: "aaaaaaaaaaaa", slug: "x-tee" }, p2: { mode: "test", state: "published", design_id: "bbbbbbbbbbbb", slug: "y-tee" }, p3: { mode: "live", state: "rejected", design_id: "cccccccccccc" } } }));
const live = makeableList(root, "live");
assert.deepEqual(live.map((m) => m.design_id), ["bc1dbe9d9aae", "aaaaaaaaaaaa"]);   // sandbox and rejected designs are not makeable live
const plan = planBatches([{ stripe_session_id: "cs1", line: 0, design_id: "aaaaaaaaaaaa", garment: "tee", color: "black", size: "M", size_raw: "M", quantity: 2, paid_at: "2026-11-08" }], live);
assert.equal(plan.needs_john.length, 0);
assert.deepEqual(plan.groups[0].print_spec, { design_id: "aaaaaaaaaaaa", front: { design: "logo.png", width_in: 10, top_in: 1.5 }, back: { width_in: 11, top_in: 1 } });
console.log(`styles: ${STYLE_IDS.length} styles, ${AD_FORMAT_IDS.length} ad formats, rotation + agent-design batching: OK`);
