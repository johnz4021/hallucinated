// End-to-end test-mode checkout through the real UI, then verification via the Stripe API. Test keys only.
// Usage:
//   node scripts/test-checkout.mjs <url> order      -> bag: tee M x1 + tee L x2 (PLAN=single: tee M x1), pays with 4242,
//                                                      ships (SHIP=pickup for pickup), checks line items + shipping
//   node scripts/test-checkout.mjs <url> preorder   -> bag: hoodie M x1 + cap x1, saves 4242, checks customer + PM
// Env VERCEL_OIDC=1 authenticates to a protected preview with the dev OIDC token from .env.local.
import { chromium } from "playwright";
import Stripe from "stripe";
import { mkdirSync } from "node:fs";
import { envVar, stripeKey } from "./root-env.mjs";

const url = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const kind = process.argv[3] ?? "order";
const { key, mode } = stripeKey({ allowLive: false });
if (mode !== "test") throw new Error("test-checkout only runs against a test key");
const stripe = new Stripe(key);
mkdirSync("test-output", { recursive: true });

const plan = kind === "preorder"
  ? process.env.PLAN === "single"
    ? [{ slug: "wordmark-cap-black", size: null, qty: 1 }]
    : [{ slug: "wordmark-hoodie-forest", size: "M", qty: 1 }, { slug: "wordmark-cap-black", size: null, qty: 1 }]
  : process.env.PLAN === "single"
    ? [{ slug: "git-reset-hard-tee", size: "M", qty: 1 }]
    : [{ slug: "git-reset-hard-tee", size: "M", qty: 1 }, { slug: "git-reset-hard-tee", size: "L", qty: 2 }];

