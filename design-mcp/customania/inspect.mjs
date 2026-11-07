// Customania inspection run (no payment). Maps everything the order tools need:
//  - editor controls (front/back sides, move/resize, size readout, scripting globals)
//  - front "Hallucinated" + back graphic placed, two-location price
//  - quantity window size labels, set S2 M3 L3 XL2 to read the real 10-shirt total
//  - cart -> Shopify checkout: contact, delivery (ship/pickup), payment iframes
// STOPS on the checkout page. Never fills payment, never pays.
// Output: ../customania-inspect/ (inspect.log, inspect.json, screenshots)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, "..");
const ROOT = path.resolve(MCP, "..");
const OUT = path.join(ROOT, "customania-inspect");
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, "inspect.log");
fs.writeFileSync(LOG, "");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const report = {};
const save = () => fs.writeFileSync(path.join(OUT, "inspect.json"), JSON.stringify(report, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRODUCT = "https://thecustomania.com/products/mens-premium-t-shirt?variant=43906002223312";
const FRONT = path.join(MCP, "refs", "logo.png");
const BACK = path.join(MCP, "refs", "git-reset-back.png");
const SIZES = { S: 2, M: 3, L: 3, XL: 2 };

// Everything visible and interactive in a frame, plus scripting globals and the size readout.
const DUMP = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden"; };
  const items = [];
  for (const e of document.querySelectorAll("button,a,input,select,textarea,label,[onclick],[role=button],[id]")) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    const text = (e.innerText || e.value || e.title || e.getAttribute("aria-label") || e.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 60);
    items.push({ tag: e.tagName.toLowerCase(), id: e.id || undefined, cls: String(e.className || "").slice(0, 70) || undefined, name: e.getAttribute("name") || undefined, type: e.getAttribute("type") || undefined, text: text || undefined, onclick: (e.getAttribute("onclick") || "").slice(0, 80) || undefined, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  }
  const readout = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /\d+(\.\d+)?\s*:\s*\d+(\.\d+)?\s*in/.test(e.textContent || "")).slice(0, 5)
    .map((e) => ({ id: e.id, cls: String(e.className), text: e.textContent.trim(), parent: e.parentElement?.id || String(e.parentElement?.className || "").slice(0, 60) }));
  const globals = Object.keys(window).filter((k) => /qsmz|fabric|canvas|design|editor|stage|konva|product|side|area/i.test(k)).slice(0, 80);
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ id: c.id, cls: String(c.className), w: c.width, h: c.height }));
  const sides = [...document.querySelectorAll("*")].filter((e) => e.children.length <= 1 && /^(front|back|left sleeve|right sleeve|sleeve)$/i.test((e.textContent || "").trim()) && vis(e))
    .slice(0, 10).map((e) => ({ tag: e.tagName.toLowerCase(), id: e.id, cls: String(e.className).slice(0, 60), text: e.textContent.trim(), onclick: e.getAttribute("onclick") }));
  const prices = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /\$\s?\d/.test(e.textContent || "") && vis(e)).slice(0, 15).map((e) => ({ id: e.id, cls: String(e.className).slice(0, 50), text: e.textContent.trim().slice(0, 60) }));
  return { url: location.href, items: items.slice(0, 450), readout, globals, canvases, sides, prices, hasFabric: typeof window.fabric !== "undefined" };
};

const ctx = await chromium.launchPersistentContext(path.join(ROOT, ".pw-chrome-profile"), {
  channel: "chrome", headless: false, viewport: null,
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--start-maximized", "--disable-blink-features=AutomationControlled", "--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,BlockThirdPartyCookies"],
});
await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
const page = ctx.pages()[0] || (await ctx.newPage());
page.on("dialog", (d) => { log(`site pop-up: ${d.message()}`); d.dismiss().catch(() => {}); });
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name) }).catch((e) => log("screenshot failed " + e.message)); log("screenshot " + name); };

let editor;
const jsClick = async (id) => { const ok = await editor.evaluate((i) => { const e = document.getElementById(i); if (!e) return false; e.click(); return true; }, id); log(`js click #${id}: ${ok ? "ok" : "NOT FOUND"}`); return ok; };
const placed = () => editor.evaluate(() => /\d+(\.\d+)?\s*:\s*\d+(\.\d+)?\s*in/.test(document.body.innerText)).catch(() => false);
async function upload(file, label) {
  await jsClick("btnaddimage"); await sleep(2000);
  await editor.locator("#qsmz-file").setInputFiles(file);
  for (let i = 0; i < 30; i++) { if (await placed()) break; await sleep(2000); }
  await sleep(3000);
  log(`${label} uploaded, placed=${await placed()}`);
}

