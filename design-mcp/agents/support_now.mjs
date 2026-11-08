// Fires the support deployment once, now (whatever its schedule state), so a demo email gets answered within ~a minute.
//   node agents/support_now.mjs        (support_now.command)
import { createClient } from "@usenaive-sdk/vetta";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envKey } from "../lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });
const deps = (await v.deployments.list({ limit: 100 })).data || [];
const dep = deps.find((d) => /\[schedule: support\]\s*$/.test(String(d.input_template || "")));
if (!dep) { console.error("no support deployment (run setup_agents.command first)"); process.exit(1); }
const r = await v.deployments.run(dep.id);
console.log(`fired support once: session ${r.session_id} (${r.status}); deployment ${dep.id} stays ${dep.enabled ? "enabled" : "paused"}`);
console.log("Watch it in Naïve Studio, or: tail -f naive.log");
process.exit(0);
