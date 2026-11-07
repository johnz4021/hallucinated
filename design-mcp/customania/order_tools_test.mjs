// Drives the order through the MCP tools exactly like the Ops agent will (local MCP client, no Naïve).
// node customania/order_tools_test.mjs [vcd_card_id]  -> with a card id it also fills the card and stops (confirm=false).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient } from "@usenaive-sdk/vetta";
import { startServer } from "../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, ".."), ROOT = path.resolve(MCP, "..");
const LOG = path.join(ROOT, "customania-runs", "tools-test.log");
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const key = (n) => (env.match(new RegExp(`${n}\\s*=\\s*["']?([^\\s"']+)`)) || [])[1];
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: key("VETTA_API_KEY") });
const identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
const PORT = 8789, token = crypto.randomBytes(12).toString("hex");
const ctx = { openaiKey: key("OPENAI_API_KEY"), vettaKey: key("VETTA_API_KEY"), identityId: identity.id, outDir: path.join(ROOT, "design-test"),
  runsDir: path.join(ROOT, "customania-runs"), rootDir: ROOT, mcpDir: MCP, baseUrl: `http://localhost:${PORT}`, log };
const server = await startServer({ port: PORT, token, ctx });
const c = new Client({ name: "ops-test", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const call = async (name, args) => {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 300000 });
  const t = r.content?.[0]?.text || "";
  log(`${r.isError ? "ERR " : ""}${name} ${JSON.stringify(args)} -> ${t.replace(/\s+/g, " ").slice(0, 900)}`);
  if (r.isError) throw new Error(t);
  return JSON.parse(t);
};
const cardId = process.argv[2];
log(`== order tools test ${cardId ? "(with card " + cardId + ", confirm=false)" : "(no card)"}`);
let sess;
try {
  sess = (await call("customania_start", {})).order_session;
  await call("customania_upload", { order_session: sess, side: "front", design: "logo.png" });
  let p = await call("customania_place", { order_session: sess, side: "front", width_in: 10, top_in: 1.5 });
  if (!p.within_tolerance) p = await call("customania_place", { order_session: sess, side: "front", width_in: 10, top_in: 1.5 });
  await call("customania_upload", { order_session: sess, side: "back", design: "git-reset-back.png" });
  await call("customania_place", { order_session: sess, side: "back", width_in: 11, top_in: 1 });
  await call("customania_checkout", { order_session: sess, sizes: { S: 2, M: 3, L: 3, XL: 2 }, email: "ops@example.com", first_name: "Hallucinated", last_name: "Ops" });
  if (cardId) await call("customania_pay", { order_session: sess, card_id: cardId, confirm: false });
  log("STOPPED before payment. Nothing paid.");
} catch (e) { log("FAILED: " + e.message.slice(0, 500)); }
await new Promise((r) => setTimeout(r, 15000));
if (sess) await call("customania_close", { order_session: sess }).catch(() => {});
await c.close(); server.close();
log("== order tools test done");
process.exit(0);
