// Store -> Ops: read paid Stripe Checkout Sessions for a drop, and mark them once they're in a Customania order.
// Plain fetch to Stripe's REST API with STRIPE_SECRET_KEY from .env (never logged). Test keys only unless STRIPE_LIVE_OK=1.
//   stripe_orders        paid + complete sessions for metadata.drop, with batched_into (so a re-run never orders a sale twice)
//   sales_batch_start    locks a set of unbatched sessions into one batch (one Customania order); refuses while another is open
//   stripe_mark_batched  writes batched_into on each sale's PaymentIntent (or the session if it has none) and closes the batch
//   sales_batch_abort    releases the lock when the order didn't get paid
// Local mirrors (repo root, git-ignored): stripe-batched.json, sales-batches.json.
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { envKey, readJson, writeJson, txt, err } from "../lib/state.mjs";
import { orderSessionsInfo } from "../customania/tools.mjs";
import { MAKEABLE } from "../agents/config.mjs";
import { flagJohn } from "../agentmail/tools.mjs";

const API = "https://api.stripe.com/v1";
const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
const STALE_MS = 6 * 3600_000;
export const normSize = (s) => { const u = String(s || "").trim().toUpperCase().replace(/^XXL$/, "2XL").replace(/^XXXL$/, "3XL"); return SIZES.includes(u) ? u : null; };

export function stripeKeyCheck(key) {
  if (!key) return { ok: false, why: "STRIPE_SECRET_KEY is not in .env" };
  const test = /^(sk|rk)_test_/.test(key), live = /^(sk|rk)_live_/.test(key);
  if (test) return { ok: true, mode: "test" };
  if (live && process.env.STRIPE_LIVE_OK === "1") return { ok: true, mode: "live" };
  return { ok: false, why: live ? "refused: STRIPE_SECRET_KEY is a live key and STRIPE_LIVE_OK=1 is not set" : "STRIPE_SECRET_KEY doesn't look like a Stripe secret/restricted key" };
}

const form = (obj, pre = "") => Object.entries(obj).flatMap(([k, v]) => {
  const key = pre ? `${pre}[${k}]` : k;
  return v && typeof v === "object" ? form(v, key).split("&").filter(Boolean) : [`${encodeURIComponent(key)}=${encodeURIComponent(v ?? "")}`];
}).join("&");

export function stripeClient(rootDir) {
  const key = envKey(rootDir, "STRIPE_SECRET_KEY");
  const chk = stripeKeyCheck(key);
  if (!chk.ok) return { error: chk.why };
  const call = async (method, p, body, { idempotencyKey } = {}) => {
    const r = await fetch(API + p, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: body ? form(body) : undefined, signal: AbortSignal.timeout(25_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`Stripe ${method} ${p.split("?")[0]} ${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`);
      Object.assign(e, { status: r.status, code: j.error?.code, decline_code: j.error?.decline_code, type: j.error?.type, payment_intent: j.error?.payment_intent });
      throw e;
    }
    return j;
  };
  return { call, mode: chk.mode };
}

// Pure: Checkout Sessions (+ their line items, price.product expanded) -> one row per line item.
// Two shapes: legacy (one line item, size in session.metadata; the single-product store) and cart (each line item's
// price.metadata {design_id, garment, color, size, drop}). Unit-checked in stripe/stripe_test.mjs.
const normGarment = (g) => (g == null || g === "" ? null : /\b(tee|t-?shirt)\b/i.test(String(g)) ? "tee" : String(g).trim().toLowerCase());
const normColor = (c) => (c == null || c === "" ? null : String(c).trim().toLowerCase());
export const groupKey = (r) => `${r.design_id}|${r.garment}|${r.color}`;
export const makeable = (r, list = MAKEABLE) => list.find((m) => m.design_id === r.design_id && m.garment === r.garment && m.color === r.color) || null;