const email = `buyer+${kind}${Date.now()}@example.com`;
const name = "Test Buyer";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
// Protected previews: VERCEL_OIDC=1 adds the linked project's short-lived dev OIDC token, only on requests
// to the store's own origin (never to Stripe). Never printed.
if (process.env.VERCEL_OIDC === "1") {
  const token = envVar("VERCEL_OIDC_TOKEN");
  const origin = new URL(url).origin;
  await ctx.route((u) => u.origin === origin, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": token } }));
}
const page = await ctx.newPage();
try {
  for (const it of plan) {
    await page.goto(`${url}/p/${it.slug}`, { waitUntil: "networkidle" });
    if (it.size) await page.click(`label.size:has(input[value="${it.size}"])`);
    for (let i = 1; i < it.qty; i++) await page.click('button[aria-label="One more"]');
    await page.click(".buy > .btn-secondary"); // Add to bag (the primary button goes straight to Checkout)
    await page.waitForSelector(".added", { timeout: 10000 });
  }
  await page.goto(`${url}/cart`, { waitUntil: "networkidle" });
  if (kind === "preorder") await page.check(`input[name="fulfilment"][value="${process.env.SHIP ?? "ship"}"]`);
  await page.screenshot({ path: `test-output/cart-${kind}.png`, fullPage: true });
  await page.click(".cart-summary > button.cta");
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });

  await page.fill("#email", email);
  if (await page.locator("#individualName").count()) await page.fill("#individualName", name);
  if (await page.locator("#shippingAddressLine1").count()) {
    // Sandbox-only test address (not a real person's).
    await page.fill("#shippingName", name);
    await page.fill("#shippingAddressLine1", "1 Test Street");
    await page.keyboard.press("Escape");
    await page.fill("#shippingLocality", "San Francisco");
    await page.fill("#shippingPostalCode", "94110");
    await page.selectOption("#shippingAdministrativeArea", "CA").catch(() => {});
    const want = (process.env.SHIP ?? "ship") === "pickup" ? /Pickup in San Francisco/ : /US shipping/;
    if (kind === "preorder") { /* setup mode: no shipping options, address only */ } else {
    const picked = await page.evaluate((src) => {
      const re = new RegExp(src);
      for (const input of document.querySelectorAll('input[name="shipping-rate"]')) {
        // climb to the largest ancestor that still holds only this one option, then match its text
        let el = input;
        while (el.parentElement && el.parentElement.querySelectorAll('input[name="shipping-rate"]').length === 1) el = el.parentElement;
        if (re.test(el.textContent ?? "")) { input.click(); return true; }
      }
      return false;
    }, want.source);
    if (!picked) throw new Error("shipping option not found");
    }
    await page.waitForTimeout(800);
  }
  const cardTab = page.locator('[data-testid="card-accordion-item-button"]');
  if (!(await page.locator("#cardNumber").isVisible().catch(() => false)) && (await cardTab.count())) {
    await cardTab.evaluate((el) => el.click());
  }
  await page.locator("#cardNumber").waitFor({ state: "visible", timeout: 15000 });
  await page.fill("#cardNumber", "4242424242424242");
  await page.fill("#cardExpiry", "12 / 34");
  await page.fill("#cardCvc", "123");
  if (await page.locator("#billingName").isVisible().catch(() => false)) await page.fill("#billingName", name);
  if (await page.locator("#billingPostalCode").isVisible().catch(() => false)) await page.fill("#billingPostalCode", "94110");
  const optOut = page.locator("#enableStripePass");
  if (await optOut.isChecked().catch(() => false)) await optOut.uncheck();
  await page.screenshot({ path: `test-output/stripe-${kind}.png`, fullPage: true });
  await page.click('[data-testid="hosted-payment-submit-button"]');
  await page.waitForURL((u) => u.href.startsWith(`${url}/success`), { timeout: 90000 });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `test-output/success-${kind}.png`, fullPage: true });
  const sessionId = new URL(page.url()).searchParams.get("session_id");

  let ok;
  let result;
  if (kind === "preorder") {
    const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent", "customer"] });
    const shipInfo = s.collected_information?.shipping_details ?? s.shipping_details ?? null;
    const si = s.setup_intent;
    const pm = si?.payment_method ? await stripe.paymentMethods.retrieve(si.payment_method) : null;
    result = {
      session_id: s.id, mode: s.mode, status: s.status, metadata: s.metadata,
      customer: s.customer?.id, customer_email: s.customer?.email, customer_name: s.customer?.name,
      setup_intent: si?.id, setup_intent_status: si?.status, setup_intent_usage: si?.usage, setup_intent_metadata: si?.metadata,
      payment_method: pm?.id, pm_customer: pm?.customer, card: pm?.card ? `${pm.card.brand} ${pm.card.last4}` : null,
      customer_details: { email: s.customer_details?.email, name: s.customer_details?.name },
      // Setup mode stores the shipping address on the Customer (customer.shipping), not on the session.
      shipping_details_present: !!(shipInfo?.address?.line1 || s.customer?.shipping?.address?.line1),
      shipping_details_location: shipInfo?.address?.line1 ? "session" : s.customer?.shipping?.address?.line1 ? "customer.shipping" : null,
    };
    const items = JSON.parse(s.metadata.preorder_items ?? "[]");
    const wantItems = plan.length;
    ok = s.status === "complete" && s.mode === "setup" && s.metadata.kind === "preorder" && items.length === wantItems &&
      si?.status === "succeeded" && si?.usage === "off_session" && pm && pm.customer === s.customer?.id && result.customer_details.email === email &&
      s.metadata.fulfilment === (process.env.SHIP ?? "ship") && si?.metadata?.fulfilment === s.metadata.fulfilment &&
      result.shipping_details_present === ((process.env.SHIP ?? "ship") !== "pickup");
  } else {
    const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items.data.price.product", "shipping_cost.shipping_rate"] });
    const ship = s.collected_information?.shipping_details ?? s.shipping_details ?? null;
    result = {
      session_id: s.id, mode: s.mode, status: s.status, payment_status: s.payment_status, amount_total: s.amount_total,
      metadata: s.metadata, invoice: s.invoice,
      shipping_rate: s.shipping_cost?.shipping_rate?.display_name ?? null,
      shipping_rate_fulfilment: s.shipping_cost?.shipping_rate?.metadata?.fulfilment ?? null,
      shipping_amount: s.shipping_cost?.amount_total ?? null,
      shipping_details_present: !!ship?.address?.line1,
      shipping_city: ship?.address?.city ?? null,
      customer_details: { email: s.customer_details?.email, name: s.customer_details?.name },
      line_items: s.line_items.data.map((li) => ({ qty: li.quantity, price: li.price.id, price_metadata: li.price.metadata, product: li.price.product.name, product_status: li.price.product.metadata.status })),
    };
    ok = s.status === "complete" && s.payment_status === "paid" && s.metadata.kind === "order" && s.line_items.data.length === plan.length &&
      s.line_items.data.every((li) => li.price.metadata.size && li.price.metadata.design_id && li.price.metadata.garment && li.price.metadata.color && li.price.metadata.drop) &&
      result.customer_details.email === email && (result.customer_details.name === name || !result.customer_details.name) &&
      (!s.shipping_cost || (result.shipping_details_present && s.metadata.fulfilment === result.shipping_rate_fulfilment));
  }
  console.log(JSON.stringify(result, null, 2));
  console.log(ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  await page.screenshot({ path: `test-output/checkout-failure-${kind}.png`, fullPage: true }).catch(() => {});
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
