// Mission-control publisher: builds hq.json (what the agents did and decided, where the founder stepped in) and PUTs it
// to the store, which serves it publicly at $STORE/api/hq for the /hq page.
//   node agents/hq_publish.mjs --once   build + upload
//   node agents/hq_publish.mjs --dry    build, write <root>/hq.json, upload nothing (not even rejected-design art)
// serve.mjs calls publishHq() every 60 s. Sources: repo-root ledgers, the archive's drop #1 run, Naïve sessions + events
// of every hallucinated-* agent since Sat 13:00 PT (cached in hq-cache.json, so a run only fetches new events), the live
// Stripe catalog and paid orders (read-only, counts and amounts only), and the store's Blob design dossiers.
// Privacy is enforced here: every string goes through scrub(), and the serialized document is asserted against the
// store's PII rules before anything is uploaded (refuses on @, cus_, pm_, the founder's name, street addresses, emails, phones).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
import { envKey, readJson, writeJson, readJsonl } from "../lib/state.mjs";
import { ptDay } from "../designs/ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..");
const STORE = "https://hallucinated-store.vercel.app";
const X_URL = (id) => `https://x.com/hallucinateddpt/status/${id}`;
const CUTOFF = "2026-11-07T21:00:00.000Z";   // Sat 13:00 PT
const MAX_BYTES = 4_000_000;

// ---- drop #1 seed (ran from the archive folder's launchers, before the cutoff) ----------------------------------------
const DROP1 = {
  design_id: "bc1dbe9d9aae", slug: "git-reset-hard-tee", title: "git reset --hard",
  sessions: { product: "ses_h2jy2sam2jcmmcmt12zqd9zx7g", ceo: "ses_b4rztbp3drbhszjs3ednfwp784", ops: "ses_s1e299kvr9f6z3gm2aq6fzezdx" },
  pickup_session: "ses_nqstpryh5mpnsjb9ts3r3xxf35",
  order_ref: "CF5A93CRK", amount_usd: 204.22, sizes: { S: 1, M: 1, L: 1, XL: 1 }, paid_at: "2026-11-07T20:55:41.000Z",
  archive_run: "2026-11-07T20-50-19_humanpay",
};
const SEED_IDS = [...Object.values(DROP1.sessions), DROP1.pickup_session];
const SEED_ROLE = Object.fromEntries(Object.entries(DROP1.sessions).map(([r, id]) => [id, r]));

const ROLE = { product: "product", ceo: "ceo", ops: "ops", growth: "growth", support: "support", creative: "growth", reviewer: "growth" };
const ASK = new Set(["customania_handoff_payment", "courier_book", "charge_preorders", "x_ads_activate", "issue_card", "refund_request"]);
// tools whose outputs we keep in the cache (things that changed something outside, plus what explains them)
const KEEP = new Set(["generate_design", "propose_design", "ceo_decide", "x_post", "x_reply", "customania_checkout", "customania_handoff_payment",
  "customania_payment_status", "courier_quote", "courier_status", "courier_book", "inbox_reply", "sales_batch_start", "sales_batch_abort",
  "set_plan", "ops_courier_request", "charge_preorders", "ad_submit", "x_browser_reply", "ad_image_generate", "ad_video_compose", "ad_review_status",
  "order_lookup", "order_status", "refund_request"]);   // support: only counts/amounts/status are read from these outputs, never emails
// args kept per tool (whitelist: checkout args carry the founder's name and the inbox address, so only sizes survive)
const ARGS = { flag_john: ["reason"], refund_request: ["amount_usd"], generate_design: ["text", "placement"], propose_design: ["design_id", "title", "slug"], ceo_decide: ["proposal_id", "decision", "reason"],
  customania_checkout: ["sizes"], customania_handoff_payment: ["amount_due"], courier_book: ["order_number", "max_price_usd", "pickup_time"],
  courier_quote: ["order_number", "pickup_time"], ad_video_start: ["model"], ad_submit: ["review_id", "kind"], ad_review: ["kind"], x_browser_reply: ["target_url"], generate_image: ["model"], sales_batch_abort: ["reason"], ops_courier_request: ["order_number"] };

// ---- privacy ------------------------------------------------------------------------------------------------------
const URL_RE = /https?:\/\/[^\s"'<>\]]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const ADDR_RE = /\b\d+\s+\w+\s+(?:St|Ave|Blvd|Rd|Street|Avenue)\b\.?/gi;
const ADDR_WIDE_RE = /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,3}\s+(?:St|Ave|Blvd|Rd|Street|Avenue|Way|Dr|Drive|Ln|Lane|Ct|Pl)\b\.?/gi;
const PLACES = [
  [/Customania[^.;\n]{0,90}?(?:20th\s+Ave|Stonestown[^)]*\)?)(?:,\s*San Francisco)?(?:,\s*CA)?(?:\s*\d{5})?(?:\s*\(Stonestown Galleria\))?/gi, "Customania (SF)"],
  [/Y\s*Combinator[^.;\n]{0,60}?20th\s+St(?:,\s*San Francisco)?(?:,\s*CA)?(?:\s*\d{5})?/gi, "YC"],
  [/\bY Combinator\b/g, "YC"], [/\bStonestown Galleria\b/gi, "SF"], [/\bthe YC office\b/gi, "YC"],
];
function scrubPlain(s) {
  for (const [re, label] of PLACES) s = s.replace(re, label);
  return s
    .replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]")
    .replace(ADDR_WIDE_RE, "[address]").replace(ADDR_RE, "[address]").replace(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, "")
    .replace(/John\s+Zhang/gi, "the founder").replace(/\bJohn['’]s\s+(?:own\s+)?i?phone\b/gi, "the founder's phone").replace(/Johns\s?iphone/gi, "the founder's phone")
    .replace(/\bJohn['’]s\b/g, "the founder's").replace(/\bJOHN\b|\bJohn\b/g, "the founder").replace(/\S*zhang\S*/gi, "the founder")
    .replace(/@hallucinateddpt\b/gi, "hallucinateddpt").replace(/@(\w{1,30})/g, "$1").replace(/@/g, " at ")
    .replace(/\b(?:cus|pm|pi|seti|ch|cs_test|cs_live|cs)_[A-Za-z0-9_]+/g, "[ref]").replace(/cus_/gi, "cus-").replace(/pm_/gi, "pm-");
}
function scrubUrl(u) {
  if (EMAIL_RE.test(u) || /cus_|pm_|zhang|trycloudflare|localhost/i.test(u)) { EMAIL_RE.lastIndex = 0; return "[link]"; }
  EMAIL_RE.lastIndex = 0;
  return u.replace(/@/g, "%40");
}
export function scrubText(s) {
  s = String(s);
  let out = "", last = 0;
  for (const m of s.matchAll(URL_RE)) { out += scrubPlain(s.slice(last, m.index)); out += scrubUrl(m[0]); last = m.index + m[0].length; }
  return (out + scrubPlain(s.slice(last))).replace(/[ \t]{2,}/g, " ").trim();
}
// the final pass: every string in the document (keys are ours and fixed)
export function scrub(o) {
  if (typeof o === "string") return scrubText(o);
  if (Array.isArray(o)) return o.map(scrub);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, scrub(v)]));
  return o;
}
// mirrors the store's 422 rules, plus emails / phones / the founder's first name
const BANNED = [["@", /@/], ["cus_", /cus_/], ["pm_", /pm_/], ["founder surname", /zhang/i], ["founder name", /\bJohn\b/],
  ["street address", /\d+\s+\w+\s+(St|Ave|Blvd|Rd|Street|Avenue)\b/i], ["email", /[A-Za-z0-9._%+-]+(@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/], ["phone", /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/]];
export function assertClean(json) {
  const hits = BANNED.filter(([, re]) => re.test(json)).map(([n]) => n);
  if (hits.length) throw new Error(`refusing to upload: output still contains ${hits.join(", ")}`);
}

// ---- helpers -------------------------------------------------------------------------------------------------------
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const plain = (s) => String(s ?? "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\*\*|__|`|^#+\s*/gm, "").replace(/\s+/g, " ").trim();
const parseJ = (s) => { try { return JSON.parse(s); } catch { return null; } };
const money = (s) => { const m = String(s ?? "").match(/\$\s?(\d+(?:\.\d{1,2})?)/) || String(s ?? "").match(/^(\d+(?:\.\d{1,2})?)$/); return m ? Number(m[1]) : null; };
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "OS"];
const sizesStr = (sz) => Object.entries(sz || {}).sort(([a], [b]) => (SIZE_ORDER.indexOf(a) + 99) % 99 - (SIZE_ORDER.indexOf(b) + 99) % 99).filter(([, n]) => n > 0).map(([k, n]) => (n > 1 ? `${k}x${n}` : k)).join("/");
const withTimeout = (p, ms, what) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out`)), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }
const stripPrefix = (n) => String(n || "").replace(/^hallucinated\./, "");

function storeCall(secret) {
  return async (method, p, { json, body, type } = {}) => {
    const r = await fetch(STORE + p, { method, headers: { Authorization: `Bearer ${secret}`, ...(json ? { "Content-Type": "application/json" } : type ? { "Content-Type": type } : {}) },
      body: json ? JSON.stringify(json) : body, signal: AbortSignal.timeout(30_000) });
    const t = await r.text(); const j = parseJ(t) || { raw: t.slice(0, 200) };
    if (!r.ok) throw new Error(`store ${method} ${p.split("?")[0]} ${r.status}: ${clip(j.error || j.raw || "", 160)}`);
    return j;
  };
}
function stripeCall(key) {
  return async (p) => {
    const r = await fetch("https://api.stripe.com/v1" + p, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Stripe GET ${p.split("?")[0]} ${r.status}`);
    return j;
  };
}

