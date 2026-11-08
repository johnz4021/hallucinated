// Support in /hq: tool calls become plain, private lines (no emails, names or bodies). Pure; no network.
import assert from "node:assert/strict";
import { deriveSession, compact, scrub, assertClean } from "./hq_publish.mjs";

let seq = 0;
const ev = (type, data, at = "2026-11-08T05:00:00Z") => compact({ type, seq: ++seq, created_at: at, data });
const call = (name, args, output, id = `tc_${seq}`) => [ev("tool.started", { name: `hallucinated.${name}`, tool_call_id: id, args }), ev("tool.completed", { name: `hallucinated.${name}`, tool_call_id: id, output: JSON.stringify(output) })];
const events = [
  ...call("inbox_list", {}, { count: 1, messages: [{ from: "Jane <jane@example.com>", subject: "where is my order" }] }),
  ...call("inbox_read", { message_id: "m1" }, { from: "Jane <jane@example.com>", text: "hi I live at 123 Main St, where's my order" }),
  ...call("order_lookup", { message_id: "m1" }, { mode: "live", count: 1, orders: [{ order_ref: "cs_live_1", items: [{ item: "tee", size: "M" }], receipt_url: "https://pay.stripe.com/x" }] }),
  ...call("inbox_reply", { message_id: "m1", text: "Hi Jane, your tee is in production" }, { sent: true, to: "jane@example.com" }),
  ...call("inbox_read", { message_id: "m2" }, { from: "Bob <bob@example.com>", text: "this is the worst shirt" }),
  ...call("flag_john", { reason: "complaint", summary: "Bob bob@example.com is angry" }, { flagged: true }),
  ...call("inbox_reply", { message_id: "m2", text: "Sorry Bob" }, { sent: true }),
  ev("tool.confirm", { name: "hallucinated.refund_request", tool_call_id: "tc_r", args: { order_ref: "cs_live_1", amount_usd: 38, reason: "Jane changed her mind" } }),
  ...call("refund_request", { order_ref: "cs_live_1", amount_usd: 38 }, { refunded: true, amount_usd: 38, status: "succeeded" }, "tc_r"),
].filter(Boolean);
const c = { id: "ses_sup", role: "support", agent: "hallucinated-support", events, status: "idle" };
const d = deriveSession(c, false);
const lines = d.items.filter((i) => i.agent === "support").map((i) => i.text);
assert.ok(lines.some((t) => /Read a customer email \(inbox_read\), looked up their order in Stripe \(order_lookup: 1 found\), replied \(inbox_reply\)/.test(t)), lines.join("\n"));
assert.ok(lines.some((t) => /flagged the founder \(flag_john: complaint\), replied \(inbox_reply\)/.test(t)), lines.join("\n"));
assert.ok(lines.some((t) => /Refunded \$38\.00 after the founder approved \(refund_request\)/.test(t)), lines.join("\n"));
assert.ok(d.items.some((i) => i.agent === "founder" && /Refund approved by founder \(\$38\.00\)/.test(i.text)), JSON.stringify(d.items.filter((i) => i.agent === "founder")));
const doc = scrub({ items: d.items });
assert.doesNotThrow(() => assertClean(doc));
assert.ok(!JSON.stringify(d.items).match(/jane|bob|@|Main St|worst shirt|changed her mind/i), "leaked customer data");
console.log("support lines:\n  " + lines.join("\n  "));
console.log("hq support: tool names, founder refund approval, privacy: OK");