export function parseOrders(sessions, lineItems, { drop = "drop-1", unbatchedOnly = true, ledger = {} } = {}) {
  const rows = [];
  for (const s of sessions) {
    if (s.status !== "complete" || s.payment_status !== "paid") continue;   // async methods (bank, Klarna) can be complete but unpaid
    const pi = s.payment_intent && typeof s.payment_intent === "object" ? s.payment_intent : null;
    if (s.mode === "setup") continue;   // a pre-order's saved card is not a sale until charge_preorders charges it
    const batched = pi?.metadata?.batched_into || s.metadata?.batched_into || ledger[s.id]?.batch_ref || null;
    if (unbatchedOnly && batched) continue;
    const items = lineItems[s.id]?.length ? lineItems[s.id] : [{ quantity: 1 }];
    const base = { stripe_session_id: s.id, source: s.source || "checkout", email: s.customer_details?.email || s.customer_email || null, name: s.customer_details?.name || null,
      paid_at: new Date((s.created || 0) * 1000).toISOString(),
      amount_total: s.amount_total != null ? (s.amount_total / 100).toFixed(2) + " " + String(s.currency || "").toUpperCase() : null, batched_into: batched };
    items.forEach((li, i) => {
      const pm = li.price?.metadata || {}, prod = li.price?.product && typeof li.price.product === "object" ? li.price.product.metadata || {} : {};
      const legacy = !pm.size && !prod.size;   // size on the session = the single-product store (drop-1 tee)
      const row = {
        ...base, line: i, shape: legacy ? "legacy" : "cart",
        design_id: pm.design_id || prod.design_id || s.metadata?.design_id || null,
        garment: normGarment(pm.garment || prod.garment || (legacy ? "tee" : null)),     // the legacy store sold only the black tee
        color: normColor(pm.color || prod.color || (legacy ? "black" : null)),
        size: normSize(pm.size || prod.size || (legacy ? s.metadata?.size : null)),
        size_raw: pm.size || prod.size || (legacy ? s.metadata?.size : null) || null,
        quantity: li.quantity || 0,
        drop: pm.drop || prod.drop || s.metadata?.drop || null,
        description: li.description || null,
      };
      if (drop && drop !== "all" && row.drop !== drop) return;
      rows.push(row);
    });
  }
  return rows.sort((a, b) => a.paid_at.localeCompare(b.paid_at) || a.line - b.line);
}

export function sumSizes(rows) {
  const out = {};
  for (const r of rows) if (r.size) out[r.size] = (out[r.size] || 0) + r.quantity;
  return Object.fromEntries(SIZES.filter((s) => out[s]).map((s) => [s, out[s]]));
}

// Pure: rows -> what Ops may batch. A sale (session) is batchable only if every line of it is a makeable product with a
// valid size and all its lines fall in the same makeable group; anything else goes to John, never a guess.
export function planBatches(rows, list = MAKEABLE) {
  const bySession = {};
  for (const r of rows) (bySession[r.stripe_session_id] ||= []).push(r);
  const groups = {}, needsJohn = [];
  for (const [sid, rs] of Object.entries(bySession)) {
    const why = rs.map((r) => !makeable(r, list) ? `line ${r.line}: ${r.garment || "?"} / ${r.color || "?"} / design ${r.design_id || "?"} is not something Customania makes for us`
      : !r.size ? `line ${r.line}: no valid size (${r.size_raw ?? "missing"})` : !(r.quantity > 0) ? `line ${r.line}: quantity ${r.quantity}` : null).filter(Boolean);
    const keys = [...new Set(rs.map(groupKey))];
    if (!why.length && keys.length > 1) why.push(`mixes ${keys.length} different products in one sale`);
    if (why.length) { needsJohn.push({ stripe_session_id: sid, email: rs[0].email, name: rs[0].name, lines: rs.map(({ line, design_id, garment, color, size_raw, quantity }) => ({ line, design_id, garment, color, size: size_raw, quantity })), reasons: why }); continue; }
    const g = (groups[keys[0]] ||= { key: keys[0], design_id: rs[0].design_id, garment: rs[0].garment, color: rs[0].color, session_ids: [], rows: [] });
    g.session_ids.push(sid); g.rows.push(...rs);
  }
  const out = Object.values(groups).map((g) => {
    const spec = makeable(g, list);
    return { key: g.key, design_id: g.design_id, garment: g.garment, color: g.color, session_ids: g.session_ids, sizes: sumSizes(g.rows),
      quantity: g.rows.reduce((n, r) => n + r.quantity, 0), oldest_paid_at: g.rows[0]?.paid_at || null, print_spec: { design_id: spec.design_id, front: spec.front, back: spec.back } };
  });
  return { groups: out, needs_john: needsJohn };
}

