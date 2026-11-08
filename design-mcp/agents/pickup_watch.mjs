process.on("unhandledRejection", (e) => { console.error(e); });
// One-off pickup listener (demo, Sat Nov 7): on the clock every N minutes (:00, :05, :10 ...) it checks
// hallucinated@agentmail.to for a "ready for pickup" mail about drop #1 (Customania's own notice, or John relaying
// Customania's phone call, e.g. subject "Pickup: CF5A93CRK"). On a hit it marks the mail handled (so Support skips it),
// records the request in courier-requests.json (same ledger as ops_courier_request: one request per order, ever) and
// starts ONE Ops session: Uber Courier quote on John's iPhone through Uber's schedule screen, then courier_book with
// pickup_time 19:30 (Uber schedules the courier for 7:30 pm), which waits for John's approval in Naïve Studio.
// Exits when that Ops session ends. Needs serve.command running (the tools live there).
//   node agents/pickup_watch.mjs [--every 5] [--pickup 19:30] [--now] [--dry]
//   --now: also check immediately   --dry: report what it would do, change nothing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createClient } from "@usenaive-sdk/vetta";
import { agentDefs, defsByName } from "./defs.mjs";
import { runSession, sleep } from "./runtime.mjs";
import { agentMail, classify, orderNumber, INBOX } from "../agentmail/tools.mjs";
import { envKey, readJson, writeJson, appendJsonl } from "../lib/state.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const val = (f) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : null);
const EVERY = Math.max(1, Number(val("--every") || 5)), PICKUP = val("--pickup") || "19:30";
const DRY = argv.includes("--dry"), NOW = argv.includes("--now");
const ORDER = "CF5A93CRK", ORDER_RE = /CF5A93CRK|#\s?1506\b|\border\s+1506\b/i;  // Customania confirmation CF5A93CRK = order #1506

