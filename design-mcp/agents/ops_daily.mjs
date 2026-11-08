// Applies defs.mjs's ops-sales schedule (daily supplier order, 9:00 PT) to that ONE Naïve deployment and turns it on,
// without touching the other deployments (setup_agents --enable-schedules would switch on all of them).
//   node agents/ops_daily.mjs          # cron from defs, enabled, resumed; prints next run
//   node agents/ops_daily.mjs --off    # pause just this deployment
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
import { scheduleDefs, TIMEZONE } from "./defs.mjs";
import { envKey } from "../lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OFF = process.argv.includes("--off");
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });
const def = scheduleDefs().find((s) => s.key === "ops-sales");
const all = [];
for (let after; ;) { const p = await v.deployments.list({ limit: 100, ...(after ? { after } : {}) }); all.push(...p.data); if (!p.has_more) break; after = p.next_cursor; }
const mine = all.filter((d) => /\[schedule: ops-sales\]\s*$/.test(String(d.input_template || "")));
if (!mine.length) { console.error("no ops-sales deployment found: run setup_agents.command once (it creates it paused), then this again"); process.exit(1); }
let d = mine[0];
if (OFF) d = await v.deployments.update(d.id, { enabled: false });
else {
  d = await v.deployments.update(d.id, { cron: def.cron, timezone: TIMEZONE, enabled: true });
  if (d.schedule_status === "paused") d = await v.deployments.resume(d.id);
}
for (const extra of mine.slice(1)) if (extra.enabled) { await v.deployments.update(extra.id, { enabled: false }); console.log(`turned off duplicate ${extra.id}`); }
const next = d.next_run_at ? new Date(d.next_run_at).toLocaleString("en-US", { timeZone: TIMEZONE, weekday: "short", hour: "numeric", minute: "2-digit" }) : "-";
console.log(`ops-sales ${d.id}: cron "${d.cron}" ${d.timezone}, enabled=${d.enabled}, status=${d.schedule_status}, next run ${next} PT`);
