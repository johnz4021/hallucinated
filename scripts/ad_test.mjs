process.on('unhandledRejection', e => { console.error(e); });
// Ad generation test: a Naïve agent makes one image ad + one short video ad for Hallucinated.
// Nothing is posted. Reads VETTA_API_KEY from ../.env, logs to ../naive.log, saves outputs to ../ad-test/.
import { createClient, withTool } from "@usenaive-sdk/vetta";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const LOG = path.join(ROOT, "naive.log");
const OUT = path.join(ROOT, "ad-test");
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

log("== ad test");

// 1. Models: Growth = best text model; Reviewer = a model that accepts images
const models = await step("models.list", () => c.models.list(), 200);
const all = (models?.data || models || []);
log("model objects (first 3): " + short(all.slice(0, 3), 1500));
const ids = all.map((m) => m.id || m.slug || m.name).filter(Boolean).filter((m) => !/:batch$/.test(m));
const pick = (res, pool = ids) => { for (const r of res) { const m = pool.find((x) => r.test(x)); if (m) return m; } };
const llm = pick([/claude.*(sonnet|opus)/i, /gpt-5(?!-nano)/i, /GLM-5\.2/i, /glm-5\.3-flash/i]) || ids[0];
const visionIds = all.filter((m) => !/:batch$/.test(m.id) && /image|vision|multimodal/i.test(JSON.stringify({ i: m.input_modalities, m: m.modalities, c: m.capabilities, a: m.architecture, f: m.features }))).map((m) => m.id);
log("vision-capable (by metadata): " + visionIds.join(", "));
const reviewerModel = pick([/claude/i, /gpt-5/i, /gemini/i, /qwen.*(vl|3\.7)/i, /gemma-3/i], visionIds) || pick([/gemma-3-12b/i, /qwen3\.7/i]) ;
log("growth model: " + llm + " | reviewer model: " + reviewerModel);

// 2. Media models
const imgM = await step("media.listModels image", () => c.media.listModels({ kind: "image", limit: 100 }), 200);
const imgIds = (imgM?.data || []).map((m) => m.id);
log("image models: " + imgIds.join(", "));
const vidM = await step("media.listModels video", () => c.media.listModels({ kind: "video", limit: 100 }), 200);
const vidIds = (vidM?.data || []).map((m) => m.id);
const wantImg = ["google/gemini-3-pro-image", "openai/gpt-image-2", "black-forest-labs/flux.2-max", "bytedance-seed/seedream-5-0-pro", "google/gemini-nano-banana-2.1", "recraft/recraft-v4.1-pro"].filter((m) => imgIds.includes(m));
const wantVid = ["kwaivgi/kling-v3.0-pro", "kwaivgi/kling-v3.0-std", "google/veo-3.1-fast", "bytedance/seedance-2.5", "bytedance/seedance-2.0-fast"].filter((m) => vidIds.includes(m));
log("enabling image: " + wantImg.join(", "));
log("enabling video: " + wantVid.join(", "));

// 3. Upload brand references
const refs = [
  ["hallucinated-logo-print-files/hallucinated-logo-black-tee-chest-4in-300dpi.png", "Logo (bone + eucalyptus ghost, transparent)"],
  ["Style 1 git reset/Back graphic.png", "Back graphic: git reset --hard / san francisco map"],
  ["Style 1 git reset/Black T-Shirt with Hallucinated Logo.png", "Product mockup: black tee with logo"],
];
const uploaded = [];
for (const [rel, label] of refs) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { log("missing ref " + rel); continue; }
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(p)], { type: "image/png" }), path.basename(p));
  const f = await step("files.upload " + path.basename(p), () => c.files.upload(form), 300);
  if (!f?.id) continue;
  await step("files.publish", () => c.files.publish(f.id), 200);
  const u = await step("files.url", () => c.files.url(f.id), 200);
  uploaded.push({ id: f.id, label, url: u?.url });
}

// 4. Agent with premium media models
const prev = await c.agents.list({ limit: 50 }).catch(() => ({ data: [] }));
for (const a of (prev.data || []).filter((a) => ["hc-smoke-test", "hc-ad-test", "hc-ad-reviewer"].includes(a.name))) await step("agents.delete " + a.name, () => c.agents.delete(a.id), 120);