// ---- Naïve sessions + events (cached) ------------------------------------------------------------------------------
export function compact(e) {
  const d = e.data || {}, at = e.created_at;
  if (e.type === "tool.started" || e.type === "tool.confirm") {
    const n = stripPrefix(d.name), keep = ARGS[n] || [], a = {};
    for (const k of keep) if (d.args?.[k] !== undefined) a[k] = d.args[k];
    if (n === "set_plan" && Array.isArray(d.args?.themes)) a.themes_n = d.args.themes.length;
    return { t: e.type === "tool.started" ? "ts" : "cf", seq: e.seq, at, n, id: d.tool_call_id, a };
  }
  if (e.type === "tool.completed") { const n = stripPrefix(d.name); return { t: "tc", seq: e.seq, at, n, id: d.tool_call_id, err: !!d.is_error, o: KEEP.has(n) ? String(d.output ?? "").slice(0, 3000) : d.is_error ? String(d.output ?? "").slice(0, 200) : "" }; }
  if (e.type === "message.completed" && d.role === "assistant") return { t: "m", seq: e.seq, at, c: String(d.content ?? "").slice(0, 4000) };
  if (e.type === "session.idle") return { t: "idle", seq: e.seq, at, r: d.stop_reason || null };
  return null;
}

const is429 = (e) => e?.status === 429 || /429|at capacity|rate limit/i.test(String(e?.message || ""));
// Gentle on Naïve (it returns 429 "at capacity" under load): agents + deployments cached 5 min, ONE sessions.list per
// push (more pages only on a cold cache or a burst of new sessions), events only for sessions whose last_seq moved
// (running ones first, at most 12 a push). Any 429 keeps the last known state.
async function syncSessions(v, cache, { budgetMs = 15_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const left = () => Math.max(1000, Math.min(10_000, deadline - Date.now()));
  const late = () => Date.now() > deadline;
  const meta = cache.meta ||= { at: 0, agents: [], deployments: [] };
  if (Date.now() - (meta.at || 0) > 5 * 60_000 || !meta.agents.length || meta.agents.some((a) => !("model" in a))) {
    try {
      const [ag, dep] = await Promise.all([withTimeout(v.agents.list({ limit: 100 }), left(), "agents.list"), withTimeout(v.deployments.list({ limit: 100 }), left(), "deployments.list")]);
      meta.agents = (ag.data || []).filter((a) => /^hallucinated-/.test(a.name)).map((a) => ({ id: a.id, name: a.name, model: a.model || null }));
      meta.deployments = (dep.data || []).filter((d) => meta.agents.some((a) => a.id === d.agent_id))
        .map((d) => ({ id: d.id, agent_id: d.agent_id, cron: d.cron, timezone: d.timezone, enabled: !!d.enabled, schedule_status: d.schedule_status, next_run_at: d.next_run_at }));
      meta.at = Date.now();
    } catch (e) { if (!meta.agents.length) throw e; }
  }
  const nameOf = Object.fromEntries(meta.agents.map((a) => [a.id, a.name]));
  const cold = !Object.keys(cache.sessions).some((id) => !SEED_IDS.includes(id));
  const listed = [];
  let after;
  for (let page = 0; page < (cold ? 15 : 5); page++) {
    if (page > 0 && late()) break;
    const r = await withTimeout(v.sessions.list({ limit: 100, ...(after ? { after } : {}) }), left(), "sessions.list");
    const data = r.data || [];
    listed.push(...data.filter((s) => s.created_at >= CUTOFF));
    // stop at the cutoff, or (warm cache) as soon as the page reaches sessions we already know
    if (!r.has_more || !r.next_cursor || data.some((s) => s.created_at < CUTOFF) || (!cold && data.some((s) => cache.sessions[s.id]))) break;
    after = r.next_cursor;
  }
  const have = new Set(listed.map((s) => s.id));
  // seeds once; cached sessions that looked active but fell off the page: re-read a few
  const stale = Object.values(cache.sessions).filter((c) => !have.has(c.id) && ["running", "queued"].includes(c.status)).slice(0, 3).map((c) => c.id);
  const extra = await Promise.all([...SEED_IDS.filter((id) => !cache.sessions[id] && !have.has(id)), ...stale].map((id) => late() ? null : withTimeout(v.sessions.get(id), left(), "sessions.get").catch(() => null)));
  const todo = [];
  for (const s of [...listed, ...extra.filter(Boolean)]) {
    const agent = nameOf[s.agent_id] || cache.sessions[s.id]?.agent || null;
    if (!SEED_ROLE[s.id] && !/^hallucinated-/.test(String(agent || ""))) continue;
    const role = SEED_ROLE[s.id] || ROLE[String(agent || "").replace(/^hallucinated-/, "")] || null;
    if (!role) continue;
    const c = cache.sessions[s.id] ||= { id: s.id, last_seq: 0, events: [] };
    Object.assign(c, { agent, role, created_at: s.created_at, started_at: s.started_at, status: s.status, stop_reason: s.stop_reason, deployment_id: s.deployment_id || null,
      spend_micro: s.consumed_micro_usd || 0, server_last_seq: s.last_seq, seen_at: new Date().toISOString() });
    if ((s.last_seq || 0) > c.last_seq) todo.push(c);
  }
  todo.sort((a, b) => (["running", "queued"].includes(b.status) - ["running", "queued"].includes(a.status)) || String(b.created_at).localeCompare(String(a.created_at)));
  let fetched = 0, limited = false;
  await pool(todo.slice(0, 12), 3, async (c) => {
    if (limited || late()) return;
    let after_seq = c.last_seq, done = false;
    try {
      for (let page = 0; page < 30; page++) {
        if (page > 0 && late()) break;
        const r = await withTimeout(v.sessions.events(c.id, { after_seq, limit: 100 }), left(), "sessions.events");
        const data = r.data || [];
        for (const e of data) { const x = compact(e); if (x) c.events.push(x); fetched++; }
        if (data.length) after_seq = Math.max(after_seq, ...data.map((e) => e.seq));
        if (!r.has_more || !data.length) { done = true; break; }
      }
    } catch (e) { if (is429(e)) limited = true; }
    c.last_seq = done ? Math.max(after_seq, c.server_last_seq || 0) : after_seq;
  });
  return { sessions: Object.values(cache.sessions), fetched, limited };
}

// ---- per-session derivation ----------------------------------------------------------------------------------------
function resultOf(c) {
  const msgs = c.events.filter((e) => e.t === "m");
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i].c.match(/RESULT:\s*(\{[\s\S]*\})/);
    if (m) { const j = parseJ(m[1]) || parseJ(m[1].slice(0, m[1].lastIndexOf("}") + 1)); return { at: msgs[i].at, json: j, raw: m[1] }; }
  }
  return null;
}
function excerptOf(c) {
  const msgs = c.events.filter((e) => e.t === "m" && e.c.trim());
  if (!msgs.length) return null;
  const pick = [...msgs].reverse().find((m) => m.c.replace(/RESULT:[\s\S]*$/, "").trim().length > 80) || msgs.at(-1);
  let t = plain(pick.c.replace(/RESULT:[\s\S]*$/, ""));
  const why = t.search(/why it (lands|works)/i);
  if (c.role === "product" && why > 0) t = t.slice(why);
  return t ? { at: pick.at, text: clip(t, 300) } : null;
}
function resultText(r, role) {
  if (!r?.json) return r ? clip(plain(r.raw), 300) : null;
  const BAD = /email|name|customer|address|phone|to$|from|session|url|card/i;
  const parts = [];
  for (const [k, val] of Object.entries(r.json)) {
    if (BAD.test(k) && k !== "order_number") continue;
    if (role === "support" && typeof val !== "number" && typeof val !== "boolean") continue;
    const s = val && typeof val === "object" ? (Object.values(val).every((x) => typeof x === "number") ? sizesStr(val) : null) : String(val);
    if (s != null && s !== "") parts.push(`${k}: ${s}`);
  }
  return parts.length ? clip(parts.join("; "), 300) : null;
}

