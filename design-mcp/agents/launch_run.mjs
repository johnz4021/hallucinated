process.on("unhandledRejection", (e) => { console.error(e); });
// One-shot pre-order launch for one product: Ops lists its open pre-orders and charges the saved cards with
// charge_preorders, which waits for John's approval in Naïve Studio (the card shows the product and the cap).
// Only successful charges become sales; batch them to Customania afterwards with sales_run (or the hourly Ops loop).
//   node agents/launch_run.mjs --product prod_XXX --max 500     (max = the most John agrees to charge in total, USD)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
import { agentDefs, defsByName, upsertAgent, pickModel } from "./defs.mjs";
import { connectTools, runSession } from "./runtime.mjs";
import { BILLING } from "./config.mjs";
import { envKey } from "../lib/state.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, ".."), ROOT = path.resolve(MCP_DIR, "..");
const val = (f) => (process.argv.indexOf(f) > -1 ? process.argv[process.argv.indexOf(f) + 1] : null);
const PRODUCT = val("--product"), MAX = Number(val("--max"));
if (!/^prod_/.test(PRODUCT || "") || !(MAX > 0)) { console.error("usage: node agents/launch_run.mjs --product prod_XXX --max <usd>"); process.exit(1); }
const RUN = path.join(ROOT, "order-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "_launch");
fs.mkdirSync(RUN, { recursive: true });
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(RUN, "run.log"), l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const record = { mode: "launch", product: PRODUCT, max_total_usd: MAX, started: new Date().toISOString(), sessions: [] };
const save = () => fs.writeFileSync(path.join(RUN, "record.json"), JSON.stringify(record, null, 2));
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });

log(`== pre-order launch ${PRODUCT}, cap $${MAX}`);
const identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
const ctx = { openaiKey: envKey(ROOT, "OPENAI_API_KEY"), vettaKey: envKey(ROOT, "VETTA_API_KEY"), identityId: identity?.id, outDir: path.join(ROOT, "design-test"),
  runsDir: path.join(ROOT, "customania-runs"), rootDir: ROOT, mcpDir: MCP_DIR, log, billing: BILLING, cardName: `${BILLING.first} ${BILLING.last}` };
const conn = await connectTools(v, { ROOT, ctx, log });
const DEFS = agentDefs({});
const ops = await upsertAgent(v, DEFS.ops, { model: await pickModel(v), mcpUrl: conn.publicUrl + "/mcp", log });
const message = `Launch of product ${PRODUCT}: charge its pre-orders.
1. preorders_list with product_id "${PRODUCT}". Report how many open pre-orders, how many have a saved card, and the open total.
2. charge_preorders with product_id "${PRODUCT}" and max_total_usd ${MAX}. It waits for John's approval in Naïve Studio; that's expected. If it returns a job_id that's still running, call charge_preorders_status until it's done.
3. Report: how many charged, how many need the customer (they get a payment link that Support emails), and any pre-orders without a saved card. Don't retry failed cards.
End with exactly: RESULT: {"product":"${PRODUCT}","charged":<n>,"needs_customer":<n>,"total_charged_usd":<n>,"issues":"<or none>"}`;
try {
  const r = await runSession(v, { label: "ops", agent: ops, message, budget: 1_500_000, identity: identity?.id, byName: defsByName(DEFS), log,
    onRecord: (x) => { record.sessions.push(x); save(); }, maxMin: 30 });
  Object.assign(record.sessions.at(-1), { status: r.status, result: r.result, ended: new Date().toISOString() });
  record.result = r.result; save();
  log(`result: ${JSON.stringify(r.result) || r.text.slice(0, 300)}`);
  log("next: batch the charged pre-orders to Customania with sales_run_dry.command, then sales_run_HUMANPAY.command");
} catch (e) { log("STOPPED: " + e.message); record.error = e.message; save(); }
conn.stop();
process.exit(0);
