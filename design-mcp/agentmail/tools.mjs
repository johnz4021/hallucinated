// Inbox tools on AgentMail (hallucinated@agentmail.to), plus the escalation path to John and the
// "ready for pickup" -> Ops courier trigger. Key: AGENTMAIL_API_KEY in .env (never logged).
//   inbox_list / inbox_read / inbox_reply / inbox_mark_handled  (AgentMail REST v0)
//   flag_john            appends to <root>/flags.jsonl + naive.log and pings the Mac
//   ops_courier_request  starts ONE Ops session per order number to quote (and, with John's OK, book) a courier
// Guards live here, not in prompts: no replies to automated senders, Customania or ourselves; one reply per message;
// one courier request per order number. MAIL_DRY_RUN=1 makes inbox_reply log instead of sending.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { z } from "zod";
import { createClient } from "@usenaive-sdk/vetta";
import { envKey, readJson, writeJson, appendJsonl, txt, err } from "../lib/state.mjs";

const API = "https://api.agentmail.to/v0";
export const INBOX = process.env.AGENTMAIL_INBOX || "hallucinated@agentmail.to";
const AUTOMATED = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|bounce|orders@thecustomania\.com)/i;
const addr = (from) => (String(from || "").match(/<([^>]+)>/) || [, String(from || "")])[1].trim().toLowerCase();

