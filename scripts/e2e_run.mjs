process.on('unhandledRejection', e => { console.error(e); });
// Hallucinated E2E: Growth agent makes an image ad + video ad -> CEO agent reviews and posts to X on its own.
// Reads VETTA_API_KEY from ../.env, logs to ../naive.log, saves media to ../e2e/. Never prints the key.
import { createClient, withTool } from "@usenaive-sdk/vetta";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const LOG = path.join(ROOT, "naive.log");
const OUT = path.join(ROOT, "e2e");
fs.mkdirSync(OUT, { recursive: true });
const log = (m) => {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${typeof m === "string" ? m : JSON.stringify(m)}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const short = (o, n = 600) => JSON.stringify(o)?.slice(0, n);
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const apiKey = (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1];
if (!apiKey) { log("No VETTA_API_KEY found in .env"); process.exit(1); }
const c = createClient({ baseUrl: "https://api.vetta.sh", apiKey });
const step = async (name, fn, n) => {
  try { const r = await fn(); log(`OK  ${name}: ${short(r, n)}`); return r; }
  catch (e) { log(`ERR ${name}: ${e?.status ?? ""} ${e?.code ?? ""} ${String(e?.message ?? e).slice(0, 400)}`); return null; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run a session to real completion: idle AND no background media jobs left. Logs the interesting events.
async function runSession(label, sessionId, maxMin = 30) {
  let afterSeq, lastStatus = "", finalText = "";
  const deadline = Date.now() + maxMin * 60_000;
  while (Date.now() < deadline) {
    await sleep(8000);
    const ev = await c.sessions.events(sessionId, { limit: 100, ...(afterSeq !== undefined ? { after_seq: afterSeq } : {}) }).catch(() => null);
    let lastIdle = null;
    for (const e of ev?.data || []) {
      afterSeq = e.seq;
      const t = e.type;
      if (t === "tool.started") log(`  [${label}] → ${e.data?.name} ${short(e.data?.args, 350)}`);
      else if (t === "tool.completed") log(`  [${label}] ← ${e.data?.name}${e.data?.is_error ? " ERROR" : ""} ${short(e.data?.output, 350)}`);
      else if (t === "message.completed" && e.data?.role === "assistant") { finalText = String(e.data.content); log(`  [${label}] says: ${finalText.slice(0, 1500)}`); }
      else if (/^media\.job|^budget|^tool\.confirm/.test(t)) log(`  [${label}] ${t}: ${short(e.data, 300)}`);
      else if (t === "session.idle") lastIdle = e.data;
    }
    const s = await c.sessions.get(sessionId).catch(() => ({}));
    if (s.status !== lastStatus) { log(`[${label}] status: ${s.status}`); lastStatus = s.status; }
    if (["failed", "cancelled"].includes(s.status)) { log(`[${label}] stopped: ${s.stop_code} ${short(s, 300)}`); return { s, finalText }; }
    if (/^awaiting/.test(s.status)) { log(`[${label}] waiting on an approval in Studio: ${short(s.pending_actions, 400)}`); }
    if (s.status === "idle" && lastIdle && !(lastIdle.background || []).length) return { s, finalText };
    if (s.status === "idle" && lastIdle && (lastIdle.background || []).length) log(`[${label}] idle, background still running: ${short(lastIdle.background, 200)}`);
  }
  log(`[${label}] timed out`);
  return { s: await c.sessions.get(sessionId).catch(() => ({})), finalText };
}

log("== E2E run");

// Identity with X connected
const ids = await step("identities.list", () => c.identities.list({ limit: 50 }), 200);
const identity = (ids?.data || []).find((i) => /hallucinated/i.test(i.name));
if (!identity) { log("No Hallucinated identity. Run connect_x first."); process.exit(1); }
const acct = await step("social.accounts", () => c.social.accounts(identity.id), 300);
const x = (acct?.data || []).find((a) => a.platform === "x");
if (!x) { log("X not connected on the identity."); process.exit(1); }
log(`posting as @${x.username}`);

// Models
const models = await step("models.list", () => c.models.list(), 100);
const chat = (models?.data || []).map((m) => m.id).filter((m) => !/:batch$/.test(m));
const llm = [/claude.*(sonnet|opus)/i, /gpt-5(?!-nano)/i, /GLM-5\.2/i, /glm-5\.3-flash/i].map((r) => chat.find((m) => r.test(m))).find(Boolean) || chat[0];
log("agent model: " + llm);

// Brand reference files
const refs = [
  ["hallucinated-logo-print-files/hallucinated-logo-black-tee-chest-4in-300dpi.png", "Logo (exact wordmark: bone letters + eucalyptus ghost offset)"],
  ["Style 1 git reset/Black T-Shirt with Hallucinated Logo.png", "Product mockup: black tee, logo on chest (FRONT)"],
  ["Style 1 git reset/Back graphic.png", "Back graphic: '> git reset --hard' over an SF street map (BACK of the tee)"],
];
const uploaded = [];
for (const [rel, label] of refs) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { log("missing ref " + rel); continue; }
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(p)], { type: "image/png" }), path.basename(p));
  const f = await step("files.upload " + path.basename(p), () => c.files.upload(form), 150);
  if (!f?.id) continue;
  await c.files.publish(f.id).catch(() => {});
  const u = await c.files.url(f.id).catch(() => null);
  uploaded.push({ id: f.id, label, url: u?.url });
}
const refText = uploaded.map((u) => `- ${u.label}: file id ${u.id}${u.url ? ` (url: ${u.url})` : ""}`).join("\n");

