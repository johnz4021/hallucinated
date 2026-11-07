// Pre-orders: the card is saved at checkout (Checkout mode "setup", metadata kind "preorder" + preorder_items
// [{price_id, qty}]) and charged at launch. Shape per the lead's note; adjust PREORDER_* below when storefront/CONTENT.md lands.
//   preorders_list            read-only: open pre-orders (customer, items, saved card yes/no, charged yes/no; never card details)
//   charge_preorders          "ask" (John approves in Studio; never auto-confirmed): one off-session PaymentIntent per pre-order
//                             for one product, idempotent, capped by max_total_usd; failures get a Stripe-hosted invoice link + flag_john
//   charge_preorders_status   poll a running charge job
//   preorder_cancel           Support: detach the saved card, mark cancelled (no money moves); refused once anything was charged
//   preorder_send_payment_link Support: emails a failed charge's hosted invoice link to that pre-order's own email, once
// State: on the SetupIntent's metadata (preorder_status, c_<product> = pi_… | inv_… | failed), mirrored in <root>/preorders-ledger.json.
// Charged pre-orders become rows in stripe_orders (source "preorder") via the PaymentIntents' metadata, so the normal
// sales batch (sales_batch_start -> Customania -> handoff -> stripe_mark_batched) prints only what was actually paid.
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { readJson, writeJson, txt, err } from "../lib/state.mjs";
import { stripeClient } from "./tools.mjs";
import { flagJohn, agentMail, INBOX } from "../agentmail/tools.mjs";

const PREORDER_KIND = "preorder";
const mdKey = (productId) => `c_${productId}`.slice(0, 40);   // Stripe metadata keys: max 40 chars
const priceCache = new Map();
const jobs = new Map();

async function price(sc, id) {
  if (!priceCache.has(id)) priceCache.set(id, await sc.call("GET", `/prices/${encodeURIComponent(id)}?expand[]=product`));
  return priceCache.get(id);
}

// Pure-ish: one pre-order from a setup-mode Checkout Session (setup_intent expanded) + resolved prices.
export function preorderFromSession(s, prices) {
  let items = [];
  try { items = JSON.parse(s.metadata?.preorder_items || "[]"); } catch {}
  const si = s.setup_intent && typeof s.setup_intent === "object" ? s.setup_intent : null;
  const md = si?.metadata || {};
  return {
    preorder_session: s.id, created_at: new Date((s.created || 0) * 1000).toISOString(),
    customer: typeof s.customer === "string" ? s.customer : s.customer?.id || null,
    email: s.customer_details?.email || s.customer_email || null, name: s.customer_details?.name || null,
    has_payment_method: !!(si?.payment_method && si.status === "succeeded"),
    cancelled: md.preorder_status === "cancelled",
    setup_intent: si?.id || null,
    items: items.map((it) => {
      const p = prices[it.price_id] || {}, pm = p.metadata || {}, prod = typeof p.product === "object" ? p.product : {};
      const charge = md[mdKey(prod.id || "")] || null;
      return { price_id: it.price_id, qty: Number(it.qty || it.quantity || 1), product_id: prod.id || null, product: prod.name || null,
        design_id: pm.design_id || prod.metadata?.design_id || null, garment: pm.garment || prod.metadata?.garment || null, color: pm.color || prod.metadata?.color || null,
        size: pm.size || null, drop: pm.drop || prod.metadata?.drop || null, unit_amount: p.unit_amount ?? null, currency: p.currency || null,
        charged: !!charge && /^pi_/.test(charge), charge_ref: charge };
    }),
  };
}