// What kind of mail this is, decided in code so every run classifies the same way.
export function classify(m) {
  const from = addr(m.from), subj = `${m.subject || ""} ${m.preview || ""}`;
  if (from === INBOX) return "self";
  if (/customania/i.test(from) || /customania/i.test(m.from || "")) {
    if (/ready (for|to be) (pick ?up|collected)|ready for pickup|pick(ed)? ?up/i.test(subj)) return "ready_for_pickup";
    if (/confirm|order #?\w+ (is )?(placed|received)|thank you for your order/i.test(subj)) return "customania_confirmation";
    return "customania_other";
  }
  if (AUTOMATED.test(from)) return "automated";
  return "customer";
}
export function orderNumber(m) {
  const s = `${m.subject || ""} ${m.preview || ""} ${m.text || ""}`;
  return (s.match(/order\s*#\s*([A-Z0-9-]{3,12})/i) || s.match(/#\s?(\d{3,7})\b/) || s.match(/\b([A-Z0-9]{9})\b/) || [])[1] || null;
}

export function flagJohn(ctx, { reason, summary, ref, from_agent }) {
  const row = { reason, summary: String(summary).slice(0, 2000), ref: ref || null, from_agent: from_agent || null };
  appendJsonl(path.join(ctx.rootDir, "flags.jsonl"), row);
  ctx.log?.(`[FLAG for John] (${reason}) ${row.summary.replace(/\s+/g, " ").slice(0, 300)}${ref ? " ref " + ref : ""}`);
  try { execFile("osascript", ["-e", `display notification ${JSON.stringify(row.summary.slice(0, 180))} with title ${JSON.stringify("Hallucinated flag: " + reason)} sound name "Glass"`]); } catch {}
  return row;
}

export function agentMail(rootDir) {
  const key = envKey(rootDir, "AGENTMAIL_API_KEY");
  if (!key) return null;
  return async (method, p, body) => {
    const r = await fetch(API + p, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw new Error(`AgentMail ${method} ${p.split("?")[0]} ${r.status}: ${(typeof j === "string" ? j : JSON.stringify(j)).slice(0, 300)}`);
    return j;
  };
}

export function registerAgentMailTools(server, ctx) {
  server.registerTool("flag_john", {
    title: "Escalate something to John (the human founder)",
    description: "Use for anything about money, refunds, chargebacks, complaints, legal or press, threats, or anything you are not sure how to handle. Writes it to John's flag queue and pings his Mac. Does not email anyone. Say what happened, what you already did, and what you need him to decide.",
    inputSchema: {
      reason: z.enum(["money", "refund", "complaint", "legal", "press", "unclear", "other"]),
      summary: z.string().min(10).max(2000),
      ref: z.string().optional().describe("message_id, order number, Stripe session id or post id this is about"),
      from_agent: z.string().optional().describe("your role, e.g. support"),
    },
  }, async (a) => { try { return txt({ flagged: true, ...flagJohn(ctx, a) }); } catch (e) { return err("flag_john failed: " + e.message); } });

  const am = agentMail(ctx.rootDir);
  if (!am) { ctx.log?.("inbox tools off: AGENTMAIL_API_KEY not in .env"); }
  else {
    const box = encodeURIComponent(INBOX);
    // Handled/replied state lives in <root>/inbox-ledger.json: this AgentMail key can't update labels (no message_update
    // permission), and the one-reply-per-message guard must hold anyway. Labels are still tried, best effort.
    const ledFile = path.join(ctx.rootDir, "inbox-ledger.json");
    const led = () => readJson(ledFile, {});
    const mark = (id, fields) => { const l = led(); l[id] = { ...(l[id] || {}), ...fields }; writeJson(ledFile, l); return l[id]; };
    const label = (id, add, remove = []) => am("PATCH", `/inboxes/${box}/messages/${encodeURIComponent(id)}`, { add_labels: add, remove_labels: remove }).catch(() => null);

    server.registerTool("inbox_list", {
      title: `List mail in ${INBOX}`,
      description: "Lists recent messages in the brand inbox, newest first, each with a kind decided by code: customer | customania_confirmation | ready_for_pickup | customania_other | automated | self, and an order number guess. By default hides messages already marked handled.",
      inputSchema: { include_handled: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() },
    }, async ({ include_handled = false, limit = 20 }) => {
      try {
        const r = await am("GET", `/inboxes/${box}/messages?limit=50`);
        const l = led();
        const done = (m) => !!l[m.message_id]?.handled_at || (m.labels || []).includes("handled");
        const msgs = (r.messages || []).filter((m) => include_handled || !done(m)).slice(0, limit)
          .map((m) => ({ message_id: m.message_id, thread_id: m.thread_id, at: m.timestamp, from: m.from, subject: m.subject, preview: String(m.preview || "").slice(0, 240),
            kind: classify(m), order_number: orderNumber(m), handled: done(m), replied: !!l[m.message_id]?.replied_at }));
        return txt({ inbox: INBOX, count: msgs.length, messages: msgs });
      } catch (e) { return err("inbox_list failed: " + e.message); }
    });

    server.registerTool("inbox_read", {
      title: "Read one email",
      description: "Returns the full text of one message (quoted history trimmed when AgentMail can), with its kind and order number guess.",
      inputSchema: { message_id: z.string() },
    }, async ({ message_id }) => {
      try {
        const m = await am("GET", `/inboxes/${box}/messages/${encodeURIComponent(message_id)}`);
        const text = String(m.extracted_text || m.text || (m.html || "").replace(/<[^>]+>/g, " ") || m.preview || "").replace(/\n{3,}/g, "\n\n").slice(0, 6000);
        return txt({ message_id: m.message_id, thread_id: m.thread_id, at: m.timestamp, from: m.from, to: m.to, subject: m.subject, labels: m.labels,
          kind: classify(m), order_number: orderNumber({ ...m, text }), text });
      } catch (e) { return err("inbox_read failed: " + e.message); }
    });

    server.registerTool("inbox_reply", {
      title: "Reply to a customer email",
      description: "Replies in the same thread from the brand inbox, in plain text. Only for real people (kind customer); refused for Customania, automated senders and our own mail, and refused if this message already got a reply. Marks the message replied + handled. Never promise refunds, discounts, dates or money: flag_john those instead and tell the customer a human will follow up.",
      inputSchema: { message_id: z.string(), text: z.string().min(1).max(4000) },
    }, async ({ message_id, text }) => {
      try {
        const m = await am("GET", `/inboxes/${box}/messages/${encodeURIComponent(message_id)}`);
        const kind = classify(m);
        if (kind !== "customer") return err(`refused: this message is ${kind}, not a customer email; don't reply to it`);
        if (led()[message_id]?.replied_at || (m.labels || []).includes("replied")) return err("refused: this message already has a reply from us");
        if (process.env.MAIL_DRY_RUN === "1") {
          ctx.log?.(`[inbox_reply DRY] to ${addr(m.from)} re "${m.subject}": ${JSON.stringify(text).slice(0, 200)}`);
          return txt({ dry_run: true, would_reply_to: addr(m.from), subject: m.subject, text });
        }
        const r = await am("POST", `/inboxes/${box}/messages/${encodeURIComponent(message_id)}/reply`, { text });
        mark(message_id, { kind, from: addr(m.from), replied_at: new Date().toISOString(), handled_at: new Date().toISOString(), reply_message_id: r.message_id });
        await label(message_id, ["replied", "handled"], ["unread"]);
        ctx.log?.(`[inbox_reply] to ${addr(m.from)} re "${m.subject}" (${r.message_id})`);
        return txt({ sent: true, to: addr(m.from), reply_message_id: r.message_id, thread_id: r.thread_id });
      } catch (e) { return err("inbox_reply failed: " + e.message); }
    });

    server.registerTool("inbox_mark_handled", {
      title: "Mark an email handled (and log order mail)",
      description: "Marks a message handled so the next inbox run skips it. For Customania mail, pass the order number: confirmations and ready-for-pickup notices are logged to the order-events log the team reads.",
      inputSchema: { message_id: z.string(), note: z.string().max(500).optional(), order_number: z.string().optional() },
    }, async ({ message_id, note, order_number }) => {
      try {
        const m = await am("GET", `/inboxes/${box}/messages/${encodeURIComponent(message_id)}`);
        const kind = classify(m);
        if (led()[message_id]?.handled_at) return txt({ handled: true, already: true, kind, message_id });
        if (kind.startsWith("customania") || kind === "ready_for_pickup") {
          appendJsonl(path.join(ctx.rootDir, "order-events.jsonl"), { kind, order_number: order_number || orderNumber(m), message_id, subject: m.subject, mail_at: m.timestamp, note: note || null });
          ctx.log?.(`[order event] ${kind} ${order_number || orderNumber(m) || "?"}: ${m.subject}`);
        }
        mark(message_id, { kind, handled_at: new Date().toISOString(), order_number: order_number || orderNumber(m) || null, note: note || null });
        await label(message_id, ["handled"], ["unread"]);
        return txt({ handled: true, kind, message_id });
      } catch (e) { return err("inbox_mark_handled failed: " + e.message); }
    });
  }

  // Support -> Ops: one Ops session per Customania order number (ledger in courier-requests.json).
  server.registerTool("ops_courier_request", {
    title: "Ask Ops to get a courier for a ready order",
    description: "Use when Customania says an order is ready for pickup. Starts an Ops session that quotes an Uber Courier from Customania to the YC office and then asks John to approve the booking. Only one request per order number ever; a second call returns the first request.",
    inputSchema: { order_number: z.string().min(3), message_id: z.string().optional(), note: z.string().max(500).optional() },
  }, async ({ order_number, message_id, note }) => {
    try {
      const file = path.join(ctx.rootDir, "courier-requests.json");
      const led = readJson(file, {});
      if (led[order_number]) return txt({ already_requested: true, ...led[order_number] });
      const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: ctx.vettaKey });
      const ops = ((await v.agents.list({ limit: 100 })).data || []).find((a) => a.name === "hallucinated-ops");
      if (!ops) return err("no hallucinated-ops agent; run setup_agents.mjs");
      const message = courierBrief(order_number, note);
      const s = await v.sessions.create({ agent_id: ops.id, identity: ctx.identityId, message, budget_micro_usd: 1_500_000 });
      led[order_number] = { order_number, message_id: message_id || null, ops_session: s.id, requested_at: new Date().toISOString() };
      writeJson(file, led);
      ctx.log?.(`[ops_courier_request] order ${order_number} -> ops session ${s.id}`);
      return txt({ requested: true, ...led[order_number] });
    } catch (e) { return err("ops_courier_request failed: " + e.message); }
  });
}

export const courierBrief = (order_number, note) =>
`Customania says order ${order_number} is ready for pickup${note ? ` (${note})` : ""}. Get it couriered from Customania to the YC office.
1. courier_quote with order_number "${order_number}". Then call courier_status with the task_id again and again until status is completed or failed (phone tasks take 3-5 minutes).
2. If the quote reached Uber's final screen with a price: call courier_book with order_number "${order_number}" and max_price_usd = the standard price rounded up + $3 (never more than $40). That call waits for John's approval in Naïve Studio; that is expected. Then courier_status until it is completed or failed.
3. If the quote failed, or the price is over $37, don't book: flag_john with what you saw.
End with one line: RESULT: {"order_number":"${order_number}","quoted":"<price or null>","booked":true|false,"issues":"<or none>"}`;
