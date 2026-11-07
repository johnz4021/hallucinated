// End-to-end test-mode purchase: store page -> Stripe hosted Checkout (test card 4242) -> /success,
// then confirms the session via the Stripe API. Test keys only.
// Usage: node scripts/test-checkout.mjs <store-url> [size] [quantity]
import { chromium } from "playwright";
import Stripe from "stripe";
import { stripeKey } from "./root-env.mjs";

const url = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const size = process.argv[3] ?? "L";
const quantity = Number(process.argv[4] ?? 2);
const { key, mode } = stripeKey({ allowLive: false });
if (mode !== "test") throw new Error("test-checkout only runs against a test key");

const email = `buyer+${Date.now()}@example.com`;
const name = "Test Buyer";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.click(`label.size:has(input[value="${size}"])`);
  for (let i = 1; i < quantity; i++) await page.click('button[aria-label="One more"]');
  await page.click("button.cta");
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });

  await page.fill("#email", email);
  await page.fill("#individualName", name);
  const cardTab = page.locator('[data-testid="card-accordion-item-button"]');
  if (!(await page.locator("#cardNumber").isVisible().catch(() => false))) {
    await cardTab.evaluate((el) => el.click()); // the accordion's cover div intercepts pointer clicks
    await page.locator("#cardNumber").waitFor({ state: "visible", timeout: 15000 });
  }
  await page.fill("#cardNumber", "4242424242424242");
  await page.fill("#cardExpiry", "12 / 34");
  await page.fill("#cardCvc", "123");
  if (await page.locator("#billingName").isVisible().catch(() => false)) await page.fill("#billingName", name);
  if (await page.locator("#billingPostalCode").isVisible().catch(() => false)) await page.fill("#billingPostalCode", "94110");
  const optOut = page.locator("#enableStripePass");
  if (await optOut.isChecked().catch(() => false)) await optOut.uncheck();
  await page.click('[data-testid="hosted-payment-submit-button"]');
  await page.waitForURL(new RegExp(`^${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/success`), { timeout: 90000 });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "test-output/success.png", fullPage: true });

  const sessionId = new URL(page.url()).searchParams.get("session_id");
  const stripe = new Stripe(key);
  const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items", "payment_intent"] });
  const result = {
    session_id: s.id,
    status: s.status,
    payment_status: s.payment_status,
    amount_total: s.amount_total,
    currency: s.currency,
    metadata: s.metadata,
    payment_intent_metadata: typeof s.payment_intent === "object" ? s.payment_intent?.metadata : null,
    quantity: s.line_items?.data[0]?.quantity,
    price: s.line_items?.data[0]?.price?.id,
    email: s.customer_details?.email,
    name: s.customer_details?.name,
    invoice: s.invoice,
    created: new Date(s.created * 1000).toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
  const ok = s.status === "complete" && s.payment_status === "paid" && s.metadata?.size === size && result.quantity === quantity && result.email === email && result.name === name;
  console.log(ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  await page.screenshot({ path: "test-output/checkout-failure.png", fullPage: true }).catch(() => {});
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
