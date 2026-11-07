// Renders 4:5 flat front/back product images of the drop-1 tee (same SVG as the site) to PNG.
// Usage: node scripts/render-flats.mjs <outDir> [background]
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STOREFRONT } from "./root-env.mjs";

const out = process.argv[2] ?? "test-output/refs";
const bg = process.argv[3] ?? "#F2EEE6";
const dataUri = (f, type) => `data:${type};base64,${readFileSync(path.join(STOREFRONT, "public", f)).toString("base64")}`;
const BODY = "L490 72 L590 196 L516 252 L478 214 L478 636 L122 636 L122 214 L84 252 L10 196 L110 72 Z";
const sides = {
  front: { neck: "M212 38 C238 92 362 92 388 38", img: `<image href="${dataUri("wordmark.svg", "image/svg+xml")}" x="210" y="150" width="180" height="29.5"/>` },
  back: { neck: "M212 38 C246 58 354 58 388 38", img: `<image href="${dataUri("back-print.png", "image/png")}" x="186" y="104" width="228" height="257"/>` },
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } });
for (const [name, s] of Object.entries(sides)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-70 -120 740 925" width="1200" height="1500"><rect x="-70" y="-120" width="740" height="925" fill="${bg}"/><path d="${s.neck.replace(/^M212 38 /, "M212 38 ")} ${BODY.replace(/^/, "")}" fill="#1A1A1A" transform=""/><path d="${s.neck}" fill="none" stroke="#262626" stroke-width="6"/>${s.img}</svg>`;
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `tee-${name}.png`), clip: { x: 0, y: 0, width: 1200, height: 1500 } });
  console.log(path.join(out, `tee-${name}.png`));
}
await browser.close();