const BRAND = `Hallucinated is an agent-run streetwear brand born out of San Francisco tech culture and tech-Twitter humor. The whole company is run by AI agents.
Look: clean, confident, Supreme-like minimalism. Natural palette only: black #1A1A1A, bone #F2EEE6, eucalyptus #8A9A80, forest #2F3B2A, rust #A4442E, sand #CBB894. No neon, no gradients, no glossy AI look.
Logo: "Hallucinated" in a heavy tight sans, with a slightly offset eucalyptus "ghost" copy (misregistered print, like the model saw it twice).
Hero product: black tee. FRONT: the logo, small, on the chest. BACK: "> git reset --hard" over a made-up San Francisco street map with "san francisco" below.
Voice: dry, insider, deadpan. Jokes land for people who work in AI/startups.
Hard rules: never name, depict or mock a real person or real company; no other brands' logos; no recognizable faces; nothing political, sexual or mean-spirited.`;

// Fresh agents
const prev = await c.agents.list({ limit: 50 }).catch(() => ({ data: [] }));
for (const a of (prev.data || []).filter((a) => ["hc-smoke-test", "hc-ad-test", "hc-ad-reviewer", "hallucinated-growth", "hallucinated-ceo"].includes(a.name)))
  await step("agents.delete " + a.name, () => c.agents.delete(a.id), 100);

let growth = await step("agents.create growth", () => c.agents.create({
  name: "hallucinated-growth", model: llm, window: "immediate",
  system: BRAND + "\n\nYou are Head of Growth. You make the ads. You cannot see images yourself, so write precise prompts and always pass the brand reference images to the media tools.",
  budget: { cap_micro_usd: 20_000_000, max_task_micro_usd: 8_000_000, period: "month" },
}), 150);
let gt = growth.tools;
gt = withTool(gt, "view_image", { enabled: false });
gt = withTool(gt, "generate_image", { enabled: true, permission: "allow", config: { models: ["google/gemini-3-pro-image", "openai/gpt-image-2", "google/gemini-nano-banana-2.1"] } });
gt = withTool(gt, "generate_video", { enabled: true, permission: "allow", config: { models: ["kwaivgi/kling-v3.0-pro", "google/veo-3.1-fast", "bytedance/seedance-2.5"] } });
growth = (await step("agents.update growth tools", () => c.agents.update(growth.id, { tools: gt }), 120)) || growth;

let ceo = await step("agents.create ceo", () => c.agents.create({
  name: "hallucinated-ceo", model: llm, window: "immediate",
  system: BRAND + "\n\nYou are the CEO. You own the brand and decide what ships. Growth brings you ads; you approve or reject them against the brand and the hard rules, write the final caption in the brand voice, and publish approved posts to X yourself with your social posting tool. You do not need a human to sign off on posts. Be decisive. Keep a one-line rationale for every decision.",
  budget: { cap_micro_usd: 5_000_000, max_task_micro_usd: 1_000_000, period: "month" },
}), 150);
let ct = ceo.tools;
ct = withTool(ct, "view_image", { enabled: false });
ct = withTool(ct, "generate_image", { enabled: false });
ct = withTool(ct, "generate_video", { enabled: false });
try { ct = withTool(ct, "social.post", { enabled: true, permission: "allow" }); } catch (e) { log("withTool social.post: " + e.message); }
ceo = (await step("agents.update ceo tools", () => c.agents.update(ceo.id, { tools: ct }), 120)) || ceo;
try { await c.identities.attach(ceo.id, identity.id); console.log(`[setup] CEO now holds identity ${identity.id}`); } catch (e) { console.log("identities.attach: " + (e?.status ?? "") + " " + e.message); }
log("ceo tool configs: " + short(Object.fromEntries(Object.entries(ct.configs || {}).filter(([k]) => /social|view|generate/.test(k))), 600));

