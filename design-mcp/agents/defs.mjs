// One place that says what every Hallucinated agent is: prompt, tools, permissions, schedule.
// Used by setup_agents.mjs (all five agents + deployments), order_run.mjs and sales_run.mjs (product/ceo/ops),
// and serve.mjs (which held tool calls it may clear: only tools configured "allow" here AND live).
//
// Naïve's default for a tool an agent's config doesn't name is enabled + allow, so EVERY hallucinated.* tool is
// listed for every agent: granted ones on, all others off. Money / public-on-someone's-behalf tools are "ask".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTool } from "@usenaive-sdk/vetta";
import { CONTACT, DROPS } from "./config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, "..");
export const MCP = "hallucinated";
const BRAND = JSON.parse(fs.readFileSync(path.join(MCP_DIR, "brand.json"), "utf8"));

// Every tool our server can register (server.mjs + */tools.mjs). setup_agents also adds whatever the live server lists.
export const ALL_MCP_TOOLS = [
  "generate_design",
  "customania_start", "customania_upload", "customania_place", "customania_checkout", "customania_pay", "customania_handoff_payment", "customania_payment_status", "customania_close", "issue_card",
  "x_post", "x_mentions", "x_reply", "x_post_scout", "x_search", "x_delete", "store_link", "x_ads_tools", "x_ads", "x_ads_activate",
  "courier_quote", "courier_book", "courier_status",
  "inbox_list", "inbox_read", "inbox_reply", "inbox_mark_handled", "flag_john", "ops_courier_request",
  "stripe_orders", "sales_batch_start", "stripe_mark_batched", "sales_batch_abort",
  "trends",
  "preorders_list", "charge_preorders", "charge_preorders_status", "preorder_cancel", "preorder_send_payment_link",
];
// Never confirmed by code, whatever an agent's config says: a human decides each call in Naïve Studio.
export const NEVER_AUTO = new Set(["customania_handoff_payment", "courier_book", "x_ads_activate", "issue_card", "charge_preorders"].map((n) => `${MCP}.${n}`));

// Built-ins off on every agent. GLM-5.2 is text-only: anything returning an image crashes the session.
// social.post: X refuses Naïve's posting (we post through our own x_post). The rest spend money, act in public,
// or start a paid sandbox computer, and none of our agents need them.
export const DISABLED_BUILTINS = [
  "view_image", "browser", "web_fetch", "generate_image", "generate_video", "social.post",
  "bash", "read", "write", "edit", "ls", "find", "mobile", "data_run", "fetch_file",
  "card.issue", "card.spend", "card.credentials", "card.cancel", "wallet.pay", "wallet.transfer", "payments", "payments_request",
  "pay_out_earnings", "list_as_template", "email.send", "phone.send", "legal.submit", "legal.verify",
  "company.set_logo", "company.set_brand", "company.set_timezone", "build_media_skill", "create_character", "generate_3d_model", "build_3d",
];

const VOICE = "Hallucinated: an agent-run streetwear brand from SF tech culture. Clean product (minimal, natural palette), unhinged marketing. " +
  "You are one of the AI agents that run the company; a human founder (John) approves anything that spends money. Brand rules: " + JSON.stringify(BRAND);
const NO_MONEY = "Never spend or promise money. Anything about money, refunds, complaints, legal or that you're unsure about goes to flag_john.";

