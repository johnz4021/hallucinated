// Screenshots /hq at 1920x1080 (viewport + full page) and on a phone. Usage: node scripts/shot-hq.mjs <base> <outDir>
// VERCEL_OIDC=1 authenticates to a protected preview (header sent to the store origin only).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { envVar } from "./root-env.mjs";
const [base, out = "test-output/hq"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
for (const [n, vp, dpr] of [["projector", { width: 1920, height: 1080 }, 1], ["mobile", { width: 390, height: 844 }, 2]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dpr });
  if (process.env.VERCEL_OIDC === "1") {
    const token = envVar("VERCEL_OIDC_TOKEN");
    const origin = new URL(base).origin;
    await ctx.route((u) => u.origin === origin, (r) => r.continue({ headers: { ...r.request().headers(), "x-vercel-trusted-oidc-idp-token": token } }));
  }
  const p = await ctx.newPage();
  await p.goto(`${base}/hq`, { waitUntil: "load" });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${n}-viewport.png` });
  await p.screenshot({ path: `${out}/${n}-full.png`, fullPage: true });
  console.log(n, "overflow", await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
  await ctx.close();
}
await b.close();
