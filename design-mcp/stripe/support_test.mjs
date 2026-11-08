// Unit checks for Support's order tools (no network: fake AgentMail + fake Stripe). node stripe/support_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { senderOf, pipelineStatus, ordersFor, registerSupportTools } from "./support.mjs";
import { NEVER_AUTO, agentDefs } from "../agents/defs.mjs";

assert.equal(senderOf("Jane Doe <Jane@Example.com>"), "jane@example.com");
assert.equal(senderOf("bob@x.test"), "bob@x.test");

// pipeline status from the ledgers
const led = { batches: [{ batch_ref: "b1", customania_order: null }], stripeBatched: { cs_2: { batch_ref: "b1", customania_order: "CF5A93CRK" } },
  events: [{ kind: "ready_for_pickup", order_number: "CF5A93CRK" }], courier: { CF5A93CRK: { ops_session: "s" } }, refunds: {} };
assert.equal(pipelineStatus({ paid: true }, led).status, "paid");
assert.equal(pipelineStatus({ paid: true, batched_into: "b1" }, led).status, "ready for pickup");
assert.equal(pipelineStatus({ paid: true, batched_into: "b9" }, led).status, "in production");
assert.equal(pipelineStatus({ preorder: true, charged: false }, led).status, "pre-order saved");
assert.equal(pipelineStatus({ paid: true, refunded: 38 }, led).status, "refunded");
assert.equal(pipelineStatus({ paid: true, batched_into: "b1" }, { ...led, courier: { CF5A93CRK: { picked_up_at: "x" } } }).status, "picked up");
console.log("pipeline status: OK");

// ordersFor: only this email (case-insensitive), whitelisted fields, pre-orders included
const rows = [
  { stripe_session_id: "cs_1", email: "Jane@Example.com", name: "Jane", paid_at: "2026-11-07T23:54:00Z", amount_total: "44.00 USD", line_usd: 38, quantity: 1, size: "M", size_raw: "M", description: "git blame --ai tee", fulfilment: "ship", shipping_usd: 6, batched_into: null, source: "checkout" },
  { stripe_session_id: "cs_2", email: "jane@example.com", paid_at: "2026-11-07T20:00:00Z", amount_total: "76.00 USD", line_usd: 76, quantity: 2, size: "L", size_raw: "L", description: "drop-1 tee", batched_into: "b1", source: "checkout" },
  { stripe_session_id: "cs_3", email: "other@x.test", paid_at: "2026-11-07T21:00:00Z", amount_total: "38.00 USD", line_usd: 38, quantity: 1, size: "S", description: "secret", source: "checkout" },
];
const pre = [{ preorder_session: "cs_pre", email: "JANE@example.com", created_at: "2026-11-07T22:00:00Z", cancelled: false, fulfilment: "pickup", shipping_usd: 0, preorder_total_cents: 6500,
  items: [{ product: "Wordmark hoodie", size: "L", qty: 1, unit_amount: 6500, charged: false }] }, { preorder_session: "cs_pre2", email: "other@x.test", items: [], created_at: "x" }];
const o = ordersFor("jane@example.com", rows, pre, led);
assert.deepEqual(o.map((x) => [x.order_ref, x.status]), [["cs_1", "paid"], ["cs_pre", "pre-order saved"], ["cs_2", "ready for pickup"]]);
assert.ok(!JSON.stringify(o).match(/other@x\.test|secret|Jane"|"name"|email/), "leaked another customer or a name/email");
assert.equal(o[0].shipping_usd, 6); assert.equal(o[0].fulfilment, "ship");
console.log("ordersFor: only the sender's orders, whitelisted: OK");

// tools: the email always comes from the message being answered; order_status refuses others' orders; refund is ask + idempotent
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sup-"));
const am = async (m, p) => { if (/msg-jane/.test(decodeURIComponent(p))) return { from: "Jane <jane@example.com>" }; if (/msg-self/.test(decodeURIComponent(p))) return { from: "hallucinated@agentmail.to" }; throw new Error("404"); };
const calls = [];
const sc = { mode: "test", call: async (m, p, body, opt) => {
  calls.push({ m, p, body, opt });
  if (p.startsWith("/checkout/sessions?")) return { data: [], has_more: false };
  if (p.startsWith("/payment_intents/search")) return { data: [] };
  if (p.startsWith("/checkout/sessions/cs_1")) return { id: "cs_1", mode: "payment", payment_status: "paid", payment_intent: "pi_1", invoice: null };
  if (p.startsWith("/checkout/sessions/cs_setup")) return { id: "cs_setup", mode: "setup" };
  if (p.startsWith("/payment_intents/pi_1")) return { id: "pi_1", amount_received: 4400, latest_charge: { amount_refunded: 0, receipt_url: "https://pay.stripe.com/receipts/x" }, metadata: {} };
  if (p === "/refunds") return { id: "re_1", status: "succeeded" };
  return { data: [] };
} };
const tools = {}; registerSupportTools({ registerTool: (n, d, h) => (tools[n] = h) }, { rootDir: root, log: () => {} }, { am, sc });
const T = (r) => ({ error: r.isError ? r.content[0].text : null, ...(r.isError ? {} : JSON.parse(r.content[0].text)) });
assert.equal((await T(await tools.order_lookup({ message_id: "msg-jane" }))).count, 0);   // fake Stripe has no sessions
assert.match(T(await tools.order_lookup({ message_id: "msg-self" })).error, /isn't from a customer/);
assert.match(T(await tools.order_status({ order_ref: "cs_3", message_id: "msg-jane" })).error, /no order with that reference/);
assert.match(T(await tools.refund_request({ order_ref: "cs_setup", reason: "changed mind" })).error, /preorder_cancel/);
const r1 = T(await tools.refund_request({ order_ref: "cs_1", reason: "wrong size, wants money back", message_id: "msg-jane" }));
assert.equal(r1.refunded, true); assert.equal(r1.amount_usd, 44);
const ref = calls.find((c) => c.p === "/refunds");
assert.equal(ref.opt.idempotencyKey, "refund-pi_1-4400"); assert.equal(ref.body.payment_intent, "pi_1");
assert.match(T(await tools.refund_request({ order_ref: "cs_1", reason: "x".repeat(10), amount_usd: 99 })).error, /at most \$44\.00/);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, "refunds.json"), "utf8")).cs_1.amount_usd, 44);
console.log("tools: sender-only lookup, refund idempotent + bounded: OK");

// permissions: lookup/status allow, refund ask and never auto-approved
const sup = agentDefs({}).support;
assert.equal(sup.tools.order_lookup, "allow"); assert.equal(sup.tools.order_status, "allow"); assert.equal(sup.tools.refund_request, "ask");
assert.ok(NEVER_AUTO.has("hallucinated.refund_request"));
console.log("permissions: refund_request ask + NEVER_AUTO: OK");
console.log("support tests: all OK");
