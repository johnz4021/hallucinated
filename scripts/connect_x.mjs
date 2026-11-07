process.on('unhandledRejection', e => { console.error(e); });
// Connect the brand's X account to a Naïve identity. Reads VETTA_API_KEY from ../.env, logs to ../naive.log. Never prints the key.
import { createClient } from "@usenaive-sdk/vetta";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const ROOT = path.resolve(process.cwd(), "..");
const LOG = path.join(ROOT, "naive.log");
const log = (m) => {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${typeof m === "string" ? m : JSON.stringify(m)}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const short = (o, n = 800) => JSON.stringify(o)?.slice(0, n);
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const apiKey = (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1];
if (!apiKey) { log("No VETTA_API_KEY found in .env"); process.exit(1); }
const c = createClient({ baseUrl: "https://api.vetta.sh", apiKey });
const step = async (name, fn) => {
  try { const r = await fn(); log(`OK  ${name}: ${short(r)}`); return r; }
  catch (e) { log(`ERR ${name}: ${e?.status ?? ""} ${e?.code ?? ""} ${String(e?.message ?? e).slice(0, 400)}`); return null; }
};

log("== connect X");
const ids = await step("identities.list", () => c.identities.list({ limit: 50 }));
let identity = (ids?.data || []).find((i) => /hallucinated/i.test(i.name));
if (!identity) identity = await step("identities.create", () => c.identities.create({ name: "Hallucinated", description: "Agent-run streetwear brand" }));
if (!identity?.id) { log("No identity, stopping."); process.exit(1); }
log("identity: " + identity.id);

await step("social.activate", () => c.social.activate(identity.id));
await step("social.status", () => c.social.status(identity.id));

const hasX = async () => {
  const a = await step("social.accounts", () => c.social.accounts(identity.id));
  return (a?.data || []).find((x) => x.platform === "x");
};
let x = await hasX();
if (!x) {
  const portal = await step("social.portal", () => c.social.portal(identity.id, { platforms: ["x"] }));
  if (!portal?.url) { log("No portal link, stopping."); process.exit(1); }
  fs.writeFileSync(path.join(ROOT, "x-connect-link.txt"), portal.url + "\n");
  log(">>> Opening the connect page in your browser. Sign in to the brand's X account and approve.");
  execFile("open", [portal.url]);
  for (let i = 0; i < 60 && !x; i++) { await new Promise((r) => setTimeout(r, 10000)); x = await hasX(); }
}
if (x) log(`CONNECTED X: @${x.username} (${x.display_name})`);
else log("X not connected after 10 minutes. The link is in x-connect-link.txt; run again after connecting.");

try {
  const mm = await (c.media.listModels || c.media?.models?.listModels)?.({ kind: "video", limit: 50 });
  if (mm) log("video models: " + (mm.data || []).map((m) => m.id).join(", "));
} catch (e) { log("media.models: " + String(e?.message ?? e).slice(0, 200)); }
log("== done");
