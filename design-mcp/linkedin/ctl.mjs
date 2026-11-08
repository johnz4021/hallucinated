// LinkedIn kill switch + status (the API route):
//   node linkedin/ctl.mjs pause [reason]   pause_linkedin.command     node linkedin/ctl.mjs resume   resume_linkedin.command
//   node linkedin/ctl.mjs status
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "../lib/state.mjs";
import { loadToken } from "./li.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = path.join(ROOT, "linkedin-ledger.json");
const l = readJson(file, { paused: false, reason: null, posts: [] });
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "pause") { Object.assign(l, { paused: true, reason: rest.join(" ") || "paused by hand" }); writeJson(file, l); console.log("LinkedIn posting is PAUSED. resume_linkedin.command turns it back on."); }
else if (cmd === "resume") { Object.assign(l, { paused: false, reason: null }); writeJson(file, l); console.log("LinkedIn posting is back on (still 1 post per Pacific day)."); }
else if (cmd === "status") {
  const t = loadToken(ROOT);
  console.log(`connected: ${t ? `${t.name || t.person_urn}, token valid until ${new Date(t.expires_at).toLocaleString()}` : "no (run linkedin_login.command)"}`);
  console.log(`posting: ${l.paused ? `PAUSED (${l.reason})` : "on"}; posts: ${(l.posts || []).length}${(l.posts || []).length ? `, last ${l.posts.at(-1).at} ${l.posts.at(-1).url || ""}` : ""}`);
  console.log(`org ids: ${JSON.stringify(readJson(path.join(ROOT, "linkedin-orgs.json"), {}))}`);
} else { console.error("usage: node linkedin/ctl.mjs pause [reason] | resume | status"); process.exit(1); }
