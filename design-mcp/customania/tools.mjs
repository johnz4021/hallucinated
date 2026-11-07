import { execFile } from "node:child_process";
// Customania order tools for the MCP server. One live Chrome session per order, kept in this process.
// The agent passes numbers and ids; card numbers never pass through the agent (customania_pay reveals
// the Naïve card server-side and types it straight into Shopify's card fields).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createClient } from "@usenaive-sdk/vetta";
import { CustomaniaSession } from "./customania.mjs";

const sessions = new Map();
const txt = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 2) }] });
const err = (m) => ({ isError: true, content: [{ type: "text", text: m }] });
// screenshots are served from /runs so the dashboard (and you) can open them
const pub = (ctx, f) => (f && typeof f === "string" ? `${ctx.baseUrl}/runs/${path.relative(ctx.runsDir, f).split(path.sep).join("/")}` : f);
const pubAll = (ctx, o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "string" && v.startsWith(ctx.runsDir) ? pub(ctx, v) : v)));

// A design id from generate_design, a /files URL, or a path inside the design or refs folder.
function resolveDesign(ctx, ref) {
  const id = (String(ref).match(/([0-9a-f]{12})(\.png)?$/) || [])[1];
  const cands = [id && path.join(ctx.outDir, `${id}.png`), path.join(ctx.mcpDir, "refs", path.basename(String(ref))), String(ref)];
  return cands.find((c) => c && fs.existsSync(c) && (c.startsWith(ctx.outDir) || c.startsWith(path.join(ctx.mcpDir, "refs"))));
}

