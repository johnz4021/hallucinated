process.on("unhandledRejection", (e) => { console.error(e); });
// Idempotent setup of the whole company in Naïve: creates or updates hallucinated-product, -ceo, -ops, -growth, -support
// (prompt, model, MCP server URL from .serve.json, tools + permissions from defs.mjs) and their deployments (cron).
//   node agents/setup_agents.mjs                    # agents + deployments; NEW deployments are created paused,
//                                                   # existing ones keep their current on/off state
//   node agents/setup_agents.mjs --enable-schedules # also turn every deployment on
//   node agents/setup_agents.mjs --pause-schedules  # turn every deployment off
//   --trends-allow   (no-op now: Product's trends tool is always "allow"; the tool still refuses any call over $0.01)
//   --run <growth|support|ops-sales>   fire that deployment once now (whatever its schedule state), print the session id
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
import { buildMcp } from "../server.mjs";
import { agentDefs, scheduleDefs, upsertAgent, pickModel, toolTable, TIMEZONE, MCP } from "./defs.mjs";
import { BILLING } from "./config.mjs";
import { envKey } from "../lib/state.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, ".."), ROOT = path.resolve(MCP_DIR, "..");
const arg = (f) => process.argv.includes(f);
const val = (f) => (process.argv.indexOf(f) > -1 ? process.argv[process.argv.indexOf(f) + 1] : null);
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });
const ENABLE = arg("--enable-schedules"), PAUSE = arg("--pause-schedules");
if (ENABLE && PAUSE) { console.error("pick one of --enable-schedules / --pause-schedules"); process.exit(1); }

log(`== setup agents${ENABLE ? " (enable schedules)" : PAUSE ? " (pause schedules)" : ""}${arg("--trends-allow") ? " (trends: allow)" : ""}`);
let identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
if (!identity) { identity = await v.identities.create({ name: "Hallucinated", description: "Agent-run streetwear brand" }); log(`created identity ${identity.id}`); }

// The MCP URL: serve.command's tunnel. Without it, agents keep whatever URL they have (serve repoints them on start).
let mcpUrl = null;
try {
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, ".serve.json"), "utf8"));
  process.kill(st.pid, 0);
  mcpUrl = st.url + "/mcp";
} catch { log("serve.command isn't running (.serve.json missing or stale): agents keep their current MCP URL; serve repoints them when it starts"); }

// Every tool the server registers right now, so a tool added later can't default to "enabled + allow" on every agent.
const probe = buildMcp({ rootDir: ROOT, mcpDir: MCP_DIR, outDir: path.join(ROOT, "design-test"), runsDir: path.join(ROOT, "customania-runs"), vettaKey: envKey(ROOT, "VETTA_API_KEY"), billing: BILLING, log: () => {} });
const liveTools = Object.keys(probe._registeredTools || {});
log(`server registers ${liveTools.length} tools: ${liveTools.join(", ")}`);

const model = await pickModel(v);
const DEFS = agentDefs({ trendsAllow: arg("--trends-allow") });
const agents = {};
for (const [key, def] of Object.entries(DEFS)) {
  agents[key] = await upsertAgent(v, def, { model, mcpUrl, allMcp: liveTools, log });
  if (def.identity) { try { await v.identities.attach(agents[key].id, identity.id); } catch (e) { if (!/already/i.test(e.message)) log(`identities.attach ${def.name}: ${e.message}`); } }
  log(`agent ${def.name} ${agents[key].id} v${agents[key].current_version} model ${agents[key].model} mcp ${agents[key].mcp_servers?.[0]?.url || "none"}`);
}

// Deployments: one per schedule KEY (an agent may have several, e.g. Growth A + B). The key is stamped as the template's
// last line "[schedule: <key>]". A deployment made before keys existed is adopted by the def with the same agent and cron
// (or, if the agent has a single def, by that def).
const existing = [];
for (let after; ;) { const p = await v.deployments.list({ limit: 100, ...(after ? { after } : {}) }); existing.push(...p.data); if (!p.has_more) break; after = p.next_cursor; }
const tag = (k) => `[schedule: ${k}]`;
const keyOf = (d) => (String(d.input_template || "").match(/\[schedule: ([a-z0-9-]+)\]\s*$/) || [])[1] || null;
const claimed = new Set(), deps = {};
for (const s of scheduleDefs()) {
  const a = agents[s.agent];
  const free = (d) => d.agent_id === a.id && !claimed.has(d.id);
  let mine = existing.filter((d) => free(d) && keyOf(d) === s.key);
  if (!mine.length) mine = existing.filter((d) => free(d) && !keyOf(d) && d.cron === s.cron);
  if (!mine.length && scheduleDefs().filter((x) => x.agent === s.agent).length === 1) mine = existing.filter((d) => free(d) && !keyOf(d));
  for (const d of mine) claimed.add(d.id);
  const cfg = { cron: s.cron, timezone: TIMEZONE, input_template: `${s.input_template}\n${tag(s.key)}`, budget_micro_usd: s.budget_micro_usd, window: "immediate",
    identity: DEFS[s.agent].identity ? identity.id : null };
  let d;
  if (mine[0]) {
    d = await v.deployments.update(mine[0].id, { ...cfg, ...(mine[0].agent_version != null ? { agent_version: a.current_version } : {}) });
    for (const extra of mine.slice(1)) { await v.deployments.update(extra.id, { enabled: false }).catch(() => {}); log(`  duplicate deployment ${extra.id} for ${s.key} turned off (delete it in Studio if unwanted)`); }
  } else {
    d = await v.deployments.create({ agent_id: a.id, ...cfg, enabled: false });
    log(`  created deployment ${d.id} for ${a.name} (off)`);
  }
  if (ENABLE && !d.enabled) d = await v.deployments.update(d.id, { enabled: true });
  if (ENABLE && d.schedule_status === "paused") d = await v.deployments.resume(d.id);
  if (PAUSE && d.enabled) d = await v.deployments.update(d.id, { enabled: false });
  deps[s.key] = d;
  log(`deployment ${s.key.padEnd(9)} ${d.id} ${a.name.padEnd(21)} cron "${d.cron}" ${d.timezone} enabled=${d.enabled} status=${d.schedule_status} agent_version=${d.agent_version ?? "latest"} next=${d.next_run_at || "-"}`);
}

// agent -> tool -> permission
const rows = toolTable(DEFS);
console.log("\nagent                  tool                                   permission");
for (const r of rows) console.log(`${r.agent.padEnd(22)} ${r.tool.padEnd(38)} ${r.permission}${r.human_only ? "  (human approves every call; never auto-confirmed)" : ""}`);
const off = liveTools.filter((t) => !rows.some((r) => r.tool === `${MCP}.${t}`));
console.log(`\noff on every agent: ${off.map((t) => MCP + "." + t).join(", ") || "none"}`);
console.log("built-ins off on every agent: image/browser/web_fetch/social.post, sandbox computer (bash/read/write/...), cards, wallet, payments, email/phone send");

const runKey = val("--run");
if (runKey) {
  if (!deps[runKey]) { log(`--run: unknown deployment ${runKey}`); process.exit(1); }
  const r = await v.deployments.run(deps[runKey].id);
  log(`fired ${runKey} once: session ${r.session_id} (${r.status})`);
}
log("== setup agents done");
process.exit(0);