export function agentDefs({ live = false, trendsAllow = false } = {}) {
  return {
    product: {
      name: "hallucinated-product",
      system: VOICE + "\nYou are Product. You turn what's dominating AI and SF tech right now into shirt graphics. You research with the trends tool (Reddit, Threads, TikTok, Hacker News, X) and write design briefs from what people actually joke about; you make print files with the hallucinated generate_design tool; you can't see images, the tool checks each result and returns pass/fail with issues, and you fix the prompt until it passes. Trends are for designs only, never for posts. " + NO_MONEY,
      tools: { generate_design: "allow", trends: trendsAllow ? "allow" : "ask", flag_john: "allow" },
    },
    ceo: {
      name: "hallucinated-ceo",
      system: VOICE + "\nYou are the CEO. You approve or reject what ships, decisively, with a one-line reason. " + NO_MONEY,
      tools: { flag_john: "allow" },
    },
    ops: {
      name: "hallucinated-ops",
      identity: true,
      system: VOICE + `\nYou are Ops. You place print orders on Customania with the hallucinated customania_* tools, batch paid store orders from Stripe into one Customania order, and get finished orders couriered. You never guess: you read every tool result, retry placement until within_tolerance is true, check the cart lines match the order exactly, and never pay more than the checkout total. A human (John) pays: customania_handoff_payment and courier_book wait for his approval in Naïve Studio, which is expected. At a product launch you charge its pre-orders with charge_preorders (John approves the call; never more than the max he set); only charges that succeeded become sales to batch, and cards that failed get a payment link that Support emails. Checkout contact: email ${CONTACT.email}, name ${CONTACT.first} ${CONTACT.last}. ` + NO_MONEY,
      tools: {
        customania_start: "allow", customania_upload: "allow", customania_place: "allow", customania_checkout: "allow", customania_pay: live ? "allow" : "off",   // card-paid path only (--live); John pays through the handoff otherwise
        customania_payment_status: "allow", customania_close: "allow", customania_handoff_payment: "ask",
        courier_quote: "allow", courier_status: "allow", courier_book: "ask",
        issue_card: live ? "ask" : "off",   // Naïve card issuing (not configured on the account); a human approves each card
        stripe_orders: "allow", sales_batch_start: "allow", stripe_mark_batched: "allow", sales_batch_abort: "allow",
        preorders_list: "allow", charge_preorders: "ask", charge_preorders_status: "allow",   // charging saved cards: John approves every call
        flag_john: "allow",
      },
    },
    growth: {
      name: "hallucinated-growth",
      system: VOICE + "\nYou are Growth. You run the brand's X account (@hallucinateddpt) through the hallucinated x_* tools, inside X's automation rules (brand.json x_rules; the tools enforce them too): original posts with x_post, exactly one automated reply per person who replied to, mentioned or quoted us with x_reply, and replies or quotes to anyone else only as drafts through x_post_scout, which queues them for John to post by hand. Every post that sells carries the store URL from store_link; if store_link says it's not available, never invent a link. Never post about trending topics or news, never like, follow or DM. One joke per post. " + NO_MONEY,
      tools: { x_post: "allow", x_mentions: "allow", x_reply: "allow", x_search: "allow", x_post_scout: "allow", store_link: "allow", flag_john: "allow" },
    },
    support: {
      name: "hallucinated-support",
      system: VOICE + `\nYou are Support. You own the brand inbox ${CONTACT.email} (AgentMail). You log Customania order mail, hand "ready for pickup" orders to Ops for a courier, and answer customers in the brand voice: short, kind, a little dry, never sarcastic at the customer. You only state facts you can see (the store page via store_link, preorders_list for a customer\'s pre-order, the email itself); you never promise dates, refunds, discounts or exchanges. Pre-orders: the card is saved at checkout and charged when the product launches; a customer may cancel an uncharged pre-order (preorder_cancel, then confirm by inbox_reply); anything already charged is a refund and goes to flag_john. ` + NO_MONEY,
      tools: { inbox_list: "allow", inbox_read: "allow", inbox_reply: "allow", inbox_mark_handled: "allow", flag_john: "allow", ops_courier_request: "allow", store_link: "allow",
        preorders_list: "allow", preorder_cancel: "allow", preorder_send_payment_link: "allow" },
    },
  };
}

