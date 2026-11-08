// Pushes ads whose store copy is missing (media not on Blob yet, or no campaign entry) to the store: the same
// publishAdToStore as ad_submit. Used after a run with ADS_SKIP_STORE=1, or if the store was down.
//   ADS_TEST=1 node creative/publish_ads.mjs     (test ads, written with test:true)   |   node creative/publish_ads.mjs (live ads)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
import { envKey } from "../lib/state.mjs";
import { loadAds, testMode } from "./ledger.mjs";
import { publishAdToStore } from "./tools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });
const todo = Object.values(loadAds(ROOT).ads).filter((a) => !!a.test === testMode() && !a.campaign?.ok && a.state !== "withdrawn");
console.log(`${todo.length} ${testMode() ? "test" : "live"} ad(s) without a store copy`);
for (const ad of todo) console.log(ad.id, JSON.stringify(await publishAdToStore({ v, rootDir: ROOT, ad, outDir: path.join(ROOT, "design-test"), baseUrl: null })));
process.exit(0);
