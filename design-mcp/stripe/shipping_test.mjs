// Unit checks for shipping (storefront 8efb7d9): fulfilment + shipping on orders and pre-orders, the $6 pre-order fee,
// shipped vs pickup counts for John, and that no address ever leaves these functions. Pure; no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseOrders, fulfilmentOf, shippingUsdOf, fulfilmentCounts } from "./tools.mjs";
import { shippingFeeCents, withShipping, preorderFromSession, chargeOne, SHIP_FEE_CENTS } from "./preorders.mjs";

const ADDR = { line1: "1 Secret St", city: "San Francisco", postal_code: "94110", country: "US" };
const sess = (id, md = {}, extra = {}) => ({ id, status: "complete", payment_status: "paid", created: 1762560000, amount_total: 4400, currency: "usd", metadata: { drop: "drop-1", design_id: "bc1dbe9d9aae", size: "M", ...md },
  customer_details: { email: `${id}@x.test`, name: "T", address: ADDR }, shipping_details: { address: ADDR, name: "T" }, collected_information: { shipping_details: { address: ADDR } }, ...extra });
assert.equal(fulfilmentOf(sess("a", { fulfilment: "ship" })), "ship");
assert.equal(fulfilmentOf(sess("b", {}, { shipping_cost: { amount_total: 0, shipping_rate: { metadata: { fulfilment: "pickup" } } } })), "pickup");   // fallback
assert.equal(fulfilmentOf(sess("c")), null);
assert.equal(fulfilmentOf(sess("d", { fulfilment: "drone" })), null);
assert.equal(shippingUsdOf(sess("a", {}, { shipping_cost: { amount_total: 600 } })), 6);
const rows = parseOrders([sess("s1", { fulfilment: "ship" }, { shipping_cost: { amount_total: 600 } }), sess("s2", { fulfilment: "pickup" }, { shipping_cost: { amount_total: 0 } }), sess("s3")], {}, { drop: "all", unbatchedOnly: false });
assert.deepEqual(rows.map((r) => [r.fulfilment, r.shipping_usd]), [["ship", 6], ["pickup", 0], [null, null]]);
assert.ok(!JSON.stringify(rows).match(/Secret|94110|line1|shipping_details|collected_information/), "an address leaked into order rows");
console.log("orders: fulfilment + shipping_usd, no address: OK");

const c = fulfilmentCounts([...rows, { ...rows[0], line: 1, quantity: 2, size: "L" }]);
assert.deepEqual([c.ship.orders, c.ship.qty, c.pickup.orders, c.pickup.qty, c.unknown.orders], [1, 3, 1, 1, 1]);
assert.deepEqual(c.ship.sizes, { M: 1, L: 2 });
console.log("batch summary: shipped vs pickup counts: OK");

// pre-orders: $6 only for ship AND total < $75; pickup / >= $75 / unknown: no fee (unknown asks John)
assert.equal(shippingFeeCents({ fulfilment: "ship", preorder_total_cents: 3800 }), SHIP_FEE_CENTS);
assert.equal(shippingFeeCents({ fulfilment: "ship", preorder_total_cents: 7499 }), 600);
assert.equal(shippingFeeCents({ fulfilment: "ship", preorder_total_cents: 7500 }), 0);
assert.equal(shippingFeeCents({ fulfilment: "pickup", preorder_total_cents: 3800 }), 0);
assert.equal(shippingFeeCents({ fulfilment: null, preorder_total_cents: 3800 }), 0);
const pre = (md) => ({ id: "cs_pre", mode: "setup", status: "complete", created: 1762560000, customer: "cus_1", customer_details: { email: "p@x.test", name: "P", address: ADDR }, shipping_details: { address: ADDR },
  metadata: { kind: "preorder", preorder_items: JSON.stringify([{ price_id: "price_1", qty: 1 }]), ...md }, setup_intent: { id: "seti_1", status: "succeeded", payment_method: "pm_1", metadata: {} } });
const prices = { price_1: { unit_amount: 3800, currency: "usd", metadata: { size: "M" }, product: { id: "prod_1", name: "Tee", metadata: {} } } };
const pShip = withShipping(preorderFromSession(pre({ fulfilment: "ship" }), prices), pre({ fulfilment: "ship" }));
assert.equal(pShip.fulfilment, "ship"); assert.equal(pShip.preorder_total_cents, 3800); assert.equal(pShip.shipping_usd, 6);
const pBig = withShipping(preorderFromSession(pre({ fulfilment: "ship", preorder_total: "9000" }), prices), pre({ fulfilment: "ship", preorder_total: "9000" }));
assert.equal(pBig.shipping_usd, 0);
const pOld = withShipping(preorderFromSession(pre({}), prices), pre({}));
assert.equal(pOld.fulfilment, null); assert.equal(pOld.shipping_usd, 0); assert.match(pOld.fulfilment_note, /ask John/);
for (const p of [pShip, pBig, pOld]) assert.ok(!JSON.stringify(p).match(/Secret|94110|line1/), "an address leaked into a pre-order");
console.log("pre-orders: fulfilment, total, $6 rule, no address: OK");

// chargeOne adds the fee once per pre-order (first product), and records it
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-"));
const calls = [];
const sc = { call: async (m, p, body) => { calls.push({ m, p, body }); if (p.startsWith("/setup_intents/") && m === "GET") return { payment_method: "pm_1" }; if (p === "/payment_intents") return { id: `pi_${calls.length}`, status: "succeeded" }; return {}; } };
const two = { ...pShip, items: [...pShip.items, { ...pShip.items[0], product_id: "prod_2", product: "Cap" }] };
const r1 = await chargeOne(sc, { rootDir: root }, two, "prod_1", { kind: "test_charge" });
const r2 = await chargeOne(sc, { rootDir: root }, two, "prod_2", { kind: "test_charge" });
const pis = calls.filter((x) => x.p === "/payment_intents").map((x) => x.body.amount);
assert.deepEqual(pis, [4400, 3800]); assert.equal(r1.shipping_usd, 6); assert.equal(r2.shipping_usd, 0);
assert.equal(calls.find((x) => x.p === "/payment_intents").body.metadata.fulfilment, "ship");
const rOld = await chargeOne(sc, { rootDir: root }, { ...pOld, preorder_session: "cs_old" }, "prod_1", { kind: "test_charge" });
assert.equal(rOld.amount_usd, 38); assert.match(rOld.note_for_john, /ask John/);
console.log("charge: $6 once per shipped pre-order under $75; older ones flagged: OK");
console.log("shipping tests: all OK");
