// Adds the front (Hallucinated wordmark) to agent products published before the two-sided rule, in place:
// images [back, FRONT, flat], metadata front=wordmark, feature "Front: Hallucinated wordmark". Idempotent.
//   node designs/backfill_front.mjs <slug> [slug ...] [--dry]      (sandbox; STRIPE_LIVE_OK=1 for the live store)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripeClient } from "../stripe/tools.mjs";
import { storeAdmin, backfillFront } from "./publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry"), slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slugs.length) { console.error("usage: node designs/backfill_front.mjs <slug> [...] [--dry]"); process.exit(1); }
const sc = stripeClient(ROOT), admin = storeAdmin(ROOT);
if (sc.error || admin.error) { console.error(sc.error || admin.error); process.exit(1); }
console.log(`backfill front in Stripe ${sc.mode.toUpperCase()}${dry ? " (dry run: nothing written)" : ""}`);
for (const slug of slugs) console.log(JSON.stringify(await backfillFront({ sc, admin, rootDir: ROOT, slug, dry, log: console.log }), null, 1));
process.exit(0);
