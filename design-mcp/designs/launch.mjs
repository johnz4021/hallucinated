// Launch images: 2-3 editorial photos of FICTIONAL people wearing an approved agent tee in SF settings, made right
// after ceo_decide publishes it (storefront/CONTENT.md §6). No LLM decides anything here except the vision reviewer:
//   1. references: the store's own mockups of THIS shirt (back print, front wordmark, print on shirt-black) + our wordmark
//   2. OpenAI images/edits (gpt-image, input_fidelity high) per shot: back view (print), front view (wordmark), candid
//   3. every image -> the vision reviewer agent (hallucinated-reviewer, gemini-3-flash-preview, view_image), the same
//      pattern as creative's ad_review: print/wordmark accurate + text exact, believable photo, no real faces/logos/garble.
//      Up to 2 regenerations per shot (with the reviewer's reasons fed back). Only passes are kept.
//   4. passes -> JPEG -> Blob upload -> content "launches" collection keyed by slug (test:true for sandbox/test runs)
// Start-then-poll: startLaunchImages() records a job and returns at once; the work runs in the background of the calling
// process (serve, or backfill_launch.mjs which awaits job.done). launchStatus(job_id) reads the ledger.
// Caps: <= 3 published images per design; <= LAUNCH_MAX_IMAGES_PER_DAY (default 60) GENERATIONS per Pacific day (all
// modes: it's real spend). Ledger: repo-root launch-images.json (git-ignored like the other ledgers). Local copies of
// every attempt + verdict: order-runs/<ts>_launch-<slug>/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createClient } from "@usenaive-sdk/vetta";
import { envKey, readJson, writeJson } from "../lib/state.mjs";
import { STORE, storeAdmin, frontLogoUrl } from "./publish.mjs";
import { loadProposals, ptDay } from "./ledger.mjs";
import { verdict as reviewVerdict, REVIEWER } from "../creative/tools.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.join(HERE, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const MAX_PER_DESIGN = 3;
export const MAX_REGEN = 2;   // per shot, so at most 3 attempts
export const MAX_PER_DAY = () => Number(process.env.LAUNCH_MAX_IMAGES_PER_DAY || 60);
const IMAGE_MODELS = (process.env.LAUNCH_IMAGE_MODELS || "gpt-image-2,gpt-image-1.5,gpt-image-1").split(",");
const QUALITY = () => process.env.LAUNCH_IMAGE_QUALITY || "high";
// USD per 1M tokens {text_in, image_in, image_out}: an ESTIMATE from OpenAI's usage numbers (gpt-image-2 assumed = 1.5's)
const RATES = { "gpt-image-1": [5, 10, 40], "gpt-image-1.5": [5, 8, 32], "gpt-image-2": [5, 8, 32] };
const FALLBACK_COST = { high: 0.25, medium: 0.07, low: 0.02 };

// ---------------- ledger ----------------
const file = (rootDir) => path.join(rootDir, "launch-images.json");
export const loadLaunch = (rootDir) => readJson(file(rootDir), { jobs: {}, designs: {}, gens: [], refs: {} });
// read-modify-write with no await inside: safe within one process (serve), and the window vs. a backfill CLI is tiny
export function mutateLaunch(rootDir, fn) {
  const l = loadLaunch(rootDir); l.jobs ||= {}; l.designs ||= {}; l.gens ||= []; l.refs ||= {};
  const out = fn(l); writeJson(file(rootDir), l); return out;
}
export const gensToday = (l, now = new Date()) => (l.gens || []).filter((g) => ptDay(g.at) === ptDay(now)).length;
const newId = () => `lj_${crypto.randomBytes(5).toString("hex")}`;
export const isTest = (p, force = false) => force || p?.mode !== "live" || process.env.LAUNCH_TEST === "1" || process.env.ADS_TEST === "1";