export async function listPreorders(sc, { includeCancelled = false } = {}) {
  const sessions = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ status: "complete", limit: "100" });
    q.append("expand[]", "data.setup_intent");
    if (after) q.set("starting_after", after);
    const r = await sc.call("GET", `/checkout/sessions?${q}`);
    sessions.push(...r.data.filter((s) => s.mode === "setup" && s.metadata?.kind === PREORDER_KIND));
    if (!r.has_more || !r.data.length) break;
    after = r.data.at(-1).id;
  }
  const ids = [...new Set(sessions.flatMap((s) => { try { return JSON.parse(s.metadata.preorder_items || "[]").map((i) => i.price_id); } catch { return []; } }))];
  const prices = {};
  for (const id of ids) prices[id] = await price(sc, id).catch(() => null);
  return sessions.map((s) => preorderFromSession(s, prices)).filter((p) => includeCancelled || !p.cancelled);
}

async function setSiMeta(sc, siId, metadata) { if (siId) await sc.call("POST", `/setup_intents/${siId}`, { metadata }); }

// One charge per (pre-order, product). Returns a result row; never throws for a card problem.
export async function chargeOne(sc, ctx, p, productId, { kind = "preorder_charge" } = {}) {   // kind is overridden only by preorders_test.mjs
  const items = p.items.filter((i) => i.product_id === productId);
  const amount = items.reduce((n, i) => n + (i.unit_amount || 0) * i.qty, 0);
  const currency = items[0]?.currency || "usd";
  const base = { preorder_session: p.preorder_session, email: p.email, name: p.name, amount_usd: amount / 100 };
  const ledFile = path.join(ctx.rootDir, "preorders-ledger.json"), led = readJson(ledFile, {}), lk = `${p.preorder_session}:${productId}`;
  if (led[lk]) return { ...base, ok: led[lk].state === "charged", skipped: `already ${led[lk].state}` };
  const si = (await sc.call("GET", `/setup_intents/${p.setup_intent}`)).payment_method;
  const compact = JSON.stringify(items.map((i) => ({ p: i.price_id, q: i.qty, s: i.size, d: i.design_id, g: i.garment, c: i.color }))).slice(0, 500);
  const md = { kind, preorder_session: p.preorder_session, product_id: productId, items: compact, drop: items[0]?.drop || "",
    email: String(p.email || "").slice(0, 200), name: String(p.name || "").slice(0, 200) };
  try {
    const pi = await sc.call("POST", "/payment_intents", { amount, currency, customer: p.customer, payment_method: si, off_session: "true", confirm: "true",
      description: `Pre-order: ${items[0]?.product || productId}`, receipt_email: p.email || undefined, metadata: md },
      { idempotencyKey: `preorder-${p.preorder_session}-${productId}` });
    if (pi.status !== "succeeded") throw Object.assign(new Error(`payment ${pi.status}`), { code: pi.status === "requires_action" ? "authentication_required" : pi.status, payment_intent: pi });
    await setSiMeta(sc, p.setup_intent, { [mdKey(productId)]: pi.id });
    led[lk] = { state: "charged", payment_intent: pi.id, amount_usd: amount / 100, at: new Date().toISOString() }; writeJson(ledFile, led);
    return { ...base, ok: true, payment_intent: pi.id };
  } catch (e) {
    if (e.status && e.status >= 500) throw e;
    const dangling = e.payment_intent?.id;   // a PaymentIntent left in requires_action / requires_payment_method: cancel it, the invoice replaces it
    if (dangling) await sc.call("POST", `/payment_intents/${dangling}/cancel`, {}).catch(() => {});
    // Card needs the customer (3DS) or was declined: no retry loop. A Stripe-hosted invoice they can pay themselves.
    let invoice = null;
    try {
      const inv = await sc.call("POST", "/invoices", { customer: p.customer, collection_method: "send_invoice", days_until_due: "3", auto_advance: "false",
        description: `Your Hallucinated pre-order is launching. The saved card didn't go through; pay here to keep your order.`,
        metadata: { kind: "preorder_fallback", preorder_session: p.preorder_session, product_id: productId } }, { idempotencyKey: `preorder-inv-${p.preorder_session}-${productId}` });
      for (const [n, i] of items.entries()) await sc.call("POST", "/invoiceitems", { customer: p.customer, invoice: inv.id, amount: String((i.unit_amount || 0) * i.qty), currency,
        description: `${i.product || productId}${i.size ? " (" + i.size + ")" : ""} x${i.qty}`, metadata: { preorder_session: p.preorder_session } }, { idempotencyKey: `preorder-ii-${p.preorder_session}-${productId}-${n}` });
      const fin = await sc.call("POST", `/invoices/${inv.id}/finalize`, {});
      invoice = { id: fin.id, url: fin.hosted_invoice_url };
    } catch (ie) { invoice = { error: ie.message }; }
    const code = e.code || e.decline_code || "failed";
    await setSiMeta(sc, p.setup_intent, { [mdKey(productId)]: invoice?.id || `failed:${code}`.slice(0, 40) }).catch(() => {});
    led[lk] = { state: "needs_customer_action", code, decline_code: e.decline_code || null, invoice_id: invoice?.id || null, invoice_url: invoice?.url || null, email: p.email, at: new Date().toISOString() };
    writeJson(ledFile, led);
    return { ...base, ok: false, code, decline_code: e.decline_code || null, invoice_url: invoice?.url || null, invoice_error: invoice?.error || null };
  }
}

