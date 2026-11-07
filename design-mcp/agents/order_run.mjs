process.on("unhandledRejection", (e) => { console.error(e); });
// Drop #1, end to end in Naïve: Product designs the back graphic -> CEO approves -> Ops places the Customania order(s).
// Every step is a Naïve session (the record). Our MCP server (design + Customania tools) runs here, reached through a tunnel.
//
//   node agents/order_run.mjs --dry            # everything, but Ops fills the test card and STOPS before Pay
//   node agents/order_run.mjs --live           # real: Ops issues a card per order (you approve in Studio) and pays
//   node agents/order_run.mjs --dry --design <id>   # skip Product+CEO, reuse an approved design
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Tunnel, bin, install } from "cloudflared";
import { createClient, withTool } from "@usenaive-sdk/vetta";
import { startServer } from "../server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, ".."), ROOT = path.resolve(MCP, "..");
const LIVE = process.argv.includes("--live");
const argDesign = (process.argv.indexOf("--design") > -1) ? process.argv[process.argv.indexOf("--design") + 1] : null;
const RUN = path.join(ROOT, "order-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (process.argv.includes("--human-pay") ? "_humanpay" : LIVE ? "_live" : "_dry"));
fs.mkdirSync(RUN, { recursive: true });
const LOG = path.join(RUN, "run.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const short = (o, n = 500) => (typeof o === "string" ? o : JSON.stringify(o))?.replace(/\s+/g, " ").slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const key = (n) => (env.match(new RegExp(`${n}\\s*=\\s*["']?([^\\s"']+)`)) || [])[1];
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: key("VETTA_API_KEY") });

// ---- order spec (edit here) ----
// Budget ~$300 of Naïve card credit. One card holds at most $150, so: 2 orders x 3 shirts (~$140-150 each incl. tax).
// Price is by quantity + print locations (front+back: 1=$94, 2-3=$141, then $47 each; +8.625% SF tax), not print size.
let SIZES = { S: 1, M: 1, L: 1, XL: 1 };   // 4 shirts: $188 + tax = $204.21 (front+back)
const sizesArg = process.argv.indexOf("--sizes") > -1 ? process.argv[process.argv.indexOf("--sizes") + 1] : null;   // e.g. M:1,L:2
if (sizesArg) SIZES = Object.fromEntries(sizesArg.split(",").map((p) => p.split(":")).map(([k, n]) => [k, Number(n)]));
// Card mode: a Naïve card holds $150, so split orders. Human-pay mode: one order (volume price is lower).
const MAX_PER_ORDER = Number(process.env.MAX_PER_ORDER || (process.argv.includes("--human-pay") ? 99 : 3));
const CARD_MAX_USD = Number(process.env.CARD_MAX_USD || 150);   // Naïve prepaid card ceiling (asking Naïve to raise it)
const ONE = process.argv.includes("--one");                       // only the first order (payment test)
const APPROVE_CARDS = process.argv.includes("--approve-cards");
const HUMAN_PAY = process.argv.includes("--human-pay");             // a person pays in the open checkout (Naïve card issuing unavailable)
import { CONTACT, BILLING } from "./config.mjs";   // agent inbox gets the confirmations; John is the pickup name + billing
const FRONT = { design: "logo.png", width_in: 10, top_in: 1.5 };
const BACK = { width_in: 11, top_in: 1 };
const records = { mode: process.argv.includes("--human-pay") ? "human-pay" : LIVE ? "live" : "dry", started: new Date().toISOString(), sessions: [] };
const saveRecords = () => fs.writeFileSync(path.join(RUN, "record.json"), JSON.stringify(records, null, 2));

log(`== drop #1 order run (${HUMAN_PAY ? "HUMAN PAY: agents do everything, you enter the card and press Pay" : LIVE ? "LIVE: real cards, real payment after your approvals" : "DRY: stops before Pay"})`);
// A fresh Naïve project (new API key) has no identity yet: create it. Connecting X is separate (connect_x.command).
let identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
if (!identity) { identity = await v.identities.create({ name: "Hallucinated", description: "Agent-run streetwear brand" }); log(`created identity ${identity.id} (new project)`); }
const models = await v.models.list();
const chat = (models.data || []).map((m) => m.id).filter((m) => !/:batch$/.test(m));
const LLM = [/claude.*(sonnet|opus)/i, /gpt-5(?!-nano)/i, /GLM-5\.2/i].map((r) => chat.find((m) => r.test(m))).find(Boolean) || chat[0];
log(`identity ${identity.id}, model ${LLM}`);