const liCache = new Map();
export async function fetchOrders(sc, rootDir, { since, drop = "drop-1", unbatchedOnly = true } = {}) {
  const sessions = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ status: "complete", limit: "100" });
    q.append("expand[]", "data.payment_intent");
    if (since) q.set("created[gte]", String(Math.floor(new Date(since).getTime() / 1000)));
    if (after) q.set("starting_after", after);
    const r = await sc.call("GET", `/checkout/sessions?${q}`);
    sessions.push(...r.data);
    if (!r.has_more || !r.data.length) break;
    after = r.data.at(-1).id;
  }
  const paid = sessions.filter((s) => s.status === "complete" && s.payment_status === "paid");
  const lineItems = {};
  for (let i = 0; i < paid.length; i += 6) {
    await Promise.all(paid.slice(i, i + 6).map(async (s) => {
      if (!liCache.has(s.id)) {
        const q = new URLSearchParams({ limit: "100" }); q.append("expand[]", "data.price.product");
        liCache.set(s.id, (await sc.call("GET", `/checkout/sessions/${s.id}/line_items?${q}`)).data);
      }
      lineItems[s.id] = liCache.get(s.id);
    }));
  }
  // Charged pre-orders (stripe/preorders.mjs) are PaymentIntents, not Checkout Sessions: fold them in as sales (source "preorder").
  const pq = new URLSearchParams({ query: "metadata['kind']:'preorder_charge' AND status:'succeeded'", limit: "100" });
  const pis = (await sc.call("GET", `/payment_intents/search?${pq}`).catch(() => ({ data: [] }))).data || [];
  for (const pi of pis) {
    if (since && pi.created < Math.floor(new Date(since).getTime() / 1000)) continue;
    let items = []; try { items = JSON.parse(pi.metadata.items || "[]"); } catch {}
    sessions.push({ id: pi.id, source: "preorder", status: "complete", payment_status: "paid", created: pi.created, amount_total: pi.amount, currency: pi.currency,
      metadata: { drop: pi.metadata.drop || null, batched_into: pi.metadata.batched_into || undefined, preorder_session: pi.metadata.preorder_session },
      customer_details: { email: pi.metadata.email || pi.receipt_email || null, name: pi.metadata.name || null }, payment_intent: null });
    lineItems[pi.id] = items.map((i) => ({ quantity: i.q, price: { metadata: { design_id: i.d, garment: i.g, color: i.c, size: i.s, drop: pi.metadata.drop } } }));
  }
  const ledger = readJson(path.join(rootDir, "stripe-batched.json"), {});
  return parseOrders(sessions, lineItems, { drop, unbatchedOnly, ledger });
}

export function openBatch(rootDir) {
  const b = (readJson(path.join(rootDir, "sales-batches.json"), { batches: [] }).batches || []).filter((x) => x.state === "open").at(-1);
  if (!b) return null;
  const pending = orderSessionsInfo().handoff_pending > 0;
  return { ...b, stale: !pending && Date.now() - new Date(b.started_at).getTime() > STALE_MS };
}

