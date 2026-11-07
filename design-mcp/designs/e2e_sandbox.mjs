process.on("unhandledRejection", (e) => { console.error(e); });
// Sandbox end-to-end of the design loop, isolated from John's live agents:
//   own MCP server + tunnel + vault ("halltest-mcp"), Stripe SANDBOX only, throwaway agents halltest-product / halltest-ceo
//   built from the same defs (Product + CEO tools only; nothing that posts). serve.mjs only manages hallucinated-*, so it
//   never repoints or clears these. Runs Product's scheduled design prompt once, follows the CEO session(s) it starts,
//   prints proposals, CEO reasoning, created sandbox product IDs and costs, then deletes the agents and the vault.
//   node designs/e2e_sandbox.mjs [--keep]      (refuses if STRIPE_LIVE_OK=1)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Tunnel, bin, install } from "cloudflared";
import { createClient } from "@usenaive-sdk/vetta";
import { startServer } from "../server.mjs";
import { agentDefs, scheduleDefs, defsByName, upsertAgent, pickModel, autoConfirmable } from "../agents/defs.mjs";
import { runSession, sleep, short } from "../agents/runtime.mjs";
import { BILLING } from "../agents/config.mjs";
import { envKey } from "../lib/state.mjs";
import { stripeClient } from "../stripe/tools.mjs";
import { loadProposals } from "./ledger.mjs";

if (process.env.STRIPE_LIVE_OK === "1") { console.error("refused: run the sandbox e2e WITHOUT STRIPE_LIVE_OK"); process.exit(1); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, ".."), ROOT = path.resolve(MCP_DIR, "..");
const sc = stripeClient(ROOT);
if (sc.error || sc.mode !== "test") { console.error("refused: the Stripe key in use is not the sandbox (" + (sc.error || sc.mode) + ")"); process.exit(1); }
Object.assign(process.env, { DESIGN_PRODUCT_AGENT: "halltest-product", DESIGN_CEO_AGENT: "halltest-ceo", X_DRY_RUN: "1", MAIL_DRY_RUN: "1" });
const KEEP = process.argv.includes("--keep");
const RUN = path.join(ROOT, "order-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "_design-e2e");
fs.mkdirSync(RUN, { recursive: true });
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(RUN, "run.log"), l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const record = { mode: "design-e2e (sandbox)", started: new Date().toISOString(), sessions: [] };
const save = () => fs.writeFileSync(path.join(RUN, "record.json"), JSON.stringify(record, null, 2));
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });

// ---- own server + tunnel + vault (never touches serve's "hallucinated-mcp" vault)
const token = crypto.randomBytes(16).toString("hex");
const ctx = { openaiKey: envKey(ROOT, "OPENAI_API_KEY"), vettaKey: envKey(ROOT, "VETTA_API_KEY"), outDir: path.join(ROOT, "design-test"),
  runsDir: path.join(ROOT, "customania-runs"), rootDir: ROOT, mcpDir: MCP_DIR, log, billing: BILLING };
const server = await startServer({ port: 0, token, ctx });
if (!fs.existsSync(bin)) await install(bin);
const tunnel = Tunnel.quick(`http://localhost:${server.address().port}`);
const url = await new Promise((res, rej) => { tunnel.once("url", res); tunnel.once("error", rej); setTimeout(() => rej(new Error("tunnel timeout")), 60000); });
await new Promise((res) => { tunnel.once("connected", res); setTimeout(res, 15000); });
ctx.baseUrl = url;
for (const o of ((await v.vaults.list().catch(() => ({ data: [] }))).data || []).filter((x) => x.display_name === "halltest-mcp")) await v.vaults.delete(o.id).catch(() => {});
const vault = await v.vaults.create({ display_name: "halltest-mcp" });
await v.vaults.credentials.create(vault.id, { kind: "static_bearer", key: "hallucinated_mcp_token", value: token, mcp_server_url: url + "/mcp" });
await sleep(3000);
log(`== design e2e (sandbox, ${sc.mode}): test tools at ${url}`);

// ---- throwaway agents from the real defs (Product + CEO tools only)
const real = agentDefs({});
const defs = { product: { ...real.product, name: "halltest-product" }, ceo: { ...real.ceo, name: "halltest-ceo" } };
const byName = defsByName(defs);
const model = await pickModel(v);
const agents = {};
for (const k of ["product", "ceo"]) {
  agents[k] = await upsertAgent(v, defs[k], { model, mcpUrl: url + "/mcp", log });
  const on = Object.entries(agents[k].tools.configs).filter(([n, c]) => n.startsWith("hallucinated.") && c.enabled !== false).map(([n, c]) => `${n.slice(13)}:${c.permission}`);
  log(`agent ${agents[k].name} ${agents[k].id}: ${on.join(" ")}`);
}

