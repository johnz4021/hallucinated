process.on("unhandledRejection", (e) => { console.error(e); });
// Growth content rotation, 5 cycles, fully dry and isolated from John's live agents:
//   own MCP server + tunnel + vault ("halltest-mcp"), X_DRY_RUN=1 (nothing reaches X), MAIL_DRY_RUN=1, Stripe sandbox,
//   throwaway agent halltest-growth with Growth's tools minus x_post_scout (so John's scout queue isn't touched).
//   The min-gap between posts is 0 here so 5 runs fit in a few minutes; every other rule (rotation, link window,
//   announce-once, caps) is the production code. DESIGNS_ANNOUNCE_TEST=1 lets the sandbox design exercise new_design.
//   node growth/e2e_growth_dry.mjs [cycles=5]      (refuses if STRIPE_LIVE_OK=1)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Tunnel, bin, install } from "cloudflared";
import { createClient } from "@usenaive-sdk/vetta";
import { startServer } from "../server.mjs";
import { agentDefs, scheduleDefs, defsByName, upsertAgent, pickModel } from "../agents/defs.mjs";
import { runSession, sleep } from "../agents/runtime.mjs";
import { BILLING } from "../agents/config.mjs";
import { envKey, readJson } from "../lib/state.mjs";

if (process.env.STRIPE_LIVE_OK === "1") { console.error("refused: run WITHOUT STRIPE_LIVE_OK"); process.exit(1); }
Object.assign(process.env, { X_DRY_RUN: "1", MAIL_DRY_RUN: "1", X_MIN_GAP_MIN: "0", DESIGNS_ANNOUNCE_TEST: "1" });
const CYCLES = Number(process.argv[2] || 5);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, ".."), ROOT = path.resolve(MCP_DIR, "..");
const RUN = path.join(ROOT, "order-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "_growth-dry");
fs.mkdirSync(RUN, { recursive: true });
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(RUN, "run.log"), l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });

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

const real = agentDefs({}).growth;
const def = { ...real, name: "halltest-growth", tools: Object.fromEntries(Object.entries(real.tools).filter(([k]) => k !== "x_post_scout")) };
const byName = defsByName({ growth: def });
const agent = await upsertAgent(v, def, { model: await pickModel(v), mcpUrl: url + "/mcp", log });
log(`== growth dry run x${CYCLES}: ${agent.name} ${agent.id} tools ${Object.keys(def.tools).join(",")} at ${url}`);
const prompt = scheduleDefs().find((s) => s.key === "growth").input_template.split("\n").filter((l) => !/^3\. Scout queue/.test(l)).join("\n");

const ledgerFile = path.join(ROOT, "x-ledger.dry.json");
const startCount = (readJson(ledgerFile, { posts: [] }).posts || []).length;
const results = [];
for (let i = 1; i <= CYCLES; i++) {
  const r = await runSession(v, { label: `growth#${i}`, agent, message: prompt, budget: 1_000_000, byName, log, maxMin: 12 }).catch((e) => ({ error: e.message }));
  const posts = (readJson(ledgerFile, { posts: [] }).posts || []).slice(startCount).filter((p) => p.kind === "post");
  results.push({ cycle: i, session: r.session, result: r.result, post: posts[i - 1] || null, error: r.error || null });
  log(`cycle ${i}: ${JSON.stringify(results.at(-1).post)}`);
}
const st = await Promise.all(results.map((x) => (x.session ? v.sessions.get(x.session).then((s) => s.consumed_micro_usd / 1e6).catch(() => null) : null)));
fs.writeFileSync(path.join(RUN, "record.json"), JSON.stringify({ results, costs_usd: st }, null, 2));
log("== DRAFTS");
for (const x of results) log(`#${x.cycle} [${x.post?.pillar || "?"}] link=${x.post?.has_link ?? "-"} media=${x.post?.media || "-"}\n    ${x.post?.text || "(no post: " + JSON.stringify(x.result || x.error) + ")"}`);
log(`naive cost per cycle: ${st.map((c) => (c == null ? "?" : "$" + c.toFixed(3))).join(", ")}`);

await v.agents.delete(agent.id).then(() => log("deleted agent halltest-growth")).catch((e) => log("agent delete: " + e.message));
await v.vaults.delete(vault.id).then(() => log("deleted vault halltest-mcp")).catch((e) => log("vault delete: " + e.message));
try { tunnel.stop(); } catch {} server.close();
log(`record: order-runs/${path.basename(RUN)}/record.json`);
log("== growth dry run done");
process.exit(0);
