// Price probe: what does Customania charge per order at different print widths and quantities?
// Never adds to cart, never checks out. Usage: node customania/price_probe.mjs <back-design-id>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CustomaniaSession } from "./customania.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, ".."), ROOT = path.resolve(MCP, "..");
const BACK = path.join(ROOT, "design-test", `${process.argv[2] || "9ab8a02eaec1"}.png`);
const FRONT = path.join(MCP, "refs", "logo.png");
const LOG = path.join(ROOT, "customania-runs", "price-probe.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONFIGS = process.argv.includes("--back-only") ? [{ front: 0, back: 11 }] : [
  { front: 10, back: 11 }, { front: 10, back: 10 }, { front: 10, back: 9 }, { front: 8, back: 9 }, { front: 8, back: 8 },
];
const QTYS = [{ M: 1 }, { M: 2 }, { S: 1, M: 2 }, { S: 1, M: 2, L: 1 }, { S: 1, M: 2, L: 2 }];
const results = [];
for (const c of CONFIGS) {
  const s = new CustomaniaSession({ root: ROOT, outDir: path.join(ROOT, "customania-runs"), log });
  try {
    await s.start();
    if (c.front) { await s.upload("front", FRONT); await s.place("front", { width_in: c.front, top_in: 1.5 }); }
    await s.upload("back", BACK); const b = await s.place("back", { width_in: c.back, top_in: 1 });
    await s.jsClick("addtocart"); await sleep(3000);
    for (const q of QTYS) {
      const want = Object.fromEntries(Object.entries(q).map(([k, n]) => [String(s.variants[{ S: "Small", M: "Medium", L: "Large", XL: "XLarge" }[k]]), n]));
      await s.editor.evaluate((want) => {
        for (const i of document.querySelectorAll("#qsmzQuantitiesWindow input.infoQty")) {
          i.value = String(want[i.dataset.variantid] ?? 0);
          i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, want);
      await sleep(1800);
      const total = await s.editor.evaluate(() => (document.getElementById("infopricesTotalPrice")?.textContent || "").trim());
      const n = Object.values(q).reduce((a, b) => a + b, 0);
      const usd = parseFloat(total.replace(/[^\d.]/g, ""));
      const r = { front_in: c.front, back_in: `${b.measured?.width_in}x${b.measured?.height_in}`, shirts: n, subtotal: total, with_tax: +(usd * 1.08625).toFixed(2), per_shirt: +(usd / n).toFixed(2) };
      results.push(r); log(JSON.stringify(r));
    }
  } catch (e) { log(`config ${JSON.stringify(c)} failed: ${e.message}`); }
  await s.close();
}
fs.writeFileSync(path.join(ROOT, "customania-runs", "price-probe.json"), JSON.stringify(results, null, 2));
log("== price probe done (nothing added to cart)");
process.exit(0);
