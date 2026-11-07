// Customania order session: one persistent Chrome window driven step by step.
// Used by the MCP tools (customania_start / place / checkout / pay) and by test_order.mjs.
// Every step returns facts (measured inches, prices, cart lines, screenshots) for the agent to check.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";

const PRODUCT_HANDLE = "mens-premium-t-shirt";
const SITE = "https://thecustomania.com";
const SIZE_NAMES = { S: "Small", M: "Medium", L: "Large", XL: "XLarge", "2XL": "2XLarge", "3XL": "3XLarge" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CustomaniaSession {
  constructor({ root, outDir, log = console.log, color = "Black" }) {
    this.id = "cs_" + crypto.randomBytes(5).toString("hex");
    this.root = root;
    this.dir = path.join(outDir, this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.log = (m) => log(`[${this.id}] ${m}`);
    this.color = color;
    this.step = 0;
    this.sides = {};
  }

  async shot(name) {
    const f = path.join(this.dir, `${String(++this.step).padStart(2, "0")}-${name}.png`);
    await this.page.screenshot({ path: f }).catch(() => {});
    return f;
  }

  async jsClick(id) {
    return this.editor.evaluate((i) => { const e = document.getElementById(i); if (!e) return false; e.click(); return true; }, id);
  }

  readout() {
    return this.editor.evaluate(() => (document.getElementById("sizeRealEl")?.textContent || "").trim()).catch(() => "");
  }

  // baseSize: the editor opens on one size/color row that can never go below 1, so open it on a size this order includes.
  async start({ baseSize = "S" } = {}) {
    this.ctx = await chromium.launchPersistentContext(path.join(this.root, ".pw-chrome-profile"), {
      channel: "chrome", headless: false, viewport: null,
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled", "--disable-features=ThirdPartyStoragePartitioning,TrackingProtection3pcd,BlockThirdPartyCookies"],
    });
    await this.ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
    this.page = this.ctx.pages()[0] || (await this.ctx.newPage());
    this.page.on("dialog", (d) => { this.log(`site pop-up: ${d.message()}`); d.dismiss().catch(() => {}); });
    await this.page.goto(`${SITE}/cart/clear`, { waitUntil: "domcontentloaded" }).catch(() => {});
    // variant ids for every size in our color
    await this.page.goto(`${SITE}/products/${PRODUCT_HANDLE}`, { waitUntil: "domcontentloaded" });
    const product = await this.page.evaluate(async (h) => (await fetch(`/products/${h}.js`)).json(), PRODUCT_HANDLE);
    this.variants = Object.fromEntries(product.variants.filter((v) => v.option2 === this.color || v.title.includes(this.color)).map((v) => [v.option1, v.id]));
    this.log(`variants (${this.color}): ${JSON.stringify(this.variants)}`);
    const baseId = this.variants[SIZE_NAMES[baseSize] || baseSize];
    if (baseId) {
      await this.page.goto(`${SITE}/products/${PRODUCT_HANDLE}?variant=${baseId}`, { waitUntil: "domcontentloaded" });
      await sleep(1500);
      this.baseVariant = String(baseId);
    }
    const href = await this.page.getByRole("link", { name: "Customize" }).first().getAttribute("href").catch(() => null);
    this.log(`base size ${baseSize} (${baseId}); customize link ${href}`);
    await this.page.getByRole("link", { name: "Customize" }).first().click();
    await this.page.waitForSelector("#qsmziFrameCont", { timeout: 45000 });
    this.editor = await (await this.page.$("#qsmziFrameCont")).contentFrame();
    await this.editor.waitForSelector("#btnaddimage", { state: "attached", timeout: 45000 });
    await sleep(6000);
    const err = await this.editor.evaluate(() => (document.body.innerText.match(/Cannot read properties[^\n]*/) || [null])[0]);
    if (err) throw new Error("editor failed to load: " + err);
    return { session: this.id, variants: this.variants, screenshot: await this.shot("editor") };
  }

  async side(name) {
    const id = name === "back" ? "stagemini1" : "stagemini0";
    await this.jsClick(id);
    await sleep(2500);
  }

  // Upload one design file onto a side. Returns the editor's measured size.
  async upload(sideName, file) {
    await this.side(sideName);
    await this.jsClick("btnaddimage");
    await sleep(1500);
    await this.editor.locator("#qsmz-file").setInputFiles(file);
    let r = "";
    for (let i = 0; i < 30; i++) { r = await this.readout(); if (/[1-9]/.test(r)) break; await sleep(2000); }
    await sleep(2500);
    await this.jsClick("btnCloseWindowImage").catch(() => {});
    this.sides[sideName] = { file };
    const m = await this.measure(sideName);
    return { side: sideName, readout: r, ...m, screenshot: await this.shot(`${sideName}-uploaded`) };
  }

  // Konva model of the current side: the design image node + the print area, in inches.
  async measure(sideName) {
    if (sideName) await this.side(sideName);
    const m = await this.editor.evaluate(() => {
      const K = window.Konva;
      if (!K) return { error: "no Konva" };
      const stages = (K.stages || []).filter((s) => s.content && s.content.offsetParent !== null);
      const stage = stages[0] || K.stages?.[0];
      if (!stage) return { error: "no stage" };
      const groups = stage.find((n) => n.getClassName() === "Group" && n.name() === "group" && n.draggable());
      const node = groups[groups.length - 1];
      const area = stage.find("Rect").filter((r) => r.stroke && r.stroke() === "#ff0000" && r.isVisible())
        .sort((a, b) => b.width() * b.height() - a.width() * a.height())[0];
      const box = (n) => n ? n.getClientRect({ relativeTo: n.getLayer() }) : null;
      const read = (document.getElementById("sizeRealEl")?.textContent || "").trim();
      const mm = read.match(/([\d.]+)\s*:\s*([\d.]+)/);
      return {
        stages: K.stages.length, designs: groups.length,
        node: node ? { ...box(node), scaleX: node.scaleX(), scaleY: node.scaleY(), name: node.name(), id: node.id() } : null,
        area: area ? box(area) : null,
        readout: read, width_in: mm ? +mm[1] : null, height_in: mm ? +mm[2] : null,
      };
    });
    if (m.node && m.area && m.width_in) {
      const ppi = m.node.width / m.width_in;
      m.ppi = +ppi.toFixed(3);
      m.area_in = { width: +(m.area.width / ppi).toFixed(2), height: +(m.area.height / ppi).toFixed(2) };
      m.top_from_area_in = +((m.node.y - m.area.y) / ppi).toFixed(2);
      m.center_offset_in = +(((m.node.x + m.node.width / 2) - (m.area.x + m.area.width / 2)) / ppi).toFixed(2);
    }
    return m;
  }

  // Resize to width_in (aspect kept), center horizontally, put the top top_in below the print area's top.
  async place(sideName, { width_in, top_in = 1, center = true }) {
    await this.side(sideName);
    const before = await this.measure();
    if (!before.ppi) return { error: "could not measure", before };
    this.ppi = this.ppi || {}; this.ppi[sideName] = this.ppi[sideName] || before.ppi;
    const res = await this.editor.evaluate(({ width_in, top_in, center, ppi }) => {
      const K = window.Konva;
      const stage = (K.stages || []).filter((s) => s.content && s.content.offsetParent !== null)[0] || K.stages[0];
      const node = stage.find((n) => n.getClassName() === "Group" && n.name() === "group" && n.draggable()).pop();
      const area = stage.find("Rect").filter((r) => r.stroke && r.stroke() === "#ff0000" && r.isVisible())
        .sort((a, b) => b.width() * b.height() - a.width() * a.height())[0];
      const cur = node.getClientRect({ relativeTo: node.getLayer() });
      const k = (width_in * ppi) / cur.width;
      node.scaleX(node.scaleX() * k); node.scaleY(node.scaleY() * k);
      const a = area.getClientRect({ relativeTo: area.getLayer() });
      let c = node.getClientRect({ relativeTo: node.getLayer() });
      const dx = center ? (a.x + a.width / 2) - (c.x + c.width / 2) : 0;
      const dy = (a.y + top_in * ppi) - c.y;
      node.x(node.x() + dx); node.y(node.y() + dy);
      const tr = stage.find("Transformer")[0];
      if (tr) { tr.nodes?.([node]); tr.forceUpdate?.(); }
      node.fire("transformstart", { target: node }, true);
      node.fire("transform", { target: node }, true);
      node.fire("transformend", { target: node }, true);
      node.fire("dragstart", { target: node }, true);
      node.fire("dragmove", { target: node }, true);
      node.fire("dragend", { target: node }, true);
      node.getLayer().batchDraw();
      stage.fire("click", { target: node }, true);
      return true;
    }, { width_in, top_in, center, ppi: this.ppi[sideName] });
    await sleep(1500);
    const after = await this.measure();
    if (after.node) {
      const ppi = this.ppi[sideName];
      after.width_in_by_scale = +(after.node.width / ppi).toFixed(2);
      after.top_from_area_in = +((after.node.y - after.area.y) / ppi).toFixed(2);
      after.center_offset_in = +(((after.node.x + after.node.width / 2) - (after.area.x + after.area.width / 2)) / ppi).toFixed(2);
      after.readout_updated = after.width_in != null && Math.abs(after.width_in - after.width_in_by_scale) < 0.3;
    }
    const ok = after.width_in_by_scale != null && Math.abs(after.width_in_by_scale - width_in) < 0.3 && Math.abs((after.top_from_area_in ?? 99) - top_in) < 0.4 && (!center || Math.abs(after.center_offset_in ?? 99) < 0.3);
    return { side: sideName, target: { width_in, top_in, center }, before, after, within_tolerance: ok, applied: res, screenshot: await this.shot(`${sideName}-placed`) };
  }

  async preview() {
    await this.jsClick("btnActionPreview"); await sleep(2500);
    const f = await this.shot("preview");
    await this.jsClick("btnClosePreview"); await sleep(1000);
    return f;
  }

  // sizes: {S:2, M:3, L:3, XL:2}. Sets quantities by variant id, goes through the disclaimer to the cart.
  // Quantities go through the editor's own +/- buttons: typed values are ignored for the default row
  // (Small / <color> = 1 can't be typed to 0), and the editor won't let the total hit 0 mid-way, so raise first, then lower.
  async setQuantities(want) {
    const step = (vid, dir) => this.editor.evaluate(({ vid, dir }) => {
      const i = document.querySelector(`#qsmzQuantitiesWindow input.infoQty[data-variantid="${vid}"]`);
      const b = i?.parentElement?.querySelector(dir > 0 ? ".btnQtyPlus" : ".btnQtyMinus");
      if (!b) return null;
      b.click();
      return Number(i.value);
    }, { vid, dir });
    const read = () => this.editor.evaluate(() => Object.fromEntries([...document.querySelectorAll("#qsmzQuantitiesWindow input.infoQty")].map((i) => [i.dataset.variantid, Number(i.value)])));
    for (let pass = 0; pass < 3; pass++) {
      let cur = await read();
      for (const [vid, q] of Object.entries(want)) for (let n = cur[vid] || 0; n < q; n++) { await step(vid, +1); await sleep(250); }
      cur = await read();
      for (const [vid, n0] of Object.entries(cur)) { const q = want[vid] || 0; for (let n = n0; n > q; n--) { await step(vid, -1); await sleep(250); } }
      await sleep(1200);
      cur = await read();
      const wrong = Object.keys({ ...cur, ...want }).filter((vid) => (cur[vid] || 0) !== (want[vid] || 0)).map((vid) => ({ variant: vid, has: cur[vid] || 0, wanted: want[vid] || 0 }));
      if (!wrong.length) return { got: Object.entries(cur).filter(([, n]) => n).map(([variant, qty]) => ({ variant, qty })), wrong };
      if (pass === 2) return { got: [], wrong };
    }
  }

  async toCart(sizes) {
    await this.jsClick("addtocart"); await sleep(3000);
    const want = Object.fromEntries(Object.entries(sizes).map(([s, q]) => [String(this.variants[SIZE_NAMES[s] || s]), q]));
    const { got, wrong } = await this.setQuantities(want);
    const set = { out: got };
    if (wrong.length) throw new Error(`quantities did not stick in the editor: ${JSON.stringify(wrong)}`);
    const total = await this.editor.evaluate(() => (document.getElementById("infopricesTotalPrice")?.textContent || "").trim());
    const qshot = await this.shot("quantities");
    await this.jsClick("btnokquantity"); await sleep(2500);
    await this.jsClick("btnAcceptDisclaimer");
    await this.page.waitForURL("**/cart**", { timeout: 60000 });
    await sleep(3000);
    const cart = await this.page.evaluate(async () => (await fetch("/cart.js")).json());
    return {
      quantities: set.out, editor_total: total,
      cart: { item_count: cart.item_count, total: cart.total_price / 100, lines: cart.items.map((i) => ({ title: i.variant_title, qty: i.quantity, line: i.final_line_price / 100, design: i.properties })) },
      screenshots: [qshot, await this.shot("cart")],
    };
  }

  // Shopify checkout up to (not including) payment. contact: {email, first, last, address1, city, zip, state, phone}
  async checkout(contact) {
    await this.page.goto(`${SITE}/checkout`, { waitUntil: "domcontentloaded" });
    await this.page.waitForURL(/checkouts/, { timeout: 60000 });
    await sleep(5000);
    const fill = async (sel, v) => { if (v == null) return; const l = this.page.locator(sel).first(); if (await l.count()) await l.fill(String(v)).catch(() => {}); };
    await fill('input[name="email"], input#email', contact.email);
    // pickup is the only delivery option on this product; make sure it is selected if a choice exists
    await this.page.getByText(/pick ?up/i).first().click({ timeout: 3000 }).catch(() => {});
    await fill('input[name="firstName"]', contact.first);
    await fill('input[name="lastName"]', contact.last);
    await fill('input[name="address1"]', contact.address1);
    await fill('input[name="city"]', contact.city);
    await fill('input[name="postalCode"]', contact.zip);
    if (contact.state) await this.page.locator('select[name="zone"]').first().selectOption({ label: contact.state }).catch(() => {});
    await fill('input[name="phone"]', contact.phone);
    await sleep(2500);
    const summary = await this.page.evaluate(() => {
      const t = document.body.innerText;
      const money = [...t.matchAll(/(Subtotal|Shipping|Estimated taxes|Taxes|Total)\s*\n?\s*(USD\s*)?\$?([\d,]+\.\d\d)/g)].map((m) => ({ label: m[1], amount: m[3] }));
      return { money, pickup: /pick ?up|Customania Inc/i.test(t) };
    });
    this.checkoutUrl = this.page.url();
    return { url: this.checkoutUrl, summary, screenshot: await this.shot("checkout"), full: await this.page.screenshot({ path: path.join(this.dir, "checkout-full.png"), fullPage: true }).then(() => path.join(this.dir, "checkout-full.png")).catch(() => null) };
  }

  // Fill the card into Shopify's PCI iframes, then the billing address. Never returns the card. Clicks Pay only if pay=true.
  async payWithCard(card, { name, billing, pay = false }) {
    const page = this.page;
    // the credit-card option must be selected for the card fields to exist
    await page.getByText(/^credit card$/i).first().click({ timeout: 3000 }).catch(() => {});
    const frame = (n) => page.frameLocator(`iframe[name^="card-fields-${n}"]`).locator("input").first();
    await frame("number").fill(card.number.replace(/\s+/g, ""));
    await frame("expiry").fill(card.expiry.replace(/\s+/g, "").replace(/^(\d\d)\/?(\d\d)(\d\d)?$/, (m, a, b, c) => `${a}/${c || b}`));
    if (card.cvv) await frame("verification_value").fill(card.cvv);
    await frame("name").fill(name).catch(() => {});
    await sleep(1000);
    // Billing address. With pickup there is no shipping address, so the only address form on the page is billing.
    // If Shopify offers "use shipping address as billing", turn it off so the real billing address is used.
    const billingInfo = { filled: [] };
    if (billing) {
      const same = page.locator('input[type="checkbox"][name*="billing" i], input[type="checkbox"][id*="billing" i]').first();
      if (await same.count() && await same.isChecked().catch(() => false)) await same.uncheck().catch(() => {});
      await sleep(800);
      const sel = async (names, value, how = "fill") => {
        for (const n of names) {
          const all = page.locator(n);
          for (let i = (await all.count()) - 1; i >= 0; i--) {         // last match = the billing form if two exist
            const l = all.nth(i);
            if (!(await l.isVisible().catch(() => false))) continue;
            if (how === "select") { const ok = await l.selectOption({ label: value }).then(() => true).catch(() => l.selectOption(value).then(() => true).catch(() => false)); if (ok) { billingInfo.filled.push(n); return; } }
            else { await l.fill(String(value)).catch(() => {}); billingInfo.filled.push(n); return; }
          }
        }
      };
      await sel(['select[name="countryCode"]', 'select[name*="country" i]'], billing.country || "United States", "select");
      await sleep(800);
      await sel(['input[name="firstName"]', 'input[id*="billing" i][name*="first" i]'], billing.first);
      await sel(['input[name="lastName"]', 'input[id*="billing" i][name*="last" i]'], billing.last);
      await sel(['input[name="address1"]', 'input[name*="address1" i]'], billing.address1);
      await sel(['input[name="city"]', 'input[name*="city" i]'], billing.city);
      await sel(['select[name="zone"]', 'select[name*="zone" i]', 'select[name*="province" i]'], billing.state, "select");
      await sel(['input[name="postalCode"]', 'input[name*="postal" i]', 'input[name*="zip" i]'], billing.zip);
      await page.keyboard.press("Escape").catch(() => {});      // close any address autocomplete popup
      await sleep(1200);
    }
    const filled = await this.shot("payment-filled");
    await page.screenshot({ path: path.join(this.dir, "payment-full.png"), fullPage: true }).catch(() => {});
    if (!pay) return { paid: false, stopped_before_pay: true, billing: billingInfo, screenshot: filled, full: path.join(this.dir, "payment-full.png") };
    const btn = (await page.locator("#checkout-pay-button").count()) ? page.locator("#checkout-pay-button")
      : page.getByRole("button", { name: /^(pay now|complete order|place order)$/i }).last();
    await btn.click();
    await page.waitForURL(/thank[_-]?you|orders\//, { timeout: 120000 }).catch(() => {});
    await sleep(4000);
    const done = await page.evaluate(() => {
      const t = document.body.innerText;
      return { thank_you: /thank you/i.test(t), order: (t.match(/(Order|Confirmation)\s*#?\s*([A-Z0-9-]{4,})/i) || [])[2] || null,
        error: (t.match(/[^\n]*(declined|couldn.t be processed|try again|not supported|invalid|enter a valid)[^\n]*/i) || [null])[0] };
    });
    await page.screenshot({ path: path.join(this.dir, "payment-result-full.png"), fullPage: true }).catch(() => {});
    return { paid: done.thank_you, ...done, billing: billingInfo, url: page.url(), screenshot: await this.shot(done.thank_you ? "confirmation" : "payment-result") };
  }

  // Human payment fallback: leave the filled checkout open on screen, fill billing, and wait for a person to
  // enter a card and press Pay. Returns once the confirmation page shows (or on timeout). Never touches card fields.
  async waitForHumanPayment({ billing, timeoutMin = 15 } = {}) {
    const page = this.page;
    await page.bringToFront().catch(() => {});
    await page.getByText(/^credit card$/i).first().click({ timeout: 3000 }).catch(() => {});
    if (billing) {
      for (const [sel, v] of [['input[name="address1"]', billing.address1], ['input[name="city"]', billing.city], ['input[name="postalCode"]', billing.zip]]) {
        const l = page.locator(sel).last(); if (await l.count() && await l.isVisible().catch(() => false)) await l.fill(v).catch(() => {});
      }
      const z = page.locator('select[name="zone"]').last(); if (await z.count()) await z.selectOption({ label: billing.state }).catch(() => {});
    }
    await page.locator('iframe[name^="card-fields-number"]').first().scrollIntoViewIfNeeded().catch(() => {});
    const ready = await this.shot("ready-for-human-payment");
    const end = Date.now() + timeoutMin * 60_000;
    while (Date.now() < end) {
      if (/thank[_-]?you|\/orders\//.test(page.url())) break;
      await sleep(3000);
    }
    const t = await page.evaluate(() => document.body.innerText).catch(() => "");
    const paid = /thank you/i.test(t);
    return { paid, order: (t.match(/(Order|Confirmation)\s*#?\s*([A-Z0-9-]{4,})/i) || [])[2] || null, url: page.url(),
      screenshot: await this.shot(paid ? "confirmation" : "human-payment-timeout"), ready_screenshot: ready };
  }

  async close() { await this.ctx?.close().catch(() => {}); }
}