export function registerCustomaniaTools(server, ctx) {
  const get = (id) => { const s = sessions.get(id); if (!s) throw new Error(`no open order session ${id}; call customania_start`); return s; };

  server.registerTool("customania_start", {
    title: "Open a Customania order",
    description: "Opens a fresh Customania Design Lab session for a black Men's Premium Tee (empties the cart first). Returns an order_session id used by every other customania_* tool. One session = one order. base_size must be a size this order includes (the editor always keeps at least 1 of it).",
    inputSchema: { base_size: z.enum(["S", "M", "L", "XL", "2XL", "3XL"]).describe("any size that is in this order, e.g. the first one") },
  }, async ({ base_size }) => {
    try {
      const s = new CustomaniaSession({ root: ctx.rootDir, outDir: ctx.runsDir, log: ctx.log });
      const r = await s.start({ baseSize: base_size });
      sessions.set(s.id, s);
      return txt(pubAll(ctx, { order_session: s.id, ...r }));
    } catch (e) { return err("start failed: " + e.message); }
  });

  server.registerTool("customania_upload", {
    title: "Upload a design to one side of the shirt",
    description: "Uploads a print file onto the front or back. `design` is a generate_design id (or its print_file_url). Returns the editor's measured size in inches and where it landed.",
    inputSchema: {
      order_session: z.string(),
      side: z.enum(["front", "back"]),
      design: z.string().describe("generate_design id or print_file_url; 'logo.png' for the official wordmark"),
    },
  }, async ({ order_session, side, design }) => {
    try {
      const file = resolveDesign(ctx, design);
      if (!file) return err(`design not found: ${design}`);
      return txt(pubAll(ctx, await get(order_session).upload(side, file)));
    } catch (e) { return err("upload failed: " + e.message); }
  });

  server.registerTool("customania_place", {
    title: "Set print size and position in inches",
    description: "Resizes the design on a side to width_in (aspect kept), centers it horizontally, and puts its top top_in below the top of the print area. Returns the measured result (width, top offset, center offset in inches, the editor's own readout) and within_tolerance. If not within tolerance, adjust and call again. Brand spec: front wordmark ~10 in wide, 1.5 in down; back graphic 11-12 in wide, 1 in down.",
    inputSchema: {
      order_session: z.string(),
      side: z.enum(["front", "back"]),
      width_in: z.number().min(1).max(15),
      top_in: z.number().min(0).max(20).optional(),
      center: z.boolean().optional(),
    },
  }, async ({ order_session, side, width_in, top_in = 1, center = true }) => {
    try {
      const s = get(order_session);
      const r = await s.place(side, { width_in, top_in, center });
      return txt(pubAll(ctx, { side, target: r.target, measured: r.after && { width_in: r.after.width_in, height_in: r.after.height_in, top_in: r.after.top_from_area_in, center_offset_in: r.after.center_offset_in, editor_readout: r.after.readout }, within_tolerance: r.within_tolerance, screenshot: r.screenshot, error: r.error }));
    } catch (e) { return err("place failed: " + e.message); }
  });

  server.registerTool("customania_checkout", {
    title: "Add to cart and go to checkout (stops before payment)",
    description: "Sets quantities per size (black shirts), confirms the originality disclaimer, adds to cart, opens Shopify checkout with local pickup, fills the contact email and name, and STOPS before payment. Returns cart lines, subtotal and total with tax.",
    inputSchema: {
      order_session: z.string(),
      sizes: z.record(z.string(), z.number().int().min(0)).describe('e.g. {"S":2,"M":3,"L":3,"XL":2}'),
      email: z.string().describe("Order contact email (confirmation goes here)"),
      first_name: z.string(),
      last_name: z.string(),
    },
  }, async ({ order_session, sizes, email, first_name, last_name }) => {
    try {
      const s = get(order_session);
      const cart = await s.toCart(sizes);
      // The printer works from the design's size breakdown, so it must equal the order exactly.
      const NAMES = { S: "Small", M: "Medium", L: "Large", XL: "XLarge", "2XL": "2XLarge", "3XL": "3XLarge" };
      const want = Object.fromEntries(Object.entries(sizes).filter(([, q]) => q > 0).map(([k, q]) => [`${NAMES[k] || k} / ${s.color}`, q]));
      const props = Object.fromEntries(cart.cart.lines.flatMap((l) => Object.entries(l.design || {})).filter(([k]) => / \/ /.test(k)).map(([k, q]) => [k, Number(q)]));
      const mismatch = [...new Set([...Object.keys(want), ...Object.keys(props)])].filter((k) => (want[k] || 0) !== (props[k] || 0));
      if (mismatch.length) {
        s.cartOk = false;
        await s.page.evaluate(() => fetch("/cart/clear", { method: "POST" })).catch(() => {});
        return err(`cart does not match the order (wanted ${JSON.stringify(want)}, cart has ${JSON.stringify(props)}); cart cleared, start a new order session`);
      }
      s.cartOk = true;
      const co = await s.checkout({ email, first: first_name, last: last_name });
      s.lastTotal = co.summary?.money?.find((m) => m.label === "Total")?.amount;
      return txt(pubAll(ctx, { cart_matches_order: true, cart: cart.cart, editor_total: cart.editor_total, checkout: co.summary, total: s.lastTotal, screenshots: [...cart.screenshots, co.screenshot] }));
    } catch (e) { return err("checkout failed: " + e.message); }
  });

  server.registerTool("customania_pay", {
    title: "Pay for the order with a Naïve prepaid card",
    description: "Pays the open checkout with the Hallucinated identity's Naïve prepaid card. The card is revealed server-side and typed into Shopify's secure card fields; its numbers are never returned. With confirm=false it fills the card and stops (dry run). With confirm=true it clicks Pay and returns the order confirmation. The card's load must cover the checkout total.",
    inputSchema: {
      order_session: z.string(),
      card_id: z.string().describe("vcd_… id of a Naïve prepaid card on the Hallucinated identity"),
      confirm: z.boolean().describe("true = actually pay; false = fill and stop"),
    },
  }, async ({ order_session, card_id, confirm }) => {
    try {
      const s = get(order_session);
      const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: ctx.vettaKey });
      const card = await v.identities.cards.get(ctx.identityId, card_id);
      const left = (card.load_micro_usd - card.spent_micro_usd) / 1e6;
      if (!s.cartOk) return err("no verified cart for this order session; run customania_checkout first");
      if (card.status !== "active") return err(`card ${card_id} is ${card.status}, not active${card.failure_reason ? " (" + card.failure_reason + ")" : ""}. A card must be active (funded) before paying.`);
      if (confirm && s.lastTotal && left + 0.001 < parseFloat(String(s.lastTotal).replace(/,/g, ""))) return err(`card has $${left.toFixed(2)} left but the total is $${s.lastTotal}; not paying`);
      const creds = await v.identities.cards.revealCredentials(ctx.identityId, card_id);
      const r = await s.payWithCard({ number: creds.number, expiry: creds.expiry || "", cvv: creds.cvv },
        { name: ctx.cardName || [ctx.billing?.first, ctx.billing?.last].filter(Boolean).join(" ") || "Hallucinated Ops", billing: ctx.billing, pay: confirm });
      // card issuer notes (e.g. which billing ZIP to use) are passed through; the numbers never are
      const notes = creds.instructions && !/\d{12,}/.test(creds.instructions.replace(/\s/g, "")) ? creds.instructions : null;
      return txt(pubAll(ctx, { card: { id: card.id, last4: card.last4, brand: card.brand, balance: left, issuer_notes: notes }, ...r }));
    } catch (e) { return err("pay failed: " + e.message); }
  });

  server.registerTool("issue_card", {
    title: "Issue a Naïve prepaid card",
    description: "Buys a Naïve prepaid card on the Hallucinated identity, loaded with amount_usd (max $150), and waits until it is active. Spends company credit, so a human approves each call. Returns the card id (vcd_…), status, last4 and, if it failed, the exact reason. Use the card id with customania_pay.",
    inputSchema: {
      label: z.string().describe('e.g. "drop1 order 1"'),
      amount_usd: z.number().min(1).max(150).describe("load; round the checkout total UP to the next whole dollar"),
    },
  }, async ({ label, amount_usd }) => {
    try {
      const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: ctx.vettaKey });
      const load = Math.ceil(amount_usd) * 1_000_000;
      const q = await v.identities.cards.quote(ctx.identityId, { load_micro_usd: load }).catch((e) => ({ error: e.message }));
      ctx.log?.(`[issue_card] ${label} load $${load / 1e6} quote ${q.error ? "ERR " + q.error : "$" + (q.price_micro_usd / 1e6).toFixed(2)}`);
      let card = await v.identities.cards.issue(ctx.identityId, { label, load_micro_usd: load });
      for (let i = 0; i < 30 && ["pending_payment", "issuing"].includes(card.status); i++) {
        await new Promise((r) => setTimeout(r, 3000));
        card = await v.identities.cards.get(ctx.identityId, card.id);
      }
      ctx.log?.(`[issue_card] ${card.id} ${card.status}${card.failure_reason ? " (" + card.failure_reason + ")" : ""}`);
      const out = { card_id: card.id, status: card.status, last4: card.last4, brand: card.brand, load_usd: card.load_micro_usd / 1e6,
        price_usd: q.price_micro_usd ? q.price_micro_usd / 1e6 : null, failure_reason: card.failure_reason };
      return card.status === "active" ? txt(out) : err(`card not active: ${JSON.stringify(out)}`);
    } catch (e) {
      ctx.log?.(`[issue_card] failed: ${e.status || ""} ${e.code || ""} ${e.message}`);
      return err(`card issue failed: ${e.status || ""} ${e.code || ""} ${e.message}`);
    }
  });

  // Human payment, start-then-poll: the tunnel in front of this server cuts any request after ~100 s,
  // so the handoff returns at once and the agent polls customania_payment_status (each call waits <= 60 s).
  server.registerTool("customania_handoff_payment", {
    title: "Hand the payment to a human",
    description: "Use when the agent can't pay itself. Needs a human's OK in Naïve (that approval card is the notification). Once approved, brings the verified checkout to the front of the operator's screen with contact and billing filled, pings their desktop, and returns immediately. Then call customania_payment_status until it says paid or timed_out.",
    inputSchema: { order_session: z.string(), amount_due: z.string().describe("the checkout total, e.g. \"$204.21\", so the human sees it on the approval card") },
  }, async ({ order_session, amount_due }) => {
    try {
      const s = get(order_session);
      if (!s.cartOk) return err("no verified cart for this order session; run customania_checkout first");
      if (s.payWatch) return txt({ waiting: true, note: "already handed off; poll customania_payment_status" });
      const notify = (msg) => { try { execFile("osascript", ["-e", `display notification ${JSON.stringify(msg)} with title "Hallucinated Ops" sound name "Glass"`]); } catch {} };
      ctx.log?.(`[${order_session}] >>> HUMAN PAYMENT NEEDED (${amount_due}): enter a card in the Customania checkout window and press Pay <<<`);
      notify(`Pay ${amount_due} in the Customania checkout window (front of your screen)`);
      const timeoutMin = Number(process.env.HANDOFF_TIMEOUT_MIN || 15);
      const reminder = setInterval(() => notify(`Still waiting for payment (${amount_due})`), 3 * 60_000);
      s.payResult = null;
      s.payWatch = s.waitForHumanPayment({ billing: ctx.billing, timeoutMin })
        .then((r) => { s.payResult = { ...r, timeout_min: timeoutMin }; notify(r.paid ? `Paid. Order ${r.order || ""} recorded.` : "Payment window timed out; nothing was paid."); ctx.log?.(`[${order_session}] human payment: ${r.paid ? "PAID " + (r.order || "") : "timed out"}`); return s.payResult; })
        .catch((e) => (s.payResult = { paid: false, error: e.message }))
        .finally(() => clearInterval(reminder));
      return txt({ waiting: true, amount_due, timeout_min: timeoutMin, next: "call customania_payment_status with this order_session until state is paid or timed_out" });
    } catch (e) { return err("handoff failed: " + e.message); }
  });

  server.registerTool("customania_payment_status", {
    title: "Check whether the human has paid",
    description: "After customania_handoff_payment: waits up to 60 s, then returns state waiting | paid | timed_out (with the order number when paid). Call it again while waiting.",
    inputSchema: { order_session: z.string() },
  }, async ({ order_session }) => {
    const s = get(order_session);
    if (!s.payWatch) return err("no payment handoff for this order session; call customania_handoff_payment first");
    await Promise.race([s.payWatch, new Promise((r) => setTimeout(r, 60_000))]);
    const r = s.payResult;
    if (!r) return txt({ state: "waiting" });
    return txt(pubAll(ctx, { state: r.paid ? "paid" : (r.error ? "error" : "timed_out"), ...r }));
  });

  server.registerTool("customania_close", {
    title: "Close an order session",
    description: "Closes the Chrome window for an order session.",
    inputSchema: { order_session: z.string() },
  }, async ({ order_session }) => {
    const s = sessions.get(order_session);
    if (s) { await s.close(); sessions.delete(order_session); }
    return txt({ closed: !!s });
  });
}
