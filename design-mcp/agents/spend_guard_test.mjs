// Unit checks for the spend guard: incremental ledger counting (each debit once), thresholds once each, and what the
// cut does to Creative (video paused, 1 variant, 1 try). Stubbed ledger; thresholds kept above the totals so nothing
// flags (flag_john would ping the Mac).
//   node agents/spend_guard_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkSpend, guardState, newCrossings, videoPaused, imageVariants, maxAttempts } from "./spend_guard.mjs";

process.env.SPEND_FLAG_USD = "1000"; process.env.SPEND_CUT_USD = "2000";   // no real crossings in this test
const root = fs.mkdtempSync(path.join(os.tmpdir(), "spend-test-"));
let rows = [
  { created_at: "2026-11-08T00:10:00Z", amount_micro_usd: -2_000_000 },
  { created_at: "2026-11-08T00:05:00Z", amount_micro_usd: -1_500_000 },
  { created_at: "2026-11-07T22:00:00Z", amount_micro_usd: 50_000_000 },   // a credit (top-up): not spend
  { created_at: "2026-11-07T21:30:00Z", amount_micro_usd: -500_000 },
  { created_at: "2026-11-07T20:00:00Z", amount_micro_usd: -9_000_000 },   // before Sat 13:00 PT: not counted
];
const client = { credits: { ledger: async ({ after }) => {   // newest first, 2 rows per page
  const i = after ? Number(after) : 0; return { data: rows.slice(i, i + 2), has_more: i + 2 < rows.length, next_cursor: String(i + 2) }; } } };
let st = await checkSpend({ rootDir: root, client, force: true });
assert.equal(st.total_usd, 4);                       // 2 + 1.5 + 0.5
rows = [{ created_at: "2026-11-08T00:20:00Z", amount_micro_usd: -3_000_000 }, ...rows];
st = await checkSpend({ rootDir: root, client, force: true });
assert.equal(st.total_usd, 7);                       // only the new debit is added
st = await checkSpend({ rootDir: root, client, force: true });
assert.equal(st.total_usd, 7);                       // nothing new: unchanged
assert.deepEqual(guardState(root).crossed, {});
// thresholds (pure), each once
process.env.SPEND_FLAG_USD = "100"; process.env.SPEND_CUT_USD = "175";
assert.deepEqual(newCrossings(99, {}), []); assert.deepEqual(newCrossings(100, {}), ["flag"]); assert.deepEqual(newCrossings(180, { flag: "t" }), ["cut"]); assert.deepEqual(newCrossings(180, { flag: "t", cut: "t" }), []);
// the cut: video paused, 1 variant, 1 try
assert.equal(videoPaused(root), false); assert.equal(imageVariants(root), 1); assert.equal(maxAttempts(root), 3);
fs.writeFileSync(path.join(root, "spend-guard.json"), JSON.stringify({ ...guardState(root), crossed: { flag: "t", cut: "t" } }));
assert.equal(videoPaused(root), true); assert.equal(imageVariants(root), 1); assert.equal(maxAttempts(root), 1);
console.log("spend guard: incremental ledger, thresholds once, cut effects: OK");