// ---------------- shots ----------------
const SETTINGS = [
  "a Mission District sidewalk at golden hour, colourful murals (abstract shapes only) and a taqueria awning, warm low sun",
  "a Caltrain platform in the late afternoon, a double-decker commuter train motion-blurred behind, long shadows",
  "the slope of Dolores Park on a bright day, the downtown skyline soft in the distance, people on blankets out of focus",
  "a scrappy startup office: exposed brick, standing desks, closed laptops, plants, a beanbag, big warehouse windows",
  "the top of a hill in thick rolling Karl-the-fog, cypress trees fading into grey, moody overcast light",
  "the Embarcadero waterfront at dusk, the bay and a bridge silhouette far behind, lights coming on",
  "a steep Russian Hill street with Victorian houses and a cable-car track, crisp morning light",
  "a Hayes Valley coffee line on a sunny morning, shipping-container cafe, bikes leaning on a rail",
  "a SoMa rooftop at blue hour, office towers glowing behind, string lights",
  "Ocean Beach at sunset, wind, dune grass, a fire pit glowing in the distance",
];
const PEOPLE = [
  "a woman in her late 20s with a short curly haircut, silver hoops, wide-leg cargo pants",
  "a man in his 30s with a buzz cut and a trimmed beard, black jeans, beat-up sneakers",
  "a non-binary person in their 20s with bleached hair, baggy shorts, tote bag on one shoulder",
  "a woman in her 40s with long grey-streaked hair, tortoiseshell glasses, relaxed trousers",
  "a man in his 20s with long dark hair tied back, wired earbuds, carpenter pants",
  "a woman in her 30s with braids, a lanyard tucked in her pocket, chunky sneakers",
  "a man in his 50s, bald with a salt-and-pepper beard, rolled-up chinos",
  "a person in their 20s with a mullet and a nose ring, track pants, carrying a skateboard",
];
const hashN = (s, n) => parseInt(crypto.createHash("sha1").update(s).digest("hex").slice(0, 8), 16) % n;
// Three different shots per design, settings and people picked from the slug (stable on retries, varied across designs)
export function shotPlan(slug) {
  const s0 = hashN(slug, SETTINGS.length), p0 = hashN(slug + "p", PEOPLE.length);
  const pick = (arr, i, step) => arr[(i * step) % arr.length];
  return [
    { n: 1, view: "back", setting: SETTINGS[s0], person: PEOPLE[p0],
      framing: "Photographed from directly behind at chest height, waist-up, the person mid-stride or standing; the whole BACK print is visible, flat and sharp in the centre of the frame." },
    { n: 2, view: "front", setting: pick(SETTINGS, s0 + 3, 1), person: pick(PEOPLE, p0 + 3, 1),
      framing: "Facing the camera, waist-up, relaxed and unposed, looking slightly off-camera; the small chest wordmark is clearly visible and sharp." },
    { n: 3, view: "candid", setting: pick(SETTINGS, s0 + 6, 1), person: pick(PEOPLE, p0 + 5, 1),
      framing: "A candid three-quarter view from behind, caught mid-moment (turning to look at something, laughing with someone out of frame); the BACK print is visible and readable across the shoulder blades." },
  ];
}

const WORDMARK = "hallucinated";
export function shotPrompt(shot, info, feedback = "") {
  const shirt = shot.view === "front"
    ? `FRONT of the shirt: only our small chest wordmark, the lowercase word "${WORDMARK}" in a bold rounded sans-serif, bone white (#F2EEE6) with a slightly offset eucalyptus-green (#8A9A80) shadow, centred on the chest about 4 inches wide, exactly as in reference images 1 and 3. Nothing else on the front.`
    : `BACK of the shirt: the print from reference images 1 and 2, reproduced EXACTLY (same artwork, same layout, same colours), centred between the shoulder blades about 11 inches wide.${info.text ? ` Its text must read exactly "${info.text}" (same spelling, spacing, punctuation and case), in the same typeface as the reference.` : ""} No other marks on the back.`;
  return [
    `Editorial streetwear lookbook photograph, shot on a 35mm film camera, natural light, shallow depth of field, real skin texture, believable fabric folds. Portrait orientation.`,
    `Subject: ${shot.person}, a FICTIONAL person (not resembling any real or famous person), wearing a plain heavyweight BLACK cotton crew-neck t-shirt: the exact shirt in the reference images.`,
    shirt,
    `Setting: ${shot.setting}, San Francisco.`,
    shot.framing,
    `No other text anywhere in the picture: no signs, shopfront lettering, street names, posters, screens or captions (keep backgrounds plain and out of focus). No brand logos on anything (clothes, shoes, bags, cars, devices, cups). No other clothing over the shirt.`,
    feedback ? `The previous attempt was rejected by our reviewer: ${feedback}. Fix exactly that.` : "",
  ].filter(Boolean).join("\n");
}