const system = `You are the Growth lead of Hallucinated, an agent-run streetwear brand born out of San Francisco tech culture and tech-Twitter humor.
Brand: clean, confident, Supreme-like minimalism. Natural palette only: black #1A1A1A, bone #F2EEE6, eucalyptus #8A9A80, forest #2F3B2A, rust #A4442E, sand #CBB894. No neon, no gradients, no glossy AI look.
Logo: the word "Hallucinated" in a heavy tight sans with a slightly offset "ghost" copy (misregistered print), like the model saw it twice.
Hero product: black tee, logo on the chest; back graphic "> git reset --hard" over a made-up San Francisco street map with "san francisco" below.
Voice: dry, insider, deadpan. Jokes land for people who work in AI/startups. Never mock a real person or real company, never use other brands' logos, never show real people's faces.`;

let agent = await step("agents.create", () => c.agents.create({
  name: "hc-ad-test",
  model: llm,
  window: "immediate",
  system,
  budget: { cap_micro_usd: 15_000_000, max_task_micro_usd: 10_000_000, period: "month" },
}), 300);
if (!agent) process.exit(1);
let tools = agent.tools;
tools = withTool(tools, "generate_image", { enabled: true, permission: "allow", ...(wantImg.length ? { config: { models: wantImg } } : {}) });
tools = withTool(tools, "view_image", { enabled: false });
tools = withTool(tools, "generate_video", { enabled: true, permission: "allow", ...(wantVid.length ? { config: { models: wantVid } } : {}) });
agent = (await step("agents.update tools", () => c.agents.update(agent.id, { tools }), 300)) || agent;
log("media tool configs: " + short({ gi: tools.configs?.generate_image, gv: tools.configs?.generate_video }, 800));

// 5. The task
const refText = uploaded.map((u) => `- ${u.label}: file id ${u.id}${u.url ? `, url ${u.url}` : ""}`).join("\n");
const message = `Make launch ads for Hallucinated. This is a test, nothing gets posted.

Brand reference files (pass them to the image tool as reference/input images so the logo and shirt stay accurate):
${refText}

You cannot look at images yourself; a separate reviewer agent will judge them. So be precise in prompts.

Deliver exactly two assets:
1) IMAGE AD for X, portrait. Try 4:5; if the model rejects the aspect ratio, use 3:4, then 1:1. The product (black tee with the Hallucinated logo on the chest) is the hero, shot like a clean editorial streetwear photo in a real SF setting (Caltrain platform, Mission side street, foggy Sunset block). No other text in the image. Prefer google/gemini-3-pro-image or openai/gpt-image-2 with the reference images. Make 2 variants.
2) VIDEO AD, 5-8 seconds, 9:16. One cinematic idea, e.g. the shirt on a person walking through SF fog. Do image-to-video from your best image variant so the shirt stays on-brand. Use kwaivgi/kling-v3.0-pro or google/veo-3.1-fast.
3) Extract 3 still frames from the video (start, middle, end) with clip_video or ffmpeg in bash, and save/publish them as image files.

Finish with: for each asset, the file id, the model used, the prompt, and an X post caption (under 200 chars, dry and deadpan). Also list the 3 frame file ids.`;

const session = await step("sessions.create", () => c.sessions.create({ agent_id: agent.id, message, budget_micro_usd: 8_000_000 }), 300);
if (!session) process.exit(1);
log(`>>> session ${session.id} running. Video can take several minutes.`);

let s, last = "";
for (let i = 0; i < 180; i++) { // up to ~30 min
  await sleep(10000);
  s = await c.sessions.get(session.id).catch((e) => ({ status: "get-error " + e?.message }));
  if (s.status !== last) { log(`session status: ${s.status}${s.pending_action ? " pending=" + short(s.pending_action, 300) : ""}`); last = s.status; }
  if (["idle", "completed", "failed", "cancelled"].includes(s.status) || /^awaiting/.test(s.status)) break;
}
log("final session: " + short(s, 600));
if (s?.stop_code) log("growth stop: " + s.stop_code);