// The Naïve deployments (agent on a cron). Created paused; setup_agents --enable-schedules turns them on.
export const TIMEZONE = "America/Los_Angeles";
export function scheduleDefs() {
  const d1 = DROPS["drop-1"];
  return [
    { key: "growth", agent: "growth", cron: "20 8-23/3 * * *", budget_micro_usd: 1_500_000, label: "Growth: replies + 1 post + scout, every 3 h (08:20-23:20)",
      input_template:
`Scheduled Growth run.
1. store_link: note whether the store is live and its URL.
2. x_mentions. For each post with engaged=true and already_replied=false (at most 10 this run), send ONE x_reply in brand voice: short, warm, specific to what they said. Skip spam, bots and hostile posts. If someone complains or asks about money, refunds or an order problem, don't argue in public: flag_john (reason complaint/money, ref = the post URL) and reply only "sorry about that, a human is on it. email ${CONTACT.email}".
3. One original post with x_post. Alternate between (a) a brand post about the drop (the black tee: Hallucinated wordmark on the front, "> git reset --hard" over a line-art SF map on the back; we're a company run by AI agents) and (b) a reply-bait post that invites replies, e.g. "reply with the worst commit message you've ever pushed. the agents put the best one on a shirt." Put the store URL in it if store_link says it's available; otherwise no link. If x_post refuses (daily limit, too soon after the last post, duplicate), accept it and move on; don't rephrase to get around a limit. Never post about trending topics or news.
4. Scout queue: run up to 2 x_search queries for conversations where SF tech / AI-agent people joke about their work (e.g. '"vibe coding" -is:retweet lang:en', '"AI agents" (shipped OR deploy) -is:retweet lang:en'). Pick at most 2 posts where a reply from us would genuinely add a laugh, and draft them with x_post_scout (mode reply or quote, with a one-line why). They go to John's scout queue and he posts the ones he likes by hand (X's API won't let us reply to people who didn't mention us). Never reply to strangers any other way.
End with: RESULT: {"replies":<n>,"posted":"<post id or none>","scout_drafts":<n>,"store_link":true|false}` },
    { key: "support", agent: "support", cron: "*/15 * * * *", budget_micro_usd: 600_000, label: "Support: inbox every 15 min",
      input_template:
`Scheduled inbox run. Call inbox_list. If it is empty, end right away with RESULT: {"handled":0}.
For each message, by its kind:
- customania_confirmation: inbox_mark_handled with its order_number (this logs the order event).
- ready_for_pickup: inbox_mark_handled with its order_number, then ops_courier_request with that order_number and the message_id (Ops quotes a courier; John approves any booking).
- customer: inbox_read it. If it's about money, payments, refunds, chargebacks, a complaint, legal, press, or anything you're unsure about: flag_john (summary: who, what they want, what you replied), then inbox_reply briefly that a human from the team will follow up within a day. Otherwise answer it with inbox_reply in brand voice using only facts you can see (store_link for the store URL); never promise dates, refunds, discounts or exchanges.
  Pre-order questions: preorders_list with their email (the sender's address) and answer from what it shows. A pre-order cancellation request: preorder_cancel with the preorder_session and requester_email = the sender's address, then inbox_reply confirming the card was removed and nothing was charged. If preorder_cancel refuses because something was charged, flag_john (reason refund) and reply that a human will follow up.
- customania_other, automated, self: inbox_mark_handled (no reply). If a customania_other mail sounds like a problem with an order, flag_john first.
Then call preorders_list once: for each entry in payment_links_to_send, preorder_send_payment_link with a short, kind note (their saved card didn't go through at launch; this link keeps their pre-order).
End with: RESULT: {"handled":<n>,"replied":<n>,"flagged":<n>,"courier_requests":<n>,"payment_links_sent":<n>}` },
    { key: "ops-sales", agent: "ops", cron: "40 * * * *", budget_micro_usd: 3_000_000, label: "Ops: batch paid store orders into one Customania order, hourly",
      input_template:
`Scheduled sales run. Call stripe_orders.
Sales in needs_john are products Customania can't make for us (or bad sizes); code already flagged them to John. Never order, guess or substitute for those.
Charged pre-orders show up here as sales too (source "preorder"); only charged ones are ever batched.
If ready_to_batch is false, stop right away and end with RESULT: {"batched":false,"reason":"<its reason>"} (no Customania session, nothing else).
If it is true:
1. sales_batch_start with session_ids = batchable.session_ids (exactly those). Use the sizes and print_spec it returns, exactly.
2. customania_start with base_size = the first size in those sizes.
3. FRONT: customania_upload side "front", design "${d1.front.design}"; customania_place side "front" width_in ${d1.front.width_in} top_in ${d1.front.top_in}. Retry place until within_tolerance is true.
4. BACK: customania_upload side "back", design "${d1.design_id}"; customania_place side "back" width_in ${d1.back.width_in} top_in ${d1.back.top_in}. Retry until within_tolerance.
5. customania_checkout with those sizes, email "${CONTACT.email}", first_name "${CONTACT.first}", last_name "${CONTACT.last}". The cart must match the sizes exactly; if not: sales_batch_abort, customania_close, flag_john, stop.
6. customania_handoff_payment with amount_due = the checkout total. It waits for John's approval; that's expected. Then customania_payment_status again and again until state is "paid" or "timed_out". Don't close while it says waiting.
7. If paid: stripe_mark_batched with the same session_ids, the batch_ref and customania_order = the order number. If not paid: sales_batch_abort with the reason and flag_john.
8. customania_close.
End with: RESULT: {"batched":true|false,"batch_ref":"<or null>","sizes":{...},"total":"<or null>","paid":true|false,"order_number":"<or null>","issues":"<or none>"}` },
  ];
}

