// One-time: connect John's LinkedIn (self-serve "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect").
// Redirect URL registered in the LinkedIn app: http://127.0.0.1:8080/linkedin/callback
// Saves <root>/.linkedin-token.json (access token ~60 days + John's member URN). Never prints the token.
//   node linkedin/login.mjs          sign in        node linkedin/login.mjs --check   show who's connected
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { envKey } from "../lib/state.mjs";
import { tokenFile, loadToken } from "./li.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REDIRECT = "http://127.0.0.1:8080/linkedin/callback";
if (process.argv.includes("--check")) {
  const t = loadToken(ROOT);
  console.log(t ? `connected: ${t.name} (${t.person_urn}), token valid until ${new Date(t.expires_at).toLocaleString()}` : "not connected (or expired): run linkedin_login.command");
  process.exit(0);
}
const id = envKey(ROOT, "LINKEDIN_CLIENT_ID"), secret = envKey(ROOT, "LINKEDIN_CLIENT_SECRET");
if (!id || !secret) { console.error("Put LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env first."); process.exit(1); }
const state = crypto.randomBytes(12).toString("hex");
const url = "https://www.linkedin.com/oauth/v2/authorization?" + new URLSearchParams({ response_type: "code", client_id: id, redirect_uri: REDIRECT, state, scope: "openid profile w_member_social" });

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== "/linkedin/callback") { res.writeHead(404).end(); return; }
  const done = (code, msg) => { res.writeHead(code, { "Content-Type": "text/plain" }).end(msg); console.log(msg); setTimeout(() => process.exit(code === 200 ? 0 : 1), 300); };
  if (u.searchParams.get("state") !== state) return done(400, "state mismatch, try again");
  if (u.searchParams.get("error")) return done(400, `LinkedIn said: ${u.searchParams.get("error")} ${u.searchParams.get("error_description") || ""}`);
  try {
    const tr = await fetch("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: u.searchParams.get("code"), redirect_uri: REDIRECT, client_id: id, client_secret: secret }) });
    const tj = await tr.json();
    if (!tr.ok || !tj.access_token) return done(400, `token exchange failed (${tr.status}): ${JSON.stringify({ error: tj.error, error_description: tj.error_description })}`);
    const ui = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${tj.access_token}` } }).then((r) => r.json());
    if (!ui.sub) return done(400, "signed in, but userinfo returned no member id: check the app has 'Sign In with LinkedIn using OpenID Connect'");
    if (!String(tj.scope || "").includes("w_member_social")) return done(400, `token has no w_member_social (scopes: ${tj.scope}): add 'Share on LinkedIn' in the app's Products tab, then sign in again`);
    fs.writeFileSync(tokenFile(ROOT), JSON.stringify({ access_token: tj.access_token, expires_at: Date.now() + (tj.expires_in || 5184000) * 1000 - 3600_000,
      person_urn: `urn:li:person:${ui.sub}`, name: ui.name || null, scope: tj.scope, saved_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
    done(200, `LinkedIn connected as ${ui.name || ui.sub}. You can close this tab.`);
  } catch (e) { done(500, "login failed: " + e.message); }
});
srv.listen(8080, "127.0.0.1", () => {
  console.log("Opening LinkedIn sign-in in your browser…");
  execFile("open", [url]);
});
setTimeout(() => { console.log("timed out after 5 min"); process.exit(1); }, 300_000);
