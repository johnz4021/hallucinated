// Pre-order checks. Unit: parsing a setup-mode Checkout Session. Live (Stripe TEST key only): two throwaway test customers
// with saved cards (pm_card_visa charges; pm_card_chargeCustomerFail declines off-session), charged through the real
// chargeOne path, then charged again to prove nothing double-charges. Test charges use kind "preorder_charge_test" so
// stripe_orders never sees them, the successful one is refunded, and the ledger goes to a temp folder, not the repo.
//   node stripe/preorders_test.mjs [--live]
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preorderFromSession, chargeOne } from "./preorders.mjs";
import { stripeClient } from "./tools.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const prices = { price_a: { id: "price_a", unit_amount: 7000, currency: "usd", metadata: { design_id: "d1", garment: "hoodie", color: "black", size: "L", drop: "drop-2" }, product: { id: "prod_A", name: "Hoodie", metadata: {} } } };
const sess = { id: "cs_pre", mode: "setup", status: "complete", created: 1762560000, customer: "cus_1", customer_details: { email: "a@x.test", name: "A" },
  metadata: { kind: "preorder", preorder_items: JSON.stringify([{ price_id: "price_a", qty: 2 }]) }, setup_intent: { id: "seti_1", status: "succeeded", payment_method: "pm_1", metadata: {} } };
let p = preorderFromSession(sess, prices);
assert.equal(p.has_payment_method, true); assert.equal(p.cancelled, false); assert.equal(p.items[0].qty, 2); assert.equal(p.items[0].product_id, "prod_A");
assert.equal(p.items[0].unit_amount, 7000); assert.equal(p.items[0].charged, false); assert.equal(JSON.stringify(p).includes("pm_1"), false);   // no card details out
p = preorderFromSession({ ...sess, setup_intent: { ...sess.setup_intent, metadata: { c_prod_A: "pi_9", preorder_status: "cancelled" } } }, prices);
assert.equal(p.items[0].charged, true); assert.equal(p.cancelled, true);
p = preorderFromSession({ ...sess, setup_intent: { ...sess.setup_intent, metadata: { c_prod_A: "failed:card_declined" } } }, prices);
assert.equal(p.items[0].charged, false); assert.equal(p.items[0].charge_ref, "failed:card_declined");
console.log("pre-order parse checks: OK");

if (!process.argv.includes("--live")) process.exit(0);
const sc = stripeClient(ROOT);
if (sc.error || sc.mode !== "test") { console.log("live check skipped:", sc.error || "not a test key"); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "preorder-test-"));
const ctx = { rootDir: tmp, log: (m) => console.log("  log:", m) };
const out = [];
for (const [label, pm] of [["ok", "pm_card_visa"], ["declines", "pm_card_chargeCustomerFail"]]) {
  const cus = await sc.call("POST", "/customers", { email: `preorder-test-${label}@example.com`, name: `Preorder Test ${label}`, metadata: { test_fixture: "preorders_test.mjs" } });
  const si = await sc.call("POST", "/setup_intents", { customer: cus.id, payment_method: pm, confirm: "true", usage: "off_session", "automatic_payment_methods[enabled]": "true", "automatic_payment_methods[allow_redirects]": "never", metadata: { test_fixture: "preorders_test.mjs" } });
  const po = { preorder_session: `cs_test_fixture_${label}_${Date.now()}`, customer: cus.id, email: cus.email, name: cus.name, setup_intent: si.id, has_payment_method: si.status === "succeeded",
    items: [{ price_id: "price_fixture", qty: 1, product_id: "prod_fixture", product: "Test fixture tee", design_id: "test-fixture", garment: "tee", color: "black", size: "M", drop: "test", unit_amount: 6500, currency: "usd" }] };
  const r1 = await chargeOne(sc, ctx, po, "prod_fixture", { kind: "preorder_charge_test" });
  const r2 = await chargeOne(sc, ctx, po, "prod_fixture", { kind: "preorder_charge_test" });
  console.log(`${label}: setup ${si.status}; first charge ${JSON.stringify(r1)}; second ${JSON.stringify(r2)}`);
  out.push({ label, r1, r2, cus: cus.id });
}
const ok = out.find((o) => o.label === "ok"), bad = out.find((o) => o.label === "declines");
assert.equal(ok.r1.ok, true); assert.match(ok.r1.payment_intent, /^pi_/); assert.match(ok.r2.skipped, /already charged/);
assert.equal(bad.r1.ok, false); assert.match(String(bad.r1.code), /card_declined|declined/); assert.match(String(bad.r1.invoice_url), /^https:\/\/invoice\.stripe\.com\//); assert.match(bad.r2.skipped, /already needs_customer_action/);
const pis = await sc.call("GET", `/payment_intents?customer=${ok.cus}&limit=10`);
assert.equal(pis.data.filter((x) => x.status === "succeeded").length, 1, "exactly one charge for the ok customer");
await sc.call("POST", "/refunds", { payment_intent: ok.r1.payment_intent, metadata: { test_fixture: "preorders_test.mjs" } });
const inv = (await sc.call("GET", `/invoices?customer=${bad.cus}&limit=5`)).data[0];
if (inv?.status === "open") await sc.call("POST", `/invoices/${inv.id}/void`, {});
console.log("live pre-order checks: OK (test charge refunded, test invoice voided; ledger in", tmp + ")");
process.exit(0);
