process.on("unhandledRejection", (e) => { console.error(e); });
// One-shot store -> printer run: Ops reads the paid, unbatched Stripe orders and builds ONE Customania order for all of them
// (drop #1's design and placement), then John pays through the handoff and the sales are marked batched in Stripe.
//   node agents/sales_run.mjs --dry          # Ops builds and verifies the cart, then STOPS before the handoff and closes it
//                                            # (no batch lock, nothing marked, nothing paid)
//   node agents/sales_run.mjs --human-pay    # full: batch lock -> cart -> handoff (you approve in Studio and pay) -> mark batched
//   --min <n>    minimum shirts to proceed (default 1 here; the daily 9:00 deployment uses SALES_MIN_QTY, default 1)
//   --drop <id>  only sales of this metadata.drop (default all)
// Uses serve.command's tools if it's up (recommended), else starts its own server + tunnel.
// Env read by the tool process: HANDOFF_TIMEOUT_MIN (default 15).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
import { agentDefs, defsByName, upsertAgent, pickModel } from "./defs.mjs";
import { connectTools, runSession } from "./runtime.mjs";
import { CONTACT, BILLING } from "./config.mjs";
import { stripeClient, salesStatus } from "../stripe/tools.mjs";
import { envKey } from "../lib/state.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, ".."), ROOT = path.resolve(MCP_DIR, "..");
const arg = (f) => process.argv.includes(f);
const val = (f, d) => (process.argv.indexOf(f) > -1 ? process.argv[process.argv.indexOf(f) + 1] : d);
const DRY = arg("--dry"), HUMAN = arg("--human-pay");
if (DRY === HUMAN) { console.error("usage: node agents/sales_run.mjs --dry | --human-pay [--min n] [--drop drop-1]"); process.exit(1); }
const MIN = Number(val("--min", 1)), DROP = val("--drop", "all");

const RUN = path.join(ROOT, "order-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (DRY ? "_sales-dry" : "_sales-humanpay"));
fs.mkdirSync(RUN, { recursive: true });
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(RUN, "run.log"), l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const record = { mode: DRY ? "sales-dry" : "sales-human-pay", drop: DROP, started: new Date().toISOString(), sessions: [] };
const save = () => fs.writeFileSync(path.join(RUN, "record.json"), JSON.stringify(record, null, 2));
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });

log(`== sales run (${DRY ? "DRY: Ops builds the cart and stops before payment" : "HUMAN PAY: you approve the handoff in Studio and pay in the Chrome checkout"}), ${DROP}, min ${MIN}`);
// 1. what's to order (read-only, straight from Stripe)
const sc = stripeClient(ROOT);
if (sc.error) { log("STOPPED: " + sc.error); process.exit(1); }
const st = await salesStatus(sc, ROOT, { drop: DROP, minQty: MIN, maxWaitH: 0, log });
record.plan = { stripe_mode: st.mode, product: st.batchable && { design_id: st.batchable.design_id, garment: st.batchable.garment, color: st.batchable.color }, sizes: st.sizes_total, quantity: st.unbatched_quantity, session_ids: st.session_ids, needs_john: st.needs_john }; save();
log(`Stripe (${st.mode}): ${st.orders.length} paid unbatched line(s); batchable for Customania: ${st.unbatched_quantity} ${st.batchable?.garment || "item"}(s) ${JSON.stringify(st.sizes_total)} from ${st.session_ids.length} sale(s)`);
for (const o of st.orders) log(`  ${o.stripe_session_id} line ${o.line} ${o.design_id} ${o.garment}/${o.color} ${o.size} x${o.quantity} ${o.amount_total} ${o.paid_at}`);
for (const n of st.needs_john) log(`  NOT BATCHED (flagged to John): ${n.stripe_session_id}: ${n.reasons.join("; ")}`);
if (st.other_batchable_groups.length) log(`  ${st.other_batchable_groups.length} more makeable product group(s) wait for the next run`);
if (!st.unbatched_quantity || st.unbatched_quantity < MIN) { log(`nothing to do: ${st.unbatched_quantity} shirt(s) < min ${MIN}`); process.exit(0); }
const spec = st.print_spec;
if (st.open_batch && !st.open_batch.stale) { log(`STOPPED: batch ${st.open_batch.batch_ref} is still open (abort it or finish it first)`); process.exit(1); }

