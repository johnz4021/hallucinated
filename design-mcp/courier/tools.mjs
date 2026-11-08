// Courier dispatch through MobileRun driving the Uber app on John's own iPhone (Uber Courier).
// Start-then-poll (phone tasks take ~3-5 min; our tunnel cuts requests at ~100 s):
//   courier_quote  -> dry run to Uber's final screen, books nothing (allow)
//   courier_book   -> actually requests the courier, only if the price is under max_price_usd (Naïve "ask": John approves)
//   courier_status -> waits up to 60 s, returns the phone task's state and result
// pickup_time "HH:MM" (SF, today) on quote/book uses Uber's own scheduling ("Schedule"/"Later"): the booking is made now
// for a courier that comes at that time. Quote with the same pickup_time first so the schedule screen is proven.
// Needs MOBILERUN_API_KEY in .env (optional MOBILERUN_DEVICE_ID; default: the first ready iPhone).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const API = "https://api.mobilerun.ai/v1";
const PICKUP = "Customania, 3251 20th Ave, San Francisco, CA";
const DROPOFF = "Y Combinator, 560 20th St, San Francisco, CA";
const UBER_IOS = "com.ubercab.UberClient";
const txt = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 2) }] });
const err = (m) => ({ isError: true, content: [{ type: "text", text: m }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OUTPUT = { type: "object", properties: {
  reached_final_screen: { type: "boolean" }, booked: { type: "boolean" }, service_name: { type: "string" },
  pickup_resolved: { type: "string" }, scheduled_for: { type: "string" }, dropoff_resolved: { type: "string" }, price: { type: "string" }, eta: { type: "string" },
  courier_or_trip_status: { type: "string" }, blockers: { type: "string" } }, required: ["reached_final_screen", "booked"] };

const ampm = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
function brief({ order_number, dropoff, book, max_price_usd, pickup_time }) {
  const when = pickup_time ? `
- SCHEDULE it, don't send it now: use Uber's scheduling option for this delivery (a "Schedule", "Later", "Reserve" or clock/calendar control, usually next to "Now" or on the final screen). Pick TODAY and the pickup time ${ampm(pickup_time)} (if Uber offers windows, the window that starts at ${ampm(pickup_time)}, else the closest one starting between 15 minutes before and ${ampm(pickup_time)}). Confirm the screen shows today and that time before going on, and report it as scheduled_for.
- If Uber offers no scheduling for this delivery, or not today at that time, STOP: request nothing and report it in blockers.` : "";
  const setup = `In the Uber app, set up a package delivery (Uber's "Courier", "Package" or "Send" option, not a ride):
- Pickup (sender's location): ${PICKUP}. Sender: John Zhang.
- Dropoff (recipient's location): ${dropoff || DROPOFF}. Recipient: John Zhang.
- Item: clothing / t-shirts, small. Pickup notes: "Customania order ${order_number || ""} for John Zhang, custom t-shirts, ask at the counter".
Check the pickup really is Customania on 20th Ave and the dropoff is the address above before continuing.${when}
Never change payment methods, tips or account settings. Never open any other app.`;
  return book
    ? `${setup}
Go to the final screen with the price. If the standard price is at most $${max_price_usd}, tap the button that requests${pickup_time ? " (schedules)" : ""} the courier ONCE, then wait until Uber shows it ${pickup_time ? "is scheduled (an upcoming/reserved delivery for that time)" : "is matching or assigning a courier"}, and report it. If the price is higher, do NOT request: go back and report the price.`
    : `DRY RUN. Do NOT book, request, confirm, send or pay for anything. Never tap a final button such as "Request", "Confirm", "Book" or "Send package".
${setup}
Go as far as the final screen that shows the price and the request button, STOP without tapping it, then go back one screen so nothing is pending. Report what you saw.`;
}

export function registerCourierTools(server, ctx) {
  const env = fs.existsSync(path.join(ctx.rootDir, ".env")) ? fs.readFileSync(path.join(ctx.rootDir, ".env"), "utf8") : "";
  const k = (n) => (env.match(new RegExp(`^${n}\\s*=\\s*["']?([^\\s"']+)`, "m")) || [])[1];
  const key = k("MOBILERUN_API_KEY");
  if (!key) { ctx.log?.("courier tools off: MOBILERUN_API_KEY not in .env"); return; }
  const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const api = async (method, p, body) => {
    const r = await fetch(API + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`MobileRun ${method} ${p} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  };
  async function device() {
    if (k("MOBILERUN_DEVICE_ID")) return k("MOBILERUN_DEVICE_ID");
    const d = await api("GET", "/devices");
    const phone = (d.items || []).find((x) => x.platform === "ios" && x.state === "ready") || (d.items || []).find((x) => x.state === "ready");
    if (!phone) throw new Error("no connected phone in MobileRun: open the Portal / mobilerun-ios connection on John's phone");
    return phone.id;
  }
  async function start(args, book) {
    const deviceId = await device();
    const t = await api("POST", "/tasks", { deviceId, task: brief({ ...args, book }), apps: [UBER_IOS], maxSteps: 45, vision: true, outputSchema: OUTPUT });
    ctx.log?.(`[courier] ${book ? "BOOK" : "quote"} task ${t.id} on ${deviceId} ${JSON.stringify(args)}`);
    return txt({ task_id: t.id, status: t.status, next: "call courier_status with this task_id until status is completed or failed (each call waits up to a minute)" });
  }

  server.registerTool("courier_quote", {
    title: "Get an Uber Courier quote (books nothing)",
    description: "Uses John's phone to set up an Uber Courier delivery from Customania (pickup) to the YC office (or `dropoff`) and stops at Uber's final screen: returns price and ETA via courier_status. Books nothing. Takes ~3-5 min.",
    inputSchema: { order_number: z.string().optional(), dropoff: z.string().optional(), pickup_time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional().describe("HH:MM, 24 h, San Francisco time today: schedule the courier in Uber for this pickup time instead of sending one now") },
  }, async (a) => { try { return await start(a, false); } catch (e) { return err(`courier_quote failed: ${e.message}`); } });

  server.registerTool("courier_book", {
    title: "Book the Uber Courier (spends money, needs human OK)",
    description: "Uses John's phone to request an Uber Courier from Customania to the YC office (or `dropoff`), only if the price is at most max_price_usd. Real charge on John's card, so it is always held for his approval. Get a quote first and pass max_price_usd a little above it. Follow with courier_status.",
    inputSchema: { order_number: z.string(), max_price_usd: z.number().min(1).max(60), dropoff: z.string().optional(), pickup_time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional().describe("HH:MM, 24 h, San Francisco time today: schedule the courier in Uber for this pickup time instead of sending one now") },
  }, async (a) => { try { return await start(a, true); } catch (e) { return err(`courier_book failed: ${e.message}`); } });

  server.registerTool("courier_status", {
    title: "Check a courier task on the phone",
    description: "Waits up to 60 s, then returns the phone task's status (running / completed / failed) and, when done, what Uber showed: price, ETA, pickup/dropoff, whether it booked.",
    inputSchema: { task_id: z.string() },
  }, async ({ task_id }) => {
    try {
      let s;
      for (let i = 0; i < 6; i++) {
        s = await api("GET", `/tasks/${task_id}/status`);
        if (["completed", "failed", "cancelled"].includes(s.status)) break;
        await sleep(10_000);
      }
      if (["completed", "failed", "cancelled"].includes(s.status)) ctx.log?.(`[courier] task ${task_id} ${s.status}: ${JSON.stringify(s.output || s.message).slice(0, 300)}`);
      return txt({ status: s.status, succeeded: s.succeeded, result: s.output, message: s.message?.slice?.(0, 1500) });
    } catch (e) { return err(`courier_status failed: ${e.message}`); }
  });
}
