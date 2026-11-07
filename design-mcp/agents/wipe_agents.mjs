// Deletes every Naïve agent named hallucinated-* so the next run starts with fresh agents (and empty Studio history).
// Touches nothing else: other agents, the identity, X connection, files and vault stay.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1] });
const all = (await v.agents.list({ limit: 100 })).data || [];
const doomed = all.filter((a) => /^hallucinated-/.test(a.name));
log(`== wipe agents: deleting ${doomed.length} (${doomed.map((a) => a.name).join(", ") || "none"}); keeping ${all.length - doomed.length} other(s)`);
for (const a of doomed) await v.agents.delete(a.id).then(() => log(`deleted ${a.name} ${a.id}`)).catch((e) => log(`could not delete ${a.name}: ${e.message}`));
log("== wipe agents done");
process.exit(0);
