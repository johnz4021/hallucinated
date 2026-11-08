// Phase 4: the CEO plans, Creative makes ads, a vision reviewer passes them, code publishes, Growth posts them.
//   get_plan            (Product, Creative, Growth, CEO) the CEO's latest plan
//   set_plan            (CEO) writes a new plan version; retire_suggestions are flagged to John by code (never unpublished)
//   store_stats         (CEO) orders and pre-orders per product, last 7 days (Stripe, current mode)
//   x_stats             (CEO) public metrics of our last ~30 X posts, with the pillar each one was
//   store_catalog       (CEO, Creative) sellable products with images, prints and URLs
//   ad_video_start      (Creative) image-to-video job (Kling / Veo) - max 1 a day, enforced here
//   ad_video_status     (Creative) waits <= 60 s, returns the video file id when done
//   ad_review           (Creative) starts the vision reviewer (its own agent, view_image) on an image or 3 video frames
//   ad_review_status    (Creative) waits <= 60 s, returns pass/fail with the reviewer's reasons
//   ad_submit           (Creative) only with a PASSING review of that exact file: caps (4 images, 1 video a day), hard-line
//                       text check, media -> Blob, campaign -> store (CONTENT.md §5), queued for Growth's ad pillar
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import sharp from "sharp";
import { createClient } from "@usenaive-sdk/vetta";
import { txt, err, readJson } from "../lib/state.mjs";
import { stripeClient, fetchOrders } from "../stripe/tools.mjs";
import { listPreorders } from "../stripe/preorders.mjs";
import { flagJohn } from "../agentmail/tools.mjs";
import { findBanned } from "../designs/guard.mjs";
import { storeAdmin } from "../designs/publish.mjs";
import { ptDay } from "../designs/ledger.mjs";
import { xKeys, xMe, xUserTweets } from "../x/xapi.mjs";
import { storeCatalog, STORE_HOSTS } from "./catalog.mjs";
import { STYLES, STYLE_IDS, AD_FORMATS, AD_FORMAT_IDS, pickStyle } from "../designs/styles.mjs";
import { testMode, latestPlan, savePlan, loadAds, mutateAds, adsToday, videosStartedToday, newId, MAX_IMAGE_ADS_PER_DAY, MAX_VIDEO_ADS_PER_DAY } from "./ledger.mjs";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const VIDEO_MODELS = ["kwaivgi/kling-v3.0-pro", "google/veo-3.1-fast"];
export const REVIEWER = () => process.env.REVIEWER_AGENT || "hallucinated-reviewer";
const HASHTAG_OK = /^#hallucinated$/i;
export const badHashtags = (t) => (String(t).match(/#[\p{L}\p{N}_]+/gu) || []).filter((h) => !HASHTAG_OK.test(h));
const SOURCE = z.object({ label: z.string().min(2).max(400), url: z.string().url() });

// The reviewer's instructions: the hard lines from brand.json plus asset checks. Fictional AI people are fine.
export function reviewBrief({ kind, files, refs, concept, caption, featured, text_in_image }) {
  return `Review this ${kind === "video" ? "VIDEO ad (you get 3 frames: start, middle, end)" : "IMAGE ad"} for Hallucinated before it goes public. Use view_image on every file below, including the references.
Ad: ${files.join(", ")}
References: ${refs.map((r) => `${r.label}: ${r.file_id}`).join("; ") || "none"}
Concept: ${concept}
Caption that runs with it: ${caption}
Text that should appear in the image, exactly: ${text_in_image ? JSON.stringify(text_in_image) : "(none given: judge the text you see on its own)"}
Featured product: ${featured ? `${featured.name} (${featured.slug})` : "none (pure brand comedy)"}

Check, and be strict:
1. product_accurate: if our shirt, logo or print is shown, it matches the references (the word "Hallucinated" spelled right, the print's text exact, black tee). null if no product is shown.
2. text_legible: every piece of text in the image is spelled correctly and readable (no garbled AI letters), and matches the intended text exactly: no duplicated, missing, extra or reworded lines. null if there is no text.
3. real_person: true if anyone looks like a real, identifiable person (a celebrity, founder, politician or look-alike). AI-generated fictional people are fine: answer false for them.
4. real_names: true if a real person's name appears in the image.
5. other_logos: true if any other brand's logo or trademark appears in the image (Apple, Google, Waymo, Tesla, OpenAI, ...).
6. slurs_or_protected_group: true if it contains a slur or makes a protected group (race, religion, gender, sexuality, disability, age, nationality) the butt of the joke.
7. tragedy: true if it mocks a real tragedy, disaster, death or its victims.
8. quality: would a sharp tech-Twitter streetwear account post this (composition, no AI artifacts like warped hands or melted fabric)?
Comedy can be edgy and dark; that's allowed. Only the hard lines above and accuracy decide.
End with exactly one line: RESULT: {"pass":true|false,"product_accurate":true|false|null,"text_legible":true|false|null,"real_person":true|false,"real_names":true|false,"other_logos":true|false,"slurs_or_protected_group":true|false,"tragedy":true|false,"quality":"good|ok|bad","reasons":"<one or two sentences>"}`;
}
// Code decides: the reviewer's pass AND no hard-line flag AND accuracy not false AND quality not bad.
export function verdict(r) {
  if (!r || typeof r !== "object") return { pass: false, reasons: "no parsable verdict" };
  const lines = ["real_person", "real_names", "other_logos", "slurs_or_protected_group", "tragedy"].filter((k) => r[k] === true);
  const acc = ["product_accurate", "text_legible"].filter((k) => r[k] === false);
  const pass = r.pass === true && !lines.length && !acc.length && r.quality !== "bad";
  return { pass, hard_lines: lines, failed_checks: acc, quality: r.quality || null, reasons: r.reasons || "" };
}

export function registerCreativeTools(server, ctx) {
  const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: ctx.vettaKey });
  const log = (m) => ctx.log?.(m);

  async function uploadToNaive(bytes, name, type) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    const f = await v.files.upload(form);
    return f.id;
  }
  // Reference images for the reviewer, uploaded to Naïve once and cached by source
  async function refFile(key, loader) {
    const cached = loadAds(ctx.rootDir).refs?.[key];
    if (cached) return cached;
    const { bytes, name, type } = await loader();
    const id = await uploadToNaive(bytes, name, type);
    mutateAds(ctx.rootDir, (l) => { (l.refs ||= {})[key] = id; });
    return id;
  }
  async function urlBytes(u) {
    const r = await fetch(u, { signal: AbortSignal.timeout(40_000) });
    if (!r.ok) throw new Error(`fetch ${u.slice(0, 80)}: ${r.status}`);
    return { bytes: Buffer.from(await r.arrayBuffer()), type: (r.headers.get("content-type") || "image/png").split(";")[0] };
  }
  async function frames(videoFile, n = 3) {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoFile]);
    const dur = Math.max(0.5, parseFloat(stdout) || 5);
    const out = [];
    for (const [i, t] of [0.15, dur / 2, Math.max(0.2, dur - 0.3)].slice(0, n).entries()) {
      const f = path.join(os.tmpdir(), `frame-${Date.now()}-${i}.jpg`);
      await run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", videoFile, "-frames:v", "1", "-q:v", "3", f]);
      out.push(f);
    }
    return out;
  }
  async function naiveToFile(fileId, ext) {
    const bytes = Buffer.from(await v.files.downloadBytes(fileId));
    const f = path.join(os.tmpdir(), `${fileId}.${ext}`);
    fs.writeFileSync(f, bytes);
    return f;
  }

  // ---------------- CEO: plan + stats ----------------
  server.registerTool("get_plan", {
    title: "The CEO's current plan",
    description: "The latest plan from the CEO agent: themes to lean into, products to push, ad seeds, notes. Read it at the start of every run and follow it.",
    inputSchema: {},
  }, async () => { const p = latestPlan(ctx.rootDir); return txt(p ? { version: p.version, at: p.at, ...p.plan } : { plan: null, note: "no plan yet; use the brand's creative_direction" }); });

  server.registerTool("set_plan", {
    title: "Write today's plan (CEO)",
    description: "Sets the company's plan that Product, Creative and Growth read every run. themes: what to make jokes about; push_products: slugs to feature in ads and posts; ad_seeds: concrete ad ideas for Creative; retire_suggestions: products you think should come off the store (John is flagged; you can't unpublish); notes: anything else. Each call is a new version.",
    inputSchema: {
      themes: z.array(z.string().max(200)).min(1).max(8),
      push_products: z.array(z.string().max(80)).max(6),
      ad_seeds: z.array(z.string().max(300)).max(8),
      retire_suggestions: z.array(z.object({ slug: z.string().max(80), why: z.string().max(300) })).max(6).optional(),
      notes: z.string().max(1500).optional(),
    },
  }, async (plan) => {
    try {
      const slugs = new Set((await storeCatalog(ctx.rootDir)).map((p) => p.slug));
      const unknown = plan.push_products.filter((s) => !slugs.has(s));
      const hits = findBanned({ themes: plan.themes.join(" | "), seeds: plan.ad_seeds.join(" | ") }, ["real_people", "tragedy"]);
      if (hits.length) return err(`refused by the hard lines: ${hits.map((h) => `"${h.term}" (${h.list})`).join(", ")}. Roast archetypes and moments, not real people or real tragedies.`);
      const v2 = savePlan(ctx.rootDir, { ...plan, push_products: plan.push_products.filter((s) => slugs.has(s)) }, "ceo");
      if (plan.retire_suggestions?.length) flagJohn(ctx, { reason: "other", from_agent: "ceo (set_plan)", ref: `plan v${v2.version}`,
        summary: `The CEO agent suggests retiring: ${plan.retire_suggestions.map((r) => `${r.slug} (${r.why})`).join("; ")}. Unpublish with unpublish.command if you agree.` });
      log(`[set_plan] v${v2.version}: themes ${plan.themes.join(" | ").slice(0, 200)}`);
      return txt({ version: v2.version, at: v2.at, unknown_products_dropped: unknown, flagged_to_john: plan.retire_suggestions?.length || 0 });
    } catch (e) { return err("set_plan failed: " + e.message); }
  });

  server.registerTool("store_stats", {
    title: "Sales per product, last 7 days (Stripe)",
    description: "Paid orders and pre-orders per product in the last 7 days from Stripe (current mode), with totals. Read-only.",
    inputSchema: { days: z.number().int().min(1).max(30).optional() },
  }, async ({ days = 7 }) => {
    try {
      const sc = stripeClient(ctx.rootDir);
      if (sc.error) return err(sc.error);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const catalog = await storeCatalog(ctx.rootDir);
      const bySlug = Object.fromEntries(catalog.map((p) => [p.slug, { slug: p.slug, name: p.name, status: p.status, orders_qty: 0, orders_usd: 0, preorders_qty: 0, preorders_usd: 0 }]));
      const slugOf = (r) => r.slug || catalog.find((p) => p.design_id && p.design_id === r.design_id && (p.garment || "tee") === (r.garment || "tee"))?.slug || "unknown";
      for (const r of await fetchOrders(sc, ctx.rootDir, { since, drop: "all", unbatchedOnly: false })) {
        const s = slugOf(r), b = (bySlug[s] ||= { slug: s, name: s, orders_qty: 0, orders_usd: 0, preorders_qty: 0, preorders_usd: 0 });
        b.orders_qty += r.quantity; b.orders_usd += r.line_usd || 0;   // was never summed: the CEO saw "$0 revenue" for a paid $65 order
      }
      for (const p of (await listPreorders(sc, {})).filter((x) => x.created_at >= since)) for (const i of p.items) {
        const s = catalog.find((c) => c.product_id === i.product_id)?.slug || i.product || "unknown";
        const b = (bySlug[s] ||= { slug: s, name: i.product || s, orders_qty: 0, orders_usd: 0, preorders_qty: 0, preorders_usd: 0 });
        b.preorders_qty += i.qty; b.preorders_usd += ((i.unit_amount || 0) * i.qty) / 100;
      }
      const list = Object.values(bySlug).sort((a, b) => b.orders_qty + b.preorders_qty - (a.orders_qty + a.preorders_qty));
      for (const x of list) { x.orders_usd = Math.round(x.orders_usd * 100) / 100; x.preorders_usd = Math.round(x.preorders_usd * 100) / 100; }
      const sum = (k) => Math.round(list.reduce((n, x) => n + x[k], 0) * 100) / 100;
      return txt({ mode: sc.mode, days, products: list, totals: { orders_qty: sum("orders_qty"), orders_usd: sum("orders_usd"), preorders_qty: sum("preorders_qty"), preorders_usd: sum("preorders_usd"), revenue_paid_usd: sum("orders_usd") },
        note: "orders = paid now; pre-orders = cards saved, charged at launch (not revenue yet)" });
    } catch (e) { return err("store_stats failed: " + e.message); }
  });

  server.registerTool("x_stats", {
    title: "How our recent X posts did",
    description: "Public metrics (likes, reposts, replies, quotes, impressions when X gives them) for our last ~30 posts, newest first, with the content pillar each one was. Read-only.",
    inputSchema: { max: z.number().int().min(5).max(100).optional() },
  }, async ({ max = 30 }) => {
    try {
      const env = fs.existsSync(path.join(ctx.rootDir, ".env")) ? fs.readFileSync(path.join(ctx.rootDir, ".env"), "utf8") : "";
      const keys = xKeys(env);
      if (!keys) return err("X keys not in .env");
      const me = ctx.xMe || (ctx.xMe = (await xMe(keys)).data);
      const posts = await xUserTweets(keys, me.id, max);
      const led = readJson(path.join(ctx.rootDir, "x-ledger.json"), { posts: [] });
      const pillar = Object.fromEntries((led.posts || []).map((p) => [p.id, p.pillar || p.kind]));
      return txt({ account: me.username, count: posts.length, posts: posts.map((p) => ({ ...p, pillar: pillar[p.id] || null })) });
    } catch (e) { return err("x_stats failed: " + e.message); }
  });

  server.registerTool("store_catalog", {
    title: "What the store sells",
    description: "Every sellable product (in stock or pre-order): slug, name, status, product URL, image URLs (mockups) and, for agent designs, the print file URL. Plus brand_refs.logo, a file id of our exact wordmark. Pass these as image_urls to generate_image when an ad shows a product or the logo.",
    inputSchema: {},
  }, async () => {
    try {
      const logo = await refFile("logo", () => ({ bytes: fs.readFileSync(path.join(ctx.mcpDir, "refs", "logo.png")), name: "logo.png", type: "image/png" }));
      return txt({ brand_refs: { logo, note: "our exact Hallucinated wordmark (bone with the offset eucalyptus ghost)" }, products: await storeCatalog(ctx.rootDir) });
    } catch (e) { return err("store_catalog failed: " + e.message); }
  });

  // ---------------- Creative: video ----------------
  // ---------------- Creative: format rotation (so the ads don't all look like terminal screenshots) ----------------
  server.registerTool("next_ad_format", {
    title: "This ad's format and visual style (rotation)",
    description: "Picks, in code, the format for your next ad (fake billboard, tabloid cover, museum placard, infomercial still, nature-doc still, catalog page, wanted poster, pitch-deck slide, job listing, terminal screenshot, incident report, editorial photo, airline safety card, trading card) and a visual style (photo box, halftone, flash snapshot, tabloid, ransom collage, zine, bootleg collage, woodcut, risograph, patent drawing, manuscript, 90s clip art, Y2K chrome, terminal). Never the same format twice in a row, preferring ones unused in the last 5. Call it once per concept and build the concept for it.",
    inputSchema: {},
  }, async () => {
    const l = loadAds(ctx.rootDir);
    const hist = (l.formats || []).filter((f) => !!f.test === testMode());
    const format = pickStyle(hist.map((h) => h.format), Math.random, AD_FORMAT_IDS);
    const style = pickStyle(hist.map((h) => h.style).filter(Boolean), Math.random, STYLE_IDS);
    mutateAds(ctx.rootDir, (x) => { (x.pending_formats ||= []).push({ format, style, at: new Date().toISOString(), test: testMode() }); x.pending_formats = x.pending_formats.slice(-6); });
    return txt({ format, what: AD_FORMATS[format], style, style_how: STYLES[style].prompt, recent_formats: hist.slice(-5).map((h) => h.format),
      note: "Pass format to ad_submit. The ad can be pure brand comedy or feature a product; keep any text short and exact. AI-generated people only, no real faces or names, no other brands' logos." });
  });

  server.registerTool("ad_video_start", {
    title: "Start a video ad from your best image (max 1 a day)",
    description: "Image-to-video: animates one of your generated images (its fil_ id) into a 5-8 s clip with Kling v3 Pro (default) or Veo 3.1 Fast. At most 1 video a day, enforced here. Takes a few minutes: poll ad_video_status with the job_id.",
    inputSchema: { image_file_id: z.string().regex(/^fil_[a-z0-9]+$/), prompt: z.string().min(10).max(1500), model: z.enum(VIDEO_MODELS).optional(),
      aspect_ratio: z.enum(["9:16", "4:5", "1:1", "16:9"]).optional(), seconds: z.number().int().min(4).max(10).optional() },
  }, async ({ image_file_id, prompt, model = VIDEO_MODELS[0], aspect_ratio = "9:16", seconds = 5 }) => {
    try {
      const l = loadAds(ctx.rootDir);
      const today = videosStartedToday(l);
      if (today.length >= MAX_VIDEO_ADS_PER_DAY()) return err(`refused: already ${today.length} video today (limit ${MAX_VIDEO_ADS_PER_DAY()}); make image ads instead`);
      const job = await v.media.videos.generate({ model, prompt, image_urls: [image_file_id], aspect_ratio, seconds });
      mutateAds(ctx.rootDir, (x) => { x.videos[job.id] = { job_id: job.id, model, prompt, image_file_id, aspect_ratio, seconds, started_at: new Date().toISOString(), cost_micro_usd: job.cost_micro_usd ?? null, test: testMode() }; });
      log(`[ad_video_start] ${job.id} ${model} from ${image_file_id}${testMode() ? " (test)" : ""}`);
      return txt({ job_id: job.id, status: job.status, next: "call ad_video_status with this job_id until it returns a file_id (each call waits up to a minute; videos take 2-6 minutes)" });
    } catch (e) { return err("ad_video_start failed: " + e.message); }
  });

  server.registerTool("ad_video_status", {
    title: "Is the video ready?",
    description: "Waits up to 60 s for a video job from ad_video_start, then returns its file_id when done (or still running).",
    inputSchema: { job_id: z.string().regex(/^med_[a-z0-9]+$/) },
  }, async ({ job_id }) => {
    try {
      for (let i = 0; i < 6; i++) {
        const files = (await v.files.list({ kind: "video", limit: 25 })).data || [];
        const f = files.find((x) => x.source?.job_id === job_id);
        if (f) {
          mutateAds(ctx.rootDir, (x) => { if (x.videos[job_id]) Object.assign(x.videos[job_id], { file_id: f.id, done_at: new Date().toISOString(), duration_seconds: f.duration_seconds ?? null }); });
          return txt({ state: "done", file_id: f.id, duration_seconds: f.duration_seconds ?? null, width: f.width, height: f.height, next: "ad_review with kind video" });
        }
        await sleep(10_000);
      }
      return txt({ state: "running", note: "not done yet; call again" });
    } catch (e) { return err("ad_video_status failed: " + e.message); }
  });

  // ---------------- Creative: review ----------------
  server.registerTool("ad_review", {
    title: "Send an ad to the vision reviewer",
    description: "Starts the reviewer agent (a vision model) on your image (fil_ id) or video (3 frames are extracted). It checks product accuracy against the real product images, text legibility, and the hard lines (no real faces or names, no other brands' logos, no slurs or protected-group jokes, no mocking real tragedies). Poll ad_review_status with the review_id. Only a passing review lets ad_submit publish that exact file.",
    inputSchema: { file_id: z.string().regex(/^fil_[a-z0-9]+$/), kind: z.enum(["image", "video"]), concept: z.string().min(10).max(600), caption: z.string().min(1).max(280),
      featured_slug: z.string().max(80).optional().describe("the product shown in the ad, if any (its images become references)"),
      text_in_image: z.string().max(400).optional().describe("the exact text you asked the image to contain (the reviewer checks it word for word, incl. duplicated or missing lines)") },
  }, async ({ file_id, kind, concept, caption, featured_slug, text_in_image }) => {
    try {
      const reviewer = ((await v.agents.list({ limit: 100 })).data || []).find((a) => a.name === REVIEWER());
      if (!reviewer) return err(`no ${REVIEWER()} agent; run setup_agents.mjs`);
      let files = [file_id];
      if (kind === "video") {
        const local = await naiveToFile(file_id, "mp4");
        files = [];
        for (const fr of await frames(local)) files.push(await uploadToNaive(fs.readFileSync(fr), path.basename(fr), "image/jpeg"));
      }
      const refs = [{ label: "Hallucinated logo (exact wordmark)", file_id: await refFile("logo", () => ({ bytes: fs.readFileSync(path.join(ctx.mcpDir, "refs", "logo.png")), name: "logo.png", type: "image/png" })) }];
      const featured = featured_slug ? (await storeCatalog(ctx.rootDir)).find((p) => p.slug === featured_slug) : null;
      if (featured_slug && !featured) return err(`no product ${featured_slug} in the store catalog`);
      if (featured?.image) refs.push({ label: `${featured.name} product mockup`, file_id: await refFile(`img:${featured.image}`, async () => { const b = await urlBytes(featured.image); return { bytes: b.bytes, name: `${featured.slug}.png`, type: b.type }; }) });
      const s = await v.sessions.create({ agent_id: reviewer.id, budget_micro_usd: 500_000, message: reviewBrief({ kind, files, refs, concept, caption, featured, text_in_image }) });
      const id = newId("rev");
      mutateAds(ctx.rootDir, (x) => { x.reviews[id] = { review_id: id, file_id, kind, frames: kind === "video" ? files : null, concept, caption, featured_slug: featured_slug || null, session: s.id, started_at: new Date().toISOString(), test: testMode() }; });
      log(`[ad_review] ${id} ${kind} ${file_id} -> reviewer session ${s.id}`);
      return txt({ review_id: id, state: "reviewing", next: "call ad_review_status with this review_id" });
    } catch (e) { return err("ad_review failed: " + e.message); }
  });

  server.registerTool("ad_review_status", {
    title: "The reviewer's verdict",
    description: "Waits up to 60 s, then returns the reviewer's verdict for a review_id: pass true/false, which hard lines or checks failed, and its reasons. If it failed, fix exactly what it says (new image) and review again; never submit a failed asset.",
    inputSchema: { review_id: z.string().regex(/^rev_[a-z0-9]+$/) },
  }, async ({ review_id }) => {
    try {
      const r = loadAds(ctx.rootDir).reviews[review_id];
      if (!r) return err(`no review ${review_id}`);
      if (r.done_at) return txt({ review_id, ...r });
      for (let i = 0; i < 12; i++) {
        const st = await v.sessions.get(r.session);
        // the reviewer's only tool is view_image: clear Naïve's holds on it from code (its config is allow)
        for (const a of (st.pending_actions || []).filter((x) => x.kind !== "question" && x.name === "view_image"))
          await v.sessions.confirmTool(r.session, { tool_call_id: a.tool_call_id, decision: "allow", scope: "session", reason: "reviewer's view_image (config: allow)" }).catch(() => {});
        if (["idle", "completed", "failed", "cancelled"].includes(st.status) && !(st.pending_actions || []).length) {
          const ev = []; for (let after; ;) { const p = await v.sessions.events(r.session, { limit: 100, ...(after !== undefined ? { after_seq: after } : {}) }); ev.push(...p.data); if (p.data.length < 100) break; after = p.data.at(-1).seq; }
          const last = ev.filter((e) => e.type === "message.completed" && e.data?.role === "assistant").map((e) => String(e.data.content)).join("\n");
          let parsed = null; try { parsed = JSON.parse((last.match(/RESULT:\s*(\{[\s\S]*?\})\s*$/m) || last.match(/RESULT:\s*(\{[\s\S]*\})/) || [])[1]); } catch {}
          const vd = verdict(parsed);
          const done = { ...vd, raw: parsed, review_text: last.slice(-1500), cost_usd: st.consumed_micro_usd / 1e6, done_at: new Date().toISOString() };
          mutateAds(ctx.rootDir, (x) => Object.assign(x.reviews[review_id], done));
          log(`[ad_review] ${review_id} ${vd.pass ? "PASS" : "FAIL"}: ${vd.reasons.slice(0, 200)}`);
          return txt({ review_id, file_id: r.file_id, ...vd, next: vd.pass ? "ad_submit with this file_id and review_id" : "fix it and make a new asset" });
        }
        await sleep(5000);
      }
      return txt({ review_id, state: "reviewing", note: "still reviewing; call again" });
    } catch (e) { return err("ad_review_status failed: " + e.message); }
  });

  // ---------------- Creative: submit ----------------
  server.registerTool("ad_submit", {
    title: "Publish a reviewed ad to the store and queue it for X",
    description: "For an asset that PASSED ad_review: uploads it to our store's media, adds it to the store's Campaigns wall and home hero, and queues it for Growth to post on X. Caps: 4 image ads and 1 video ad a day. event=true only when the ad reacts to a specific current SF/tech event; then give its real sources. Captions: no hashtags except #hallucinated, no real people's names.",
    inputSchema: { file_id: z.string().regex(/^fil_[a-z0-9]+$/), review_id: z.string().regex(/^rev_[a-z0-9]+$/), kind: z.enum(["image", "video"]),
      concept: z.string().min(10).max(600), caption: z.string().min(1).max(280), event: z.boolean(), sources: z.array(SOURCE).max(10).optional(),
      featured_products: z.array(z.string().max(80)).max(4).optional(),
      format: z.enum(AD_FORMAT_IDS).optional().describe("the format next_ad_format gave you for this concept") },
  }, async (a) => {
    try {
      const l = loadAds(ctx.rootDir);
      const rv = l.reviews[a.review_id];
      if (!rv || rv.file_id !== a.file_id) return err("refused: that review is not for this file");
      if (!rv.done_at) return err("refused: the review isn't finished; poll ad_review_status");
      if (!rv.pass) return err(`refused: the reviewer failed this asset (${rv.reasons}); make a new one`);
      if (Object.values(l.ads).some((x) => x.naive_file_id === a.file_id)) return err("refused: this file was already submitted");
      const cap = a.kind === "video" ? MAX_VIDEO_ADS_PER_DAY() : MAX_IMAGE_ADS_PER_DAY();
      if (adsToday(l, a.kind).length >= cap) return err(`refused: already ${adsToday(l, a.kind).length} ${a.kind} ads today (limit ${cap})`);
      if (a.event && !(a.sources || []).length) return err("refused: an event ad needs at least one real source");
      const tags = badHashtags(a.caption);
      if (tags.length) return err(`refused: no hashtags except #hallucinated (found ${tags.join(" ")})`);
      const hits = findBanned({ caption: a.caption, concept: a.concept }, ["real_people", "tragedy"]);
      if (hits.length) return err(`refused by the hard lines: ${hits.map((h) => `"${h.term}" (${h.list})`).join(", ")}`);
      const id = `ad-${ptDay()}-${a.concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${newId("x").slice(2, 7)}`.replace(/-+/g, "-").slice(0, 80);
      // queued for Growth first (Growth posts the Naïve file itself), then the store copy
      const ad = { id, state: "queued", kind: a.kind, naive_file_id: a.file_id, media_url: null, poster_url: null, concept: a.concept.slice(0, 600), caption: a.caption.slice(0, 280), event: a.event,
        sources: (a.sources || []).slice(0, 6).map((s) => ({ label: s.label.slice(0, 120), url: s.url })), featured_products: (a.featured_products || []).slice(0, 4),
        review_id: a.review_id, format: a.format || null, campaign: { ok: false, pending: true }, created_at: new Date().toISOString(), test: testMode() };
      mutateAds(ctx.rootDir, (x) => {
        x.ads[id] = ad;
        // the rotation history: the format this ad used (and the style issued with it), so the next pick avoids it
        const issued = (x.pending_formats || []).find((f) => f.format === a.format && !!f.test === testMode());
        if (a.format) { (x.formats ||= []).push({ format: a.format, style: issued?.style || null, ad_id: id, at: ad.created_at, test: testMode() }); x.formats = x.formats.slice(-60); }
        if (issued) x.pending_formats = x.pending_formats.filter((f) => f !== issued);
      });
      let store = { skipped: "ADS_SKIP_STORE=1" };
      if (process.env.ADS_SKIP_STORE !== "1") store = await publishAdToStore({ v, rootDir: ctx.rootDir, ad, outDir: ctx.outDir, baseUrl: ctx.baseUrl });
      log(`[ad_submit] ${id} ${a.kind}${a.event ? " EVENT" : ""} queued for Growth; store: ${store.media_url || store.skipped || store.error}${testMode() ? " (test)" : ""}`);
      return txt({ ad_id: id, queued_for_growth: true, store });
    } catch (e) { return err("ad_submit failed: " + e.message); }
  });
}

