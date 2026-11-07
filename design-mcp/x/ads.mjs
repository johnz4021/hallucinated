// X Ads: OAuth 2.0 user token (ads.read ads.write offline.access) + a client for X's hosted Ads MCP (https://ads-api.x.com/mcp).
// Token lives in ../.x-ads-token.json (git-ignored), refreshed automatically (access ~2 h, refresh tokens rotate).
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const ADS_MCP = "https://ads-api.x.com/mcp";
export const ADS_SCOPES = "ads.read ads.write offline.access tweet.read users.read";
export const CALLBACK = "http://127.0.0.1:8080/callback";

export function adsEnv(env) {
  const k = (n) => (env.match(new RegExp(`^${n}\\s*=\\s*["']?([^\\s"']+)`, "m")) || [])[1];
  return { clientId: k("X_CLIENT_ID"), clientSecret: k("X_CLIENT_SECRET") };
}

export async function tokenRequest({ clientId, clientSecret }, params) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams({ ...params, client_id: clientId });
  if (clientSecret) headers.Authorization = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await fetch("https://api.x.com/2/oauth2/token", { method: "POST", headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`X token ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return { ...j, obtained_at: Date.now() };
}

export class AdsToken {
  constructor(root, creds) { this.file = path.join(root, ".x-ads-token.json"); this.creds = creds; }
  load() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return null; } }
  save(t) { fs.writeFileSync(this.file, JSON.stringify(t, null, 2), { mode: 0o600 }); }
  async access() {
    let t = this.load();
    if (!t?.refresh_token) throw new Error("no X Ads token yet: run x_ads_login.command once");
    if (!t.access_token || Date.now() > t.obtained_at + (t.expires_in - 300) * 1000) {
      t = await tokenRequest(this.creds, { grant_type: "refresh_token", refresh_token: t.refresh_token });
      this.save(t);   // refresh tokens rotate: always keep the newest
    }
    return t.access_token;
  }
}

// One MCP call against X's Ads MCP with a fresh token (new connection per call; simple and stateless).
export async function adsCall(token, name, args) {
  const client = new Client({ name: "hallucinated", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ADS_MCP), { requestInit: { headers: { Authorization: `Bearer ${await token.access()}` } } });
  await client.connect(transport);
  try { return name === "__list__" ? await client.listTools() : await client.callTool({ name, arguments: args || {} }); }
  finally { await client.close().catch(() => {}); }
}
