// Unit check of the Stripe order parsing and batching plan (fixtures), then one read-only live call if
// STRIPE_SECRET_KEY is a test key. Never marks anything batched and never flags (flag: false).
//   node stripe/stripe_test.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOrders, planBatches, sumSizes, normSize, stripeKeyCheck, stripeClient, salesStatus } from "./tools.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const S = (id, o = {}) => ({ id, status: "complete", payment_status: "paid", created: 1762560000, amount_total: 6500, currency: "usd",
  metadata: { drop: "drop-1", design_id: "bc1dbe9d9aae", size: "M" }, customer_details: { email: `${id}@x.test`, name: "Test Buyer" }, payment_intent: { id: "pi_" + id, metadata: {} }, ...o });
const P = (md, qty = 1) => ({ quantity: qty, description: "item", price: { id: "price_x", metadata: md, product: { id: "prod_x", metadata: {} } } });
const TEE = { design_id: "bc1dbe9d9aae", garment: "t-shirt", color: "Black", drop: "drop-1" };
const sessions = [
  // legacy shape (single-product store): size on the session, one plain line item
  S("cs_a"),
  S("cs_b", { metadata: { drop: "drop-1", design_id: "bc1dbe9d9aae", size: "l" } }),
  S("cs_unpaid", { payment_status: "unpaid" }),                    // async method (bank, Klarna) not settled: ignore
  S("cs_open", { status: "open", payment_status: "unpaid" }),
  S("cs_other_drop", { metadata: { drop: "drop-2", size: "S" } }),
  S("cs_batched", { payment_intent: { id: "pi_x", metadata: { batched_into: "batch-1" } } }),
  S("cs_sess_batched", { payment_intent: null, metadata: { drop: "drop-1", size: "XL", batched_into: "batch-2" } }),
  S("cs_local_batched"),
  S("cs_nosize", { metadata: { drop: "drop-1", design_id: "bc1dbe9d9aae" } }),
  // cart shape: everything on price.metadata, no session metadata
  S("cs_cart", { metadata: {} }),
  S("cs_cart_mixed", { metadata: {} }),
  S("cs_cart_hoodie", { metadata: {} }),
];
const li = {
  cs_a: [{ quantity: 1 }], cs_b: [{ quantity: 2 }], cs_nosize: [{ quantity: 1 }], cs_batched: [{ quantity: 1 }], cs_local_batched: [{ quantity: 3 }],
  cs_cart: [P({ ...TEE, size: "S" }, 2), P({ ...TEE, size: "XXL" }, 1)],
  cs_cart_mixed: [P({ ...TEE, size: "M" }, 1), P({ ...TEE, color: "white", size: "M" }, 1)],
  cs_cart_hoodie: [P({ design_id: "bc1dbe9d9aae", garment: "hoodie", color: "black", size: "L", drop: "drop-1" }, 1)],
};
const ledger = { cs_local_batched: { batch_ref: "batch-3" } };

const rows = parseOrders(sessions, li, { ledger });
const ids = [...new Set(rows.map((r) => r.stripe_session_id))].sort();
assert.deepEqual(ids, ["cs_a", "cs_b", "cs_cart", "cs_cart_hoodie", "cs_cart_mixed", "cs_nosize"]);
const r = (id, line = 0) => rows.find((x) => x.stripe_session_id === id && x.line === line);
assert.equal(r("cs_b").quantity, 2); assert.equal(r("cs_b").size, "L"); assert.equal(r("cs_b").garment, "tee"); assert.equal(r("cs_b").color, "black"); assert.equal(r("cs_b").shape, "legacy");
assert.equal(r("cs_cart", 0).size, "S"); assert.equal(r("cs_cart", 0).quantity, 2); assert.equal(r("cs_cart", 1).size, "2XL"); assert.equal(r("cs_cart", 0).garment, "tee"); assert.equal(r("cs_cart", 0).color, "black");
assert.equal(r("cs_nosize").size, null);
assert.equal(r("cs_a").amount_total, "65.00 USD"); assert.equal(r("cs_a").email, "cs_a@x.test");
const all = parseOrders(sessions, li, { ledger, unbatchedOnly: false });
assert.equal(all.find((x) => x.stripe_session_id === "cs_batched").batched_into, "batch-1");
assert.equal(all.find((x) => x.stripe_session_id === "cs_sess_batched").batched_into, "batch-2");
assert.equal(all.find((x) => x.stripe_session_id === "cs_local_batched").batched_into, "batch-3");
assert.equal(all.some((x) => x.stripe_session_id === "cs_unpaid"), false);

const plan = planBatches(rows);
assert.equal(plan.groups.length, 1);
assert.deepEqual(plan.groups[0].session_ids.sort(), ["cs_a", "cs_b", "cs_cart"]);
assert.deepEqual(plan.groups[0].sizes, { S: 2, M: 1, L: 2, "2XL": 1 });
assert.equal(plan.groups[0].quantity, 6);
assert.equal(plan.groups[0].print_spec.design_id, "bc1dbe9d9aae");
const nj = Object.fromEntries(plan.needs_john.map((n) => [n.stripe_session_id, n.reasons.join("; ")]));
assert.match(nj.cs_cart_hoodie, /hoodie.*not something Customania makes/);
assert.match(nj.cs_cart_mixed, /white.*not something/);           // a whole sale waits if any line can't be made
assert.match(nj.cs_nosize, /no valid size/);
assert.deepEqual(sumSizes(rows.filter((x) => x.stripe_session_id === "cs_cart")), { S: 2, "2XL": 1 });
assert.equal(normSize(" xl "), "XL"); assert.equal(normSize("huge"), null);
assert.equal(stripeKeyCheck("sk_test_abc").mode, "test"); assert.equal(stripeKeyCheck("rk_test_abc").mode, "test");
assert.equal(stripeKeyCheck("sk_live_abc").ok, process.env.STRIPE_LIVE_OK === "1"); assert.equal(stripeKeyCheck(undefined).ok, false);
console.log("parse + plan checks: OK");

const sc = stripeClient(ROOT);
if (sc.error) { console.log("live check skipped:", sc.error); process.exit(0); }
const st = await salesStatus(sc, ROOT, { flag: false });
console.log(`live (${st.mode}): ${st.orders.length} unbatched paid line(s); batchable ${JSON.stringify(st.sizes_total)} from ${st.session_ids.length} sale(s); needs John ${st.needs_john.length}; ready_to_batch=${st.ready_to_batch} (${st.reason})`);
for (const o of st.orders) console.log(`  ${o.stripe_session_id.slice(0, 18)}… line ${o.line} ${o.shape} ${o.design_id} ${o.garment}/${o.color} ${o.size} x${o.quantity} ${o.amount_total} batched_into=${o.batched_into}`);
process.exit(0);
