// Is it safe to restart serve? Exit 0 only when nothing would be killed; otherwise print what's busy and exit 1.
//   node agents/safe_to_restart.mjs        (from design-mcp/)
// Busy means any of:
//   - a hallucinated-* Naïve session that is running / queued / starting, OR one parked on an approval
//     (stop_reason awaiting_approval or pending actions): held sessions look idle, and a restart drops the hold
//     (that killed a held Product run once);
//   - a local order / sales / launch / pickup script, or an x_login / dry-test browser;
//   - a Chrome on the Customania profile (serve keeps those checkout sessions and payment handoffs in memory)
//     or on the X profile (a browser reply in progress).
// Exit 2 = couldn't check (treat as not safe).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const busy = [];

// 1. local processes
const SCRIPTS = [
  [/agents\/order_run\.mjs/, "order_run.mjs (a print order)"],
  [/agents\/sales_run\.mjs/, "sales_run.mjs (batching paid orders)"],
  [/agents\/launch_run\.mjs/, "launch_run.mjs (a product launch)"],
  [/agents\/pickup_watch\.mjs/, "pickup_watch.mjs (watching for a pickup / courier)"],
  [/x\/browser_cli\.mjs (login|dry)/, "x/browser_cli.mjs (x_login window or a dry test)"],
  [/--user-data-dir=[^\n]*\.pw-chrome-profile/, "Chrome on the Customania profile (a checkout or payment handoff)"],
  [/--user-data-dir=[^\n]*\.pw-x-profile/, "Chrome on the X profile (a browser reply or the login window)"],
];
let ps = "";
try { ps = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }); } catch (e) { console.log(`can't list processes: ${e.message}`); process.exit(2); }
const seen = new Set();
for (const line of ps.split("\n")) {
  if (!line.trim() || line.includes("safe_to_restart")) continue;
  if (/^\s*\d+\s+(\/bin\/)?(ba|z)?sh\b|\bgrep\b|\bpgrep\b/.test(line)) continue;   // shells/greps that merely mention a path
  for (const [re, what] of SCRIPTS) if (re.test(line) && !seen.has(what)) { seen.add(what); busy.push(`process: ${what} (pid ${line.trim().split(/\s+/)[0]})`); }
}

// 2. Naïve sessions of our agents
const env = fs.existsSync(path.join(ROOT, ".env")) ? fs.readFileSync(path.join(ROOT, ".env"), "utf8") : "";
const key = (env.match(/^VETTA_API_KEY=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
if (!key) { console.log("no VETTA_API_KEY in .env: can't check sessions"); process.exit(2); }
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: key });
const DONE = new Set(["idle", "completed", "complete", "succeeded", "failed", "error", "errored", "cancelled", "canceled", "terminated", "ended", "stopped", "expired", "archived"]);
try {
  const agents = Object.fromEntries(((await v.agents.list({ limit: 100 })).data || []).filter((a) => /^hallucinated-/.test(a.name)).map((a) => [a.id, a.name]));
  const recent = (await v.sessions.list({ limit: 100 })).data || [];
  const held = (await v.sessions.list({ stop_reason: "awaiting_approval", limit: 100 })).data || [];
  const byId = new Map([...recent, ...held].map((s) => [s.id, s]));
  for (const s of byId.values()) {
    const name = agents[s.agent_id];
    if (!name) continue;
    const pending = (s.pending_actions || []).map((a) => a.name || a.kind).filter(Boolean);
    const why = !DONE.has(s.status) ? `status ${s.status}`
      : s.stop_reason === "awaiting_approval" ? `waiting for approval${pending.length ? ": " + pending.join(", ") : ""}`
      : pending.length ? `pending: ${pending.join(", ")}` : null;
    if (why) busy.push(`session: ${name} ${s.id} ${why} (started ${s.started_at || s.created_at})`);
  }
} catch (e) { console.log(`can't check Naïve sessions: ${e.message}`); process.exit(2); }

if (busy.length) { console.log(`NOT safe to restart serve (${busy.length} busy):\n  ${busy.join("\n  ")}`); process.exit(1); }
console.log("safe to restart serve: no hallucinated-* session running, queued or awaiting approval; no order/pickup script or profile browser open");