export function deriveSession(c, dry) {
  const ev = [...c.events].sort((a, b) => a.seq - b.seq);
  // dry runs: listed in an order-runs record, or the session says so itself (fake post ids, RESULT dry:true)
  const res0 = resultOf(c)?.json;
  if (!dry && (res0?.dry === true || /^dry-/.test(String(res0?.posted || "")) || ev.some((e) => e.t === "tc" && /"id":\s*"dry-/.test(e.o)))) dry = true;
  const testOrders = !dry && ev.some((e) => e.t === "tc" && /cs_test_/.test(e.o));
  const tag = dry ? " (dry run)" : testOrders ? " (Stripe test orders)" : "";
  const items = [], human = [], facts = { designs: [], decisions: [], courier: [], paid: [], checkout: [], posts: [] };
  const started = new Map(ev.filter((e) => e.t === "ts").map((e) => [e.id, e]));
  const ok = ev.filter((e) => e.t === "tc" && !e.err && !/waiting for approval/.test(e.o)).map((e) => ({ ...e, a: started.get(e.id)?.a || {}, startedAt: started.get(e.id)?.at || e.at }));
  const add = (agent, kind, text, at, url) => items.push({ at, agent, kind, text: clip(text, 400), ...(url ? { url } : {}), session: c.id });
  // Support: what it did for one email, with tool names (no emails, names or bodies)
  let steps = [], stepsAt = null;
  const step = (txt, at) => { steps.push(txt); stepsAt ||= at; };
  const flushSteps = () => { if (steps.length) { const t = steps.join(", "); add("support", "email", t[0].toUpperCase() + t.slice(1) + tag, stepsAt); } steps = []; stepsAt = null; };
  for (const e of ok) {
    const o = parseJ(e.o) || {};
    if (c.role === "support") switch (e.n) {
      case "inbox_read": flushSteps(); step("Read a customer email (inbox_read)", e.at); continue;
      case "order_lookup": step(`looked up their order in Stripe (order_lookup${o.count != null ? `: ${o.count} found` : ""})`, e.at); continue;
      case "order_status": step(`checked the order status (order_status${o.order?.status ? `: ${o.order.status}` : ""})`, e.at); continue;
      case "preorder_cancel": step("cancelled their pre-order (preorder_cancel)", e.at); continue;
      case "refund_request": step(`refunded ${o.amount_usd != null ? `$${Number(o.amount_usd).toFixed(2)}` : "the order"} after the founder approved (refund_request)`, e.at); continue;
      case "flag_john": step(`flagged the founder (flag_john${e.a.reason ? `: ${e.a.reason}` : ""})`, e.at); continue;
      case "inbox_reply": step("replied (inbox_reply)", e.at); flushSteps(); continue;
    }
    switch (e.n) {
      case "generate_design":
        if (o.id) { facts.designs.push({ id: o.id, at: e.at, session: c.id, pass: !!o.pass });
          add(c.role, "design", `Generated design ${o.id}${o.text_seen || e.a.text ? `: "${clip(o.text_seen || e.a.text, 80)}"` : ""} (QA ${o.pass ? "pass" : "fail"})${tag}`, e.at); }
        break;
      case "propose_design": add(c.role, "proposal", `Proposed "${e.a.title || e.a.slug}" (design ${e.a.design_id}) to the CEO${tag}`, e.at); break;
      case "ceo_decide": {
        facts.decisions.push({ proposal_id: e.a.proposal_id, decision: e.a.decision, reason: e.a.reason, at: e.at, session: c.id, url: o.url || null });
        add(c.role, "decision", e.a.decision === "approve" ? `Approved a design${o.url ? " and published it to the store" : ""}: ${clip(plain(e.a.reason), 260)}${tag}` : `Rejected a design: ${clip(plain(e.a.reason), 260)}${tag}`, e.at, o.state === "published" ? o.url : null);
        break;
      }
      case "customania_checkout": {
        const total = money(o.total) ?? money(o.checkout?.money?.find?.((m) => /total/i.test(m.label))?.amount);
        facts.checkout.push({ at: e.at, total, sizes: e.a.sizes || null });
        add("ops", "order", `Placed the front + back prints and verified the Customania cart: ${sizesStr(e.a.sizes) || "?"} black tees${total ? `, $${total.toFixed(2)}` : ""}${tag}`, e.at);
        break;
      }
      case "customania_handoff_payment": add("ops", "handoff", `Handed the ${e.a.amount_due || "checkout"} payment to the founder (the agents can't pay)${tag}`, e.at); break;
      case "customania_payment_status":
        if (o.paid && o.order) { facts.paid.push({ at: e.at, order: o.order }); add("ops", "order", `Customania order ${o.order} is paid${tag}`, e.at); }
        break;
      case "courier_status": {
        const r = o.result; if (!r || o.status !== "completed") break;
        const price = money(r.price);
        const when = r.scheduled_for ? String(r.scheduled_for).replace(/\s*GMT[+-]\d+/, "") : null;
        facts.courier.push({ at: e.at, booked: !!r.booked, price, when });
        add("ops", "courier", r.booked ? `Booked an Uber Courier, Customania (SF) → YC${price ? `, $${price.toFixed(2)}` : ""}${when ? `, ${when}` : ""}${tag}`
          : `Got an Uber Courier quote, Customania (SF) → YC${price ? `: $${price.toFixed(2)}` : ""}${when ? ` for ${when}` : ""}${tag}`, e.at);
        break;
      }
      case "inbox_reply": add(c.role, "email", `Answered a customer email (inbox_reply)${tag}`, e.at); break;
      case "sales_batch_start": add("ops", "batch", `Batched paid store orders into one Customania order${tag}`, e.at); break;
      case "sales_batch_abort": add("ops", "batch", `Stopped the store-order batch${e.a.reason ? `: ${clip(plain(e.a.reason), 160)}` : ""}${tag}`, e.at); break;
      case "set_plan": add(c.role, "plan", `Set the plan for the other agents${e.a.themes_n ? ` (${e.a.themes_n} themes)` : ""}${tag}`, e.at); break;
      case "ops_courier_request": add(c.role, "handoff", `Handed a ready-for-pickup order to Ops for a courier${tag}`, e.at); break;
      case "charge_preorders": add("ops", "charge", `Charged pre-orders after the founder's OK${tag}`, e.at); break;
      case "ad_submit": add(c.role, "ad", `Submitted an ad that passed review${tag}`, e.at); break;
      case "x_post": case "x_reply": if (o.id) facts.posts.push({ id: String(o.id), role: c.role }); break;
    }
  }
  flushSteps();
  // the founder's calls on ask-tools: approved if the same tool later succeeded, declined if the session moved on without it
  const seen = new Set();
  for (const cf of ev.filter((e) => e.t === "cf" && ASK.has(e.n))) {
    const key = `${cf.n}:${JSON.stringify(cf.a)}`;
    if (seen.has(key)) continue;
    const okAfter = ok.find((x) => x.n === cf.n && x.seq > cf.seq);
    const later = ev.some((x) => x.seq > cf.seq + 3 && x.t !== "idle");
    if (!okAfter && (!later || c.stop_reason === "awaiting_approval")) continue;   // still waiting
    seen.add(key);
    const at = okAfter ? okAfter.startedAt : cf.at;
    if (cf.n === "customania_handoff_payment") {
      const amount = money(cf.a.amount_due);
      const paid = facts.paid.find((p) => p.at >= cf.at);
      human.push({ at, kind: "payment_handoff", text: okAfter ? `Founder approved the payment handoff${paid ? ` and paid Customania order ${paid.order} at checkout` : ""}${tag}` : `Founder declined the payment handoff${tag}`, ...(amount ? { amount_usd: amount } : {}) });
    } else if (cf.n === "courier_book") {
      const booked = facts.courier.find((x) => x.booked && x.at >= cf.at);
      const amount = booked?.price ?? (cf.a.max_price_usd != null ? Number(cf.a.max_price_usd) : null);
      human.push({ at, kind: "courier_approval", text: okAfter ? `Founder approved the Uber Courier booking${cf.a.order_number ? ` for ${cf.a.order_number}` : ""}${cf.a.max_price_usd ? ` (cap $${cf.a.max_price_usd})` : ""}${tag}` : `Founder declined the courier booking${tag}`, ...(amount != null ? { amount_usd: amount } : {}) });
    } else if (cf.n === "refund_request") {
      const amt = cf.a.amount_usd != null ? Number(cf.a.amount_usd) : money(parseJ(okAfter?.o)?.amount_usd);
      human.push({ at, kind: "refund_approval", text: okAfter ? `Refund approved by founder${amt != null ? ` ($${amt.toFixed(2)})` : ""}${tag}` : `Founder declined a refund${tag}` });
    } else {
      human.push({ at, kind: "approval", text: `Founder ${okAfter ? "approved" : "declined"} ${cf.n.replace(/_/g, " ")}${tag}` });
    }
  }
  for (const h of human) items.push({ at: h.at, agent: "founder", kind: h.kind, text: h.text, session: c.id });
  // reasoning (Product's rationale, the CEO's reasons) and the RESULT line
  if (["product", "ceo"].includes(c.role)) { const x = excerptOf(c); if (x) add(c.role, "reasoning", x.text + tag, x.at); }
  const r = resultOf(c);
  const rt = r && resultText(r, c.role);
  if (rt && !/reviewer$/.test(String(c.agent || ""))) add(c.role, "result", `Result: ${rt}${tag}`, r.at);
  return { items, human, facts, dry, result: r?.json || null, spend: (c.spend_micro || 0) / 1e6 };
}

// ---- v2: the live agent workspace (agents, flows, money, feed) -------------------------------------------------------
const AGENTS_V2 = [
  ["ceo", "CEO", "Sets the plan, approves designs"], ["product", "Product", "Turns trends into shirt designs"],
  ["creative", "Creative", "Makes the ads"], ["reviewer", "Reviewer", "Checks every ad before posting"],
  ["growth", "Growth", "Runs the X account"], ["ops", "Ops", "Print orders and courier pickups"], ["support", "Support", "Answers the brand inbox"],
];
const NOW_LABEL = {
  generate_design: "generating a design", trends: "researching trends", x_search: "searching X", propose_design: "proposing a design",
  ceo_decide: "deciding on a design", get_plan: "reading the plan", set_plan: "setting today's plan", store_stats: "reading the numbers",
  x_stats: "reading X stats", agents_log: "reading the agents' log", store_catalog: "reading the catalog", generate_image: "generating an image",
  ad_review: "sending an ad to review", ad_review_status: "waiting for the ad review", ad_submit: "publishing an ad", ad_video_status: "waiting for the video",
  view_image: "looking at an ad", x_post: "posting on X", x_mentions: "reading mentions", x_reply: "replying to a mention", x_post_scout: "drafting a scout reply",
  x_browser_reply: "replying on X", growth_next_pillar: "picking the next post", store_link: "getting the store link", store_new_designs: "checking new designs",
  customania_start: "opening a Customania order", customania_upload: "uploading prints to Customania", customania_place: "placing prints on the tee",
  customania_checkout: "checking out at Customania", customania_handoff_payment: "handing payment to the founder", customania_payment_status: "waiting for payment",
  courier_quote: "getting a courier quote", courier_book: "booking a courier", courier_status: "checking the courier", inbox_list: "reading the inbox",
  inbox_read: "reading an email", inbox_reply: "answering an email", stripe_orders: "reading store orders", sales_batch_start: "batching store orders",
  flag_john: "flagging the founder", charge_preorders: "charging pre-orders", order_lookup: "looking up an order", order_status: "checking an order",
  refund_request: "waiting for a refund approval", linkedin_post: "posting on LinkedIn", linkedin_images: "picking LinkedIn images", preorder_cancel: "cancelling a pre-order",
};
const nowLabel = (n, a = {}) => n === "ad_video_start" ? `generating video${a.model ? ` (${String(a.model).split("/").pop().split("-")[0]})` : ""}` : NOW_LABEL[n] || String(n || "working").replace(/^.*\./, "").replace(/_/g, " ");

function cronTimes(cron) {
  const [mi, hr, dom, mon, dow] = String(cron || "").trim().split(/\s+/);
  if (!mi || !hr) return [];
  const field = (f, max) => {
    const out = new Set();
    for (const part of f.split(",")) {
      const [range, step] = part.split("/"); const st = Number(step || 1);
      let [a, b] = range === "*" ? [0, max] : range.split("-").map(Number); if (b === undefined) b = step ? max : a;
      for (let x = a; x <= b; x += st) out.add(x);
    }
    return [...out];
  };
  const t = []; for (const h of field(hr, 23)) for (const m of field(mi, 59)) t.push(h * 60 + m);
  void dom; void mon; void dow;
  return t;
}
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
export function humanSchedule(crons) {
  const t = [...new Set(crons.flatMap(cronTimes))].sort((a, b) => a - b);
  if (!t.length) return null;
  if (t.length === 1) return `daily · ${hm(t[0])}`;
  const gaps = t.slice(1).map((x, i) => x - t[i]);
  const g = gaps[0], even = gaps.every((x) => x === g);
  const every = g < 60 ? `every ${g} min` : g === 60 ? "hourly" : `every ${+(g / 60).toFixed(1)}h`;
  if (even && t.length * g === 1440) return `${every} · all day`;
  if (!even) {
    const avg = Math.round((t.at(-1) - t[0]) / (t.length - 1));
    const lbl = avg < 60 ? `~every ${avg} min` : `~every ${+(avg / 60).toFixed(1)}h`;
    return `${lbl} · ${t.at(-1) - t[0] >= 23 * 60 ? "all day" : `${hm(t[0])}–${hm(t.at(-1))}`}`;
  }
  return `${every} · ${hm(t[0])}–${hm(t.at(-1))}`;
}

function buildV2({ rootDir, cache, sessions, derived, stripe, xl, liveProposals, d1, human, timeline }) {
  const today = ptDay(new Date());
  const isToday = (at) => !!at && ptDay(at) === today;
  const meta = cache.meta || { agents: [], deployments: [] };
  const ads = readJson(path.join(rootDir, "ads.json"), { ads: {}, reviews: {} });
  const liveAds = Object.values(ads.ads || {}).filter((a) => !a.test);
  const liveReviews = Object.values(ads.reviews || {}).filter((r) => !r.test);
  const plans = (readJson(path.join(rootDir, "plans.json"), { versions: [] }).versions || []).filter((p) => !p.test);
  const xb = readJson(path.join(rootDir, "x-browser.json"), { replies: [] });
  const posts = (xl.posts || []).filter((p) => p.kind === "post" && p.id);
  const replies = (xl.posts || []).filter((p) => (p.kind === "reply" && p.id) || (p.kind === "browser_reply" && !p.dry));
  const pub = (u) => (typeof u === "string" && /^https:\/\//.test(u) && !/trycloudflare|localhost/.test(u) ? u : null);
  const notDry = (t) => !/\((dry run|Stripe test orders)\)/.test(t.text || "");

  // things each agent shipped (outside effects), newest last
  const ship = [];
  const S = (agent, at, text, url = null, thumb = null, kind = null, status = null) => at && ship.push({ agent, at, text: clip(plain(text), 80), url: pub(url), thumb: pub(thumb), kind, status });
  for (const p of liveProposals) {
    S("product", p.proposed_at, `Proposed "${p.title}"`, p.publish?.url, p.publish?.mockup_url || cache.art[p.design_id], "design", p.state === "published" ? "live" : p.state === "rejected" ? "rejected" : "proposed");
    if (p.state === "published") S("ceo", p.publish?.published_at || p.decision?.at, `Approved and published "${p.title}"`, p.publish?.url, p.publish?.mockup_url, "verdict", "approved");
    else if (p.state === "rejected" && p.decision?.at) S("ceo", p.decision.at, `Rejected "${p.title}"`, null, cache.art[p.design_id], "verdict", "rejected");
  }
  S("product", d1.stages.designed.at, `Designed drop #1: "${d1.title}"`, d1.stages.live?.url, d1.artwork_url, "design", "shipped");
  S("ceo", d1.stages.ceo.at, "Approved drop #1 for print", d1.stages.live?.url, d1.artwork_url, "verdict", "approved");
  for (const p of plans) S("ceo", p.at, `Set the plan${p.plan?.themes?.length ? ` (${p.plan.themes.length} themes)` : ""}`, null, null, "plan", null);
  // withdrawn ads (the retired poster formats John rejected) were never shipped: no gallery, feed or flow entry, no thumb
  const withdrawn = Object.values(ads.ads || {}).filter((a) => a.state === "withdrawn");
  const withdrawnMedia = new Set(withdrawn.flatMap((a) => [a.media_url, a.poster_url]).filter(Boolean));
  const withdrawnIds = new Set(withdrawn.map((a) => a.id));
  for (const a of liveAds.filter((a) => a.state !== "withdrawn")) S("creative", a.created_at, `Made ${a.kind === "video" ? "a video" : "an image"} ad${a.format ? ` (${String(a.format).replace(/_/g, " ")})` : ""}`, a.x_url || a.posted?.url || null, a.kind === "video" ? a.poster_url : a.media_url, "ad", a.state || null);
  const adByReview = Object.fromEntries(Object.values(ads.ads || {}).filter((a) => a.review_id).map((a) => [a.review_id, a]));
  for (const r of liveReviews.filter((r) => r.done_at)) { const a = adByReview[r.review_id]; S("reviewer", r.done_at, r.pass ? "Passed an ad" : "Sent an ad back", null, a && a.state !== "withdrawn" ? (a.kind === "video" ? a.poster_url : a.media_url) : null, "verdict", r.pass ? "passed" : "rejected"); }
  for (const p of posts.filter((p) => !withdrawnIds.has(p.ad_id) && !withdrawnMedia.has(p.media))) S("growth", p.at, p.text || "Posted on X", X_URL(p.id), p.media, "post", p.pillar || null);
  for (const p of replies) S("growth", p.at, p.kind === "browser_reply" ? "Replied to a post on X" : "Replied to a mention", p.id ? X_URL(p.id) : null, null, "reply", p.kind === "browser_reply" ? "browser" : "mention");
  for (const c of sessions) {
    const d = derived[c.id];
    if (!d || d.dry || (c.events || []).some((e) => e.t === "tc" && /cs_test_/.test(e.o))) continue;
    for (const p of d.facts.paid) S("ops", p.at, `Customania print order ${p.order} placed (founder paid)`, null, null, "order", "paid");
    for (const x of d.facts.courier.filter((x) => x.booked)) S("ops", x.at, `Booked a courier pickup to YC${x.price ? ` ($${x.price.toFixed(2)})` : ""}`, null, null, "pickup", "booked");
  }
  for (const t of timeline.filter((t) => t.agent === "support" && notDry(t) && t.kind === "email")) S("support", t.at, t.text, null, null, "email", null);
  ship.sort((a, b) => a.at.localeCompare(b.at));

  // agents
  const byKey = {};
  for (const c of sessions) { const k = String(c.agent || "").replace(/^hallucinated-/, ""); (byKey[k] ||= []).push(c); }
  let anyRunning = false;
  const agents = AGENTS_V2.map(([key, name, role]) => {
    const agentIds = meta.agents.filter((a) => a.name === `hallucinated-${key}`).map((a) => a.id);
    const deps = meta.deployments.filter((d) => agentIds.includes(d.agent_id));
    const ses = (byKey[key] || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const running = ses.find((c) => ["running", "queued"].includes(c.status));
    const latest = ses[0];
    const waiting = !running && latest && /awaiting_(approval|answer|input)/.test(latest.stop_reason || "") && Date.now() - Date.parse(latest.created_at) < 6 * 3600_000;
    const status = running ? "running" : waiting ? "waiting_human" : deps.length && deps.every((d) => !d.enabled) ? "paused" : "idle";
    if (running) anyRunning = true;
    let now = null;
    const lastTool = (c) => {
      const ev = [...(c.events || [])].sort((a, b) => b.seq - a.seq);
      const done = new Set(ev.filter((e) => e.t === "tc").map((e) => e.id));
      const open = ev.find((e) => e.t === "ts" && !done.has(e.id));
      return open || ev.find((e) => e.t === "ts") || null;
    };
    if (running) { const t = lastTool(running); now = clip(t ? nowLabel(t.n, t.a) : "starting up", 60); }
    else if (waiting) { const cf = [...(latest.events || [])].filter((e) => e.t === "cf").sort((a, b) => b.seq - a.seq)[0]; now = clip(`waiting for the founder${cf ? `: ${nowLabel(cf.n, cf.a)}` : ""}`, 60); }
    const enabled = deps.filter((d) => d.enabled);
    const next = enabled.map((d) => d.next_run_at).filter(Boolean).sort()[0] || null;
    const mine = ship.filter((x) => x.agent === key);
    const last = mine.at(-1) || null;
    const prev = ses.find((c) => c !== running);
    return {
      key, name, role, status, now,
      running_since: running ? running.started_at || running.created_at : null,
      last_run_at: prev ? prev.started_at || prev.created_at : null,
      next_run_at: next,
      schedule: deps.length ? humanSchedule((enabled.length ? enabled : deps).map((d) => d.cron)) : key === "reviewer" ? "on demand (every ad)" : "on demand",
      last_shipped: last ? { at: last.at, text: last.text, url: last.url, thumb: last.thumb } : null,
      today: { runs: ses.filter((c) => isToday(c.created_at)).length, shipped: mine.filter((x) => isToday(x.at)).length },
    };
  });

  // flows
  const F = (from, to, label, ats) => { const a = ats.filter(Boolean).sort(); return { from, to, label, count_today: a.filter(isToday).length, last_at: a.at(-1) || null }; };
  const paidCustomania = []; const booked = [];
  for (const c of sessions) { const d = derived[c.id]; if (!d || d.dry) continue; if (/cs_test_/.test(JSON.stringify(c.events?.filter((e) => e.t === "tc").map((e) => e.o) || []))) continue;
    paidCustomania.push(...d.facts.paid.map((p) => p.at)); booked.push(...d.facts.courier.filter((x) => x.booked).map((x) => x.at)); }
  const flows = [
    F("product", "ceo", "proposals", liveProposals.map((p) => p.proposed_at)),
    F("ceo", "store", "published", liveProposals.filter((p) => p.state === "published").map((p) => p.publish?.published_at)),
    F("ceo", "product", "rejected", liveProposals.filter((p) => p.state === "rejected").map((p) => p.decision?.at)),
    F("creative", "reviewer", "ad reviews", liveReviews.map((r) => r.started_at)),
    F("reviewer", "growth", "ads passed", liveReviews.filter((r) => r.pass).map((r) => r.done_at)),
    F("growth", "x", "posts", posts.map((p) => p.at)),
    F("growth", "x", "replies", replies.map((p) => p.at)),
    F("store", "ops", "paid orders", (stripe.orders || []).map((o) => o.at)),
    F("ops", "customania", "print orders", paidCustomania),
    F("ops", "courier", "pickups", booked),
    F("ceo", "all", "daily plan", plans.map((p) => p.at)),
  ];

  // money
  const sum = (xs) => Math.round(xs.reduce((n, x) => n + x, 0) * 100) / 100;
  const money = {
    revenue_usd: sum((stripe.orders || []).map((o) => o.amount_usd)), orders_paid: (stripe.orders || []).length,
    preorders_count: (stripe.preorders || []).length, preorders_usd: sum((stripe.preorders || []).map((o) => o.amount_usd)),
    items_live: (stripe.products || []).length, posts_today: posts.filter((p) => isToday(p.at)).length, replies_today: replies.filter((p) => isToday(p.at)).length,
    agent_spend_today_usd: sum(sessions.filter((c) => isToday(c.created_at)).map((c) => (c.spend_micro || 0) / 1e6)),
    agent_spend_total_usd: sum(sessions.map((c) => (c.spend_micro || 0) / 1e6)),
  };

  // feed: what shipped + where the founder stepped in, short
  const feed = [...ship.map((x) => ({ at: x.at, agent: x.agent, text: x.text, ...(x.url ? { url: x.url } : {}) })),
    ...human.map((h) => ({ at: h.at, agent: "founder", text: h.text }))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30).map((f) => ({ ...f, text: clip(f.text, 90) }));
  void xb;
  return { v2: { money, agents, flows, feed }, anyRunning, ship };
}

// ---- v3: per-agent drill-down (hq-agents.json) ------------------------------------------------------------------------
// The agents doc goes to PUT /api/admin/hq?doc=agents once the store has that route; until then it is only written
// locally (<root>/hq-agents.json). The route is live on production (fe996e2).
const AGENTS_DOC_PUSH = true;
const AGENTS_DOC_MAX = 1_500_000;
// tool -> [label (<=20 chars), icon]
const TOOL_META = {
  x_search: ["X search", "search"], trends: ["Trends", "trends"], generate_design: ["Design", "design"], next_design_style: ["Design style", "design"],
  propose_design: ["Propose design", "check"], ceo_decide: ["Decide", "check"], get_plan: ["Read plan", "plan"], set_plan: ["Set plan", "plan"],
  store_stats: ["Store stats", "store"], x_stats: ["X stats", "post"], agents_log: ["Agents log", "plan"], store_catalog: ["Catalog", "catalog"],
  store_link: ["Store link", "store"], store_new_designs: ["New designs", "store"], growth_next_pillar: ["Next post", "plan"],
  x_post: ["Post on X", "post"], x_mentions: ["Mentions", "reply"], x_reply: ["Reply", "reply"], x_post_scout: ["Scout draft", "reply"], x_browser_reply: ["Browser reply", "browser"],
  next_ad_format: ["Ad format", "plan"], ad_concepts: ["Ad concepts", "plan"], ad_image_generate: ["Ad image", "image"], ad_image_status: ["Image status", "image"],
  generate_image: ["Generate image", "image"], ad_video_start: ["Video", "video"], ad_video_status: ["Video status", "video"], ad_video_compose: ["Compose video", "video"],
  ad_review: ["Send to review", "review"], ad_review_status: ["Review result", "review"], ad_submit: ["Publish ad", "check"], view_image: ["Look at ad", "review"],
  customania_start: ["Open order", "store"], customania_upload: ["Upload print", "design"], customania_place: ["Place print", "design"], customania_checkout: ["Checkout", "money"],
  customania_pay: ["Pay", "money"], customania_handoff_payment: ["Payment handoff", "money"], customania_payment_status: ["Payment status", "money"], customania_close: ["Close order", "store"],
  issue_card: ["Issue card", "money"], courier_quote: ["Courier quote", "courier"], courier_book: ["Book courier", "courier"], courier_status: ["Courier status", "courier"],
  stripe_orders: ["Store orders", "money"], sales_batch_start: ["Batch orders", "money"], stripe_mark_batched: ["Mark batched", "money"], sales_batch_abort: ["Abort batch", "money"],
  preorders_list: ["Pre-orders", "money"], charge_preorders: ["Charge pre-orders", "money"], charge_preorders_status: ["Charge status", "money"],
  inbox_list: ["Inbox", "inbox"], inbox_read: ["Read email", "inbox"], inbox_reply: ["Reply email", "mail"], inbox_mark_handled: ["Mark handled", "inbox"],
  ops_courier_request: ["Courier request", "courier"], preorder_cancel: ["Cancel pre-order", "money"], preorder_send_payment_link: ["Payment link", "mail"],
  linkedin_post: ["LinkedIn post", "post"], linkedin_images: ["LinkedIn images", "image"],
  flag_john: ["Flag founder", "flag"], order_lookup: ["Order lookup", "money"], order_status: ["Order status", "money"], refund_request: ["Refund", "money"],
};
// the storefront's icon set, exactly; anything else renders as "other"
const ICONS = new Set(["search", "trends", "design", "image", "video", "review", "check", "post", "reply", "browser", "store", "money", "courier", "inbox", "plan", "flag", "catalog", "mail", "other"]);
const toolMeta = (n) => { const m = TOOL_META[n]; return m ? { label: m[0], icon: ICONS.has(m[1]) ? m[1] : "other" } : { label: clip(String(n || "tool").replace(/^.*\./, "").replace(/_/g, " "), 20), icon: "other" }; };
const PRIVATE_ROLES = new Set(["ops", "support"]);
let defsCache = null;
const defsModel = {};
async function grantedTools() {
  if (defsCache) return defsCache;
  try {
    const { agentDefs } = await import("./defs.mjs");
    const defs = agentDefs({ live: false, trendsAllow: true });
    for (const [k, d] of Object.entries(defs)) if (d.model) defsModel[k] = d.model;
    defsCache = Object.fromEntries(Object.entries(defs).map(([k, d]) => [k, [
      ...Object.entries(d.tools || {}).filter(([, perm]) => perm && perm !== "off").map(([n, perm]) => ({ name: n, ...toolMeta(n), permission: perm === "ask" ? "ask" : "allow" })),
      ...Object.entries(d.builtins || {}).filter(([, c]) => c?.enabled).map(([n, c]) => ({ name: n, ...toolMeta(n), permission: c.permission === "ask" ? "ask" : "allow" })),
    ]]));
  } catch { defsCache = {}; }
  return defsCache;
}

function buildAgentsDoc({ rootDir, cache, sessions, derived, ship, v2agents, d1, proposalsAll }) {
  const meta = cache.meta || { agents: [], deployments: [] };
  const ads = readJson(path.join(rootDir, "ads.json"), { ads: {}, reviews: {} });
  const adList = Object.values(ads.ads || {});
  const reviewSessions = new Set(Object.values(ads.reviews || {}).map((r) => r.session).filter(Boolean));
  const ceoHandoff = new Set(proposalsAll.map((p) => p.ceo_session).filter(Boolean));
  const opsHandoff = new Set(Object.values(readJson(path.join(rootDir, "courier-requests.json"), {})).map((r) => r?.ops_session).filter(Boolean));
  const xl = readJson(path.join(rootDir, "x-ledger.json"), { posts: [] });
  const pub = (u) => (typeof u === "string" && /^https:\/\//.test(u) && !/trycloudflare|localhost/.test(u) ? u : null);
  const thumbOfAd = (a) => pub(a?.kind === "video" ? a.poster_url || null : a?.media_url);
  const designThumb = (id) => {
    if (id === DROP1.design_id) return d1.artwork_url;
    const p = proposalsAll.find((x) => x.design_id === id && x.mode === "live");
    return pub(p?.publish?.mockup_url) || pub(cache.art[id]) || null;
  };
  const near = (list, at, ms, key = "at") => list.find((x) => x[key] && Math.abs(Date.parse(x[key]) - Date.parse(at)) <= ms) || null;
  const out = {};
  for (const a of v2agents) {
    const key = a.key;
    const agentMeta = meta.agents.find((x) => x.name === `hallucinated-${key}`);
    const deps = meta.deployments.filter((d) => d.agent_id === agentMeta?.id);
    const cronMins = deps.flatMap((d) => cronTimes(d.cron));
    const ptMin = (iso) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(iso)); const g = (t) => Number(p.find((x) => x.type === t)?.value || 0); return (g("hour") % 24) * 60 + g("minute"); };
    const ses = sessions.filter((c) => String(c.agent || "").replace(/^hallucinated-/, "") === key).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, 15);
    const runs = ses.map((c) => {
      const ev = [...(c.events || [])].sort((x, y) => x.seq - y.seq);
      const done = new Map(ev.filter((e) => e.t === "tc").map((e) => [e.id, e]));
      const raw = [];
      for (const e of ev.filter((e) => e.t === "ts")) {
        const tc = done.get(e.id);
        if (tc && /waiting for approval/.test(tc.o)) continue;   // Naïve's hold: the call is re-issued later
        const o = tc ? parseJ(tc.o) || {} : {};
        const ok = !!tc && !tc.err;
        const m = toolMeta(e.n);
        let summary = "", url = null, thumb = null;
        const at = e.at;
        switch (e.n) {
          case "generate_design": if (o.id) { summary = `Design ${o.id}${o.text_seen ? `: "${clip(o.text_seen, 50)}"` : ""}, QA ${o.pass ? "pass" : "fail"}`; thumb = designThumb(o.id); } break;
          case "propose_design": summary = ok ? `Proposed "${e.a.title || e.a.slug || "a design"}"` : `Refused: "${e.a.title || e.a.slug || "a design"}"`; break;
          case "ceo_decide": summary = `${e.a.decision === "approve" ? "Approved" : e.a.decision === "reject" ? "Rejected" : "Decided"}: ${plain(e.a.reason || "")}`; if (o.url) url = o.url; break;
          case "x_post": { const id = o.id || near(xl.posts.filter((p) => p.kind === "post" && p.id), at, 15_000)?.id; if (ok && id && !/^dry-/.test(String(id))) { url = X_URL(id); summary = plain(o.text || xl.posts.find((p) => p.id === id)?.text || "Posted on X"); } break; }
          case "x_reply": if (ok && o.id) { url = X_URL(o.id); summary = "Replied to a mention"; } break;
          case "x_browser_reply": if (ok) { const r = near(xl.posts.filter((p) => p.kind === "browser_reply"), at, 120_000); summary = "Replied to a post on X"; if (r?.id) url = X_URL(r.id); } break;
          case "ad_submit": { const ad = (e.a.review_id && adList.find((x) => x.review_id === e.a.review_id)) || near(adList, at, 120_000, "created_at"); if (ok) { const gone = ad?.state === "withdrawn"; summary = `${gone ? "Made" : "Published"} ${ad?.kind === "video" ? "a video" : "an"} ad${ad?.format ? ` (${String(ad.format).replace(/_/g, " ")})` : ""}${gone ? ", later withdrawn" : ""}`; thumb = gone ? null : thumbOfAd(ad); url = gone ? null : pub(ad?.x_url) || null; } break; }
          case "customania_checkout": summary = ok ? `Cart verified${o.total ? `, $${o.total}` : ""}` : ""; break;
          case "courier_status": if (o.status === "completed" && o.result) summary = o.result.booked ? `Courier booked${money(o.result.price) ? ` ($${money(o.result.price).toFixed(2)})` : ""}` : `Quote${money(o.result.price) ? ` $${money(o.result.price).toFixed(2)}` : ""}`; break;
        }
        if (!summary && !ok) summary = tc ? (PRIVATE_ROLES.has(c.role) || !tc.o ? "failed" : clip(plain(tc.o), 100)) : "no result";
        raw.push({ at, tool: e.n, label: m.label, icon: m.icon, ok, summary, url: pub(url), thumb: pub(thumb) });
      }
      // collapse consecutive repeats of the same tool (keep the last link/thumb, ok = the last call's)
      const steps = [];
      for (const st of raw) {
        const prev = steps.at(-1);
        if (prev && prev.tool === st.tool && !st.url && !st.thumb && !prev.url && !prev.thumb) {
          prev.n += 1; prev.fails += st.ok ? 0 : 1; prev.ok = st.ok; prev.summary = st.summary; continue;
        }
        steps.push({ ...st, n: 1, fails: st.ok ? 0 : 1 });
      }
      for (const st of steps) {
        if (st.n > 1) {
          st.label = clip(`${st.label} ×${st.n}`, 24);
          if (st.fails && st.ok) st.summary = `${st.fails} of ${st.n} failed, then ok${st.summary ? `: ${st.summary}` : ""}`;
          else if (st.fails === st.n && st.summary === "failed") st.summary = `all ${st.n} failed`;
        }
        delete st.n; delete st.fails; st.summary = clip(st.summary, 100);
      }
      const idle = [...ev].reverse().find((e) => e.t === "idle");
      const running = ["running", "queued"].includes(c.status);
      const status = running ? "running" : c.status === "failed" || c.stop_reason === "error" ? "failed" : c.status === "cancelled" ? "cancelled"
        : /awaiting_(approval|answer|input)/.test(c.stop_reason || "") ? "waiting_human" : "done";
      const mins = c.created_at ? ptMin(c.created_at) : -1;
      const fromCron = c.deployment_id === undefined && cronMins.some((m) => Math.abs(mins - m) <= 2);
      const trigger = c.deployment_id || fromCron ? "schedule" : key === "reviewer" || reviewSessions.has(c.id) || ceoHandoff.has(c.id) || opsHandoff.has(c.id) ? "handoff" : "manual";
      const r = resultOf(c);
      const d = derived[c.id];
      return {
        id: c.id, started_at: c.started_at || c.created_at, ended_at: running ? null : idle?.at || null, status, trigger,
        spend_usd: c.spend_micro != null ? Math.round(c.spend_micro / 1e4) / 100 : null,
        result: r ? clip(resultText(r, c.role) || "", 140) || null : null,
        ...(d?.dry ? { dry_run: true } : {}),
        steps: steps.slice(0, 25),
      };
    });
    const shipped = ship.filter((x) => x.agent === key).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 24)
      .map((x) => ({ at: x.at, kind: x.kind || "post", title: x.text, url: x.url, thumb: x.thumb, status: x.status ?? null }));
    const model = agentMeta?.model || defsModel[key] || (key === "reviewer" ? REVIEWER_MODEL_FALLBACK : null);
    out[key] = { key, name: a.name, role: a.role, model: model ? String(model).split("/").pop() : null, schedule: a.schedule, next_run_at: a.next_run_at,
      tools: (defsCache || {})[key] || [], shipped, runs };
  }
  return { version: 1, generated_at: new Date().toISOString(), agents: out };
}
const REVIEWER_MODEL_FALLBACK = "google/gemini-3-flash-preview";

// ---- Stripe (live, read-only) --------------------------------------------------------------------------------------
async function liveStripe(rootDir) {
  const key = envKey(rootDir, "STRIPE_LIVE_SECRET_KEY") || null;
  if (!key || !/^(sk|rk)_live_/.test(key)) return { error: "no live Stripe key", products: [], orders: [], preorders: [] };
  const get = stripeCall(key);
  const [prods, prices] = await Promise.all([get("/products?active=true&limit=100"), get("/prices?active=true&limit=100")]);
  const products = (prods.data || []).filter((p) => p.metadata?.slug && ["live", "preorder"].includes(p.metadata?.status));
  const priceMeta = Object.fromEntries((prices.data || []).map((p) => [p.id, p.metadata || {}]));
  const sessions = [];
  let starting_after = null;
  for (let page = 0; page < 5; page++) {
    const r = await get(`/checkout/sessions?status=complete&limit=100&expand[]=data.line_items${starting_after ? `&starting_after=${starting_after}` : ""}`);
    sessions.push(...(r.data || []));
    if (!r.has_more || !r.data?.length) break;
    starting_after = r.data.at(-1).id;
  }
  const orders = [], preorders = [];
  for (const s of sessions) {
    const at = new Date((s.created || 0) * 1000).toISOString();
    if (s.mode === "payment" && s.payment_status === "paid") {
      const lines = (s.line_items?.data || []).map((li) => ({ qty: li.quantity || 1, size: li.price?.metadata?.size || s.metadata?.size || null, slug: li.price?.metadata?.slug || null, design_id: li.price?.metadata?.design_id || s.metadata?.design_id || null }));
      orders.push({ at, amount_usd: (s.amount_total || 0) / 100, lines: lines.length ? lines : [{ qty: 1, size: s.metadata?.size || null, slug: null, design_id: s.metadata?.design_id || null }] });
    } else if (s.mode === "setup" && s.metadata?.kind === "preorder") {
      const items = parseJ(s.metadata.preorder_items) || [];
      preorders.push({ at, amount_usd: Number(s.metadata.preorder_total || 0) / 100, lines: items.map((i) => ({ qty: i.qty || 1, size: priceMeta[i.price_id]?.size || null, slug: priceMeta[i.price_id]?.slug || null, design_id: priceMeta[i.price_id]?.design_id || null })) });
    }
  }
  return { products, orders, preorders };
}

// ---- build ---------------------------------------------------------------------------------------------------------
export async function buildHq({ rootDir = DEFAULT_ROOT, uploadArt = false, log = () => {} } = {}) {
  const t0 = Date.now();
  const cacheFile = path.join(rootDir, "hq-cache.json");
  const cache = readJson(cacheFile, { v: 1, sessions: {}, art: {}, last_push: null });
  cache.sessions ||= {}; cache.art ||= {};
  const secret = envKey(rootDir, "STORE_ADMIN_SECRET");
  const store = secret ? storeCall(secret) : null;
  const warn = [];

  // 1. Naïve, Stripe and the store's dossiers in parallel
  const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(rootDir, "VETTA_API_KEY") });
  const [naive, stripe, content] = await Promise.all([
    syncSessions(v, cache).catch((e) => { warn.push(`naive: ${e.message}`); return { sessions: Object.values(cache.sessions), fetched: 0 }; }),
    liveStripe(rootDir).catch((e) => { warn.push(`stripe: ${e.message}`); return { products: [], orders: [], preorders: [], error: e.message }; }),
    store ? store("GET", "/api/admin/content").catch((e) => { warn.push(`content: ${e.message}`); return null; }) : Promise.resolve(null),
  ]);

  // 2. which sessions were dry runs / sandbox tests (order-runs records, here and in the archive)
  const dry = new Set();
  for (const dir of [path.join(rootDir, "order-runs"), path.join(rootDir, "..", "order-runs")]) {
    let runs = []; try { runs = fs.readdirSync(dir); } catch {}
    for (const r of runs) {
      const rec = readJson(path.join(dir, r, "record.json"), null);
      if (!rec || !/dry|sandbox|e2e|test/i.test(`${rec.mode || ""} ${r}`) || r === DROP1.archive_run) continue;
      for (const s of rec.sessions || []) if (s.session && !SEED_IDS.includes(s.session)) dry.add(s.session);
    }
  }

  // 3. per-session items
  const timeline = [], human = [];
  let spend = 0;
  const facts = { designs: [], decisions: [], postRole: {}, courierBySession: {} };
  const derived = {};
  for (const c of naive.sessions) {
    const d = deriveSession(c, dry.has(c.id));
    derived[c.id] = d;
    spend += d.spend;
    timeline.push(...d.items);
    if (!d.dry) human.push(...d.human);
    facts.designs.push(...d.facts.designs);
    facts.decisions.push(...d.facts.decisions);
    for (const p of d.facts.posts) facts.postRole[p.id] = p.role;
    facts.courierBySession[c.id] = d.facts.courier;
  }

  // 4. ledgers
  const xl = readJson(path.join(rootDir, "x-ledger.json"), { posts: [] });
  const xPosts = (xl.posts || []).filter((p) => p.id && ["post", "reply"].includes(p.kind));
  for (const p of xl.posts || []) {
    const agent = ROLE[facts.postRole[p.id]] || "growth";
    if (p.kind === "post" && p.id) timeline.push({ at: p.at, agent, kind: "x_post", text: clip(plain(p.text), 400), url: X_URL(p.id) });
    else if (p.kind === "reply" && p.id) timeline.push({ at: p.at, agent, kind: "x_reply", text: "Replied to a mention", url: X_URL(p.id) });
    else if (p.kind === "scout") timeline.push({ at: p.at, agent, kind: "scout", text: "Drafted a reply for the founder's scout queue (the founder posts it by hand, or not)" });
  }
  const seenMail = new Set();
  for (const e of readJsonl(path.join(rootDir, "order-events.jsonl"))) {
    const k = `${e.kind}:${e.message_id || e.order_number}`;
    if (seenMail.has(k)) continue; seenMail.add(k);
    if (e.kind === "ready_for_pickup") timeline.push({ at: e.mail_at || e.at, agent: "founder", kind: "relay", text: `Relayed Customania's ready-for-pickup call to the brand inbox (order ${e.order_number})` },
      { at: e.at, agent: "support", kind: "email", text: `Read the pickup notice for order ${e.order_number} and handed it to Ops for a courier` });
    else if (e.kind === "customania_confirmation") timeline.push({ at: e.at, agent: "support", kind: "email", text: "Logged Customania's order confirmation email" });
  }
  for (const f of readJsonl(path.join(rootDir, "flags.jsonl"))) timeline.push({ at: f.at, agent: ROLE[String(f.from_agent || "").split(/\s/)[0]] || "ops", kind: "flag", text: `Flagged the founder (${f.reason || "needs a human"})` });
  const events = readJsonl(path.join(rootDir, "order-events.jsonl"));

  // 5. designs
  const liveBySlug = Object.fromEntries((stripe.products || []).map((p) => [p.metadata.slug, p]));
  const liveByDesign = Object.fromEntries((stripe.products || []).filter((p) => p.metadata.design_id).map((p) => [p.metadata.design_id, p]));
  const dossiers = ((content?.content || content || {}).designs || []).filter((d) => d.slug && liveBySlug[d.slug]);
  const proposals = Object.values(readJson(path.join(rootDir, "design-proposals.json"), { proposals: {} }).proposals || {})
    .filter((p) => p.mode === "live" && !["abandoned", "unpublished"].includes(p.state));
  const designedAt = (id) => facts.designs.find((d) => d.id === id) || null;
  const orderedFor = (slug, design_id) => {
    const rows = [];
    for (const o of stripe.orders || []) for (const l of o.lines) if (l.slug === slug || (design_id && l.design_id === design_id)) rows.push({ ...l, at: o.at, amount: o.amount_usd / Math.max(1, o.lines.length), paid: true });
    for (const o of stripe.preorders || []) for (const l of o.lines) if (l.slug === slug || (design_id && l.design_id === design_id)) rows.push({ ...l, at: o.at, amount: 0, paid: false });
    if (!rows.length) return null;
    const sizes = {}; for (const r of rows) if (r.size) sizes[r.size] = (sizes[r.size] || 0) + r.qty;
    return { at: rows.map((r) => r.at).sort().at(-1), count: rows.reduce((n, r) => n + r.qty, 0), sizes, amount_usd: Math.round(rows.reduce((n, r) => n + r.amount, 0) * 100) / 100,
      ...(rows.some((r) => !r.paid) ? { preorders: rows.filter((r) => !r.paid).reduce((n, r) => n + r.qty, 0) } : {}) };
  };
  const postFor = (slug, extra) => {
    const p = (xl.posts || []).find((x) => x.id && x.kind === "post" && (x.announces === slug || (extra && extra.test(x.text || ""))));
    return p ? { at: p.at, url: X_URL(p.id) } : null;
  };
  const artFor = async (design_id) => {
    const live = liveByDesign[design_id];
    if (live?.images?.[0]) return live.images[0];
    if (cache.art[design_id]) return cache.art[design_id];
    if (!uploadArt || !store) return null;
    const f = path.join(rootDir, "design-test", `${design_id}-preview.png`);
    if (!fs.existsSync(f)) return null;
    try {
      let buf = fs.readFileSync(f);
      if (buf.length > 4_300_000) { const sharp = (await import("sharp")).default; buf = await sharp(buf).resize(1400, 1400, { fit: "inside" }).png({ compressionLevel: 9 }).toBuffer(); }
      const up = await store("POST", `/api/admin/upload?name=${encodeURIComponent(`hq-${design_id}`)}`, { body: buf, type: "image/png" });
      if (up.url) cache.art[design_id] = up.url;
      return up.url || null;
    } catch (e) { warn.push(`art ${design_id}: ${e.message}`); return null; }
  };

  // drop #1: the first full story
  const ceoSeed = derived[DROP1.sessions.ceo];
  const arch = readJson(path.join(rootDir, "..", "order-runs", DROP1.archive_run, "record.json"), { sessions: [] });
  const archSes = (label) => (arch.sessions || []).find((s) => s.label === label) || {};
  const pickup = (facts.courierBySession[DROP1.pickup_session] || []).find((x) => x.booked);
  const d1live = liveBySlug[DROP1.slug];
  const d1designed = designedAt(DROP1.design_id);
  const ceoCached = naive.sessions.find((x) => x.id === DROP1.sessions.ceo);
  const ceoAt = (ceoCached && resultOf(ceoCached)?.at) || archSes("ceo").ended || "2026-11-07T20:51:42.000Z";
  const d1 = {
    design_id: DROP1.design_id, title: DROP1.title, slug: DROP1.slug, artwork_url: d1live?.images?.[0] || null, status: "shipped",
    stages: {
      trend: null,
      designed: { at: d1designed?.at || archSes("product").ended || "2026-11-07T20:51:21.000Z", session: DROP1.sessions.product },
      ceo: { decision: "approved", reason: clip(plain(ceoSeed?.result?.reason || archSes("ceo").result?.reason || "Approved for print."), 500), at: ceoAt, session: DROP1.sessions.ceo },
      live: d1live ? { at: new Date((d1live.created || 0) * 1000).toISOString(), url: `${STORE}/p/${DROP1.slug}` } : null,
      posted: postFor(DROP1.slug, /git reset --hard|&gt; git reset/i),
      ordered: orderedFor(DROP1.slug, DROP1.design_id),
      customania: { at: DROP1.paid_at, order_ref: DROP1.order_ref, amount_usd: DROP1.amount_usd, sizes: DROP1.sizes },
      picked_up: pickup ? { at: (facts.courierBySession[DROP1.pickup_session] || []).find((x) => x.booked)?.at, status: "booked", note: `Uber Courier booked by Ops for $${(pickup.price ?? 17.67).toFixed(2)}, Customania (SF) → YC${pickup.when ? `, ${pickup.when}` : ""}` }
        : { at: "2026-11-07T23:17:26.000Z", status: "booked", note: "Uber Courier booked by Ops for $17.67, Customania (SF) → YC, 7:30-8:00 pm" },
    },
  };
  const delivered = events.filter((e) => e.order_number === DROP1.order_ref && /picked_up|delivered/.test(e.kind)).at(-1);
  if (delivered) d1.stages.picked_up = { ...d1.stages.picked_up, at: delivered.at, status: /delivered/.test(delivered.kind) ? "delivered" : "picked_up" };
  // the CEO's drop #1 call came before ceo_decide existed: record it as a decision
  if (!timeline.some((t) => t.session === DROP1.sessions.ceo && t.kind === "decision")) timeline.push({ at: d1.stages.ceo.at, agent: "ceo", kind: "decision", text: `Approved drop #1 (design ${DROP1.design_id}) for print: ${d1.stages.ceo.reason}`, session: DROP1.sessions.ceo });

  const designs = [];
  const batches = readJson(path.join(rootDir, "sales-batches.json"), { batches: [] }).batches || [];
  for (const p of proposals) {
    if (p.design_id === DROP1.design_id) continue;
    const dec = p.decision || facts.decisions.find((d) => d.proposal_id === p.proposal_id) || null;
    const dos = dossiers.find((d) => d.slug === p.slug);
    const live = liveBySlug[p.slug] && p.state === "published" ? liveBySlug[p.slug] : null;
    const status = p.state === "rejected" ? "rejected" : live ? "live" : "proposed";
    const batch = batches.filter((b) => String(b.product || "").startsWith(p.design_id) && b.customania_order && /placed|paid|done/.test(b.state || "")).at(-1);
    const dsg = designedAt(p.design_id);
    const ann = p.announced?.post_id ? { at: p.announced.at, url: X_URL(p.announced.post_id) } : postFor(p.slug);
    designs.push({
      design_id: p.design_id, title: clip(p.title, 120), slug: live ? p.slug : null, artwork_url: await artFor(p.design_id), status: batch ? "shipped" : status,
      stages: {
        trend: p.trend_summary || dos?.trend?.summary ? { at: p.proposed_at, summary: clip(plain(p.trend_summary || dos.trend.summary), 600), sources: (p.sources || dos?.trend?.sources || []).slice(0, 6).map((s) => ({ label: clip(plain(s.label), 120), url: s.url })) } : null,
        designed: { at: dsg?.at || p.proposed_at, session: dsg?.session || p.product_session || null },
        ceo: dec?.decision ? { decision: dec.decision === "approve" ? "approved" : "rejected", reason: clip(plain(dec.reason), 500), at: dec.at, session: p.ceo_session || dec.session || null } : null,
        live: live ? { at: p.publish?.published_at || new Date((live.created || 0) * 1000).toISOString(), url: `${STORE}/p/${p.slug}` } : null,
        posted: live ? ann : null,
        ordered: live ? orderedFor(p.slug, p.design_id) : null,
        customania: batch ? { at: batch.closed_at || batch.started_at, order_ref: batch.customania_order, amount_usd: money(batch.total) } : null,
        picked_up: null,
      },
    });
  }
  // live agent designs the ledger doesn't know (dossier or Stripe only)
  for (const prod of (stripe.products || []).filter((x) => x.metadata.origin === "agents" && x.metadata.design_id !== DROP1.design_id && !designs.some((d) => d.design_id === x.metadata.design_id))) {
    const dos = dossiers.find((d) => d.slug === prod.metadata.slug);
    designs.push({ design_id: prod.metadata.design_id, title: clip(dos?.title || prod.name, 120), slug: prod.metadata.slug, artwork_url: prod.images?.[0] || null, status: "live",
      stages: { trend: dos?.trend ? { at: dos.created_at, summary: clip(plain(dos.trend.summary), 600), sources: (dos.trend.sources || []).slice(0, 6) } : null,
        designed: { at: dos?.created_at || new Date(prod.created * 1000).toISOString(), session: dos?.product_session || null },
        ceo: dos?.ceo ? { decision: "approved", reason: clip(plain(dos.ceo.reason), 500), at: dos.ceo.at, session: dos.ceo_session || null } : null,
        live: { at: new Date(prod.created * 1000).toISOString(), url: `${STORE}/p/${prod.metadata.slug}` }, posted: postFor(prod.metadata.slug),
        ordered: orderedFor(prod.metadata.slug, prod.metadata.design_id), customania: null, picked_up: null } });
  }
  const latest = (d) => Object.values(d.stages).filter(Boolean).map((s) => s.at || "").sort().at(-1) || "";
  designs.sort((a, b) => latest(b).localeCompare(latest(a)));
  designs.unshift(d1);

  // 6. assemble
  const tl = timeline.filter((t) => t.at && t.text).sort((a, b) => b.at.localeCompare(a.at));
  const strip = ({ session, agent, ...rest }) => rest;   // session ids live on designs; timeline items stay lean
  const byAgent = { product: [], ceo: [], ops: [], growth: [], support: [] };
  for (const t of tl) if (byAgent[t.agent] && byAgent[t.agent].length < 60) byAgent[t.agent].push(strip(t));
  const humanSorted = human.filter((h) => h.at).sort((a, b) => b.at.localeCompare(a.at));
  const paidOrders = stripe.orders || [];
  const doc = {
    version: 2, generated_at: new Date().toISOString(),
    counters: {
      designs_proposed: designs.length,
      designs_approved: designs.filter((d) => d.stages.ceo?.decision === "approved").length,
      designs_rejected: designs.filter((d) => d.stages.ceo?.decision === "rejected").length,
      live_items: (stripe.products || []).length,
      x_posts: xPosts.length,
      orders: paidOrders.length,
      revenue_usd: Math.round(paidOrders.reduce((n, o) => n + o.amount_usd, 0) * 100) / 100,
      agent_spend_usd: Math.round(spend * 100) / 100,
      human_approvals: humanSorted.length,
    },
    designs,
    by_agent: byAgent,
    timeline: tl.slice(0, 200).map(({ session, ...t }) => t),
    human: humanSorted,
  };
  await grantedTools();
  const { v2, anyRunning, ship } = buildV2({ rootDir, cache, sessions: naive.sessions, derived, stripe, xl, d1, human: humanSorted, timeline: tl,
    liveProposals: Object.values(readJson(path.join(rootDir, "design-proposals.json"), { proposals: {} }).proposals || {}).filter((p) => p.mode === "live" && !["abandoned"].includes(p.state)) });
  Object.assign(doc, v2);
  const proposalsAll = Object.values(readJson(path.join(rootDir, "design-proposals.json"), { proposals: {} }).proposals || {});
  let agentsJson = null;
  try {
    const agentsDoc = scrub(buildAgentsDoc({ rootDir, cache, sessions: naive.sessions, derived, ship, v2agents: v2.agents, d1, proposalsAll }));
    // trim to budget: fewer steps, then fewer runs
    agentsJson = JSON.stringify(agentsDoc);
    for (const [maxRuns, maxSteps] of [[15, 15], [10, 12], [6, 10], [4, 8]]) {
      if (agentsJson.length <= AGENTS_DOC_MAX) break;
      for (const ag of Object.values(agentsDoc.agents)) { ag.runs = ag.runs.slice(0, maxRuns); for (const r of ag.runs) r.steps = r.steps.slice(0, maxSteps); }
      agentsJson = JSON.stringify(agentsDoc);
    }
    assertClean(agentsJson);
    if (agentsJson.length > AGENTS_DOC_MAX) throw new Error(`hq-agents.json is ${agentsJson.length} bytes`);
  } catch (e) { warn.push(`agents doc: ${e.message}`); agentsJson = null; }
  const clean = scrub(doc);
  const json = JSON.stringify(clean);
  assertClean(json);
  if (json.length > MAX_BYTES) throw new Error(`hq.json is ${json.length} bytes (limit ${MAX_BYTES})`);
  writeJson(cacheFile, cache);
  if (naive.limited) warn.push("naive: 429, kept the last known state");
  return { doc: clean, json, agentsJson, cache, cacheFile, store, warn, anyRunning, fetched: naive.fetched, sessions: naive.sessions.length, ms: Date.now() - t0 };
}

