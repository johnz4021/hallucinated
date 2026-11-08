// Click-through smoke test of the real buying flows (test key only). Opens Stripe Checkout but never pays.
// Usage: node scripts/test-flows.mjs <store-url>      (VERCEL_OIDC=1 for a protected preview)
// Flows: buy-now tee, pre-order cap (ship), agent tee (pickup), stale bag (old price + wrong kind), old-client API call.
import { chromium } from "playwright";
import Stripe from "stripe";
import { envVar, stripeKey } from "./root-env.mjs";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { key, mode } = stripeKey({ allowLive: false });
if (mode !== "test") throw new Error("test-flows only runs against a test key");
const stripe = new Stripe(key);
const origin = new URL(base).origin;
const oidc = process.env.VERCEL_OIDC === "1" ? envVar("VERCEL_OIDC_TOKEN") : null;
const browser = await chromium.launch();
const results = [];

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (oidc) await ctx.route((u) => u.origin === origin, (r) => r.continue({ headers: { ...r.request().headers(), "x-vercel-trusted-oidc-idp-token": oidc } }));
  return { ctx, page: await ctx.newPage() };
}

async function toCheckout(page, choice) {
  await page.goto(`${base}/cart`, { waitUntil: "load" });
  await page.waitForTimeout(2000); // bag re-check against Stripe
  const hasChoice = await page.locator(".fulfil-choice").count();
  if (hasChoice) await page.check(`input[name="fulfilment"][value="${choice ?? "ship"}"]`);
  await page.click(".cart-summary button.cta");
  // A bag that just got corrected shows what changed and needs a second press.
  const opened = await page.waitForURL(/checkout\.stripe\.com/, { timeout: 8000 }).then(() => true).catch(() => false);
  if (!opened) {
    if (await page.locator(".bag-notes").count()) await page.click(".cart-summary button.cta");
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
  }
  return { hasChoice: !!hasChoice };
}

async function flow(name, fn) {
  const { ctx, page } = await newPage();
  try {
    const detail = await fn(page);
    results.push({ name, ok: true, ...detail });
  } catch (e) {
    await page.screenshot({ path: `test-output/flow-fail-${name}.png`, fullPage: true }).catch(() => {});
    results.push({ name, ok: false, error: e.message.split("\n")[0] });
  } finally {
    await ctx.close();
  }
}

async function addFromProduct(page, slug, size) {
  await page.goto(`${base}/p/${slug}`, { waitUntil: "load" });
  if (size) await page.click(`label.size:has(input[value="${size}"])`);
  await page.click("button.cta");
  await page.waitForSelector(".added", { timeout: 10000 });
}

await flow("buy-now tee", async (page) => {
  await addFromProduct(page, "git-reset-hard-tee", "M");
  const r = await toCheckout(page);
  if (r.hasChoice) throw new Error("buy-now bag should not ask ship/pickup (Stripe Checkout does)");
  return { checkout: "opened" };
});

await flow("pre-order cap, ship", async (page) => {
  await addFromProduct(page, "wordmark-cap-black", null);
  const r = await toCheckout(page, "ship");
  if (!r.hasChoice) throw new Error("pre-order bag must show the ship/pickup choice");
  return { checkout: "opened" };
});

await flow("agent tee, pickup", async (page) => {
  const agent = (await stripe.products.search({ query: "metadata['origin']:'agents' AND active:'true'" })).data[0];
  if (!agent) return { checkout: "skipped (no active agent product in this catalog)" };
  await addFromProduct(page, agent.metadata.slug, "L");
  const r = await toCheckout(page, "pickup");
  if (!r.hasChoice) throw new Error("agent pre-order bag must show the ship/pickup choice");
  return { slug: agent.metadata.slug, checkout: "opened" };
});

await flow("stale bag (old price, wrong kind)", async (page) => {
  const cap = (await stripe.products.search({ query: "metadata['slug']:'wordmark-cap-black'" })).data[0];
  const old = (await stripe.prices.list({ product: cap.id, active: false, limit: 10 })).data.find((p) => p.metadata.size);
  if (!old) return { checkout: "skipped (no archived cap price)" };
  const stale = [{ priceId: old.id, slug: "wordmark-cap-black", name: "Wordmark cap", size: "OS", unitAmount: old.unit_amount, image: null, kind: "live", launchWindow: null, qty: 1 }];
  await page.addInitScript((v) => localStorage.setItem("hallucinated.cart.v1", v), JSON.stringify(stale));
  const r = await toCheckout(page, "ship");
  if (!r.hasChoice) throw new Error("stale bag was not corrected to a pre-order");
  return { old_price: old.id, checkout: "opened" };
});

await flow("old client API (no choice sent)", async () => {
  const cap = (await stripe.prices.list({ lookup_keys: ["wordmark-cap-black-os"], active: true })).data[0];
  const call = (extra) => fetch(`${base}/api/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(oidc ? { "x-vercel-trusted-oidc-idp-token": oidc } : {}) },
    body: JSON.stringify({ items: [{ price_id: cap.id, quantity: 1 }], ...extra }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const legacy = await call({});
  const current = await call({ client: 2 });
  if (legacy.status !== 200 || !legacy.body.url) throw new Error(`old client should still get a checkout (got ${legacy.status})`);
  if (current.status !== 400) throw new Error(`current client without a choice should get 400 (got ${current.status})`);
  return { legacy: "accepted, fulfilment=ask", current: "400 asks for a choice" };
});

await browser.close();
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `: ${r.error}`}  ${r.ok ? JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !["name", "ok"].includes(k)))) : ""}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