// Sales Ops can't batch are flagged to John once per sale (ledger stripe-flagged.json), from code, not by the agent.
function flagUnmakeable(rootDir, log, needsJohn) {
  if (!needsJohn.length) return;
  const f = path.join(rootDir, "stripe-flagged.json"), led = readJson(f, {});
  const fresh = needsJohn.filter((n) => !led[n.stripe_session_id]);
  if (!fresh.length) return;
  flagJohn({ rootDir, log }, { reason: "money", from_agent: "ops (stripe_orders)", ref: fresh.map((n) => n.stripe_session_id).join(", "),
    summary: `Paid store sale(s) Ops can't send to Customania (not in our makeable list, or a bad size): ${fresh.map((n) => `${n.stripe_session_id} (${n.email || "?"}): ${n.reasons.join("; ")}`).join(" | ")}. They are left unbatched; decide how to fulfil or refund them.` });
  for (const n of fresh) led[n.stripe_session_id] = { at: new Date().toISOString(), reasons: n.reasons };
  writeJson(f, led);
}

export async function salesStatus(sc, rootDir, { since, drop = "drop-1", minQty = Number(process.env.SALES_MIN_QTY || 3), maxWaitH = Number(process.env.SALES_MAX_WAIT_H || 24), log, flag = true } = {}) {
  const orders = await fetchOrders(sc, rootDir, { since, drop, unbatchedOnly: true });
  const plan = planBatches(orders);
  if (flag) flagUnmakeable(rootDir, log, plan.needs_john);
  const g = plan.groups[0] || null;   // one makeable product today; more groups = more Customania orders, one per run
  const qty = g?.quantity || 0;
  const ob = openBatch(rootDir), cs = orderSessionsInfo();
  const oldestH = g?.oldest_paid_at ? (Date.now() - new Date(g.oldest_paid_at).getTime()) / 3600_000 : 0;
  let ready = true, reason = `${qty} ${g?.garment || "item"}(s) paid and unbatched for ${g?.key}`;
  if (!qty) { ready = false; reason = plan.needs_john.length ? "nothing batchable; the other sales were flagged to John" : "no unbatched paid orders"; }
  else if (ob && !ob.stale) { ready = false; reason = `batch ${ob.batch_ref} is still open (started ${ob.started_at})`; }
  else if (cs.handoff_pending) { ready = false; reason = "a Customania payment handoff is still waiting for John"; }
  else if (cs.open) { ready = false; reason = "a Customania order session is open in the tool server"; }
  else if (qty < minQty && oldestH < maxWaitH) { ready = false; reason = `only ${qty} shirt(s); waiting for ${minQty} (Customania front+back: 1 shirt $94, 2-3 shirts $141 total, then $47 each) or until the oldest order is ${maxWaitH} h old (now ${oldestH.toFixed(1)} h)`; }
  return { mode: sc.mode, drop, orders, batchable: g, other_batchable_groups: plan.groups.slice(1), needs_john: plan.needs_john,
    unbatched_quantity: qty, sizes_total: g?.sizes || {}, session_ids: g?.session_ids || [],
    open_batch: ob, customania: cs, min_qty: minQty, ready_to_batch: ready, reason, print_spec: g?.print_spec || null };
}

