process.on('unhandledRejection', e => { console.error(e); });
// Design tool test, 3 stages:
//  1) direct: one generate_design call against OpenAI (proves key, transparency, vision check)
//  2) MCP over a public quick tunnel (proves Naïve can reach it)
//  3) a Naïve designer agent runs the generate -> check -> retry loop using the MCP tool
// Reads OPENAI_API_KEY + VETTA_API_KEY from ../.env (never printed). Output: ../design-test/, log: ../naive.log
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Tunnel, bin, install } from "cloudflared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient, withTool } from "@usenaive-sdk/vetta";
import { startServer } from "./server.mjs";
import { generateDesign } from "./generate.mjs";

const ROOT = path.resolve(process.cwd(), "..");
const LOG = path.join(ROOT, "naive.log");
const OUT = path.join(ROOT, "design-test");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const short = (o, n = 500) => JSON.stringify(o)?.slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const key = (name) => (env.match(new RegExp(`${name}\\s*=\\s*["']?([^\\s"']+)`)) || [])[1];
const openaiKey = key("OPENAI_API_KEY"), vettaKey = key("VETTA_API_KEY");
if (!openaiKey || !vettaKey) { log("Missing OPENAI_API_KEY or VETTA_API_KEY in .env"); process.exit(1); }

log("== design tool test");
const PORT = 8787;
const token = crypto.randomBytes(16).toString("hex");
const ctx = { openaiKey, outDir: OUT, baseUrl: `http://localhost:${PORT}`, log };
const server = await startServer({ port: PORT, token, ctx });
log(`server on :${PORT}`);

const TEST = {
  prompt: "A minimal line-art map of a made-up San Francisco neighborhood: street grid, a few hills as contour lines, the bay edge. Bone lines, eucalyptus accents.",
  text: "> git reset --hard", references: ["git-reset-back"],
  placement: "back",
};

// Stage 1: direct (passed Fri 20:55; rerun with --direct)
if (process.argv.includes("--direct")) try {
  const r = await generateDesign(TEST, ctx);
  log("STAGE 1 direct: " + short(r, 800));
} catch (e) { log("STAGE 1 direct FAILED: " + e.message); server.close(); process.exit(1); }

// Stage 2: public tunnel + MCP client
if (!fs.existsSync(bin)) { log("installing cloudflared…"); await install(bin); }
const tunnel = Tunnel.quick(`http://localhost:${PORT}`);
const publicUrl = await new Promise((res, rej) => { tunnel.once("url", res); tunnel.once("error", rej); setTimeout(() => rej(new Error("tunnel timeout")), 60000); });
await new Promise((res) => { tunnel.once("connected", res); setTimeout(res, 15000); });
ctx.baseUrl = publicUrl; // file links handed to agents must be public
log("public URL: " + publicUrl);
await sleep(3000);
try {
  const t = new StreamableHTTPClientTransport(new URL(publicUrl + "/mcp"), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const c = new Client({ name: "hallucinated-test", version: "1" });
  await c.connect(t);
  log("STAGE 2 MCP over tunnel, tools: " + (await c.listTools()).tools.map((x) => x.name).join(", "));
  await c.close();
} catch (e) { log("STAGE 2 FAILED: " + e.message); }

// Stage 3: Naïve designer agent loops on the MCP tool
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: vettaKey });
const models = await v.models.list().catch(() => ({ data: [] }));
const chat = (models.data || []).map((m) => m.id).filter((m) => !/:batch$/.test(m));
const llm = [/claude.*(sonnet|opus)/i, /gpt-5(?!-nano)/i, /GLM-5\.2/i].map((r) => chat.find((m) => r.test(m))).find(Boolean) || chat[0];
const prev = await v.agents.list({ limit: 50 }).catch(() => ({ data: [] }));
for (const a of (prev.data || []).filter((a) => a.name === "hallucinated-designer")) await v.agents.delete(a.id).catch(() => {});
let agent;
try {
  const vlist = await v.vaults.list().catch(() => ({ data: [] }));
  for (const old of (vlist.data || []).filter((x) => x.display_name === "hallucinated-mcp")) await v.vaults.delete(old.id).catch(() => {});
  const vault = await v.vaults.create({ display_name: "hallucinated-mcp" });
  const cred = await v.vaults.credentials.create(vault.id, { kind: "static_bearer", key: "hallucinated_mcp_token", value: token, mcp_server_url: publicUrl + "/mcp" });
  log(`vault ${vault.id} credential ${cred.id} bound to ${publicUrl}/mcp`);
  agent = await v.agents.create({
    name: "hallucinated-designer", model: llm, window: "immediate",
    system: "You are the designer at Hallucinated, an agent-run streetwear brand built on SF tech humor. Clean, Supreme-like minimalism; natural palette (black, bone, eucalyptus, forest, rust, sand); dry deadpan insider jokes. Never use real people, real companies or other brands' logos. You make t-shirt graphics with the hallucinated generate_design tool: you describe the design and pass the exact words in `text`; the tool attaches our logo and style references and checks the spelling. You can't see images yourself: the tool checks every result and tells you pass/fail with specific issues. When it fails, rewrite your prompt to fix exactly those issues and call it again.",
    mcp_servers: [{ name: "hallucinated", url: publicUrl + "/mcp" }],
    budget: { cap_micro_usd: 3_000_000, max_task_micro_usd: 1_000_000, period: "month" },
  });
  log(`agent ${agent.id} model=${llm}`);

  const toolNames = Object.keys(agent.tools?.configs || {});
  log("agent tool configs: " + toolNames.join(", "));
  let tools = agent.tools;
  tools = withTool(tools, "hallucinated.generate_design", { enabled: true, permission: "allow" });
  tools = withTool(tools, "generate_image", { enabled: false });
  tools = withTool(tools, "view_image", { enabled: false });
  agent = await v.agents.update(agent.id, { tools });
} catch (e) { log("agent setup FAILED: " + (e?.status ?? "") + " " + e.message); }

