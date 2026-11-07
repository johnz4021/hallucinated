// Shared plumbing for one-shot runs (sales_run.mjs): reach our tools (serve.command's, or our own server + tunnel),
// and run one Naïve session to completion while clearing Naïve's spurious holds on "allow" tools.
// Same behavior as order_run.mjs's inline versions (which stay as they are so drop orders keep working unchanged).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { Tunnel, bin, install } from "cloudflared";
import { startServer } from "../server.mjs";
import { autoConfirmable } from "./defs.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const short = (o, n = 500) => (typeof o === "string" ? o : JSON.stringify(o))?.replace(/\s+/g, " ").slice(0, n);

export async function connectTools(v, { ROOT, ctx, log }) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(ROOT, ".serve.json"), "utf8"));
    process.kill(st.pid, 0);
    if (await fetch(st.url + "/health", { signal: AbortSignal.timeout(10000) }).then((r) => r.ok)) { log(`using serve.command's tools at ${st.url}`); return { publicUrl: st.url, stop: () => {} }; }
  } catch {}
  const token = crypto.randomBytes(16).toString("hex");
  const server = await startServer({ port: 0, token, ctx });
  const port = server.address().port;
  ctx.baseUrl = `http://localhost:${port}`;
  if (!fs.existsSync(bin)) await install(bin);
  const tunnel = Tunnel.quick(`http://localhost:${port}`);
  const publicUrl = await new Promise((res, rej) => { tunnel.once("url", res); tunnel.once("error", rej); setTimeout(() => rej(new Error("tunnel timeout")), 60000); });
  await new Promise((res) => { tunnel.once("connected", res); setTimeout(res, 15000); });
  ctx.baseUrl = publicUrl;
  log(`own MCP server on port ${port}, public URL ${publicUrl}`);
  const vl = await v.vaults.list().catch(() => ({ data: [] }));
  for (const o of (vl.data || []).filter((x) => x.display_name === "hallucinated-mcp")) await v.vaults.delete(o.id).catch(() => {});
  const vault = await v.vaults.create({ display_name: "hallucinated-mcp" });
  await v.vaults.credentials.create(vault.id, { kind: "static_bearer", key: "hallucinated_mcp_token", value: token, mcp_server_url: publicUrl + "/mcp" });
  await sleep(3000);
  return { publicUrl, stop: () => { try { tunnel.stop(); } catch {} server.close(); } };
}

// Runs one session until idle/failed; clears holds only on tools autoConfirmable() allows; nudges twice if no RESULT line.
export async function runSession(v, { label, agent, message, budget = 3_000_000, identity, byName, log, onRecord = () => {}, maxMin = 30 }) {
  const s = await v.sessions.create({ agent_id: agent.id, identity, message, budget_micro_usd: budget });
  onRecord({ label, agent: agent.name, session: s.id, started: new Date().toISOString() });
  log(`[${label}] session ${s.id}`);
  let after, status = "", last = "";
  const approved = new Map(), waiting = new Set();
  const end = Date.now() + maxMin * 60_000;
  const poll = async () => { while (Date.now() < end) {
    await sleep(5000);
    const ev = await v.sessions.events(s.id, { limit: 100, ...(after !== undefined ? { after_seq: after } : {}) }).catch(() => null);
    for (const e of ev?.data || []) {
      after = e.seq;
      if (e.type === "tool.started") log(`  [${label}] → ${e.data?.name} ${short(e.data?.args, 300)}`);
      else if (e.type === "tool.completed") log(`  [${label}] ← ${e.data?.name}${e.data?.is_error ? " ERROR" : ""} ${short(e.data?.output, 400)}`);
      else if (e.type === "message.completed" && e.data?.role === "assistant") { last = String(e.data.content); log(`  [${label}] says: ${short(last, 1200)}`); }
    }
    const st = await v.sessions.get(s.id).catch(() => ({}));
    if (st.status !== status) { status = st.status; log(`[${label}] status ${status}${st.stop_reason ? " (" + st.stop_reason + ")" : ""}`); }
    const pend = (st.pending_actions || []).filter((a) => a.kind !== "question");
    if (pend.length) {
      for (const a of pend) {
        const seen = approved.get(a.tool_call_id);
        if (seen && Date.now() - seen < 15000) continue;
        if (autoConfirmable(byName, agent.name, a.name, agent.tools)) {
          await v.sessions.confirmTool(s.id, { tool_call_id: a.tool_call_id, decision: "allow", scope: "session", reason: "pre-approved tool (agent config: allow)" })
            .then(() => log(`  [${label}] allowed held ${a.name} for this session (pre-approved tool)`))
            .catch((e) => log(`  [${label}] confirmTool ${a.name} failed: ${e.message}`));
          approved.set(a.tool_call_id, Date.now());
        } else if (!waiting.has(a.tool_call_id)) {
          waiting.add(a.tool_call_id);
          log(`  [${label}] WAITING FOR YOU: approve or deny ${a.name} in Naïve Studio (session ${s.id}) ${short(a.args, 200)}`);
          try { execFile("osascript", ["-e", `display notification ${JSON.stringify(`${label} needs your OK in Naïve Studio: ${a.name.replace(/^hallucinated\./, "")}`)} with title "Hallucinated" sound name "Glass"`]); } catch {}
        }
      }
      continue;
    }
    if (["idle", "failed", "cancelled", "completed"].includes(status)) break;
  } };
  await poll();
  for (let n = 1; n <= 2 && !/RESULT:/.test(last) && status === "idle"; n++) {
    log(`  [${label}] turn ended without a RESULT; nudging it to continue (${n}/2)`);
    await v.sessions.send(s.id, { message: "Continue the task from where you stopped, then end with the RESULT line." }).catch((e) => log("send failed: " + e.message));
    await sleep(8000); status = "";
    await poll();
  }
  const m = last.match(/RESULT:\s*(\{[\s\S]*\})/);
  let result = null; try { result = m ? JSON.parse(m[1]) : null; } catch {}
  return { session: s.id, status, result, text: last };
}
