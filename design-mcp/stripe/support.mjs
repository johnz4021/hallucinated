// Support's order tools (Stripe, current mode via stripeClient; live on serve with STRIPE_LIVE_OK=1):
//   order_lookup   (allow) the SENDER's own orders and pre-orders, found by the email of the message being answered
//   order_status   (allow) one order (cs_ / pi_ / pre-order session) - only if it belongs to that sender
//   refund_request (ASK, NEVER_AUTO) refunds a paid order after John approves the call in Naïve; idempotent; ledger refunds.json
// Privacy: the email always comes from the AgentMail message (never from the email body), so a customer can only see their
// own orders. Output is a whitelist: items, sizes, qty, amounts, dates, status, receipt link. Never card details, addresses,
// other customers or Stripe customer ids.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readJson, writeJson, txt, err } from "../lib/state.mjs";
import { stripeClient, fetchOrders } from "./tools.mjs";
import { listPreorders } from "./preorders.mjs";
import { agentMail, INBOX, flagJohn } from "../agentmail/tools.mjs";

const lc = (s) => String(s || "").trim().toLowerCase();
export const senderOf = (from) => lc((String(from || "").match(/<([^>]+)>/) || [, String(from || "")])[1]);

// Pure: where an order is in our pipeline, from the ledgers (sales-batches.json, stripe-batched.json, order-events.jsonl,
// courier-requests.json) -> { status, detail }
export function pipelineStatus({ paid, batched_into, preorder, charged, refunded }, led) {
  if (refunded) return { status: "refunded", detail: `refunded $${refunded.toFixed(2)}` };
  if (preorder && !charged) return { status: "pre-order saved", detail: "card saved; charged when the product launches" };
  if (!paid) return { status: "not paid", detail: null };
  if (!batched_into) return { status: "paid", detail: "paid; waiting for the next daily print order" };
  const b = (led.batches || []).find((x) => x.batch_ref === batched_into);
  const order = Object.values(led.stripeBatched || {}).find((x) => x.batch_ref === batched_into && x.customania_order)?.customania_order || b?.customania_order || null;
  const ready = order && (led.events || []).some((e) => e.kind === "ready_for_pickup" && String(e.order_number) === String(order));
  const courier = order ? led.courier?.[order] : null;
  if (courier?.picked_up_at) return { status: "picked up", detail: "picked up from the printer" };
  if (ready) return { status: "ready for pickup", detail: courier ? "ready at the printer; a courier is being arranged" : "ready at the printer" };
  return { status: "in production", detail: order ? "sent to our printer (Customania)" : "batched into a print order" };
}
export const loadLedgers = (rootDir) => ({
  batches: readJson(path.join(rootDir, "sales-batches.json"), { batches: [] }).batches,
  stripeBatched: readJson(path.join(rootDir, "stripe-batched.json"), {}),
  events: (() => { try { return fs.readFileSync(path.join(rootDir, "order-events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } })(),
  courier: readJson(path.join(rootDir, "courier-requests.json"), {}),
  refunds: readJson(path.join(rootDir, "refunds.json"), {}),
});

// Pure: rows (fetchOrders) + pre-orders -> this email's orders, whitelisted
export function ordersFor(email, rows, preorders, led) {
  const e = lc(email), out = [];
  const bySession = {};
  for (const r of rows.filter((x) => lc(x.email) === e)) (bySession[r.stripe_session_id] ||= []).push(r);
  for (const [id, rs] of Object.entries(bySession)) {
    const r0 = rs[0], ref = id;
    const refunded = led.refunds?.[id]?.amount_usd || null;
    out.push({ order_ref: ref, kind: r0.source === "preorder" ? "pre-order (charged)" : "order", created: r0.paid_at,
      items: rs.map((r) => ({ item: r.description || r.slug || [r.garment, r.color].filter(Boolean).join(" ") || "item", size: r.size_raw || r.size, qty: r.quantity, amount_usd: r.line_usd })),
      total: r0.amount_total, fulfilment: r0.fulfilment || null, shipping_usd: r0.shipping_usd ?? null,
      ...pipelineStatus({ paid: true, batched_into: r0.batched_into, refunded }, led) });
  }
  for (const p of preorders.filter((x) => lc(x.email) === e && !x.cancelled)) {
    const charged = p.items.some((i) => i.charged);
    if (charged) continue;   // a charged pre-order shows up above as an order (source preorder)
    out.push({ order_ref: p.preorder_session, kind: "pre-order", created: p.created_at,
      items: p.items.map((i) => ({ item: i.product, size: i.size, qty: i.qty, amount_usd: i.unit_amount != null ? (i.unit_amount * i.qty) / 100 : null })),
      total: p.preorder_total_cents != null ? `${(p.preorder_total_cents / 100).toFixed(2)} USD` : null, fulfilment: p.fulfilment || null, shipping_usd: p.shipping_usd ?? null,
      ...pipelineStatus({ preorder: true, charged: false }, led) });
  }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

async function receiptUrl(sc, ref) {
  try {
    if (/^pi_/.test(ref)) return (await sc.call("GET", `/payment_intents/${ref}?expand[]=latest_charge`)).latest_charge?.receipt_url || null;
    if (/^cs_/.test(ref)) {
      const s = await sc.call("GET", `/checkout/sessions/${ref}?expand[]=payment_intent.latest_charge&expand[]=invoice`);
      return s.invoice?.hosted_invoice_url || s.payment_intent?.latest_charge?.receipt_url || null;
    }
  } catch {}
  return null;
}

export function registerSupportTools(server, ctx, { am = agentMail(ctx.rootDir), sc: scIn = null } = {}) {
  const need = () => { const sc = scIn || stripeClient(ctx.rootDir); if (sc.error) throw new Error(sc.error); return sc; };
  const box = encodeURIComponent(INBOX);
  async function sender(message_id) {
    if (!am) throw new Error("AGENTMAIL_API_KEY is not set");
    const m = await am("GET", `/inboxes/${box}/messages/${encodeURIComponent(message_id)}`);
    const s = senderOf(m.from);
    if (!s || s === lc(INBOX)) throw new Error("that message isn't from a customer");
    return s;
  }
  async function ordersOf(email, sc) {
    const [rows, pre] = await Promise.all([fetchOrders(sc, ctx.rootDir, { drop: "all", unbatchedOnly: false }), listPreorders(sc, {})]);
    return ordersFor(email, rows, pre, loadLedgers(ctx.rootDir));
  }

  server.registerTool("order_lookup", {
    title: "Look up the customer's orders (Stripe)",
    description: "For a customer email you're answering: their orders and pre-orders, found by the SENDER's email address of that message (never an address from the email body). Returns items, sizes, quantities, amounts, dates, fulfilment (ship / pickup), shipping, where each order is (paid / pre-order saved / in production / ready for pickup / picked up / refunded) and a receipt link. Read-only. State only what it shows.",
    inputSchema: { message_id: z.string().describe("the message you're answering (inbox_read)") },
  }, async ({ message_id }) => {
    try {
      const sc = need(), email = await sender(message_id);
      const orders = await ordersOf(email, sc);
      for (const o of orders.slice(0, 5)) o.receipt_url = await receiptUrl(sc, o.order_ref);
      ctx.log?.(`[order_lookup] ${sc.mode}: ${orders.length} order(s) for the sender of ${String(message_id).slice(0, 24)}`);
      return txt({ mode: sc.mode, count: orders.length, orders, ...(orders.length ? {} : { note: "no orders under the address this email came from; ask which email they ordered with (they must write from it), never look up another address" }) });
    } catch (e) { return err("order_lookup failed: " + e.message); }
  });

  server.registerTool("order_status", {
    title: "One order's status (Stripe)",
    description: "The status of one order (its order_ref: cs_..., pi_... or a pre-order session) for the customer you're answering. Refused if that order doesn't belong to the sender of message_id.",
    inputSchema: { order_ref: z.string().regex(/^(cs|pi)_[A-Za-z0-9_]+$/), message_id: z.string() },
  }, async ({ order_ref, message_id }) => {
    try {
      const sc = need(), email = await sender(message_id);
      const o = (await ordersOf(email, sc)).find((x) => x.order_ref === order_ref);
      if (!o) return err("refused: no order with that reference under the address this email came from");
      o.receipt_url = await receiptUrl(sc, order_ref);
      return txt({ mode: sc.mode, order: o });
    } catch (e) { return err("order_status failed: " + e.message); }
  });

  server.registerTool("refund_request", {
    title: "Refund a paid order (John approves every call)",
    description: "Refunds a PAID order (cs_ checkout session or pi_ charged pre-order) in full or in part, after John approves this call in Naïve Studio (it always waits for him). Idempotent: the same order and amount never refunds twice. An uncharged pre-order isn't a refund: use preorder_cancel. After it succeeds, email the customer a short confirmation with inbox_reply.",
    inputSchema: { order_ref: z.string().regex(/^(cs|pi)_[A-Za-z0-9_]+$/), reason: z.string().min(5).max(300), amount_usd: z.number().positive().max(1000).optional().describe("omit for a full refund"),
      message_id: z.string().optional().describe("the customer's email this is about") },
  }, async ({ order_ref, reason, amount_usd, message_id }) => {
    try {
      const sc = need();
      const file = path.join(ctx.rootDir, "refunds.json"), led = readJson(file, {});
      let pi = order_ref;
      if (/^cs_/.test(order_ref)) {
        const s = await sc.call("GET", `/checkout/sessions/${order_ref}`);
        if (s.mode === "setup") return err("refused: that's an uncharged pre-order (nothing was paid); use preorder_cancel");
        if (s.payment_status !== "paid" || !s.payment_intent) return err("refused: that order isn't paid");
        pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent.id;
      }
      const p = await sc.call("GET", `/payment_intents/${pi}?expand[]=latest_charge`);
      const paid = (p.amount_received || 0), already = p.latest_charge?.amount_refunded || 0;
      const cents = amount_usd != null ? Math.round(amount_usd * 100) : paid - already;
      if (!(cents > 0)) return err(`refused: nothing left to refund on ${order_ref} (already refunded $${(already / 100).toFixed(2)})`);
      if (cents > paid - already) return err(`refused: at most $${((paid - already) / 100).toFixed(2)} is refundable on ${order_ref}`);
      const r = await sc.call("POST", "/refunds", { payment_intent: pi, amount: String(cents), reason: "requested_by_customer", metadata: { order_ref, support_reason: reason.slice(0, 300) } },
        { idempotencyKey: `refund-${pi}-${cents}` });
      led[order_ref] = { order_ref, payment_intent: pi, refund_id: r.id, status: r.status, amount_usd: cents / 100, reason, message_id: message_id || null, at: new Date().toISOString(), mode: sc.mode };
      writeJson(file, led);
      const batched = p.metadata?.batched_into || null;
      ctx.log?.(`[refund_request] ${sc.mode} ${order_ref}: refunded $${(cents / 100).toFixed(2)} (${r.status})`);
      if (batched) flagJohn(ctx, { reason: "refund", from_agent: "support (refund_request)", ref: order_ref, summary: `Refunded $${(cents / 100).toFixed(2)} on an order that was already batched into a print order (${batched}).` });
      return txt({ refunded: true, order_ref, amount_usd: cents / 100, status: r.status, ...(batched ? { note: "this order was already sent to the printer; John was told" } : {}), next: "inbox_reply with a short confirmation (5-10 business days to show on their card)" });
    } catch (e) { return err("refund_request failed: " + e.message); }
  });
}