// ---------------- design info + references ----------------
const frontMockup = (frontUrl) => `${STORE}/api/mockup?side=front&print=${encodeURIComponent(frontUrl)}`;
export async function designInfo(rootDir, outDir, slugOrProposal, { admin } = {}) {
  const ps = Object.values(loadProposals(rootDir).proposals);
  const p = typeof slugOrProposal === "object" ? slugOrProposal
    : ps.filter((x) => x.slug === slugOrProposal && x.publish?.print_url).sort((a, b) => (b.mode === "live") - (a.mode === "live") || String(b.publish.published_at).localeCompare(a.publish.published_at))[0];
  if (!p?.publish?.print_url) throw new Error(`no published design with slug ${typeof slugOrProposal === "object" ? slugOrProposal.slug : slugOrProposal}`);
  const vf = path.join(outDir, `${p.design_id}.json`);
  const v = fs.existsSync(vf) ? JSON.parse(fs.readFileSync(vf, "utf8")) : {};
  let front = p.publish.front_url;
  if (!front) {
    const cached = readJson(path.join(rootDir, "store-assets.json"), {}).front_wordmark_url;
    front = frontMockup(cached || await frontLogoUrl(rootDir, admin || storeAdmin(rootDir)));
  }
  return { slug: p.slug, title: p.title, design_id: p.design_id, mode: p.mode, proposal_id: p.proposal_id,
    text: (v.args?.text || v.text_seen || "").trim(), print_line: p.print_line || p.title,
    back_url: p.publish.mockup_url, front_url: front, flat_url: p.publish.flat_url };
}
// Downloads (once) the three mockups + makes a large wordmark-on-black card; returns local PNG paths
export async function refFiles(rootDir, info) {
  const dir = path.join(rootDir, "design-test", "launch-refs"); fs.mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [k, u] of [["back", info.back_url], ["front", info.front_url], ["flat", info.flat_url]]) {
    const f = path.join(dir, `${info.slug}-${k}.png`);
    if (!fs.existsSync(f)) {
      const r = await fetch(u, { signal: AbortSignal.timeout(40_000) });
      if (!r.ok) throw new Error(`mockup ${k} ${r.status}`);
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    }
    out[k] = f;
  }
  const wm = path.join(dir, "wordmark-card.png");
  if (!fs.existsSync(wm)) {
    const logo = await sharp(path.join(MCP_DIR, "refs", "logo.png")).resize(900).png().toBuffer();
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#1A1A1A" } }).composite([{ input: logo, gravity: "center" }]).png().toFile(wm);
  }
  out.wordmark = wm;
  return out;
}
const refsFor = (shot, r) => (shot.view === "front" ? [r.front, r.back, r.wordmark] : [r.back, r.flat, r.front]);