// ---- MCP server + public tunnel + vault credential ----
// If serve.command is running, use its always-on server (no second server, tunnel or vault). Otherwise start our own.
let PORT = 0; const token = crypto.randomBytes(16).toString("hex");   // 0 = any free port, so a leftover run can never block this one
const ctx = { openaiKey: key("OPENAI_API_KEY"), vettaKey: key("VETTA_API_KEY"), identityId: identity.id, outDir: path.join(ROOT, "design-test"),
  runsDir: path.join(ROOT, "customania-runs"), rootDir: ROOT, mcpDir: MCP, baseUrl: `http://localhost:${PORT}`, log,
  billing: BILLING, cardName: `${BILLING.first} ${BILLING.last}` };
let server = null, tunnel = null, publicUrl = null;
try {
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, ".serve.json"), "utf8"));
  process.kill(st.pid, 0);   // throws if serve isn't running
  if (await fetch(st.url + "/health", { signal: AbortSignal.timeout(10000) }).then((r) => r.ok)) { publicUrl = st.url; log(`using serve.command's tools at ${publicUrl}`); }
} catch {}
if (!publicUrl) {
  server = await startServer({ port: PORT, token, ctx });
  PORT = server.address().port; ctx.baseUrl = `http://localhost:${PORT}`;
  log(`MCP server on port ${PORT}`);
  if (!fs.existsSync(bin)) await install(bin);
  tunnel = Tunnel.quick(`http://localhost:${PORT}`);
  publicUrl = await new Promise((res, rej) => { tunnel.once("url", res); tunnel.once("error", rej); setTimeout(() => rej(new Error("tunnel timeout")), 60000); });
  await new Promise((res) => { tunnel.once("connected", res); setTimeout(res, 15000); });
  ctx.baseUrl = publicUrl;
  log("MCP public URL " + publicUrl);
  const vl = await v.vaults.list().catch(() => ({ data: [] }));
  for (const o of (vl.data || []).filter((x) => x.display_name === "hallucinated-mcp")) await v.vaults.delete(o.id).catch(() => {});
  const vault = await v.vaults.create({ display_name: "hallucinated-mcp" });
  await v.vaults.credentials.create(vault.id, { kind: "static_bearer", key: "hallucinated_mcp_token", value: token, mcp_server_url: publicUrl + "/mcp" });
  await sleep(3000);
}

// ---- agents (create or update by name) ----
const BRAND = fs.readFileSync(path.join(MCP, "brand.json"), "utf8");
async function upsertAgent(name, system, tune) {
  // Update the agent in place if it exists, so every earlier run's chats stay visible in Naïve Studio
  // (deleting and recreating would orphan them). Only the tunnel URL, prompt and tools change per run.
  const list = await v.agents.list({ limit: 100 });
  const same = (list.data || []).filter((a) => a.name === name);
  const cfg = { name, model: LLM, window: "immediate", system, mcp_servers: [{ name: "hallucinated", url: publicUrl + "/mcp" }],
    budget: { cap_micro_usd: 20_000_000, max_task_micro_usd: 10_000_000, period: "month" } };
  let a = same[0] ? await v.agents.update(same[0].id, cfg).catch(() => null) : null;
  if (!a) a = await v.agents.create(cfg);
  let t = a.tools;
  // GLM-5.2 is text-only: any tool that returns an image (view_image, browser screenshots) crashes the session.
  for (const n of ["view_image", "generate_image", "generate_video", "social.post", "browser", "web_fetch"]) t = withTool(t, n, { enabled: false });
  t = tune(t);
  a = await v.agents.update(a.id, { tools: t });
  const money = Object.entries(a.tools?.configs || {}).filter(([k]) => /^(card|wallet)\./.test(k)).map(([k, c]) => `${k}:${c.enabled ? c.permission : "off"}`);
  log(`agent ${name} ${a.id}${money.length ? "  money tools: " + money.join(", ") : ""}`);
  return a;
}
const VOICE = "Hallucinated: an agent-run streetwear brand from SF tech culture. Clean product (minimal, natural palette), unhinged marketing. Brand rules: " + BRAND;
const product = await upsertAgent("hallucinated-product",
  VOICE + "\nYou are Product. You turn what's dominating AI and SF tech right now into shirt graphics. You make print files with the hallucinated generate_design tool; you can't see images, the tool checks each result and returns pass/fail with issues, and you fix the prompt until it passes.",
  (t) => withTool(t, "hallucinated.generate_design", { enabled: true, permission: "allow" }));