// 2. tools + Ops agent
const identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
const ctx = { openaiKey: envKey(ROOT, "OPENAI_API_KEY"), vettaKey: envKey(ROOT, "VETTA_API_KEY"), identityId: identity?.id, outDir: path.join(ROOT, "design-test"),
  runsDir: path.join(ROOT, "customania-runs"), rootDir: ROOT, mcpDir: MCP_DIR, log, billing: BILLING, cardName: `${BILLING.first} ${BILLING.last}` };
const conn = await connectTools(v, { ROOT, ctx, log });
const DEFS = agentDefs({});
const ops = await upsertAgent(v, DEFS.ops, { model: await pickModel(v), mcpUrl: conn.publicUrl + "/mcp", log });
if (identity) await v.identities.attach(ops.id, identity.id).catch(() => {});
log(`agent ${ops.name} ${ops.id} v${ops.current_version}`);

const ids = JSON.stringify(record.plan.session_ids), sizes = JSON.stringify(st.sizes_total), base = Object.keys(st.sizes_total)[0];
const build = (n) => `${n}. customania_start with base_size "${base}".
${n + 1}. FRONT: customania_upload side "front", design "${spec.front.design}"; customania_place side "front" width_in ${spec.front.width_in} top_in ${spec.front.top_in}. Retry place until within_tolerance is true.
${n + 2}. BACK: customania_upload side "back", design "${spec.design_id}"; customania_place side "back" width_in ${spec.back.width_in} top_in ${spec.back.top_in}. Retry until within_tolerance.
${n + 3}. customania_checkout with sizes ${sizes}, email "${CONTACT.email}", first_name "${CONTACT.first}", last_name "${CONTACT.last}". Check the cart lines are exactly ${sizes} in Black; if not, stop and report.`;
const message = DRY
  ? `Store sales batch for ${DROP}, DRY RUN: build and verify the Customania order, then stop before payment.
1. stripe_orders: confirm these paid, unbatched sales are listed: ${ids}, totalling ${sizes}. If not, stop and report.
${build(2)}
6. DRY RUN: do NOT call customania_handoff_payment, sales_batch_start or stripe_mark_batched. Read the checkout total.
7. customania_close.
End with exactly: RESULT: {"dry":true,"sizes":${sizes},"total":"<checkout total>","cart_matches":true|false,"issues":"<or none>"}`
  : `Store sales batch for ${DROP}: order the paid store sales from Customania in ONE order; John pays.
1. sales_batch_start with session_ids ${ids}. It returns batch_ref and sizes; the sizes must be ${sizes}. If it refuses, stop and report.
${build(2)} If the cart doesn't match: sales_batch_abort, customania_close, stop.
6. customania_handoff_payment with amount_due = the checkout total. It needs John's OK in Naïve Studio; that's expected. Then customania_payment_status again and again (each call waits up to a minute) until state is "paid" or "timed_out". Don't close while it says waiting.
7. If paid: stripe_mark_batched with session_ids ${ids}, the batch_ref and customania_order = the order number. If not paid: sales_batch_abort with the reason.
8. customania_close.
End with exactly: RESULT: {"batch_ref":"<ref>","sizes":${sizes},"total":"<checkout total>","paid":true|false,"order_number":"<or null>","marked":true|false,"issues":"<or none>"}`;

try {
  const r = await runSession(v, { label: "ops", agent: ops, message, budget: 3_000_000, identity: identity?.id, byName: defsByName(DEFS), log,
    onRecord: (x) => { record.sessions.push(x); save(); }, maxMin: 40 });
  Object.assign(record.sessions.at(-1), { status: r.status, result: r.result, ended: new Date().toISOString() });
  record.result = r.result; save();
  log(`result: ${JSON.stringify(r.result) || r.text.slice(0, 300)}`);
} catch (e) { log("STOPPED: " + e.message); record.error = e.message; save(); }
log(`record: order-runs/${path.basename(RUN)}/record.json`);
conn.stop();
log("== sales run done");
process.exit(0);
