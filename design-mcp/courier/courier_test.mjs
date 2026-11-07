// Quote-only test of the courier path through MobileRun's API (books nothing). Usage: node courier/courier_test.mjs
// Uses the same tool code the agents get: registers the tools on a fake server, calls courier_quote, then courier_status.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerCourierTools } from "./tools.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const tools = {};
registerCourierTools({ registerTool: (name, _meta, fn) => (tools[name] = fn) }, { rootDir: ROOT, log });
if (!tools.courier_quote) { log("courier test: MOBILERUN_API_KEY missing in .env"); process.exit(1); }
log("== courier test (quote only, books nothing)");
const q = JSON.parse((await tools.courier_quote({ order_number: "TEST" })).content[0].text);
log("task " + q.task_id);
for (let i = 0; i < 8; i++) {
  const s = JSON.parse((await tools.courier_status({ task_id: q.task_id })).content[0].text);
  log(`status ${s.status}`);
  if (["completed", "failed", "cancelled"].includes(s.status)) { log("result " + JSON.stringify(s.result || s.message)); break; }
}
log("== courier test done");
process.exit(0);