export async function markBatched(sc, rootDir, { session_ids, batch_ref, customania_order }) {
  const ledgerFile = path.join(rootDir, "stripe-batched.json");
  const ledger = readJson(ledgerFile, {});
  const out = [];
  for (const id of session_ids) {
    if (/^pi_/.test(id)) {   // a charged pre-order: the marker goes on its PaymentIntent
      const pi = await sc.call("GET", `/payment_intents/${id}`);
      if (pi.metadata?.batched_into && pi.metadata.batched_into !== batch_ref) { out.push({ id, skipped: `already batched into ${pi.metadata.batched_into}` }); continue; }
      await sc.call("POST", `/payment_intents/${id}`, { metadata: { batched_into: batch_ref, ...(customania_order ? { customania_order } : {}) } });
      ledger[id] = { batch_ref, customania_order: customania_order || null, at: new Date().toISOString(), on: id };
      out.push({ id, marked: true, on: id });
      continue;
    }
    const s = await sc.call("GET", `/checkout/sessions/${id}?expand[]=payment_intent`);
    const pi = s.payment_intent && typeof s.payment_intent === "object" ? s.payment_intent : null;
    const prev = pi?.metadata?.batched_into || s.metadata?.batched_into;
    if (prev && prev !== batch_ref) { out.push({ id, skipped: `already batched into ${prev}` }); continue; }
    const md = { metadata: { batched_into: batch_ref, ...(customania_order ? { customania_order } : {}) } };
    if (pi) await sc.call("POST", `/payment_intents/${pi.id}`, md);
    else await sc.call("POST", `/checkout/sessions/${id}`, md);
    ledger[id] = { batch_ref, customania_order: customania_order || null, at: new Date().toISOString(), on: pi ? pi.id : id };
    out.push({ id, marked: true, on: pi ? pi.id : id });
  }
  writeJson(ledgerFile, ledger);
  const bf = path.join(rootDir, "sales-batches.json"), all = readJson(bf, { batches: [] });
  const b = all.batches.find((x) => x.batch_ref === batch_ref);
  if (b) Object.assign(b, { state: "done", customania_order: customania_order || null, closed_at: new Date().toISOString() });
  writeJson(bf, all);
  return out;
}

