// Click-through smoke test of the real buying flows. Opens Stripe Checkout but NEVER pays.
// Usage:
//   node scripts/test-flows.mjs <store-url>                       sandbox (test key); VERCEL_OIDC=1 for a protected preview
//   node scripts/test-flows.mjs https://hallucinated-store.vercel.app --live-readonly
//        production: Stripe lookups use the LIVE key read-only (prices/products), no payments, no writes.
// Flows: direct buy-now, direct pre-order (ship), direct agent pre-order (pickup), bag buy-now, bag pre-order,
// stale bag (old price + wrong kind), old-client API call. Reports taps from product page to Stripe.
import { chromium } from "playwright";
import Stripe from "stripe";
import { envVar, stripeKey } from "./root-env.mjs";

const args = process.argv.slice(2);
const liveRO = args.includes("--live-readonly");
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
let key;
if (liveRO) {
  if (new URL(base).hostname !== "hallucinated-store.vercel.app") throw new Error("--live-readonly is for the production URL only");
  key = envVar("STRIPE_LIVE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_LIVE_SECRET_KEY missing");
} else {
  const k = stripeKey({ allowLive: false });
  if (k.mode !== "test") throw new Error("test-flows needs a test key (or --live-readonly against production)");
  key = k.key;
}
// Read-only use: only retrieve/list/search calls below.
const stripe = new Stripe(key);
const origin = new URL(base).origin;
const oidc = process.env.VERCEL_OIDC === "1" ? envVar("VERCEL_OIDC_TOKEN") : null;
const browser = await chromium.launch();
const results = [];

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (oidc) await ctx.route((u) => u.origin === origin, (r) => r.continue({ headers: { ...r.request().headers(), "x-vercel-trusted-oidc-idp-token": oidc } }));
  const page = await ctx.newPage();
  page.taps = 0;
  page.tap = async (sel) => { page.taps++; await page.click(sel); };
  page.tapCheck = async (sel) => { page.taps++; await page.check(sel); };
  return { ctx, page };
}
const waitStripe = (page, ms = 30000) => page.waitForURL(/checkout\.stripe\.com/, { timeout: ms });

async function flow(name, fn) {
  const { ctx, page } = await newPage();
  try {
    const detail = await fn(page);
    results.push({ name, ok: true, ...detail });
  } catch (e) {
    await page.screenshot({ path: `test-output/flow-fail-${name.replace(/\W+/g, "-")}.png`, fullPage: true }).catch(() => {});
    results.push({ name, ok: false, error: e.message.split("\n")[0] });
  } finally {
    await ctx.close();
  }
}
async function openProduct(page, slug) {
  await page.goto(`${base}/p/${slug}`, { waitUntil: "load" });
  await page.waitForTimeout(800);
}
const agentSlug = async () => (await stripe.products.search({ query: "metadata['origin']:'agents' AND active:'true'" })).data[0]?.metadata.slug;

// ---- Direct paths (the primary button on the product page) ----
await flow("direct buy-now tee", async (page) => {
  await openProduct(page, "git-reset-hard-tee");
  await page.tap('label.size:has(input[value="M"])');
  await page.tap(".buy > button.cta");
  await waitStripe(page);
  return { taps_to_stripe: page.taps };
});
await flow("direct pre-order cap (ship, default)", async (page) => {
  await openProduct(page, "wordmark-cap-black");
  await page.tap(".buy > button.cta");
  await waitStripe(page);
  await page.waitForTimeout(2500);
  return { taps_to_stripe: page.taps, address_form: (await page.locator("#shippingAddressLine1").count()) > 0 };
});
await flow("direct agent pre-order (pickup)", async (page) => {
  const slug = await agentSlug();
  if (!slug) return { skipped: "no active agent product" };
  await openProduct(page, slug);
  await page.tap('label.size:has(input[value="L"])');
  await page.tap('.fulfil-toggle input[value="pickup"]');
  await page.tap(".buy > button.cta");
  await waitStripe(page);
  await page.waitForTimeout(2500);
  return { slug, taps_to_stripe: page.taps, address_form: (await page.locator("#shippingAddressLine1").count()) > 0, name_field: (await page.locator("#individualName").count()) > 0 };
});
await flow("mobile sticky bar pre-order", async (page) => {
  const slug = await agentSlug();
  if (!slug) return { skipped: "no active agent product" };
  await openProduct(page, slug);
  await page.tap(".sticky-buy .cta"); // no size yet: should ask for one
  if (!(await page.locator(".need-size").count())) throw new Error("sticky bar did not ask for a size");
  await page.tap('label.size:has(input[value="M"])');
  await page.tap(".sticky-buy .cta");
  await waitStripe(page);
  return { taps_to_stripe: page.taps };
});

// ---- Bag paths ----
async function viaBag(page, slug, size) {
  await openProduct(page, slug);
  if (size) await page.tap(`label.size:has(input[value="${size}"])`);
  await page.tap(".buy > .btn-secondary");
  await page.waitForSelector(".added", { timeout: 10000 });
  await page.goto(`${base}/cart`, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  await page.tap(".cart-summary > button.cta");
  const opened = await waitStripe(page, 8000).then(() => true).catch(() => false);
  if (!opened) {
    if (await page.locator(".bag-notes").count()) await page.tap(".cart-summary > button.cta");
    await waitStripe(page);
  }
  return { hasChoice: (await page.locator(".fulfil-choice").count()) > 0 };
}
await flow("bag buy-now tee", async (page) => { await viaBag(page, "git-reset-hard-tee", "M"); return { checkout: "opened" }; });
await flow("bag pre-order cap (ship preselected)", async (page) => { await viaBag(page, "wordmark-cap-black", null); return { checkout: "opened" }; });

await flow("stale bag (old price, wrong kind)", async (page) => {
  const cap = (await stripe.products.search({ query: "metadata['slug']:'wordmark-cap-black'" })).data[0];
  const old = (await stripe.prices.list({ product: cap.id, active: false, limit: 10 })).data.find((p) => p.metadata.size);
  if (!old) return { skipped: "no archived cap price" };
  const stale = [{ priceId: old.id, slug: "wordmark-cap-black", name: "Wordmark cap", size: "OS", unitAmount: old.unit_amount, image: null, kind: "live", launchWindow: null, qty: 1 }];
  await page.addInitScript((v) => localStorage.setItem("hallucinated.cart.v1", v), JSON.stringify(stale));
  await page.goto(`${base}/cart`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  if (!(await page.locator(".fulfil-choice").count())) throw new Error("stale bag was not corrected to a pre-order");
  await page.tap(".cart-summary > button.cta");
  await waitStripe(page);
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