// Apply a def's tools on top of an agent's current tool config.
export function applyTools(tools, def, allMcp = ALL_MCP_TOOLS) {
  let t = tools;
  for (const n of DISABLED_BUILTINS) { try { t = withTool(t, n, { enabled: false }); } catch {} }
  for (const n of new Set([...ALL_MCP_TOOLS, ...allMcp])) {
    const p = def.tools[n];
    t = withTool(t, `${MCP}.${n}`, p && p !== "off" ? { enabled: true, permission: p } : { enabled: false, permission: NEVER_AUTO.has(`${MCP}.${n}`) ? "ask" : "allow" });
  }
  return t;
}

// May code confirm a held call? Only if defs say allow, the live agent config says allow and it isn't a human-only tool.
export function autoConfirmable(defsByName, agentName, toolName, liveTools) {
  if (NEVER_AUTO.has(toolName)) return false;
  const def = defsByName[agentName];
  if (!def || !toolName.startsWith(MCP + ".")) return false;
  const short = toolName.slice(MCP.length + 1);
  const live = liveTools?.configs?.[toolName];
  return def.tools[short] === "allow" && live?.enabled !== false && live?.permission === "allow";
}
export const defsByName = (defs) => Object.fromEntries(Object.values(defs).map((d) => [d.name, d]));

// Model: same preference order order_run.mjs has always used (GLM-5.2 is what the account has).
export async function pickModel(v) {
  const models = await v.models.list();
  const chat = (models.data || []).map((m) => m.id).filter((m) => !/:batch$/.test(m));
  return [/claude.*(sonnet|opus)/i, /gpt-5(?!-nano)/i, /GLM-5\.2/i].map((r) => chat.find((m) => r.test(m))).find(Boolean) || chat[0];
}

// Create or update one agent by name (updating keeps its Studio history), then set its tools.
export async function upsertAgent(v, def, { model, mcpUrl, allMcp, log = () => {} }) {
  const list = await v.agents.list({ limit: 100 });
  const same = (list.data || []).filter((a) => a.name === def.name);
  const cfg = { name: def.name, model, window: "immediate", system: def.system, ...(mcpUrl ? { mcp_servers: [{ name: MCP, url: mcpUrl }] } : {}),
    budget: { cap_micro_usd: 20_000_000, max_task_micro_usd: 10_000_000, period: "month" } };
  let a = same[0] ? await v.agents.update(same[0].id, cfg).catch((e) => { log(`update ${def.name} failed (${e.message}); creating`); return null; }) : null;
  if (!a) a = await v.agents.create(cfg);
  a = await v.agents.update(a.id, { tools: applyTools(a.tools, def, allMcp) });
  return a;
}

// agent -> tool -> permission, for the setup printout.
export function toolTable(defs) {
  const rows = [];
  for (const d of Object.values(defs)) for (const [n, p] of Object.entries(d.tools)) rows.push({ agent: d.name, tool: `${MCP}.${n}`, permission: p, human_only: NEVER_AUTO.has(`${MCP}.${n}`) });
  return rows;
}
