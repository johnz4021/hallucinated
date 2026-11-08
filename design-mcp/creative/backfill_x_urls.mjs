// Retries the store x_url link for every posted ad that doesn't have it on the store yet (CONTENT.md §5).
//   node creative/backfill_x_urls.mjs        (live ads)   |   ADS_TEST=1 node creative/backfill_x_urls.mjs (test ads)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xKeys, xMe } from "../x/xapi.mjs";
import { backfillXUrls } from "./x_urls.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const keys = xKeys(fs.readFileSync(path.join(ROOT, ".env"), "utf8"));
const username = keys ? (await xMe(keys).catch(() => ({ data: {} }))).data?.username : null;
const out = await backfillXUrls({ rootDir: ROOT, username: username || "hallucinateddpt", log: console.log });
console.log(`${out.length} posted ad(s) needed an x_url on the store: ${out.filter((o) => o.ok).length} done, ${out.filter((o) => !o.ok).length} not yet`);
process.exit(0);
