// Screenshots of /hq/agent/<key> at 1920x1080 (first run expanded) and 390 px. Usage: node scripts/shot-agents.mjs <base> <outDir> [keys]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { envVar } from "./root-env.mjs";
const [base, out = "test-output/hq-agents", keysArg = "growth,creative,ceo"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
for (const [n, vp, dpr] of [["projector", { width: 1920, height: 1080 }, 1], ["mobile", { width: 390, height: 844 }, 2]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dpr });
  if (process.env.VERCEL_OIDC === "1") {
    const t = envVar("VERCEL_OIDC_TOKEN"), o = new URL(base).origin;
    await ctx.route((u) => u.origin === o, (r) => r.continue({ headers: { ...r.request().headers(), "x-vercel-trusted-oidc-idp-token": t } }));
  }
  const p = await ctx.newPage();
  for (const k of keysArg.split(",")) {
    await p.goto(`${base}/hq/agent/${k}`, { waitUntil: "load" });
    await p.waitForTimeout(1500);
    await p.locator(".hqa-run-head").first().click().catch(() => {});
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${n}-${k}.png`, fullPage: n === "mobile" });
    console.log(n, k, "overflow", await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), "scrolls", await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1));
  }
  // the /hq map links into a drill-down
  await p.goto(`${base}/hq`, { waitUntil: "load" }); await p.waitForTimeout(1200);
  if (n === "projector") { await p.locator(".hq2-node.agent-growth .hq2-node-link").click(); await p.waitForURL(/\/hq\/agent\/growth/); console.log("map click -> drill-down OK"); }
  await ctx.close();
}
await b.close();