const RUN = path.join(ROOT, "order-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "_pickup");
fs.mkdirSync(RUN, { recursive: true });
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(RUN, "run.log"), l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const notify = (msg) => { try { execFile("osascript", ["-e", `display notification ${JSON.stringify(msg)} with title "Hallucinated" sound name "Glass"`]); } catch {} };
const clock = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const am = agentMail(ROOT);
if (!am) { console.error("AGENTMAIL_API_KEY missing from .env"); process.exit(1); }
const box = encodeURIComponent(INBOX);
const LEDGER = path.join(ROOT, "inbox-ledger.json"), REQUESTS = path.join(ROOT, "courier-requests.json");

const pickupHHMM = (() => { const [h, m] = PICKUP.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; })();
const brief = (msg) => `Pickup trigger from the brand inbox: "${msg.subject}" (from ${msg.from}). Customania order ${ORDER} (their order #1506: drop #1, 4 black tees S/M/L/XL) is ready, and Customania wants it picked up at ${pickupHHMM} today (they close at 8 pm). Get it couriered from Customania to the YC office.
Think out loud briefly at each step, for the record.
1. courier_quote with order_number "${ORDER}" and pickup_time "${PICKUP}": a dry run on John's phone through Uber's schedule screen for a ${pickupHHMM} pickup. Then call courier_status with the task_id again and again until status is completed or failed (phone tasks take 3-5 minutes).
2. If the quote reached the final screen with a price AND scheduled_for shows today at ${pickupHHMM}: courier_book with order_number "${ORDER}", pickup_time "${PICKUP}" and max_price_usd = the quoted standard price rounded up + $5 (never more than $45). It waits for John's approval in Naïve Studio; that is expected. Then courier_status until completed or failed, and check booked is true and scheduled_for is ${pickupHHMM} today.
3. If the quote failed, showed no scheduling for that time, or the price is over $40: don't book. flag_john with exactly what you saw.
End with one line: RESULT: {"order_number":"${ORDER}","quoted":"<price or null>","booked":true|false,"scheduled_for":"<or null>","issues":"<or none>"}`;

function isTrigger(m) {
  const kind = classify(m);
  if (["self", "automated"].includes(kind)) return false;
  const s = `${m.subject || ""} ${m.preview || ""}`;
  if (kind === "ready_for_pickup") return true;                                   // Customania's own notice
  return /pick\s?-?up|ready/i.test(s) && ORDER_RE.test(s);                       // a relay naming the order
}

async function check() {
  if (readJson(REQUESTS, {})[ORDER]) { log(`courier already requested for ${ORDER} (courier-requests.json); nothing to do`); return "done"; }
  const r = await am("GET", `/inboxes/${box}/messages?limit=30`);
  const led = readJson(LEDGER, {});
  const hit = (r.messages || []).find((m) => !led[m.message_id]?.handled_at && isTrigger(m));
  if (!hit) { log(`checked ${INBOX}: ${(r.messages || []).length} messages, no new pickup mail`); return null; }
  log(`PICKUP MAIL: "${hit.subject}" from ${hit.from} at ${hit.timestamp} (${classify(hit)})`);
  if (DRY) { log("--dry: would mark it handled and start the Ops courier session"); return "done"; }

  led[hit.message_id] = { kind: "ready_for_pickup", handled_at: new Date().toISOString(), order_number: ORDER, note: "pickup_watch trigger" };
  writeJson(LEDGER, led);
  appendJsonl(path.join(ROOT, "order-events.jsonl"), { kind: "ready_for_pickup", order_number: ORDER, message_id: hit.message_id, subject: hit.subject, mail_at: hit.timestamp, note: `pickup ${PICKUP}` });
  notify(`Pickup mail for ${ORDER}: Ops is getting an Uber Courier for ${pickupHHMM}`);

  const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });
  const ops = ((await v.agents.list({ limit: 100 })).data || []).find((a) => a.name === "hallucinated-ops");
  if (!ops) throw new Error("no hallucinated-ops agent (run setup_agents)");
  const identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
  const reqs = readJson(REQUESTS, {});
  reqs[ORDER] = { order_number: ORDER, message_id: hit.message_id, ops_session: null, requested_at: new Date().toISOString(), via: "pickup_watch" };
  writeJson(REQUESTS, reqs);
  const res = await runSession(v, { label: "ops", agent: ops, message: brief(hit), budget: 1_500_000, identity: identity?.id,
    byName: defsByName(agentDefs({})), log, maxMin: 40,
    onRecord: (x) => { const q = readJson(REQUESTS, {}); q[ORDER].ops_session = x.session; writeJson(REQUESTS, q); } });
  log(`ops finished (${res.status}): ${JSON.stringify(res.result) || res.text.slice(0, 400)}`);
  if (res.result?.booked) { log(`courier SCHEDULED in Uber for ${res.result.scheduled_for || pickupHHMM} (check Activity > Upcoming on the phone; cancel there if needed)`); notify(`Courier scheduled for ${ORDER}: ${res.result.scheduled_for || pickupHHMM}`); }
  else { log("NO courier booked: see the Ops session / flags, or book it by hand in Uber"); notify(`No courier booked for ${ORDER}: check Naïve Studio`); }
  return "done";
}

log(`== pickup watch: ${INBOX} every ${EVERY} min, order ${ORDER}, pickup ${pickupHHMM}${DRY ? " (DRY)" : ""}`);
try {
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, ".serve.json"), "utf8"));
  const ok = await fetch(st.url + "/health", { signal: AbortSignal.timeout(10000) }).then((r) => r.ok).catch(() => false);
  log(ok ? `serve is up at ${st.url}` : "WARNING: serve.command isn't answering; start it first or the courier tools won't work");
} catch { log("WARNING: serve.command isn't running; start it first or the courier tools won't work"); }
if (NOW && (await check().catch((e) => (log("check failed: " + e.message), null))) === "done") process.exit(0);
for (;;) {
  const next = Math.ceil((Date.now() + 1000) / (EVERY * 60_000)) * EVERY * 60_000;
  log(`next check at ${clock(new Date(next))}`);
  await sleep(next - Date.now());
  const r = await check().catch((e) => { log("check failed: " + e.message); return null; });
  if (r === "done") break;
}
process.exit(0);
