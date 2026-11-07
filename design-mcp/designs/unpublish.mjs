// For John (agents don't get this): take an agent design off the store.
//   node designs/unpublish.mjs <slug>          # the store's current mode (live when STRIPE_LIVE_OK=1, else the sandbox)
// Archives every active Stripe product with metadata.slug = <slug> and all its prices, removes the "designs" dossier,
// revalidates the site, and marks the proposal unpublished in design-proposals.json.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripeClient } from "../stripe/tools.mjs";
import { storeAdmin, archiveDesign } from "./publish.mjs";
import { loadProposals, saveProposals } from "./ledger.mjs";
import { SLUG_RE } from "./guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const slug = process.argv[2];
if (!slug || !SLUG_RE.test(slug)) { console.error("usage: node designs/unpublish.mjs <slug>   (e.g. merge-conflict-tee)"); process.exit(1); }
const sc = stripeClient(ROOT), admin = storeAdmin(ROOT);
if (sc.error || admin.error) { console.error(sc.error || admin.error); process.exit(1); }
console.log(`unpublishing ${slug} in Stripe ${sc.mode.toUpperCase()} mode...`);
const r = await archiveDesign({ sc, admin, slug, log: console.log });
const l = loadProposals(ROOT);
for (const p of Object.values(l.proposals)) if (p.slug === slug && p.mode === sc.mode && p.state === "published") Object.assign(p, { state: "unpublished", unpublished_at: new Date().toISOString() });
saveProposals(ROOT, l);
console.log(JSON.stringify(r, null, 2));
if (!r.archived.length) console.log(`no active product with slug ${slug} in ${sc.mode} mode`);
process.exit(0);