try {
  log("0. empty the cart from earlier tests");
  await page.goto("https://thecustomania.com/cart/clear", { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(2000);

  log("1. product page -> Customize");
  await page.goto(PRODUCT, { waitUntil: "domcontentloaded" });
  report.product_page = await page.evaluate(DUMP);
  await page.getByRole("link", { name: "Customize" }).first().click();
  await page.waitForSelector("#qsmziFrameCont", { timeout: 45000 });
  editor = await (await page.$("#qsmziFrameCont")).contentFrame();
  await editor.waitForSelector("#btnaddimage", { state: "attached", timeout: 45000 });
  await sleep(6000);
  report.editor_empty = await editor.evaluate(DUMP); save();
  await shot("1-editor.png");

  log("2. FRONT: upload the wordmark");
  await upload(FRONT, "front");
  report.editor_front = await editor.evaluate(DUMP); save();
  await shot("2-front-placed.png");

  log("3. switch to BACK side");
  const back = report.editor_front.sides.find((s) => /^back$/i.test(s.text));
  if (back?.id) await jsClick(back.id);
  else await editor.getByText(/^back$/i).first().click({ timeout: 5000 }).catch((e) => log("back side click failed: " + e.message));
  await sleep(3000);
  report.editor_back_empty = await editor.evaluate(DUMP); save();
  await shot("3-back-side.png");

  log("4. BACK: upload the graphic");
  await upload(BACK, "back");
  report.editor_back = await editor.evaluate(DUMP); save();
  await shot("4-back-placed.png");

  log("5. ORDER NOW -> quantity window");
  await jsClick("addtocart"); await sleep(3000);
  report.quantity_window = await editor.evaluate(() => {
    const w = document.getElementById("qsmzQuantitiesWindow");
    if (!w) return null;
    return [...w.querySelectorAll("input.infoQty")].map((i) => {
      let el = i, label = "";
      for (let k = 0; k < 5 && el && !label; k++) { el = el.parentElement; const t = (el?.innerText || "").trim().replace(/\s+/g, " "); if (t && t.length < 40) label = t; }
      return { id: i.id, value: i.value, label, data: { ...i.dataset } };
    });
  });
  log("quantity rows: " + JSON.stringify(report.quantity_window));
  save();
  // set S2 M3 L3 XL2 by matching labels
  const setQty = await editor.evaluate((sizes) => {
    const done = {};
    for (const i of document.querySelectorAll("#qsmzQuantitiesWindow input.infoQty")) {
      let el = i, label = "";
      for (let k = 0; k < 5 && el && !label; k++) { el = el.parentElement; const t = (el?.innerText || "").trim(); if (t && t.length < 40) label = t; }
      const key = Object.keys(sizes).find((s) => new RegExp(`(^|\\s)${s === "S" ? "(S|Small)" : s === "M" ? "(M|Medium)" : s === "L" ? "(L|Large)" : "(XL|X-Large|Extra Large)"}(\\s|$|\\b)`, "i").test(label) && !(s === "L" && /x-?l/i.test(label)));
      const v = key ? sizes[key] : 0;
      i.value = String(v); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true }));
      if (key) done[key] = { id: i.id, label, v };
    }
    return done;
  }, SIZES);
  if (!Object.keys(setQty).length) {
    // labels not found near inputs: fall back to column order (infoQty2 was Small in the last run)
    const fb = await editor.evaluate(() => {
      const ins = [...document.querySelectorAll("#qsmzQuantitiesWindow input.infoQty")];
      const vals = [2, 3, 3, 2];
      ins.forEach((i, k) => { i.value = String(vals[k] ?? 0); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
      return ins.map((i) => `${i.id}=${i.value}`);
    });
    log("labels not found; set by column order: " + fb.join(", "));
    Object.assign(setQty, { fallback_by_order: fb });
  }
  log("set quantities: " + JSON.stringify(setQty));
  await sleep(2000);
  report.quantity_set = setQty;
  report.quantity_window_after = await editor.evaluate(DUMP).then((d) => ({ prices: d.prices }));
  log("prices shown: " + JSON.stringify(report.quantity_window_after.prices));
  save();
  await shot("5-quantities.png");

  log("6. confirm -> disclaimer -> cart");
  await jsClick("btnokquantity"); await sleep(2500);
  await shot("6-disclaimer.png");
  await jsClick("btnAcceptDisclaimer");
  await page.waitForURL("**/cart**", { timeout: 60000 }).catch(() => log("did not reach /cart"));
  await sleep(4000);
  report.cart_text = (await page.locator("main").innerText().catch(() => "")).slice(0, 1500);
  log("cart: " + report.cart_text.replace(/\n+/g, " | ").slice(0, 600));
  save();
  await shot("7-cart.png");

  log("7. Check Out -> Shopify checkout (inspect only)");
  await page.getByRole("button", { name: /check ?out/i }).first().click().catch(async () => { await page.goto("https://thecustomania.com/checkout"); });
  await page.waitForURL(/checkout|checkouts/, { timeout: 60000 }).catch(() => log("did not reach checkout"));
  await sleep(6000);
  report.checkout = await page.evaluate(DUMP);
  report.checkout_frames = page.frames().map((f) => ({ name: f.name(), url: f.url().slice(0, 120) }));
  report.checkout_text = (await page.locator("body").innerText().catch(() => "")).slice(0, 3000);
  log("checkout frames: " + JSON.stringify(report.checkout_frames));
  log("checkout text: " + report.checkout_text.replace(/\n+/g, " | ").slice(0, 1200));
  save();
  await shot("8-checkout.png");
  await page.screenshot({ path: path.join(OUT, "8b-checkout-full.png"), fullPage: true }).catch(() => {});
  log("STOPPED at checkout. Nothing was filled in or paid.");
} catch (e) {
  log("EXCEPTION: " + e.message.slice(0, 400));
  await shot("x-exception.png");
  save();
} finally {
  log("closing in 15s");
  await sleep(15000);
  await ctx.close();
  log("== inspect done. Results in customania-inspect/");
}
