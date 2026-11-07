// One X recent search for "AI agents" using the four OAuth 1.0a keys that already post (no bearer token). Read-only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xKeys, xSearch } from "./xapi.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const keys = xKeys(fs.readFileSync(path.join(ROOT, ".env"), "utf8"));
log("== X API search test (user keys)");
try {
  const posts = await xSearch(keys, '"AI agents" -is:retweet lang:en', 10);
  log(`X search OK: ${posts.length} posts; samples: ${posts.slice(0, 5).map((p) => `[@${p.author} ${p.like_count ?? 0} likes] ${p.text.replace(/\s+/g, " ").slice(0, 110)}`).join(" || ")}`);
} catch (e) { log("X search FAILED: " + e.message); }
log("== X API search test done");
