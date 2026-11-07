process.on('unhandledRejection', e => { console.error(e); });
// Diagnoses X posting: account health, every post with its status/error, and the CEO's post in detail.
// Reads VETTA_API_KEY from ../.env (never printed). Output -> naive.log
import { createClient } from "@usenaive-sdk/vetta";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(process.cwd(), "..");
const LOG = path.join(ROOT, "naive.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const c = createClient({ baseUrl: "https://api.vetta.sh", apiKey: (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1] });
const POST = process.argv[2] || "8c25ab35-da1d-4ece-a5e6-089b15caff94";
const j = (o, n = 1500) => JSON.stringify(o).slice(0, n);
const tryit = async (label, fn) => { try { const r = await fn(); log(`OK  ${label}: ${j(r)}`); return r; } catch (e) { log(`ERR ${label}: ${e?.status ?? ""} ${e?.code ?? ""} ${e.message} ${j(e?.body ?? e?.details ?? "", 600)}`); return null; } };
log("== X posting diagnosis");
const ids = await c.identities.list({ limit: 50 });
const identity = (ids.data || []).find((i) => /hallucinated/i.test(i.name));
log(`identity ${identity?.id}`);
await tryit("social.status", () => c.social.status(identity.id));
await tryit("social.accounts", () => c.social.accounts(identity.id));
const list = await tryit("social.listPosts (reconcile)", () => c.social.listPosts({ identity_id: identity.id, limit: 20, reconcile: true }));
for (const p of list?.data || []) log(`post ${p.id} status=${p.status} created=${p.created_at} scheduled=${p.scheduled_at} posted=${p.posted_at} url=${p.url} error=${j(p.error, 600)} files=${j(p.file_ids)} media=${j(p.media_urls, 300)} dup=${j(p.duplicate_of)}`);
await tryit("social.getPost", () => c.social.getPost(identity.id, POST));
await tryit("social.postAnalytics", () => c.social.postAnalytics(identity.id, POST));
log("== X posting diagnosis done");
