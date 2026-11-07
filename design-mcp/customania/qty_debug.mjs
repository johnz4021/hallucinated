// Debug the quantity window: dump the row markup + handlers, then try ways of setting M=1, S=0. Never adds to cart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CustomaniaSession } from "./customania.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, ".."), ROOT = path.resolve(MCP, "..");
const OUT = path.join(ROOT, "customania-runs", "qty-debug.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = new CustomaniaSession({ root: ROOT, outDir: path.join(ROOT, "customania-runs"), log: console.log });
const res = {};
try {
  await s.start({ baseSize: process.argv[2] || "M" });
  await s.upload("front", path.join(MCP, "refs", "logo.png"));
  await s.jsClick("addtocart"); await sleep(3000);
  const S = String(s.variants.Small), M = String(s.variants.Medium);
  res.dom = await s.editor.evaluate(({ S, M }) => {
    const row = (vid) => { const i = document.querySelector(`#qsmzQuantitiesWindow input.infoQty[data-variantid="${vid}"]`); let r = i; for (let k = 0; k < 3 && r.parentElement; k++) r = r.parentElement; return { input: i.outerHTML, row: r.outerHTML.slice(0, 1500) }; };
    const ev = (el) => { try { const d = window.jQuery && window.jQuery._data(el, "events"); return d ? Object.keys(d) : null; } catch { return "err"; } };
    const i = document.querySelector(`#qsmzQuantitiesWindow input.infoQty[data-variantid="${S}"]`);
    return { small: row(S), medium: row(M), jquery: !!window.jQuery, small_events: ev(i), total: document.getElementById("infopricesTotalPrice")?.textContent };
  }, { S, M });
  const read = () => s.editor.evaluate(({ S, M }) => {
    const v = (vid) => document.querySelector(`#qsmzQuantitiesWindow input.infoQty[data-variantid="${vid}"]`).value;
    return { S: v(S), M: v(M), total: document.getElementById("infopricesTotalPrice")?.textContent?.trim() };
  }, { S, M });
  // Strategy A: real keyboard typing (Playwright fill = focus + input events + change on blur)
  const inp = (vid) => s.editor.locator(`#qsmzQuantitiesWindow input.infoQty[data-variantid="${vid}"]`);
  await inp(M).fill("1"); await inp(M).press("Tab"); await sleep(1200); res.a1_after_M = await read();
  await inp(S).fill("0"); await inp(S).press("Tab"); await sleep(1200); res.a2_after_S = await read();
  // Strategy B: the editor's own +/- buttons (what toCart now uses)
  res.b_setQuantities_M1 = await s.setQuantities({ [M]: 1 });
  res.b_after = await read();
  res.b_setQuantities_M2_L1 = await s.setQuantities({ [M]: 2, [String(s.variants.Large)]: 1 });
  res.b_after2 = await read();
  res.controls = await s.editor.evaluate(({ S }) => {
    const i = document.querySelector(`#qsmzQuantitiesWindow input.infoQty[data-variantid="${S}"]`);
    const p = i.parentElement;
    return [...p.querySelectorAll("*")].filter((e) => e !== i).map((e) => ({ tag: e.tagName, id: e.id, cls: e.className?.toString?.(), text: e.textContent.trim().slice(0, 10), onclick: e.getAttribute("onclick") }));
  }, { S });
} catch (e) { res.error = e.message; }
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2).slice(0, 4000));
await s.close();
process.exit(0);
