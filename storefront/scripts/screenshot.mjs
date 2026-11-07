// Usage: node scripts/screenshot.mjs <baseUrl> [outDir] [path,path,...]   (paths default to home, shop, product, drop 2 + bag)
// Full-page mobile (390px) + desktop (1440px) screenshots of home, shop, a product page and a filled bag.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { envVar } from "./root-env.mjs";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const out = process.argv[3] ?? "test-output/shots";
mkdirSync(out, { recursive: true });
// Protected previews: VERCEL_OIDC=1 sends the linked project's short-lived dev OIDC token (from .env.local, never printed).
// The header is added only to requests for the store's own origin (not Stripe, Blob or fonts).
async function authorize(ctx) {
  if (process.env.VERCEL_OIDC !== "1") return;
  const token = envVar("VERCEL_OIDC_TOKEN");
  const origin = new URL(base).origin;
  await ctx.route((u) => u.origin === origin, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": token } }));
}
const browser = await chromium.launch();
for (const [name, viewport] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1440, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: name === "mobile" ? 2 : 1 });
  await authorize(ctx);
  const page = await ctx.newPage();
  const custom = process.argv[4]?.split(",").map((p) => [p === "/" ? "home" : p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-"), p]);
  for (const [slug, path] of custom ?? [["home", "/"], ["shop", "/shop"], ["product", "/p/git-reset-hard-tee"], ["drop2", "/drops/2"]]) {
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-${slug}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${name} ${slug} overflow=${overflow}`);
  }
  if (custom) { await ctx.close(); continue; }
  // Fill the bag: tee M x2, then cart page.
  await page.goto(base + "/p/git-reset-hard-tee", { waitUntil: "networkidle" });
  await page.click('label.size:has(input[value="M"])');
  await page.click('button[aria-label="One more"]');
  await page.click("button.cta");
  await page.goto(base + "/cart", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-cart.png`, fullPage: true });
  console.log(`${name} cart done`);
  await ctx.close();
}
await browser.close();