const ceo = await upsertAgent("hallucinated-ceo",
  VOICE + "\nYou are the CEO. You approve or reject what ships, decisively, with a one-line reason. You also own the brand's X account.",
  (t) => withTool(t, "social.post", { enabled: true, permission: "allow" }));
try { await v.identities.attach(ceo.id, identity.id); } catch (e) { log("identities.attach ceo: " + e.message); }
const ops = await upsertAgent("hallucinated-ops",
  VOICE + "\nYou are Ops. You place print orders on Customania with the hallucinated customania_* tools and pay with Naïve prepaid cards. You never guess: you read every tool result, retry placement until within_tolerance is true, check the cart lines match the order exactly, and never pay more than the checkout total.",
  (t) => {
    for (const n of ["customania_start", "customania_upload", "customania_place", "customania_checkout", "customania_pay", "customania_payment_status", "customania_close"]) t = withTool(t, `hallucinated.${n}`, { enabled: true, permission: "allow" });
    // Handing payment to a human goes through a Naïve approval card: that card in Studio is the "you're needed" notification.
    t = withTool(t, "hallucinated.customania_handoff_payment", { enabled: true, permission: "ask" });
    // Courier on John's phone (MobileRun + Uber): quotes and status freely, booking only with his OK in Studio.
    t = withTool(t, "hallucinated.courier_quote", { enabled: true, permission: "allow" });
    t = withTool(t, "hallucinated.courier_status", { enabled: true, permission: "allow" });
    t = withTool(t, "hallucinated.courier_book", { enabled: true, permission: "ask" });
    // Cards are issued through our own tool (Naïve's built-in card.issue isn't offered to this agent); a human approves each one.
    t = withTool(t, "hallucinated.issue_card", { enabled: LIVE, permission: "ask" });
    return t;
  });
try { await v.identities.attach(ops.id, identity.id); log("ops holds the Hallucinated identity"); } catch (e) { log("identities.attach ops: " + e.message); }

// ---- run one agent session to completion, logging and recording it ----
async function run(label, agent, message, budget = 3_000_000) {
  const s = await v.sessions.create({ agent_id: agent.id, identity: label === "ops" ? identity.id : undefined, message, budget_micro_usd: budget });
  records.sessions.push({ label, agent: agent.name, session: s.id, started: new Date().toISOString() }); saveRecords();
  log(`[${label}] session ${s.id}`);
  let after, status = "", last = "";
  const approved = new Map(), waiting = new Set();
  const end = Date.now() + 25 * 60_000;
  const poll = async () => { while (Date.now() < end) {
    await sleep(5000);
    const ev = await v.sessions.events(s.id, { limit: 100, ...(after !== undefined ? { after_seq: after } : {}) }).catch(() => null);
    for (const e of ev?.data || []) {
      after = e.seq;
      if (e.type === "tool.started") log(`  [${label}] → ${e.data?.name} ${short(e.data?.args, 300)}`);
      else if (e.type === "tool.completed") log(`  [${label}] ← ${e.data?.name}${e.data?.is_error ? " ERROR" : ""} ${short(e.data?.output, 400)}`);
      else if (e.type === "message.completed" && e.data?.role === "assistant") { last = String(e.data.content); log(`  [${label}] says: ${short(last, 1200)}`); }
      else if (/^tool\.confirm/.test(e.type)) log(`  [${label}] ${e.type} ${short(e.data, 200)}`);
    }
    const st = await v.sessions.get(s.id).catch(() => ({}));
    if (st.status !== status) { status = st.status; log(`[${label}] status ${status}${st.stop_reason ? " (" + st.stop_reason + ")" : ""}`); }
    const pend = (st.pending_actions || []).filter((a) => a.kind !== "question");
    if (pend.length) {
      // Naïve holds some calls for approval even when the tool is set to "allow" (seen: the 2nd generate_design).
      // Our own MCP tools were already approved by config, so the orchestrator clears those holds and logs it.
      // Anything else (card.issue, payments) is left for a human in Naïve Studio.
      for (const a of pend) {
        // Naïve can re-hold a retried call under the same tool_call_id, so re-confirm anything still pending after 15s.
        const seen = approved.get(a.tool_call_id);
        if (seen && Date.now() - seen < 15000) continue;
        if (/^hallucinated\./.test(a.name) && !["hallucinated.issue_card", "hallucinated.customania_handoff_payment", "hallucinated.courier_book", "hallucinated.x_ads_activate"].includes(a.name)) {
          await v.sessions.confirmTool(s.id, { tool_call_id: a.tool_call_id, decision: "allow", scope: "session", reason: "pre-approved tool (agent config: allow)" })
            .then(() => log(`  [${label}] orchestrator allowed held ${a.name} for this session (pre-approved tool)`))
            .catch((e) => log(`  [${label}] confirmTool ${a.name} failed: ${e.message}`));
          approved.set(a.tool_call_id, Date.now());
        } else if (APPROVE_CARDS && a.name === "hallucinated.issue_card" && Number(a.args?.amount_usd || 0) <= CARD_MAX_USD) {
          await v.sessions.confirmTool(s.id, { tool_call_id: a.tool_call_id, decision: "allow", reason: "John approved card issuance for this payment test (chat, 2026-11-06 23:21 PT)" })
            .then(() => log(`  [${label}] issue_card approved (John's approval for this run) ${short(a.args, 200)}`))
            .catch((e) => log(`  [${label}] confirmTool card.issue failed: ${e.message}`));
          approved.set(a.tool_call_id, Date.now());
        } else if (!waiting.has(a.tool_call_id)) {
          waiting.add(a.tool_call_id);
          log(`  [${label}] WAITING FOR YOU: approve or deny ${a.name} in Naïve Studio (session ${s.id}) ${short(a.args, 200)}`);
          try { execFile("osascript", ["-e", `display notification ${JSON.stringify(`${label} needs your OK in Naïve Studio: ${a.name.replace(/^hallucinated\./, "")}`)} with title "Hallucinated" sound name "Glass"`]); } catch {}
        }
      }
      continue;
    }
    if (["idle", "failed", "cancelled"].includes(status)) break;
  } };
  await poll();
  for (let nudges = 1; nudges <= 2 && !/RESULT:/.test(last) && status === "idle"; nudges++) {
    log(`  [${label}] turn ended without a RESULT; nudging it to continue (${nudges}/2)`);
    await v.sessions.send(s.id, { message: "Continue the task from where you stopped, then end with the RESULT line." }).catch((e) => log("send failed: " + e.message));
    await sleep(8000); status = "";
    await poll();
  }
  const m = last.match(/RESULT:\s*(\{[\s\S]*\})/);
  let result = null; try { result = m ? JSON.parse(m[1]) : null; } catch {}
  Object.assign(records.sessions.at(-1), { status, result, ended: new Date().toISOString() }); saveRecords();
  return { status, result, text: last };
}

