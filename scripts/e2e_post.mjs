process.on('unhandledRejection', e => { console.error(e); });
// E2E posting test WITHOUT regenerating: the CEO agent reviews the ads Growth already made and posts one to X.
// Reads VETTA_API_KEY from ../.env (never printed). Log: ../naive.log
import { createClient, withTool } from "@usenaive-sdk/vetta";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(process.cwd(), "..");
const LOG = path.join(ROOT, "naive.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const short = (o, n = 500) => JSON.stringify(o)?.slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const apiKey = (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1];
const c = createClient({ baseUrl: "https://api.vetta.sh", apiKey });

log("== E2E post (reuse existing ads)");
const ids = await c.identities.list({ limit: 50 });
const identity = (ids.data || []).find((i) => /hallucinated/i.test(i.name));
const acct = await c.social.accounts(identity.id);
const x = (acct.data || []).find((a) => a.platform === "x");
if (!x) { log("X not connected"); process.exit(1); }
log(`posting as @${x.username}`);

// Ads Growth already generated in the two earlier ad runs
const SESSIONS = ["ses_ted41d8bbfs4pt0kagyaak0677", "ses_h5xms6q5bqm8crcaeh7487qxgz"];
const assets = [];
for (const s of SESSIONS) {
  const f = await c.files.list({ session_id: s, limit: 50 }).catch(() => ({ data: [] }));
  for (const a of (f.data || []).filter((a) => ["image", "video"].includes(a.kind))) assets.push(a);
}
const growthAgents = await c.agents.list({ limit: 50 }).catch(() => ({ data: [] }));
for (const g of (growthAgents.data || []).filter((a) => a.name === "hallucinated-growth")) {
  const f = await c.files.list({ agent_id: g.id, limit: 50 }).catch(() => ({ data: [] }));
  for (const a of (f.data || []).filter((a) => ["image", "video"].includes(a.kind) && !assets.some((x) => x.id === a.id))) assets.unshift(a);
}
log(`found ${assets.length} existing assets: ${assets.map((a) => a.kind + ":" + a.id).join(", ")}`);
if (!assets.length) process.exit(1);

const BRAND = `Hallucinated is an agent-run streetwear brand born out of San Francisco tech culture and tech-Twitter humor; the whole company is run by AI agents.
Look: clean Supreme-like minimalism, natural palette (black, bone, eucalyptus, forest, rust, sand). Logo: "Hallucinated" in a heavy tight sans with an offset eucalyptus ghost copy. Hero product: black tee, logo on the chest, "> git reset --hard" over an SF street map on the back.
Voice: dry, insider, deadpan. Hard rules: never name, depict or mock a real person or real company; no other brands' logos; no recognizable faces; nothing political, sexual or mean.`;

const prev = await c.agents.list({ limit: 50 }).catch(() => ({ data: [] }));
for (const a of (prev.data || []).filter((a) => ["hallucinated-ceo", "hc-ad-test", "hc-ad-reviewer", "hc-smoke-test"].includes(a.name))) await c.agents.delete(a.id).catch(() => {});
const models = await c.models.list();
const chat = (models.data || []).map((m) => m.id).filter((m) => !/:batch$/.test(m));
const llm = [/claude.*(sonnet|opus)/i, /gpt-5(?!-nano)/i, /GLM-5\.2/i].map((r) => chat.find((m) => r.test(m))).find(Boolean) || chat[0];
let ceo = await c.agents.create({
  name: "hallucinated-ceo", model: llm, window: "immediate",
  system: BRAND + "\n\nYou are the CEO. You own the brand and decide what ships. You review Growth's ads against the brand and the hard rules, pick what goes out, write the final caption in the brand voice, and publish it to X yourself with your social posting tool. No human signs off on posts. Be decisive and give a one-line rationale for every decision.",
  budget: { cap_micro_usd: 5_000_000, max_task_micro_usd: 1_000_000, period: "month" },
});
let t = ceo.tools;
for (const n of ["view_image", "generate_image", "generate_video"]) t = withTool(t, n, { enabled: false });
t = withTool(t, "social.post", { enabled: true, permission: "allow" });
ceo = await c.agents.update(ceo.id, { tools: t });
try { await c.identities.attach(ceo.id, identity.id); console.log(`[setup] CEO now holds identity ${identity.id}`); } catch (e) { console.log("identities.attach: " + (e?.status ?? "") + " " + e.message); }
log(`ceo ${ceo.id} model=${llm} social.post=${short(t.configs["social.post"])}`);

const list = assets.map((a) => `- ${a.kind} ${a.id} (${a.width}x${a.height}${a.duration_seconds ? `, ${a.duration_seconds}s` : ""}, model ${a.source?.model}) prompt: ${String(a.source?.prompt || "").slice(0, 350)}`).join("\n");
const msg = `Growth delivered these launch ads for the black tee (already generated, do not regenerate):
${list}

Decide now. Judge them against the brand and the hard rules from the prompts (you can't view images). Then publish ONE post to X with your social posting tool: prefer a video if one is listed; otherwise the strongest image. Attach the file by its id. Write the caption yourself: dry, deadpan, tech-insider, under 200 characters, no hashtags spam. Mark it as AI generated.
Finish with: which asset, one-line rationale, the caption, and the post id/status.`;
const s = await c.sessions.create({ agent_id: ceo.id, identity: identity.id, message: msg, budget_micro_usd: 1_000_000 });
log(`session ${s.id}`);
let afterSeq, status = "";
const end = Date.now() + 10 * 60_000;
while (Date.now() < end) {
  await sleep(5000);
  const ev = await c.sessions.events(s.id, { limit: 100, ...(afterSeq !== undefined ? { after_seq: afterSeq } : {}) }).catch(() => null);
  for (const e of ev?.data || []) {
    afterSeq = e.seq;
    if (e.type === "tool.started") log(`  [ceo] → ${e.data?.name} ${short(e.data?.args, 500)}`);
    else if (e.type === "tool.completed") log(`  [ceo] ← ${e.data?.name}${e.data?.is_error ? " ERROR" : ""} ${short(e.data?.output, 500)}`);
    else if (e.type === "message.completed" && e.data?.role === "assistant") log(`  [ceo] says: ${String(e.data.content).slice(0, 1500)}`);
    else if (/^tool\.confirm/.test(e.type)) log(`  [ceo] ${e.type} ${short(e.data, 300)}  <- approve in Studio if it asks`);
  }
  const st = await c.sessions.get(s.id).catch(() => ({}));
  if (st.status !== status) { status = st.status; log(`[ceo] status: ${status}`); }
  if (["idle", "failed", "cancelled"].includes(status)) { if (st.stop_code) log("stop: " + st.stop_code); break; }
}
const posts = await c.social.listPosts({ identity_id: identity.id, limit: 10 }).catch((e) => ({ data: [], err: e.message }));
for (const p of posts.data || []) log(`POST ${p.id} status=${p.status} ${short(p, 400)}`);
const sp = await c.agents.spend(ceo.id).catch(() => null);
if (sp) log(`ceo spend: $${(sp.spent_micro_usd / 1e6).toFixed(4)}`);
log(`== E2E post done. Check https://x.com/${x.username}`);