// 6. Events (all pages)
let afterSeq, n = 0;
for (let page = 0; page < 30; page++) {
  const ev = await c.sessions.events(session.id, { limit: 100, ...(afterSeq !== undefined ? { after_seq: afterSeq } : {}) }).catch((e) => { log("events err " + e?.message); return null; });
  const items = ev?.data || [];
  for (const e of items) {
    n++; afterSeq = e.seq;
    const t = e.type ?? "?";
    if (/^(tool\.|media\.|message\.completed|budget|session\.idle|file)/.test(t)) log(`  ev ${t}: ${short(e.data ?? e, 500)}`);
  }
  if (items.length < 100) break;
}
log(`events seen: ${n}`);

// 7. Reviewer agent (the "CEO" check) grades everything the Growth agent made
const made = await step("files.list session", () => c.files.list({ session_id: session.id, limit: 100 }), 300);
const imgs = (made?.data || []).filter((f) => f.kind === "image");
log(`growth produced ${made?.data?.length ?? 0} files, ${imgs.length} images`);
if (reviewerModel && imgs.length) {
  const rev = await step("agents.create reviewer", () => c.agents.create({
    name: "hc-ad-reviewer", model: reviewerModel, window: "immediate",
    system: system + "\nYou are the CEO. You approve or reject ads before they post. You are strict about brand and safety and honest about quality.",
    budget: { cap_micro_usd: 2_000_000, max_task_micro_usd: 1_000_000, period: "month" },
  }), 200);
  if (rev) {
    const rs = await step("sessions.create review", () => c.sessions.create({ agent_id: rev.id, budget_micro_usd: 1_000_000, message:
      `Review these ad images (some are still frames from a video ad). Use view_image on: ${imgs.map((f) => f.id).join(", ")}.
Reference brand files for comparison: ${uploaded.map((u) => u.id).join(", ")}.
For each file, check: 1) natural brand palette, no neon/gloss, 2) the word "Hallucinated" on the shirt is spelled right and legible, 3) no real people's recognizable faces, no other brands' logos, 4) no garbled text or AI artifacts (hands, warped fabric), 5) would a tech-Twitter streetwear account actually post this.
Reply with one line per file: <file id> PASS|FAIL - reason. Then one line: VERDICT image ad: PASS|FAIL, video ad: PASS|FAIL.` }), 200);
    if (rs) {
      let r, lastR = "";
      for (let i = 0; i < 60; i++) { await sleep(5000); r = await c.sessions.get(rs.id).catch(() => ({})); if (r.status !== lastR) { log("review status: " + r.status); lastR = r.status; } if (["idle", "completed", "failed", "cancelled"].includes(r.status)) break; }
      const rev_ev = await c.sessions.events(rs.id, { limit: 100 }).catch(() => null);
      for (const e of (rev_ev?.data || [])) if (e.type === "message.completed" && e.data?.role === "assistant") log("REVIEW: " + String(e.data.content).slice(0, 2000));
      if (r?.stop_code) log("review stop: " + r.stop_code + " " + short(r, 300));
    }
  }
}

// 8. Save the generated media locally
const files = await step("files.list session", () => c.files.list({ session_id: session.id, limit: 100 }), 200);
const gen = (files?.data || []).filter((f) => ["image", "video"].includes(f.kind));
for (const f of gen) {
  try {
    const bytes = await c.files.downloadBytes(f.id);
    const name = `${f.kind}-${f.id}-${(f.source?.model || "model").replace(/[^a-z0-9.-]+/gi, "_")}-${f.name || ""}`.replace(/[^a-z0-9._-]+/gi, "_");
    fs.writeFileSync(path.join(OUT, name), bytes);
    log(`saved ${name} (${f.width}x${f.height}${f.duration_seconds ? `, ${f.duration_seconds}s` : ""}) model=${f.source?.model} prompt=${short(f.source?.prompt, 300)}`);
  } catch (e) { log("download err " + f.id + " " + e?.message); }
}
await step("agents.spend", () => c.agents.spend(agent.id), 300);
log("== ad test done. Outputs in ad-test/");
