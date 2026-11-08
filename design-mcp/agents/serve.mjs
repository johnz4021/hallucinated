process.on("unhandledRejection", (e) => { console.error(e); });
// Always-on tool server for the whole hackathon: our MCP server (design, Customania, X, cards) + a public tunnel.
// Repoints every hallucinated-* agent in Naïve at the current URL, re-opens the tunnel if it drops,
// keeps the Mac awake, and writes ../.serve.json so order_run.mjs reuses this server instead of starting its own.
//   node agents/serve.mjs        (Ctrl-C or close the window to stop)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Tunnel, bin, install } from "cloudflared";
import { createClient } from "@usenaive-sdk/vetta";
import { startServer } from "../server.mjs";
import { BILLING } from "./config.mjs";
import { agentDefs, defsByName, autoConfirmable } from "./defs.mjs";
import { execFile } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, ".."), ROOT = path.resolve(MCP, "..");
const STATE = path.join(ROOT, ".serve.json");
const LOG = path.join(ROOT, "serve.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const key = (n) => (env.match(new RegExp(`${n}\\s*=\\s*["']?([^\\s"']+)`)) || [])[1];
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: key("VETTA_API_KEY") });

let identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
if (!identity) { identity = await v.identities.create({ name: "Hallucinated", description: "Agent-run streetwear brand" }); log(`created identity ${identity.id}`); }

const token = crypto.randomBytes(16).toString("hex");
const ctx = { openaiKey: key("OPENAI_API_KEY"), vettaKey: key("VETTA_API_KEY"), identityId: identity.id, outDir: path.join(ROOT, "design-test"),
  runsDir: path.join(ROOT, "customania-runs"), rootDir: ROOT, mcpDir: MCP, log, billing: BILLING, cardName: `${BILLING.first} ${BILLING.last}` };
const server = await startServer({ port: 0, token, ctx });
const PORT = server.address().port;
ctx.baseUrl = `http://localhost:${PORT}`;
log(`== serve: MCP server on port ${PORT}`);

