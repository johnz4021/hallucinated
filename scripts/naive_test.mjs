process.on('unhandledRejection', e => { console.error(e); });
// Naïve SDK smoke test. Reads VETTA_API_KEY from ../.env, logs to ../naive.log. Never prints the key.
import { createClient } from "@usenaive-sdk/vetta";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const LOG = path.join(ROOT, "naive.log");
const log = (m) => {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${typeof m === "string" ? m : JSON.stringify(m)}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const short = (o, n = 600) => JSON.stringify(o)?.slice(0, n);

const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const apiKey = (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1];
if (!apiKey) { log("No VETTA_API_KEY found in .env"); process.exit(1); }
log(`key loaded (${apiKey.length} chars, starts ${apiKey.slice(0, 4)}…)`);

const c = createClient({ baseUrl: "https://api.vetta.sh", apiKey });
const step = async (name, fn) => {
  try { const r = await fn(); log(`OK  ${name}: ${short(r)}`); return r; }
  catch (e) { log(`ERR ${name}: ${e?.status ?? ""} ${e?.code ?? ""} ${String(e?.message ?? e).slice(0, 400)}`); return null; }
};

log("== namespaces: " + Object.keys(c).join(", "));
log("== credits methods: " + Object.keys(c.credits || {}).join(", "));

const models = await step("models.list", () => c.models.list());
const modelIds = (models?.data || models || []).map((m) => m.id || m.slug || m.name).filter(Boolean);
log("models: " + modelIds.slice(0, 25).join(", "));
const nb = modelIds.filter((m) => !/:batch$/.test(m));
const model = nb.find((m) => /claude.*sonnet/i.test(m)) || nb.find((m) => /claude/i.test(m)) || nb.find((m) => /glm-5\.3-flash/.test(m)) || modelIds[0] || "openai/gpt-oss-120b";
log("using model: " + model);

for (const k of Object.keys(c.credits || {})) {
  if (/^show$|^spend$|^subscription$/i.test(k) && typeof c.credits[k] === "function") await step(`credits.${k}`, () => c.credits[k]());
}
await step("agents.list", () => c.agents.list({ limit: 10 }));
await step("identities.list", () => c.identities.list());

// clean up earlier smoke agents we created
const prev = await c.agents.list({ limit: 50 }).catch(() => ({ data: [] }));
for (const a of (prev.data || []).filter((a) => a.name === "hc-smoke-test")) await step("agents.delete old smoke", () => c.agents.delete(a.id));
const agent = await step("agents.create", () => c.agents.create({
  name: "hc-smoke-test",
  model,
  window: "immediate",
  budget: { cap_micro_usd: 1_000_000, max_task_micro_usd: 500_000, period: "month" },
}));
if (!agent) { log("Stopping: couldn't create an agent."); process.exit(0); }
log("agent tools config: " + short(agent.tools, 800));

const session = await step("sessions.create", () => c.sessions.create({
  agent_id: agent.id,
  budget_micro_usd: 500_000,
  message:
    "Smoke test, be brief. 1) Use web_fetch on https://thecustomania.com and report the page <title>. " +
    "2) If you have a shell/computer tool, run: curl -s -o /dev/null -w '%{http_code}' https://api.stripe.com/v1 and report the HTTP code. " +
    "3) List the names of every tool you have. 4) Reply with DONE and the three results.",
}));
if (session) {
  let s, last = "";
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    s = await c.sessions.get(session.id).catch((e) => ({ status: "get-error " + e?.message }));
    if (s.status !== last) { log(`session status: ${s.status}${s.pending_action ? " pending=" + short(s.pending_action, 300) : ""}`); last = s.status; }
    if (["idle", "completed", "failed", "cancelled"].includes(s.status) || /^awaiting/.test(s.status)) break;
  }
  log("final session: " + short(s, 900));
  const ev = await step("sessions.events", () => c.sessions.events(session.id, { limit: 100 }));
  const items = ev?.data || ev?.events || ev || [];
  for (const e of (Array.isArray(items) ? items : []).slice(-60)) {
    log(`  event ${e.type ?? e.kind ?? "?"}: ${short(e.data ?? e.content ?? e.text ?? e, 400)}`);
  }
}
await step("agents.spend", () => c.agents.spend(agent.id));
log("== done");