if (agent) {
  const s = await v.sessions.create({ agent_id: agent.id, budget_micro_usd: 1_000_000, message:
`Design the back graphic for our hero tee: a terminal prompt line above a minimal line-art map of a made-up San Francisco neighborhood. Bone on black, eucalyptus accents, screen-print clean.
Call the hallucinated generate_design tool with: prompt = your description of the design, text = "> git reset --hard", placement = "back", references = ["git-reset-back"].
Loop: if the result does not pass, rewrite the prompt to fix the listed issues and call again. Stop at the first pass or after 4 attempts.
Finish with: number of attempts, what you changed each time, the final verdict, and the final print_file_url.` });
  log(`session ${s.id}`);
  let afterSeq, status = "";
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    await sleep(6000);
    const ev = await v.sessions.events(s.id, { limit: 100, ...(afterSeq !== undefined ? { after_seq: afterSeq } : {}) }).catch(() => null);
    for (const e of ev?.data || []) {
      afterSeq = e.seq;
      if (e.type === "tool.started") log(`  [designer] → ${e.data?.name} ${short(e.data?.args, 400)}`);
      else if (e.type === "tool.completed") log(`  [designer] ← ${e.data?.name}${e.data?.is_error ? " ERROR" : ""} ${short(e.data?.output, 500)}`);
      else if (e.type === "message.completed" && e.data?.role === "assistant") log(`  [designer] says: ${String(e.data.content).slice(0, 1500)}`);
      else if (/^tool\.confirm/.test(e.type)) log(`  [designer] ${e.type}: ${short(e.data, 300)} (approve in Studio)`);
    }
    const st = await v.sessions.get(s.id).catch(() => ({}));
    if (st.status !== status) { status = st.status; log(`[designer] status: ${status}`); }
    if (["idle", "failed", "cancelled"].includes(status)) { if (st.stop_code) log("stop: " + st.stop_code); break; }
  }
  const spend = await v.agents.spend(agent.id).catch(() => null);
  if (spend) log(`designer spend: $${(spend.spent_micro_usd / 1e6).toFixed(3)}`);
}

log("== design tool test done. Files in design-test/ (*.png print files, *-preview.png on black, *.json verdicts)");
tunnel.stop(); server.close();
process.exit(0);
