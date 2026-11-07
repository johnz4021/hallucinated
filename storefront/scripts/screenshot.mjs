// Usage: node scripts/screenshot.mjs <baseUrl> [outDir]
// Full-page mobile (390px) + desktop (1440px) screenshots of home, shop, a product page and a filled bag.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const out = process.argv[3] ?? "test-output/shots";
mkdirSync(out, { recursive: true });
const headers = process.env.VERCEL_BYPASS ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS } : {};
const browser = await chromium.launch();
for (const [name, viewport] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1440, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: name === "mobile" ? 2 : 1, extraHTTPHeaders: headers });
  const page = await ctx.newPage();
  for (const [slug, path] of [["home", "/"], ["shop", "/shop"], ["product", "/p/git-reset-hard-tee"], ["drop2", "/drops/2"]]) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-${slug}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${name} ${slug} overflow=${overflow}`);
  }
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