// ---- hold clearing for the CEO sessions propose_design starts (serve ignores halltest-*)
const ids = new Set(Object.values(agents).map((a) => a.id));
const confirmed = new Map();
const clearer = setInterval(async () => {
  const held = ((await v.sessions.list({ stop_reason: "awaiting_approval", limit: 50 }).catch(() => ({ data: [] }))).data || []).filter((s) => ids.has(s.agent_id));
  for (const s of held) {
    const agent = Object.values(agents).find((a) => a.id === s.agent_id);
    for (const a of (s.pending_actions || []).filter((x) => x.kind !== "question")) {
      const k = `${s.id}:${a.tool_call_id}`;
      if (!autoConfirmable(byName, agent.name, a.name, agent.tools) || Date.now() - (confirmed.get(k) || 0) < 15_000) continue;
      confirmed.set(k, Date.now());
      await v.sessions.confirmTool(s.id, { tool_call_id: a.tool_call_id, decision: "allow", scope: "session", reason: "pre-approved tool (test agent config: allow)" })
        .then(() => log(`  [holds] allowed ${a.name} for ${agent.name} ${s.id}`)).catch(() => {});
    }
  }
}, 8000);

// ---- Product runs its scheduled prompt once
const t0 = new Date().toISOString();
const productPrompt = scheduleDefs().find((s) => s.key === "product").input_template;
let result = null;
try {
  result = await runSession(v, { label: "product", agent: agents.product, message: productPrompt, budget: 2_500_000, byName, log, maxMin: 35,
    onRecord: (x) => { record.sessions.push(x); save(); } });
  Object.assign(record.sessions.at(-1), { status: result.status, result: result.result });
} catch (e) { log("product run failed: " + e.message); }

// ---- follow every CEO session the run started
const mine = () => Object.values(loadProposals(ROOT).proposals).filter((p) => p.mode === "test" && p.proposed_at >= t0);
for (const p of mine()) {
  if (!p.ceo_session) continue;
  log(`[ceo] following ${p.ceo_session} for ${p.proposal_id} (${p.slug})`);
  let after, last = "", idleSince = 0;
  for (const end = Date.now() + 12 * 60_000; Date.now() < end;) {
    await sleep(5000);
    const ev = await v.sessions.events(p.ceo_session, { limit: 100, ...(after !== undefined ? { after_seq: after } : {}) }).catch(() => null);
    for (const e of ev?.data || []) {
      after = e.seq;
      if (e.type === "tool.started") log(`  [ceo] → ${e.data?.name} ${short(e.data?.args, 400)}`);
      else if (e.type === "tool.completed") log(`  [ceo] ← ${e.data?.name}${e.data?.is_error ? " ERROR" : ""} ${short(e.data?.output, 400)}`);
      else if (e.type === "message.completed" && e.data?.role === "assistant") { last = String(e.data.content); log(`  [ceo] says: ${short(last, 1500)}`); }
    }
    const st = await v.sessions.get(p.ceo_session).catch(() => ({}));
    const decided = loadProposals(ROOT).proposals[p.proposal_id]?.state !== "pending";
    const done = ["idle", "completed", "failed", "cancelled"].includes(st.status) && st.stop_reason !== "awaiting_approval";
    idleSince = done ? idleSince || Date.now() : 0;
    if (done && (decided || Date.now() - idleSince > 45_000)) break;   // decided, or ended its turn without deciding
  }
  record.sessions.push({ label: "ceo", agent: "halltest-ceo", session: p.ceo_session, last_message: last });
}
clearInterval(clearer);

// ---- report: proposals, CEO reasoning, sandbox products, cost
const props = mine();
let consumed = 0;
for (const s of record.sessions) { const st = await v.sessions.get(s.session).catch(() => null); s.consumed_usd = st ? st.consumed_micro_usd / 1e6 : null; consumed += s.consumed_usd || 0; }
const pev = []; for (let after; ;) { const ev = await v.sessions.events(record.sessions[0]?.session, { limit: 100, ...(after !== undefined ? { after_seq: after } : {}) }).catch(() => null); if (!ev?.data?.length) break; pev.push(...ev.data); after = ev.data.at(-1).seq; if (ev.data.length < 100) break; }
const gens = pev.filter((e) => e.type === "tool.started" && /generate_design$/.test(e.data?.name || "")).length;
const trendsCalls = pev.filter((e) => e.type === "tool.started" && /\.trends$/.test(e.data?.name || "")).length;
record.summary = { proposals: props.map((p) => ({ proposal_id: p.proposal_id, slug: p.slug, title: p.title, design_id: p.design_id, state: p.state, pitch: p.pitch, trend_summary: p.trend_summary, sources: p.sources,
  ceo_decision: p.decision, publish: p.publish || null, publish_error: p.publish_error || null })), generate_design_calls: gens, trends_calls: trendsCalls, naive_sessions_usd: Number(consumed.toFixed(3)) };
save();
log(`SUMMARY ${JSON.stringify(record.summary, null, 1)}`);

// ---- clean up: agents, vault, tunnel, server
if (!KEEP) {
  for (const a of Object.values(agents)) await v.agents.delete(a.id).then(() => log(`deleted agent ${a.name}`)).catch((e) => log(`delete ${a.name}: ${e.message}`));
  await v.vaults.delete(vault.id).then(() => log("deleted vault halltest-mcp")).catch((e) => log("vault delete: " + e.message));
}
try { tunnel.stop(); } catch {} server.close();
log(`record: order-runs/${path.basename(RUN)}/record.json`);
log("== design e2e done");
process.exit(0);