// ---- store copy of an ad (CONTENT.md §5): media -> Blob, then the campaigns collection. Idempotent per ad id.
export async function videoFrames(videoFile, n = 3) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoFile]);
  const dur = Math.max(0.5, parseFloat(stdout) || 5);
  const out = [];
  for (const [i, t] of [0.15, dur / 2, Math.max(0.2, dur - 0.3)].slice(0, n).entries()) {
    const f = path.join(os.tmpdir(), `frame-${Date.now()}-${i}.jpg`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", videoFile, "-frames:v", "1", "-q:v", "3", f]);
    out.push(f);
  }
  return out;
}
export async function publishAdToStore({ v, rootDir, ad, outDir, baseUrl }) {
  const admin = storeAdmin(rootDir);
  if (admin.error) return { error: admin.error };
  try {
    let media_url = ad.media_url, poster_url = ad.poster_url;
    if (!media_url) {
      const bytes0 = Buffer.from(await v.files.downloadBytes(ad.naive_file_id));
      if (ad.kind === "image") {
        let bytes = bytes0, type = "image/png";
        if (bytes.length > 4_300_000) { bytes = await sharp(bytes).jpeg({ quality: 86 }).toBuffer(); type = "image/jpeg"; }
        media_url = (await admin.call("POST", `/api/admin/upload?name=${encodeURIComponent(ad.id)}`, { body: bytes, type })).url;
      } else {
        const src = path.join(os.tmpdir(), `${ad.naive_file_id}.mp4`); fs.writeFileSync(src, bytes0);
        const mp4 = path.join(outDir, `${ad.id}.mp4`);   // H.264, <=1080 px on the long side, no audio; served at /files for URL ingest if large
        await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", "scale='if(gt(iw,ih),min(1080,iw),-2)':'if(gt(iw,ih),-2,min(1080,ih))',format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart", "-an", mp4]);
        const size = fs.statSync(mp4).size;
        media_url = size <= 4_300_000 ? (await admin.call("POST", `/api/admin/upload?name=${encodeURIComponent(ad.id)}`, { body: fs.readFileSync(mp4), type: "video/mp4" })).url
          : (await admin.call("POST", "/api/admin/ingest", { json: { url: `${baseUrl}/files/${path.basename(mp4)}`, name: ad.id } })).url;
        const poster = (await videoFrames(mp4, 1))[0];
        poster_url = (await admin.call("POST", `/api/admin/upload?name=${encodeURIComponent(ad.id + "-poster")}`, { body: fs.readFileSync(poster), type: "image/jpeg" })).url;
      }
      mutateAds(rootDir, (x) => { Object.assign(x.ads[ad.id], { media_url, poster_url }); });
    }
    const item = { id: ad.id, kind: ad.kind, media_url, ...(poster_url ? { poster_url } : {}), concept: ad.concept, caption: ad.caption, event: ad.event, sources: ad.sources,
      featured_products: ad.featured_products, created_at: ad.created_at, test: !!ad.test };
    let campaign = { ok: false };
    for (let i = 0; i < 3; i++) {
      try { await admin.call("PATCH", "/api/admin/content", { json: { op: "upsert", collection: "campaigns", item } }); campaign = { ok: true, at: new Date().toISOString() }; break; }
      catch (e) { campaign = { ok: false, error: e.message }; if (e.status !== 409) break; await sleep(800); }
    }
    mutateAds(rootDir, (x) => { x.ads[ad.id].campaign = campaign; });
    return { media_url, poster_url, campaign };
  } catch (e) {
    mutateAds(rootDir, (x) => { x.ads[ad.id].campaign = { ok: false, error: e.message }; });
    return { error: e.message };
  }
}