// serve calls this (every 30 s while an agent runs, else 60 s: `running` in the result). Skips the upload when nothing
// but generated_at changed and the last push is < 5 min old.
export async function publishHq({ rootDir = DEFAULT_ROOT, dry = false, force = false, log = () => {} } = {}) {
  const b = await buildHq({ rootDir, uploadArt: !dry, log });
  const hash = crypto.createHash("sha256").update(JSON.stringify({ ...b.doc, generated_at: null })).digest("hex");
  if (b.agentsJson && (dry || !AGENTS_DOC_PUSH)) fs.writeFileSync(path.join(rootDir, "hq-agents.json"), b.agentsJson);
  if (dry) { fs.writeFileSync(path.join(rootDir, "hq.json"), JSON.stringify(b.doc, null, 2)); return { dry: true, running: b.anyRunning, bytes: b.json.length, events: b.doc.timeline.length, ms: b.ms, fetched: b.fetched, warn: b.warn }; }
  if (!b.store) throw new Error("STORE_ADMIN_SECRET is not in .env");
  const last = b.cache.last_push;
  // the agents doc: its own hash, never blocks the main push
  let agentsPushed = false;
  if (AGENTS_DOC_PUSH && b.agentsJson) {
    const ah = crypto.createHash("sha256").update(b.agentsJson.replace(/"generated_at":"[^"]*"/, "")).digest("hex");
    if (force || b.cache.last_agents_push?.hash !== ah || Date.now() - Date.parse(b.cache.last_agents_push?.at || 0) > 5 * 60_000) {
      try { await b.store("PUT", "/api/admin/hq?doc=agents", { body: b.agentsJson, type: "application/json" }); agentsPushed = true; b.cache.last_agents_push = { hash: ah, at: new Date().toISOString() }; writeJson(b.cacheFile, b.cache); }
      catch (e) { b.warn.push(`agents doc push: ${e.message}`); }
    }
  }
  if (!force && last?.hash === hash && Date.now() - Date.parse(last.at) < 5 * 60_000) return { skipped: true, agentsPushed, running: b.anyRunning, ms: b.ms, warn: b.warn };
  const r = await b.store("PUT", "/api/admin/hq", { json: b.doc });
  const cache = readJson(b.cacheFile, b.cache);
  cache.last_push = { hash, at: new Date().toISOString() };
  writeJson(b.cacheFile, cache);
  return { pushed: true, agentsPushed, running: b.anyRunning, bytes: r.bytes ?? b.json.length, events: b.doc.timeline.length, snapshot: r.snapshot ?? null, ms: b.ms, fetched: b.fetched, warn: b.warn };
}

// ---- CLI -----------------------------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dry = process.argv.includes("--dry");
  if (!dry && !process.argv.includes("--once")) { console.log("usage: node agents/hq_publish.mjs --once | --dry"); process.exit(2); }
  const t0 = Date.now();
  publishHq({ dry, force: true }).then((r) => {
    const doc = dry ? readJson(path.join(DEFAULT_ROOT, "hq.json"), null) : null;
    console.log(`[hq] ${dry ? "wrote hq.json" : "pushed"}: ${r.events} timeline items, ${r.bytes} bytes, ${r.fetched} new Naïve events, build ${r.ms} ms, total ${Date.now() - t0} ms${r.snapshot ? `, snapshot ${r.snapshot}` : ""}`);
    if (doc) console.log("[hq] counters", JSON.stringify(doc.counters));
    for (const w of r.warn || []) console.log(`[hq] warning: ${w}`);
  }).catch((e) => { console.error(`[hq] failed: ${e.message}`); process.exit(1); });
}
