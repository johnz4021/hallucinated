// Dry run of the full order flow. Stops before payment (no card is touched).
// Output: ../customania-runs/<session>/ screenshots + result.json, log in ../customania-runs/test.log
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CustomaniaSession } from "./customania.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, ".."), ROOT = path.resolve(MCP, "..");
const OUT = path.join(ROOT, "customania-runs"); fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, "test.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const j = (o) => JSON.stringify(o, (k, v) => (typeof v === "number" ? +v.toFixed?.(2) ?? v : v));
const result = {};
const s = new CustomaniaSession({ root: ROOT, outDir: OUT, log });
const save = () => fs.writeFileSync(path.join(s.dir, "result.json"), JSON.stringify(result, null, 2));
log("== test order (dry run, stops before payment)");
try {
  result.start = await s.start(); log("start: " + j(result.start));
  result.front_upload = await s.upload("front", path.join(MCP, "refs", "logo.png")); log("front upload: " + j(result.front_upload));
  result.front_place = await s.place("front", { width_in: 10, top_in: 1.5 }); log("front place: " + j({ after: result.front_place.after, ok: result.front_place.within_tolerance, err: result.front_place.error }));
  result.back_upload = await s.upload("back", path.join(MCP, "refs", "git-reset-back.png")); log("back upload: " + j(result.back_upload));
  result.back_place = await s.place("back", { width_in: 11, top_in: 1 }); log("back place: " + j({ after: result.back_place.after, ok: result.back_place.within_tolerance, err: result.back_place.error }));
  result.front_check = await s.measure("front"); log("front re-check after back: " + j(result.front_check));
  result.preview = await s.preview(); log("preview: " + result.preview);
  save();
  if (process.argv.includes("--place-only")) throw Object.assign(new Error("place-only run: stopping before cart"), { quiet: true });
  result.cart = await s.toCart({ S: 2, M: 3, L: 3, XL: 2 }); log("cart: " + j(result.cart));
  save();
  result.checkout = await s.checkout({ email: "ops@example.com", first: "Hallucinated", last: "Ops" });
  log("checkout: " + j(result.checkout));
  log("STOPPED before payment. Nothing paid.");
} catch (e) {
  if (e.quiet) log(e.message); else { log("EXCEPTION: " + (e.stack || e.message).slice(0, 800)); result.error = e.message; await s.shot("exception"); }
} finally {
  save();
  log(`results: customania-runs/${s.id}/`);
  await new Promise((r) => setTimeout(r, process.argv.includes("--place-only") ? 8000 : 20000));
  await s.close();
  log("== test order done");
}