let designId = argDesign;
try {
  let concept = null, words = null;
  if (!designId) {
    // 1. Product designs the back
    const p = await run("product", product,
`Drop #1 for Hallucinated: design the BACK graphic of our black tee. The front is fixed (the Hallucinated wordmark across the chest).
The founder already picked the concept for this first drop; execute it well:
- A terminal prompt line reading exactly "> git reset --hard" at the top, in monospace.
- Below it, a minimal line-art map of a made-up San Francisco neighborhood: a few streets on the grid, one diagonal like Market, a bit of coastline/bay edge, a tiny pin. Thin, even strokes. No real street names, no labels besides the prompt line.
- Bone #F2EEE6 lines and type on black, eucalyptus #8A9A80 for one accent (the pin or the cursor). Flat screen-print, no gradients.
Call hallucinated generate_design with placement "back", text "> git reset --hard", references ["git-reset-back"] (our house style for exactly this idea). Loop on the verdict until it passes (max 5 attempts), fixing exactly the issues it lists.
Think out loud for the record: before the first call, say in 2-3 sentences how you'll execute the concept and why it lands with SF tech people; after each failed attempt, say what you're changing and why.
End your final message with a line exactly like: RESULT: {"design_id":"<id of the passing design>","concept":"<one line>","text":"<the words on it>"}`);
    const vf = p.result?.design_id && path.join(ctx.outDir, `${path.basename(String(p.result.design_id))}.json`);
    if (!vf || !fs.existsSync(vf)) throw new Error("Product did not return a passing design");
    designId = path.basename(String(p.result.design_id));
    concept = p.result.concept; words = p.result.text;
  }
  if (!process.argv.includes("--skip-ceo")) {
    const verdict = JSON.parse(fs.readFileSync(path.join(ctx.outDir, `${designId}.json`), "utf8"));
    if (!verdict.pass) throw new Error(`design ${designId} did not pass the design tool`);
    concept ||= verdict.notes; words ||= verdict.text_seen;
    // 2. CEO approves
    const c = await run("ceo", ceo,
`Product's design for drop #1's back print is ready. You decide if it ships to the printer.
Concept: ${concept}
Text on the shirt: ${words}
Design tool verdict: ${verdict.pass ? "PASS" : "FAIL"} (checked on a black-tee preview by ${verdict.vision_model}); notes: ${verdict.notes || "-"}; issues: ${(verdict.issues || []).join("; ") || "none"}
(You can't view images; the design tool's vision check is your eyes.)
Judge it against the brand rules (clean product, the joke lands for SF tech people, no real people/companies/logos, nothing mean). Approve or reject.
Explain your call for the record in 3-4 sentences: what works, what the risk is, and why it's worth (or not worth) printing as our first drop.
End with exactly: RESULT: {"approve": true|false, "reason":"<one line>"}`, 1_000_000);
    if (!c.result?.approve) throw new Error("CEO rejected: " + (c.result?.reason || c.text.slice(0, 200)));
    log(`CEO approved design ${designId}: ${c.result.reason}`);
  }
  records.design_id = designId; saveRecords();

  // 3. Ops places the order(s), split so each fits one card
  const lines = Object.entries(SIZES).flatMap(([s, q]) => Array(q).fill(s));
  const orders = [];
  for (let i = 0; i < lines.length; i += MAX_PER_ORDER) orders.push(lines.slice(i, i + MAX_PER_ORDER).reduce((o, s) => ((o[s] = (o[s] || 0) + 1), o), {}));
  log(`orders: ${JSON.stringify(orders)}`);
  const testCard = fs.existsSync(path.join(ROOT, "customania-runs", "test-card.txt")) ? fs.readFileSync(path.join(ROOT, "customania-runs", "test-card.txt"), "utf8").trim() : null;
  records.orders = [];
  for (const [i, sizes] of orders.entries()) {
    const payStep = HUMAN_PAY
      ? `5. Payment is done by a human for now: call customania_handoff_payment with the order_session and amount_due = the checkout total (e.g. "$204.21"). It needs the person's OK; that's expected. Then call customania_payment_status again and again (each call waits up to a minute) until state is "paid" or "timed_out". Don't close the order session while it says "waiting". Report paid + order number, or the timeout. Then customania_close.`
      : LIVE
      ? `5. Issue a Naïve prepaid card with the hallucinated issue_card tool: label "drop1 order ${i + 1}", amount_usd = the checkout total rounded UP to the next whole dollar. If the total is over $${CARD_MAX_USD}, do NOT issue a card: stop and report. Issuing waits for a human approval; that's expected. If it fails (e.g. not enough credit), stop, close the order session and report the exact error. Don't look for other card or wallet tools.
6. customania_pay with that card's id and confirm=true. If it says the card is not active yet, wait ~20 seconds and call it again (up to 6 times). Read the result: paid + order number, or the exact error.`
      : `5. DRY RUN: do not issue any card. ${testCard ? `Call customania_pay with card_id "${testCard}" and confirm=false (fills the card, stops before Pay).` : "Skip payment."}`;
    const o = await run("ops", ops,
`Place order ${i + 1} of ${orders.length} for drop #1 on Customania (black Men's Premium Tee).
1. customania_start with base_size "${Object.keys(sizes)[0]}".
2. FRONT: customania_upload side "front", design "${FRONT.design}"; customania_place side "front" width_in ${FRONT.width_in} top_in ${FRONT.top_in}. Retry place until within_tolerance is true.
3. BACK: customania_upload side "back", design "${designId}"; customania_place side "back" width_in ${BACK.width_in} top_in ${BACK.top_in}. Retry until within_tolerance.
4. customania_checkout with sizes ${JSON.stringify(sizes)}, email "${CONTACT.email}", first_name "${CONTACT.first}", last_name "${CONTACT.last}". Check the cart lines are exactly ${JSON.stringify(sizes)} in Black; if not, stop and report.
${payStep}
7. customania_close.
End with exactly: RESULT: {"order":${i + 1},"sizes":${JSON.stringify(sizes)},"total":"<checkout total>","card_id":"<id or null>","paid":true|false,"order_number":"<or null>","issues":"<or none>"}`, 3_000_000);
    records.orders.push(o.result || { order: i + 1, error: o.text.slice(0, 300) }); saveRecords();
    if (!LIVE && !HUMAN_PAY) { log("dry run: one order is enough to prove the flow"); break; }
    if (ONE) { log("--one: stopping after the first order"); break; }
    if (!o.result?.paid) { log("order not paid; not starting the next one"); break; }
  }
} catch (e) {
  log("STOPPED: " + e.message);
  records.error = e.message; saveRecords();
}
log(`record: order-runs/${path.basename(RUN)}/record.json  (Naïve sessions: ${records.sessions.map((s) => s.session).join(", ")})`);
if (tunnel) tunnel.stop(); if (server) server.close();
log("== order run done");
process.exit(0);
