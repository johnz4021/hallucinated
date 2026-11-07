// One-time X Ads sign-in (OAuth 2.0 + PKCE). Opens your browser; you approve as @hallucinateddpt; the token is saved
// to ../.x-ads-token.json (git-ignored, never printed). Then lists your ads accounts to prove it works.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { adsEnv, tokenRequest, AdsToken, adsCall, ADS_SCOPES, CALLBACK } from "./ads.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG = path.join(ROOT, "naive.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const creds = adsEnv(fs.readFileSync(path.join(ROOT, ".env"), "utf8"));
if (!creds.clientId) { log("X Ads login: X_CLIENT_ID missing in .env"); process.exit(1); }

// --basic: sign in WITHOUT ads permissions, to tell "ads access not enabled" apart from callback/app-type problems
const BASIC = process.argv.includes("--basic");
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const state = crypto.randomBytes(12).toString("hex");
const url = "https://x.com/i/oauth2/authorize?" + new URLSearchParams({ response_type: "code", client_id: creds.clientId, redirect_uri: CALLBACK,
  scope: BASIC ? "tweet.read users.read offline.access" : ADS_SCOPES, state, code_challenge: challenge, code_challenge_method: "S256" });

log("== X Ads login: approve in the browser window that opens (sign in as @hallucinateddpt)");
const code = await new Promise((resolve, reject) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, CALLBACK);
    if (u.pathname !== "/callback") { res.end(); return; }
    const err = u.searchParams.get("error");
    res.end(err ? `X said: ${err}. You can close this tab.` : "Hallucinated: X Ads connected. You can close this tab.");
    srv.close();
    if (err || u.searchParams.get("state") !== state) reject(new Error(err || "state mismatch")); else resolve(u.searchParams.get("code"));
  }).listen(8080, "127.0.0.1", () => exec(`open "${url}"`));
  setTimeout(() => { srv.close(); reject(new Error("timed out after 5 min")); }, 300_000);
}).catch((e) => { log("X Ads login FAILED: " + e.message); process.exit(1); });

try {
  const t = await tokenRequest(creds, { grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier });
  if (BASIC) { log(`BASIC sign-in worked (scopes: ${t.scope}). So the callback and app type are fine; the ads permissions are what X refuses: enable Ads Project access for the app.`); log("== X Ads login done"); process.exit(0); }
  const store = new AdsToken(ROOT, creds); store.save(t);
  log(`X Ads token saved (scopes: ${t.scope})`);
  const tools = await adsCall(store, "__list__");
  log(`Ads MCP OK: ${tools.tools.length} tools`);
  const listName = tools.tools.map((x) => x.name).find((n) => /list_.*accounts|accounts_list|get_accounts/i.test(n));
  if (listName) { const r = await adsCall(store, listName, {}); log(`${listName}: ${JSON.stringify(r.content ?? r).slice(0, 800)}`); }
} catch (e) { log("X Ads setup FAILED: " + e.message); }
log("== X Ads login done");
process.exit(0);