// Phase 1: Growth makes the ads
const growthMsg = `Make today's launch ads for the Hallucinated black tee.

Brand reference images. Pass these to generate_image in image_urls (file ids; use the urls if ids are rejected) so the real logo and shirt are reproduced:
${refText}

Deliver:
1) IMAGE AD for X, 4:5 portrait (fall back to 3:4 if rejected). Editorial streetwear photo in a real SF setting (Caltrain platform, Mission side street, or foggy Sunset block). The model wears the tee; show the FRONT with the small chest logo matching the reference. No recognizable face. No extra text. One image, model google/gemini-3-pro-image.
2) VIDEO AD, 5 seconds, 9:16, made image-to-video from your image (pass the image's file id in image_urls). Subtle, cinematic motion (walking through fog, slow push-in). Model kwaivgi/kling-v3.0-pro.
The video renders in the background. After starting it, end your turn; you will be woken when it is done.
When BOTH are finished, report: image file id, video file id, the prompt for each, and 3 caption options (under 200 chars, dry and deadpan, tech-insider).`;
const gs = await step("sessions.create growth", () => c.sessions.create({ agent_id: growth.id, message: growthMsg, budget_micro_usd: 6_000_000 }), 150);
if (!gs) process.exit(1);
log(">>> Growth is working. Video takes a few minutes.");
const g = await runSession("growth", gs.id, 30);

const gFiles = await step("files.list growth", () => c.files.list({ session_id: gs.id, limit: 50 }), 200);
const media = (gFiles?.data || []).filter((f) => ["image", "video"].includes(f.kind));
for (const f of media) {
  try {
    const bytes = await c.files.downloadBytes(f.id);
    const ext = f.kind === "video" ? "mp4" : (f.name?.split(".").pop() || "png");
    const name = `${f.kind}-${f.id}.${ext}`;
    fs.writeFileSync(path.join(OUT, name), bytes);
    log(`saved e2e/${name} model=${f.source?.model}`);
  } catch (e) { log("download err " + e?.message); }
}
if (!media.some((f) => f.kind === "video") && !media.some((f) => f.kind === "image")) { log("Growth produced no media; stopping before CEO."); process.exit(1); }

// Phase 2: CEO reviews and posts
const mediaList = media.map((f) => `- ${f.kind}: file id ${f.id}, model ${f.source?.model}, prompt: ${String(f.source?.prompt || "").slice(0, 400)}`).join("\n");
const ceoMsg = `Growth delivered the launch ads. Their report:
---
${g.finalText.slice(0, 4000)}
---
Files actually produced:
${mediaList}

Decide. Review the work against the brand and the hard rules (you can't view images, so judge by the prompts, models and Growth's report). Then:
- If approved, publish to X now with your social posting tool: one post with the VIDEO (fall back to the image if the video post fails). Write the final caption yourself in the brand voice (under 200 chars). Mark it as AI generated.
- If rejected, say exactly why and do not post.
Finish with: decision, one-line rationale, the caption, and the post id/status.`;
const cs = await step("sessions.create ceo", () => c.sessions.create({ agent_id: ceo.id, identity: identity.id, message: ceoMsg, budget_micro_usd: 1_000_000 }), 150);
if (cs) await runSession("ceo", cs.id, 10);

// What actually went out
const posts = await step("social.listPosts", () => c.social.listPosts({ identity_id: identity.id, limit: 10 }), 1500);
for (const p of posts?.data || []) log(`POST ${p.id} status=${p.status} ${short(p, 400)}`);
await step("growth spend", () => c.agents.spend(growth.id), 200);
await step("ceo spend", () => c.agents.spend(ceo.id), 200);
log("== E2E done. Media in e2e/, check @" + x.username);
