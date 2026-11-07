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
  tunnel.once("exit", async () => { log("tunnel dropped; reopening in 5 s"); await sleep(5000); openTunnel().catch((e) => log("reopen failed: " + e.message)); });
}
await openTunnel();

// health check every 2 min: if the public URL stops answering, restart the tunnel
setInterval(async () => {
  const ok = await fetch(url + "/health", { signal: AbortSignal.timeout(15000) }).then((r) => r.ok).catch(() => false);
  if (!ok) { log("health check failed; restarting tunnel"); try { tunnel.stop(); } catch {} }
}, 120_000);

const stop = () => { try { fs.unlinkSync(STATE); } catch {} try { tunnel.stop(); } catch {} server.close(); log("== serve stopped"); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);
log("serve is up. Leave this window open; close it (or Ctrl-C) to stop the tools.");