// ---------------- generation (OpenAI images/edits) ----------------
async function openaiEdit(key, model, prompt, files, withFidelity = true) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ model, prompt, size: "1024x1536", quality: QUALITY(), n: 1, ...(withFidelity ? { input_fidelity: "high" } : {}) })) form.append(k, String(v));
  for (const f of files) form.append("image[]", new Blob([fs.readFileSync(f)], { type: "image/png" }), path.basename(f));
  const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(300_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 400 && withFidelity && /fidelity/i.test(j?.error?.message || "")) return openaiEdit(key, model, prompt, files, false);
    const e = new Error(j?.error?.message || `HTTP ${r.status}`); e.status = r.status; throw e;
  }
  return j;
}
export function costOf(model, usage) {
  const rate = RATES[model];
  if (!usage || !rate) return FALLBACK_COST[QUALITY()] ?? 0.25;
  const imgIn = usage.input_tokens_details?.image_tokens ?? 0, txtIn = usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens || 0) - imgIn);
  return (txtIn * rate[0] + imgIn * rate[1] + (usage.output_tokens || 0) * rate[2]) / 1e6;
}
async function generate(openaiKey, prompt, files) {
  let last;
  for (const model of IMAGE_MODELS) {
    try {
      const j = await openaiEdit(openaiKey, model, prompt, files);
      const raw = Buffer.from(j.data[0].b64_json, "base64");
      const jpg = await sharp(raw).resize(1024, 1536, { fit: "cover" }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      return { jpg, model, usage: j.usage || null, cost_usd: costOf(model, j.usage) };
    } catch (e) { last = e; if (![400, 403, 404].includes(e.status) || /safety|moderation/i.test(e.message)) throw e; }
  }
  throw last;
}

// ---------------- review (the creative reviewer agent) ----------------
export function launchReviewBrief({ shot, info, file, crop, refs }) {
  const target = shot.view === "front"
    ? `the FRONT chest wordmark: the lowercase word "${WORDMARK}" (bone white with an offset green shadow), matching the wordmark reference`
    : `the BACK print, matching the print reference exactly${info.text ? `; its text must read exactly ${JSON.stringify(info.text)}` : ""}`;
  return `Review this LAUNCH PHOTO for Hallucinated before it goes on the store: an AI-generated editorial photo of a fictional person wearing our black tee "${info.title}". Use view_image on the photo AND every reference.
Photo: ${file}${crop ? `\nClose-up of the same photo's torso (print area), upscaled so small lettering is readable: ${crop}. Read the shirt's text from the close-up; judge everything else on the full photo.` : ""}
References: ${refs.map((r) => `${r.label}: ${r.file_id}`).join("; ")}
Shot: ${shot.view} view. The shirt must show ${target}.

Check, and be strict:
1. product_accurate: the shirt is a plain black tee and the visible print/wordmark matches the reference (same artwork, same layout, nothing missing, nothing added). Wrong side, a different drawing, extra graphics or a wrong colour shirt = false.
2. text_legible: every letter on the shirt is spelled exactly as required and is crisp (no garbled, doubled, missing or extra characters). Any OTHER readable text in the photo (signs, posters, screens) = false.
3. photo_believable: it looks like a real photograph (natural anatomy and hands, fabric that drapes, consistent lighting, no melted or warped areas).
4. real_person: true if anyone looks like a real, identifiable or famous person. Fictional AI people are fine: false.
5. real_names: true if a real person's name appears.
6. other_logos: true if any other brand's logo or trademark appears (on clothes, shoes, bags, cars, devices, signs).
7. slurs_or_protected_group / tragedy: true if present (should never be).
8. quality: would a sharp streetwear brand put this on its product page?
End with exactly one line: RESULT: {"pass":true|false,"product_accurate":true|false,"text_legible":true|false,"photo_believable":true|false,"real_person":true|false,"real_names":true|false,"other_logos":true|false,"slurs_or_protected_group":true|false,"tragedy":true|false,"quality":"good|ok|bad","text_seen":"<the text you read on the shirt>","reasons":"<one or two sentences; if it fails, the exact fix>"}`;
}
// Code decides: the reviewer's pass AND creative's verdict() (hard lines, accuracy, quality) AND a believable photo
export function launchVerdict(raw) {
  const vd = reviewVerdict(raw);
  const fails = [...(vd.failed_checks || [])];
  if (raw && raw.product_accurate == null) fails.push("product_accurate");   // must be a definite yes here
  if (raw && raw.text_legible == null) fails.push("text_legible");
  if (raw && raw.photo_believable !== true) fails.push("photo_believable");
  return { ...vd, hard_lines: vd.hard_lines || [], failed_checks: [...new Set(fails)], pass: vd.pass && !fails.length, text_seen: raw?.text_seen || "" };
}

function naive(ctx) { return createClient({ baseUrl: "https://api.vetta.sh", apiKey: ctx.vettaKey }); }
async function upload(v, bytes, name, type) {
  const form = new FormData(); form.append("file", new Blob([bytes], { type }), name);
  return (await v.files.upload(form)).id;
}
async function refFileIds(ctx, v, info, refs) {
  const get = async (key, f, label) => {
    const cached = loadLaunch(ctx.rootDir).refs?.[key];
    if (cached) return { label, file_id: cached };
    const id = await upload(v, await sharp(f).resize(800).png().toBuffer(), `${key.replace(/[^a-z0-9-]/gi, "-")}.png`, "image/png");
    mutateLaunch(ctx.rootDir, (l) => { l.refs[key] = id; });
    return { label, file_id: id };
  };
  return [
    await get(`flat:${info.flat_url}`, refs.flat, "the back print itself on shirt black (exact artwork)"),
    await get(`back:${info.back_url}`, refs.back, "product mockup, back of the shirt"),
    await get(`front:${info.front_url}`, refs.front, "product mockup, front of the shirt (chest wordmark)"),
    await get("wordmark-card", refs.wordmark, "our exact wordmark, large"),
  ];
}
// The print-area close-up the reviewer also gets: the full photo is downscaled for the vision model, and a 4-inch chest
// wordmark then reads as "garbled" (seen on the first test run). Torso region of a waist-up portrait, upscaled.
export async function detailCrop(jpg) {
  const { width: w, height: h } = await sharp(jpg).metadata();
  return sharp(jpg).extract({ left: Math.round(w * 0.1), top: Math.round(h * 0.25), width: Math.round(w * 0.8), height: Math.round(h * 0.45) })
    .resize(1400).jpeg({ quality: 90 }).toBuffer();
}
async function review(ctx, v, reviewerId, jpg, shot, info, refIds) {
  // Naïve hiccups ("the service is at capacity") are retried on the SAME image: they must not use up a regeneration
  for (let i = 0; ; i++) {
    try { return await reviewOnce(ctx, v, reviewerId, jpg, shot, info, refIds); }
    catch (e) { if (i >= 6) throw e; const s = Math.min(90, 15 * 2 ** i); ctx.log?.(`[launch] ${info.slug} shot ${shot.n}: review error (${e.message}), retrying in ${s} s`); await sleep(s * 1000); }
  }
}
async function reviewOnce(ctx, v, reviewerId, jpg, shot, info, refIds) {
  const fid = await upload(v, jpg, `launch-${info.slug}-${shot.n}.jpg`, "image/jpeg");
  const crop = await upload(v, await detailCrop(jpg), `launch-${info.slug}-${shot.n}-detail.jpg`, "image/jpeg");
  const s = await v.sessions.create({ agent_id: reviewerId, budget_micro_usd: 400_000, message: launchReviewBrief({ shot, info, file: fid, crop, refs: refIds }) });
  for (let i = 0; i < 60; i++) {   // up to ~5 min
    await sleep(5000);
    const st = await v.sessions.get(s.id);
    for (const a of (st.pending_actions || []).filter((x) => x.kind !== "question" && x.name === "view_image"))
      await v.sessions.confirmTool(s.id, { tool_call_id: a.tool_call_id, decision: "allow", scope: "session", reason: "reviewer's view_image (config: allow)" }).catch(() => {});
    if (["idle", "completed", "failed", "cancelled"].includes(st.status) && !(st.pending_actions || []).length) {
      const ev = []; for (let after; ;) { const p = await v.sessions.events(s.id, { limit: 100, ...(after !== undefined ? { after_seq: after } : {}) }); ev.push(...p.data); if (p.data.length < 100) break; after = p.data.at(-1).seq; }
      const last = ev.filter((e) => e.type === "message.completed" && e.data?.role === "assistant").map((e) => String(e.data.content)).join("\n");
      let raw = null; try { raw = JSON.parse((last.match(/RESULT:\s*(\{[\s\S]*?\})\s*$/m) || last.match(/RESULT:\s*(\{[\s\S]*\})/) || [])[1]); } catch {}
      if (!raw && st.status === "failed") throw new Error(`reviewer session ${s.id} failed`);
      return { ...launchVerdict(raw), raw, session: s.id, naive_file_id: fid, cost_usd: (st.consumed_micro_usd || 0) / 1e6 };
    }
  }
  throw new Error(`reviewer session ${s.id} timed out`);
}

// ---------------- publish (CONTENT.md §6) ----------------
export const altFor = (shot, info) => `AI-generated photo: a fictional person ${shot.view === "front" ? "facing the camera" : "seen from behind"} in ${shot.setting.split(/[,:]/)[0]}, San Francisco, wearing the black ${info.title} tee (${shot.view === "front" ? `"${WORDMARK}" chest wordmark` : info.text ? `back print "${info.text}"` : `back print: ${String(info.print_line).slice(0, 90)}`}).`.slice(0, 300);
export const launchItem = (info, images, test, created_at = new Date().toISOString()) => ({
  slug: info.slug, title: String(info.title || "").slice(0, 120), images: images.slice(0, 6).map((i) => ({ url: i.url, alt: i.alt.slice(0, 300), kind: "on_model" })), created_at, test: !!test,
});
// Never overwrite a launch someone else made (e.g. drop #1's git-reset-hard-tee, published by hand): an existing store
// item for this slug is replaced only if every image in it is one this code uploaded (recorded in the ledger).
export async function foreignLaunch(rootDir, admin, slug) {
  const cur = await admin.call("GET", "/api/admin/content");
  const item = (cur.content?.launches || []).find((x) => (x.slug || x.id) === slug);
  if (!item) return null;
  const ours = new Set((loadLaunch(rootDir).designs[slug]?.passes || []).map((p) => p.blob_url).filter(Boolean));
  const theirs = (item.images || []).map((i) => i.url).filter((u) => !ours.has(u));
  return theirs.length ? { images: (item.images || []).length, test: !!item.test } : null;
}
export async function publishLaunch({ rootDir, info, passes, test, admin = storeAdmin(rootDir), log = () => {} }) {
  if (admin.error) return { ok: false, error: admin.error };
  const foreign = await foreignLaunch(rootDir, admin, info.slug);
  if (foreign) return { ok: false, error: `the store already has a launch for ${info.slug} that this code didn't make (${foreign.images} image(s)); not overwriting it` };
  const images = [];
  for (const ps of passes.slice(0, MAX_PER_DESIGN)) {
    let url = ps.blob_url;
    if (!url) {
      url = (await admin.call("POST", `/api/admin/upload?name=${encodeURIComponent(`${info.slug}-launch-${ps.n}`)}`, { body: fs.readFileSync(ps.local), type: "image/jpeg" })).url;
      mutateLaunch(rootDir, (l) => { const d = l.designs[info.slug]; const x = d?.passes?.find((q) => q.local === ps.local); if (x) x.blob_url = url; });
    }
    const shot = shotPlan(info.slug).find((x) => x.n === ps.n);
    images.push({ url, alt: shot ? altFor(shot, info) : ps.alt });
  }
  if (!images.length) return { ok: false, error: "no passing images" };
  const item = launchItem(info, images, test);
  for (let i = 0; i < 3; i++) {
    try { await admin.call("PATCH", "/api/admin/content", { json: { op: "upsert", collection: "launches", item } }); log(`[launch] ${info.slug}: published ${images.length} image(s) to the store${test ? " (test:true)" : ""}`); return { ok: true, images: images.length, test: !!test, at: new Date().toISOString(), urls: images.map((x) => x.url) }; }
    catch (e) { if (e.status !== 409) return { ok: false, error: e.message, urls: images.map((x) => x.url) }; await sleep(800); }
  }
  return { ok: false, error: "content kept changing (409 x3)" };
}
export async function removeLaunch(rootDir, slug) {
  const admin = storeAdmin(rootDir); if (admin.error) return { ok: false, error: admin.error };
  return admin.call("PATCH", "/api/admin/content", { json: { op: "remove", collection: "launches", id: slug } }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
}

// ---------------- the job ----------------
const running = new Map();   // job_id -> promise (this process only)
const tsDir = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// ctx: { rootDir, outDir, vettaKey, openaiKey, log }. opts: { test, regen, publish (default true), label, dry }
// Returns quickly: { job_id, state, done } (done = promise of the final job record; serve ignores it, the CLI awaits it).
export async function startLaunchImages(ctx, slugOrProposal, opts = {}) {
  const log = (m) => ctx.log?.(m);
  const info = await designInfo(ctx.rootDir, ctx.outDir, slugOrProposal);
  const test = isTest(info, opts.test);
  const l = loadLaunch(ctx.rootDir);
  const busy = Object.values(l.jobs).find((j) => j.slug === info.slug && j.state === "running" && running.has(j.job_id));
  if (busy) return { job_id: busy.job_id, state: "running", note: "a job for this design is already running", done: running.get(busy.job_id) };
  const prev = l.designs[info.slug];
  if (!opts.regen && prev?.published?.ok && prev.published.images >= 2 && !!prev.published.test === test)
    return { job_id: null, state: "skipped", note: `already has ${prev.published.images} launch images (${test ? "test" : "live"}); pass regen to redo`, done: Promise.resolve(null) };
  const job_id = newId();
  const runDir = path.join(ctx.rootDir, "order-runs", `${tsDir()}_${opts.label || `launch-${info.slug}`}`);
  const job = { job_id, slug: info.slug, design_id: info.design_id, state: "running", test, started_at: new Date().toISOString(), run_dir: runDir, shots: [], cost: { openai_usd: 0, reviewer_usd: 0 } };
  mutateLaunch(ctx.rootDir, (x) => { x.jobs[job_id] = job; });
  log(`[launch] ${info.slug}: job ${job_id} started${test ? " (test)" : ""} -> ${path.relative(ctx.rootDir, runDir)}`);
  const done = runJob(ctx, job_id, info, { ...opts, test, runDir }).catch((e) => {
    log(`[launch] ${info.slug}: job ${job_id} failed: ${e.message}`);
    return mutateLaunch(ctx.rootDir, (x) => Object.assign(x.jobs[job_id], { state: "failed", error: e.message, done_at: new Date().toISOString() }));
  }).finally(() => running.delete(job_id));
  running.set(job_id, done);
  return { job_id, state: "running", slug: info.slug, test, run_dir: runDir, done };
}
export const launchStatus = (rootDir, job_id) => loadLaunch(rootDir).jobs[job_id] || null;

async function runJob(ctx, job_id, info, opts) {
  const log = (m) => ctx.log?.(m);
  fs.mkdirSync(opts.runDir, { recursive: true });
  const upd = (patch) => mutateLaunch(ctx.rootDir, (x) => Object.assign(x.jobs[job_id], typeof patch === "function" ? patch(x.jobs[job_id]) : patch));
  const addCost = (k, usd) => mutateLaunch(ctx.rootDir, (x) => { x.jobs[job_id].cost[k] = Math.round((x.jobs[job_id].cost[k] + usd) * 10000) / 10000; });

  // Reuse passes made earlier for this exact design (e.g. a test run before the live backfill): no new spend
  const prior = (loadLaunch(ctx.rootDir).designs[info.slug]?.passes || []).filter((p) => p.design_id === info.design_id && fs.existsSync(p.local));
  let passes = opts.regen ? [] : prior.slice(0, MAX_PER_DESIGN);
  if (!opts.regen && prior.length >= 2) {
    passes = prior.slice(0, MAX_PER_DESIGN);
    log(`[launch] ${info.slug}: reusing ${passes.length} passing image(s) from earlier runs`);
  } else {
    const openaiKey = ctx.openaiKey || envKey(ctx.rootDir, "OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY is not in .env");
    const v = naive(ctx);
    const reviewer = ((await v.agents.list({ limit: 100 })).data || []).find((a) => a.name === REVIEWER());
    if (!reviewer) throw new Error(`no ${REVIEWER()} agent; run setup_agents.mjs`);
    const refs = await refFiles(ctx.rootDir, info);
    const refIds = await refFileIds(ctx, v, info, refs);
    const plan = shotPlan(info.slug).slice(0, MAX_PER_DESIGN).filter((sh) => !passes.some((p) => p.n === sh.n));   // only shots without a pass yet
    fs.writeFileSync(path.join(opts.runDir, "info.json"), JSON.stringify({ info, plan, test: opts.test }, null, 2));

    const doShot = async (shot) => {
      let feedback = "";
      for (let attempt = 1; attempt <= 1 + MAX_REGEN; attempt++) {
        // daily cap, reserved before spending (sync read-modify-write)
        const ok = mutateLaunch(ctx.rootDir, (x) => { if (gensToday(x) >= MAX_PER_DAY()) return false; x.gens.push({ at: new Date().toISOString(), slug: info.slug, job_id, shot: shot.n, attempt }); return true; });
        if (!ok) { log(`[launch] ${info.slug} shot ${shot.n}: daily cap (${MAX_PER_DAY()} images) reached`); return { shot, pass: null, capped: true }; }
        const prompt = shotPrompt(shot, info, feedback);
        let g;
        try { g = await generate(openaiKey, prompt, refsFor(shot, refs)); }
        catch (e) { log(`[launch] ${info.slug} shot ${shot.n}.${attempt}: generation failed: ${e.message}`); upd((j) => ({ shots: [...j.shots, { n: shot.n, attempt, view: shot.view, error: e.message }] })); feedback = ""; continue; }
        addCost("openai_usd", g.cost_usd);
        const local = path.join(opts.runDir, `shot${shot.n}-${shot.view}-try${attempt}.jpg`);
        fs.writeFileSync(local, g.jpg);
        let r;
        try { r = await review(ctx, v, reviewer.id, g.jpg, shot, info, refIds); }
        catch (e) { r = { pass: false, reasons: `review error: ${e.message}`, cost_usd: 0, review_error: true }; }
        addCost("reviewer_usd", r.cost_usd || 0);
        const rec = { n: shot.n, attempt, view: shot.view, local, model: g.model, cost_usd: Math.round(g.cost_usd * 10000) / 10000, review_usd: r.cost_usd || 0,
          pass: r.pass, reasons: r.reasons, failed_checks: r.failed_checks, hard_lines: r.hard_lines, quality: r.quality, text_seen: r.text_seen, review_session: r.session };
        fs.writeFileSync(local.replace(/\.jpg$/, ".json"), JSON.stringify({ prompt, ...rec, raw: r.raw }, null, 2));
        upd((j) => ({ shots: [...j.shots, rec] }));
        log(`[launch] ${info.slug} shot ${shot.n} (${shot.view}) try ${attempt}: ${r.pass ? "PASS" : "FAIL"} ${String(r.reasons || "").slice(0, 160)}`);
        if (r.pass) return { shot, pass: { n: shot.n, view: shot.view, local, alt: altFor(shot, info), design_id: info.design_id, at: new Date().toISOString() } };
        if (r.review_error) { log(`[launch] ${info.slug} shot ${shot.n}: reviewer unavailable; not regenerating (rerun backfill_launch.mjs later)`); return { shot, pass: null, review_unavailable: true }; }
        feedback = String(r.reasons || "").slice(0, 400);
        if (r.hard_lines?.length) feedback += ` (hard line: ${r.hard_lines.join(", ")})`;
      }
      return { shot, pass: null };
    };
    const results = await Promise.all(plan.map(doShot));   // shots in parallel, attempts in sequence
    passes = [...passes, ...results.map((x) => x.pass).filter(Boolean)].sort((a, b) => a.n - b.n);   // shot order: back, front, candid
    if (passes.length) mutateLaunch(ctx.rootDir, (x) => { const d = (x.designs[info.slug] ||= { slug: info.slug }); d.design_id = info.design_id; d.passes = passes; d.updated_at = new Date().toISOString(); });
  }

  let published = { ok: false, skipped: opts.publish === false ? "publish off" : "no passes" };
  if (passes.length && opts.publish !== false) {
    published = await publishLaunch({ rootDir: ctx.rootDir, info, passes, test: opts.test, log }).catch((e) => ({ ok: false, error: e.message }));
    mutateLaunch(ctx.rootDir, (x) => { x.designs[info.slug].published = published; });
  }
  const j = loadLaunch(ctx.rootDir).jobs[job_id];
  const total = Math.round((j.cost.openai_usd + j.cost.reviewer_usd) * 100) / 100;
  const gens = j.shots.filter((s) => s.local).length;
  const final = upd({ state: "done", passes: passes.length, generations: gens, published, cost: { ...j.cost, total_usd: total, note: "openai = estimate from token usage; reviewer = Naïve consumed" }, done_at: new Date().toISOString() });
  fs.writeFileSync(path.join(opts.runDir, "record.json"), JSON.stringify(final, null, 2));
  log(`[launch] ${info.slug}: done, ${passes.length} pass(es) from ${gens} generation(s), cost ~$${total} (openai ~$${j.cost.openai_usd}, reviewer $${j.cost.reviewer_usd}); store: ${published.ok ? `ok${opts.test ? " test" : ""}` : published.error || published.skipped}`);
  return final;
}

// For ceo_decide: fire-and-forget after a successful publish. Never throws, never awaited.
// Live publishes always (LAUNCH_IMAGES=0 turns it off); sandbox publishes only with LAUNCH_IMAGES_TEST=1 (then test:true).
export function kickLaunchImages(ctx, proposal, pub) {
  try {
    if (process.env.LAUNCH_IMAGES === "0") return null;
    if (pub?.mode !== "live" && process.env.LAUNCH_IMAGES_TEST !== "1") return null;
    const p = { ...proposal, mode: pub.mode, publish: pub };
    startLaunchImages(ctx, p).then((r) => ctx.log?.(`[launch] ${p.slug}: ${r.state} ${r.job_id || r.note || ""}`))
      .catch((e) => ctx.log?.(`[launch] ${p.slug}: could not start: ${e.message}`));
    return true;
  } catch (e) { ctx.log?.(`[launch] could not start: ${e.message}`); return null; }
}