export function registerStripeTools(server, ctx) {
  const sc = stripeClient(ctx.rootDir);
  if (sc.error) { ctx.log?.(`stripe tools: ${sc.error} (tools answer with this error)`); }
  const need = () => { if (sc.error) throw new Error(sc.error); return sc; };
  const DROP = z.string().optional().describe('metadata.drop to filter on; default "all" (every paid sale; anything Customania cannot make goes to needs_john)');

  server.registerTool("stripe_orders", {
    title: "Paid store orders (Stripe)",
    description: "Paid (status complete AND payment_status paid) Stripe Checkout Sessions for a drop, one row per line item: {stripe_session_id, design_id, garment, color, size, quantity, email, name, paid_at, amount_total, batched_into}. Also: batchable = the unbatched sales Customania can make (session_ids, size totals, print spec), needs_john = sales it can't (code already flagged them to John; never guess at those), whether a batch or payment handoff is open, and ready_to_batch with the reason. Read-only.",
    inputSchema: { since: z.string().optional().describe("ISO date; only sessions created after it"), unbatched_only: z.boolean().optional(), drop: DROP },
  }, async ({ since, unbatched_only = true, drop = "all" }) => {
    try {
      const st = await salesStatus(need(), ctx.rootDir, { since, drop, log: ctx.log });
      if (!unbatched_only) st.all_orders = await fetchOrders(sc, ctx.rootDir, { since, drop, unbatchedOnly: false });
      ctx.log?.(`[stripe_orders] ${st.mode} ${drop}: ${st.orders.length} unbatched line(s); batchable ${st.unbatched_quantity} ${JSON.stringify(st.sizes_total)}; needs John ${st.needs_john.length}; ready=${st.ready_to_batch}`);
      return txt(st);
    } catch (e) { return err("stripe_orders failed: " + e.message); }
  });

  server.registerTool("sales_batch_start", {
    title: "Lock paid orders into one Customania batch",
    description: "Before building a Customania order for store sales: pass the stripe_session_ids you are about to order. Checks each is paid and unbatched, refuses while another batch is open or a payment handoff is waiting, and returns batch_ref, the size totals to order and the print spec. Use the returned sizes exactly.",
    inputSchema: { session_ids: z.array(z.string()).min(1), drop: DROP },
  }, async ({ session_ids, drop = "all" }) => {
    try {
      const ob = openBatch(ctx.rootDir);
      if (ob && !ob.stale) return err(`refused: batch ${ob.batch_ref} is still open; finish it (stripe_mark_batched) or abort it (sales_batch_abort)`);
      if (orderSessionsInfo().handoff_pending) return err("refused: a Customania payment handoff is still waiting for John");
      const rowsAll = await fetchOrders(need(), ctx.rootDir, { drop, unbatchedOnly: true });
      const plan = planBatches(rowsAll);
      const g = plan.groups.find((x) => session_ids.every((id) => x.session_ids.includes(id)));
      if (!g) {
        const bad = session_ids.filter((id) => !plan.groups.some((x) => x.session_ids.includes(id)));
        const why = bad.map((id) => plan.needs_john.find((n) => n.stripe_session_id === id)?.reasons.join("; ") || "not paid, already batched, or not this drop");
        return err(`refused: ${bad.length ? bad.map((id, i) => `${id}: ${why[i]}`).join(" | ") : "these sales are different products; batch one product at a time"}`);
      }
      const rowsIn = rowsAll.filter((r) => session_ids.includes(r.stripe_session_id));
      const sizes = sumSizes(rowsIn);
      const batch_ref = `batch-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${crypto.randomBytes(2).toString("hex")}`;
      const bf = path.join(ctx.rootDir, "sales-batches.json"), all = readJson(bf, { batches: [] });
      if (ob?.stale) { const s = all.batches.find((x) => x.batch_ref === ob.batch_ref); if (s) Object.assign(s, { state: "aborted", reason: "stale (superseded)", closed_at: new Date().toISOString() }); }
      all.batches.push({ batch_ref, drop, product: g.key, session_ids, sizes, state: "open", started_at: new Date().toISOString() });
      writeJson(bf, all);
      ctx.log?.(`[sales_batch_start] ${batch_ref} ${JSON.stringify(sizes)} from ${session_ids.length} sale(s)`);
      return txt({ batch_ref, sizes, quantity: Object.values(sizes).reduce((a, b) => a + b, 0), session_ids, product: { design_id: g.design_id, garment: g.garment, color: g.color }, print_spec: g.print_spec });
    } catch (e) { return err("sales_batch_start failed: " + e.message); }
  });

  server.registerTool("stripe_mark_batched", {
    title: "Mark store orders as ordered from the printer",
    description: "After the Customania order for a batch is PAID: writes batched_into = batch_ref (and the Customania order number) on each sale in Stripe, so no re-run orders them again, and closes the batch.",
    inputSchema: { session_ids: z.array(z.string()).min(1), batch_ref: z.string(), customania_order: z.string().optional() },
  }, async (a) => {
    try { const r = await markBatched(need(), ctx.rootDir, a); ctx.log?.(`[stripe_mark_batched] ${a.batch_ref} ${a.customania_order || ""}: ${JSON.stringify(r)}`); return txt({ batch_ref: a.batch_ref, results: r }); }
    catch (e) { return err("stripe_mark_batched failed: " + e.message); }
  });

  server.registerTool("sales_batch_abort", {
    title: "Release a batch that didn't get ordered",
    description: "If the Customania order for a batch was not paid (timed out, cart mismatch, error), call this so the sales go back to unbatched and the next run can retry.",
    inputSchema: { batch_ref: z.string(), reason: z.string().max(500) },
  }, async ({ batch_ref, reason }) => {
    const bf = path.join(ctx.rootDir, "sales-batches.json"), all = readJson(bf, { batches: [] });
    const b = all.batches.find((x) => x.batch_ref === batch_ref && x.state === "open");
    if (!b) return err(`no open batch ${batch_ref}`);
    Object.assign(b, { state: "aborted", reason, closed_at: new Date().toISOString() });
    writeJson(bf, all);
    ctx.log?.(`[sales_batch_abort] ${batch_ref}: ${reason}`);
    return txt({ aborted: batch_ref });
  });
}