export function registerPreorderTools(server, ctx) {
  const sc = stripeClient(ctx.rootDir);
  const need = () => { if (sc.error) throw new Error(sc.error); return sc; };

  server.registerTool("preorders_list", {
    title: "Open pre-orders (Stripe, read-only)",
    description: "Lists pre-orders (card saved at checkout, charged at launch): customer, email, name, items (product, size, qty, price), whether a saved payment method is on file (yes/no) and whether each item was charged. Never shows card details. Filter by design_id or product_id; email to find one customer's pre-order.",
    inputSchema: { design_id: z.string().optional(), product_id: z.string().optional(), email: z.string().optional(), include_cancelled: z.boolean().optional() },
  }, async ({ design_id, product_id, email, include_cancelled }) => {
    try {
      let ps = await listPreorders(need(), { includeCancelled: !!include_cancelled });
      if (design_id || product_id) ps = ps.filter((p) => p.items.some((i) => (!design_id || i.design_id === design_id) && (!product_id || i.product_id === product_id)));
      if (email) ps = ps.filter((p) => String(p.email).toLowerCase() === email.toLowerCase());
      const out = ps.map(({ setup_intent, customer, ...p }) => ({ ...p, items: p.items.map(({ charge_ref, ...i }) => ({ ...i, charge_failed: !!charge_ref && !/^pi_/.test(charge_ref) })) }));
      const byProduct = {};
      for (const p of out) for (const i of p.items) if (!p.cancelled) { const b = (byProduct[i.product_id] ||= { product: i.product, open: 0, charged: 0, open_amount_usd: 0 }); if (i.charged) b.charged += i.qty; else { b.open += i.qty; b.open_amount_usd += ((i.unit_amount || 0) * i.qty) / 100; } }
      const led = readJson(path.join(ctx.rootDir, "preorders-ledger.json"), {});
      const links = Object.entries(led).filter(([k, e]) => e.state === "needs_customer_action" && e.invoice_url && !e.link_sent_at)
        .map(([k, e]) => ({ preorder_session: k.split(":")[0], product_id: k.split(":")[1], email: e.email, code: e.code }));
      return txt({ mode: sc.mode, count: out.length, by_product: byProduct, payment_links_to_send: links, preorders: out });
    } catch (e) { return err("preorders_list failed: " + e.message); }
  });

  server.registerTool("charge_preorders", {
    title: "Charge saved cards for a launched product (moves customers' money; John approves)",
    description: "At launch: charges every open, uncharged pre-order of product_id off-session on its saved card, one PaymentIntent per pre-order (idempotent: a re-run never double-charges). Refused if the total would exceed max_total_usd. Cards that need the customer (3DS) or decline get a Stripe-hosted invoice link instead (no retries), and John is flagged; Support emails those links with preorder_send_payment_link. Returns results, or a job_id to poll with charge_preorders_status if it's still running.",
    inputSchema: { product_id: z.string().startsWith("prod_"), max_total_usd: z.number().positive().max(5000) },
  }, async ({ product_id, max_total_usd }) => {
    try {
      need();
      const all = await listPreorders(sc);
      const due = all.filter((p) => !p.cancelled && p.has_payment_method && p.items.some((i) => i.product_id === product_id && !i.charge_ref));
      const noCard = all.filter((p) => !p.cancelled && !p.has_payment_method && p.items.some((i) => i.product_id === product_id && !i.charge_ref));
      const total = due.reduce((n, p) => n + p.items.filter((i) => i.product_id === product_id).reduce((m, i) => m + (i.unit_amount || 0) * i.qty, 0), 0) / 100;
      if (!due.length) return txt({ charged: 0, note: "no open, uncharged pre-orders with a saved card for this product", without_saved_card: noCard.map((p) => p.preorder_session) });
      if (total > max_total_usd + 1e-9) return err(`refused: ${due.length} pre-order(s) total $${total.toFixed(2)}, over max_total_usd $${max_total_usd}`);
      const job_id = `chg_${crypto.randomBytes(4).toString("hex")}`;
      const job = { job_id, product_id, total_usd: total, count: due.length, done: 0, results: [], state: "running", started: new Date().toISOString() };
      jobs.set(job_id, job);
      ctx.log?.(`[charge_preorders] ${job_id} ${product_id}: ${due.length} pre-order(s), $${total.toFixed(2)} (${sc.mode})`);
      job.promise = (async () => {
        for (const p of due) { job.results.push(await chargeOne(sc, ctx, p, product_id).catch((e) => ({ preorder_session: p.preorder_session, ok: false, code: "error", error: e.message }))); job.done++; }
        job.state = "done";
        const bad = job.results.filter((r) => !r.ok);
        ctx.log?.(`[charge_preorders] ${job_id} done: ${job.results.length - bad.length} charged, ${bad.length} need the customer`);
        if (bad.length) flagJohn(ctx, { reason: "money", from_agent: "ops (charge_preorders)", ref: job_id,
          summary: `Pre-order launch ${product_id}: ${bad.length} card(s) didn't charge (${bad.map((b) => `${b.email || b.preorder_session}: ${b.code}${b.invoice_url ? "" : " (no invoice link: " + (b.invoice_error || b.error || "?") + ")"}`).join("; ")}). Hosted invoice links were created; Support should email them (preorder_send_payment_link).` });
      })();
      await Promise.race([job.promise, new Promise((r) => setTimeout(r, 60_000))]);
      const { promise, ...view } = job;
      return txt({ ...view, mode: sc.mode, without_saved_card: noCard.map((p) => p.preorder_session), ...(job.state === "running" ? { next: "call charge_preorders_status with job_id" } : {}) });
    } catch (e) { return err("charge_preorders failed: " + e.message); }
  });

  server.registerTool("charge_preorders_status", {
    title: "Progress of a pre-order charge job",
    description: "Waits up to 60 s, then returns the job's state and per-pre-order results (charged, or needs the customer with an invoice link).",
    inputSchema: { job_id: z.string() },
  }, async ({ job_id }) => {
    const job = jobs.get(job_id);
    if (!job) return err(`no job ${job_id} in this tool server (it may have restarted; preorders_list shows what was charged)`);
    await Promise.race([job.promise, new Promise((r) => setTimeout(r, 60_000))]);
    const { promise, ...view } = job;
    return txt(view);
  });

  server.registerTool("preorder_cancel", {
    title: "Cancel a pre-order (no money moves)",
    description: "For a customer who asks to cancel their pre-order by email: removes their saved card from Stripe and marks the pre-order cancelled. requester_email must be the pre-order's email (the address the cancellation came from). Refused if anything on it was already charged: that's a refund, so flag_john. Then confirm to the customer with inbox_reply.",
    inputSchema: { preorder_session: z.string().startsWith("cs_"), requester_email: z.string(), reason: z.string().max(300).optional() },
  }, async ({ preorder_session, requester_email, reason }) => {
    try {
      const p = (await listPreorders(need(), { includeCancelled: true })).find((x) => x.preorder_session === preorder_session);
      if (!p) return err("no such pre-order");
      if (String(p.email).toLowerCase() !== String(requester_email).toLowerCase().replace(/^.*<|>.*$/g, "")) return err("refused: the request didn't come from this pre-order's email address");
      if (p.cancelled) return txt({ cancelled: true, already: true });
      if (p.items.some((i) => i.charged)) return err("refused: part of this pre-order was already charged; a cancellation now is a refund. flag_john (reason refund) and tell the customer a human will follow up.");
      const si = await sc.call("GET", `/setup_intents/${p.setup_intent}`);
      if (si.payment_method) await sc.call("POST", `/payment_methods/${si.payment_method}/detach`, {}).catch((e) => { if (!/not attached|No such/.test(e.message)) throw e; });
      await setSiMeta(sc, p.setup_intent, { preorder_status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: String(reason || "").slice(0, 200) });
      const ledFile = path.join(ctx.rootDir, "preorders-ledger.json"), led = readJson(ledFile, {});
      led[`${preorder_session}:cancel`] = { state: "cancelled", email: p.email, at: new Date().toISOString(), reason: reason || null }; writeJson(ledFile, led);
      ctx.log?.(`[preorder_cancel] ${preorder_session} (${p.email}) cancelled; saved card removed`);
      return txt({ cancelled: true, preorder_session, card_removed: !!si.payment_method });
    } catch (e) { return err("preorder_cancel failed: " + e.message); }
  });

  server.registerTool("preorder_send_payment_link", {
    title: "Email a pre-order customer their payment link",
    description: "After charge_preorders couldn't charge a saved card: emails that pre-order's customer (only their own address on file) your short note plus the Stripe-hosted invoice link, from the brand inbox. Once per pre-order and product.",
    inputSchema: { preorder_session: z.string(), product_id: z.string(), note: z.string().min(10).max(1500).describe("2-4 friendly sentences in brand voice; the link is appended automatically") },
  }, async ({ preorder_session, product_id, note }) => {
    try {
      const ledFile = path.join(ctx.rootDir, "preorders-ledger.json"), led = readJson(ledFile, {}), e = led[`${preorder_session}:${product_id}`];
      if (!e || e.state !== "needs_customer_action" || !e.invoice_url) return err("refused: no failed charge with a payment link for that pre-order and product");
      if (e.link_sent_at) return err(`refused: link already sent ${e.link_sent_at}`);
      const text = `${note}\n\nPay here (secure Stripe page): ${e.invoice_url}\n\n- Hallucinated`;
      if (process.env.MAIL_DRY_RUN === "1") { ctx.log?.(`[preorder_send_payment_link DRY] to ${e.email}: ${JSON.stringify(text).slice(0, 200)}`); return txt({ dry_run: true, to: e.email, text }); }
      const am = agentMail(ctx.rootDir);
      if (!am) return err("AGENTMAIL_API_KEY not in .env");
      const r = await am("POST", `/inboxes/${encodeURIComponent(INBOX)}/messages/send`, { to: [e.email], subject: "Your Hallucinated pre-order: one more step", text });
      e.link_sent_at = new Date().toISOString(); e.link_message_id = r.message_id; writeJson(ledFile, led);
      ctx.log?.(`[preorder_send_payment_link] ${preorder_session} -> ${e.email}`);
      return txt({ sent: true, to: e.email });
    } catch (e) { return err("preorder_send_payment_link failed: " + e.message); }
  });
}