// keep the Mac awake for as long as this process lives
if (process.platform === "darwin") spawn("caffeinate", ["-dimsu", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
if (!fs.existsSync(bin)) await install(bin);

let tunnel = null, url = null;
async function openTunnel() {
  tunnel = Tunnel.quick(`http://localhost:${PORT}`);
  url = await new Promise((res, rej) => { tunnel.once("url", res); tunnel.once("error", rej); setTimeout(() => rej(new Error("tunnel timeout")), 60000); });
  await new Promise((res) => { tunnel.once("connected", res); setTimeout(res, 15000); });
  ctx.baseUrl = url;
  // the bearer token lives in a Naïve vault credential bound to this URL (Naïve forbids auth headers in mcp_servers)
  const vl = await v.vaults.list().catch(() => ({ data: [] }));
  for (const o of (vl.data || []).filter((x) => x.display_name === "hallucinated-mcp")) await v.vaults.delete(o.id).catch(() => {});
  const vault = await v.vaults.create({ display_name: "hallucinated-mcp" });
  await v.vaults.credentials.create(vault.id, { kind: "static_bearer", key: "hallucinated_mcp_token", value: token, mcp_server_url: url + "/mcp" });
  // repoint every hallucinated-* agent
  const agents = ((await v.agents.list({ limit: 100 })).data || []).filter((a) => /^hallucinated-/.test(a.name));
  for (const a of agents) await v.agents.update(a.id, { mcp_servers: [{ name: "hallucinated", url: url + "/mcp" }] }).catch((e) => log(`repoint ${a.name}: ${e.message}`));
  fs.writeFileSync(STATE, JSON.stringify({ url, port: PORT, pid: process.pid, started: new Date().toISOString() }, null, 2));
  log(`tools live at ${url} (repointed ${agents.length} agents: ${agents.map((a) => a.name).join(", ") || "none yet"})`);
  await syncDeployments().catch((e) => log("deployment sync: " + e.message));
  tunnel.once("exit", async () => { log("tunnel dropped; reopening in 5 s"); await sleep(5000); openTunnel().catch((e) => log("reopen failed: " + e.message)); });
}
await openTunnel();

// health check every 2 min: if the public URL stops answering, restart the tunnel
setInterval(async () => {
  const ok = await fetch(url + "/health", { signal: AbortSignal.timeout(15000) }).then((r) => r.ok).catch(() => false);
  if (!ok) { log("health check failed; restarting tunnel"); try { tunnel.stop(); } catch {} }
}, 120_000);

// A deployment pinned to an agent version keeps firing that version (with its old tunnel URL); move pins to the latest.
async function syncDeployments() {
  const agents = ((await v.agents.list({ limit: 100 })).data || []).filter((a) => /^hallucinated-/.test(a.name));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const deps = ((await v.deployments.list({ limit: 100 })).data || []).filter((d) => byId[d.agent_id]);
  for (const d of deps) if (d.agent_version != null && d.agent_version !== byId[d.agent_id].current_version)
    await v.deployments.update(d.id, { agent_version: byId[d.agent_id].current_version }).then(() => log(`deployment ${d.id} (${byId[d.agent_id].name}) now runs v${byId[d.agent_id].current_version}`));
}

// Hold clearing for sessions nobody is watching (deployments, Support -> Ops courier requests). Naïve sometimes holds a
// call to a tool configured "allow"; confirm it only if defs.mjs says allow AND the live agent config says allow.
// Never confirms an "ask" tool (payments, courier booking, scout replies, ads, cards): those wait for John in Studio,
// and he gets one desktop notification per held call.
const DEFS = defsByName(agentDefs({ live: false, trendsAllow: true }));   // trends is cleared only if the live config says allow
const confirmed = new Map(), notified = new Set();
const PUBLIC_ACTS = new Set(["x_post", "x_reply", "inbox_reply", "preorder_send_payment_link", "preorder_cancel"].map((n) => `hallucinated.${n}`));
let ourAgents = {}, agentsAt = 0;
async function clearHolds() {
  if (Date.now() - agentsAt > 120_000) {
    ourAgents = Object.fromEntries(((await v.agents.list({ limit: 100 })).data || []).filter((a) => /^hallucinated-/.test(a.name)).map((a) => [a.id, a]));
    agentsAt = Date.now();
  }
  const held = (await v.sessions.list({ stop_reason: "awaiting_approval", limit: 50 })).data || [];
  for (const s of held) {
    const agent = ourAgents[s.agent_id];
    if (!agent) continue;
    for (const a of (s.pending_actions || []).filter((x) => x.kind !== "question")) {
      const k = `${s.id}:${a.tool_call_id}:${a.parked_seq ?? ""}`;
      // HOLDS_STRICT_PUBLIC=1: when Naïve holds a call because the chat has read people's data (read_people), leave the
      // public-facing ones (posts, replies, customer email) for John instead of clearing them.
      const strict = process.env.HOLDS_STRICT_PUBLIC === "1" && a.read_people && PUBLIC_ACTS.has(a.name);
      if (!strict && autoConfirmable(DEFS, agent.name, a.name, agent.tools)) {
        if (Date.now() - (confirmed.get(k) || 0) < 15_000) continue;
        confirmed.set(k, Date.now());
        await v.sessions.confirmTool(s.id, { tool_call_id: a.tool_call_id, decision: "allow", scope: "session", reason: "pre-approved tool (agent config: allow); cleared by serve" })
          .then(() => log(`[holds] allowed held ${a.name} for ${agent.name} session ${s.id} (pre-approved tool)`))
          .catch((e) => log(`[holds] confirmTool ${a.name} on ${s.id} failed: ${e.message}`));
      } else if (!notified.has(k)) {
        notified.add(k);
        log(`[holds] WAITING FOR JOHN: ${agent.name} wants ${a.name} (session ${s.id}) ${JSON.stringify(a.args || {}).slice(0, 240)}`);
        try { execFile("osascript", ["-e", `display notification ${JSON.stringify(`${agent.name.replace(/^hallucinated-/, "")} needs your OK in Naïve Studio: ${a.name.replace(/^hallucinated\./, "")}`)} with title "Hallucinated" sound name "Glass"`]); } catch {}
      }
    }
  }
  if (confirmed.size > 5000) confirmed.clear();
}
let clearing = false;
setInterval(async () => { if (clearing) return; clearing = true; try { await clearHolds(); } catch (e) { log("[holds] " + e.message); } finally { clearing = false; } }, 10_000);

// [hq] mission-control publisher (agents/hq_publish.mjs): every 60 s, one run at a time, loaded lazily so a broken
// publisher can never take serve down. One log line per push or failure; unchanged documents are skipped quietly.
let hqBusy = false;
setInterval(async () => {
  if (hqBusy) return; hqBusy = true;
  try { const r = await (await import("./hq_publish.mjs")).publishHq({ rootDir: ROOT }); if (r.pushed) log(`[hq] pushed ${r.events} events (${r.bytes} bytes, ${r.ms} ms)`); }
  catch (e) { log(`[hq] push failed: ${String(e.message).slice(0, 200)}`); }
  finally { hqBusy = false; }
}, 60_000).unref();

// Spend guard (agents/spend_guard.mjs): Naïve spend since Sat 13:00 PT, checked every 5 min. >= $100: flag John once;
// >= $175: Creative's video refuses, 1 image + 1 try per concept, flag John. Logs one line per threshold crossed only.
// Loaded lazily, like [hq], so a broken guard can never take serve down.
let spendBusy = false;
const spendTick = async () => {
  if (spendBusy) return; spendBusy = true;
  try { await (await import("./spend_guard.mjs")).checkSpend({ rootDir: ROOT, vettaKey: key("VETTA_API_KEY"), log, force: true }); }
  catch (e) { log(`[spend] check failed: ${String(e.message).slice(0, 160)}`); }
  finally { spendBusy = false; }
};
setTimeout(spendTick, 30_000).unref();
setInterval(spendTick, 5 * 60_000).unref();

const stop = () => { try { fs.unlinkSync(STATE); } catch {} try { tunnel.stop(); } catch {} server.close(); log("== serve stopped"); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);
log("serve is up. Leave this window open; close it (or Ctrl-C) to stop the tools.");
