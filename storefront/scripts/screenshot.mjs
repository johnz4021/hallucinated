// Usage: node scripts/screenshot.mjs <url> [outDir]  -> mobile (390px) + desktop full-page screenshots
import { chromium } from "playwright";
const url = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "test-output";
const browser = await chromium.launch();
for (const [name, viewport] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1440, height: 900 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: name === "mobile" ? 2 : 1 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(name, "horizontal overflow:", overflow);
  await page.close();
}
await browser.close();
