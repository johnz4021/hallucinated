// Phase 4: the CEO plans, Creative makes ads, a vision reviewer passes them, code publishes, Growth posts them.
//   get_plan            (Product, Creative, Growth, CEO) the CEO's latest plan
//   set_plan            (CEO) writes a new plan version; retire_suggestions are flagged to John by code (never unpublished)
//   store_stats         (CEO) orders and pre-orders per product, last 7 days (Stripe, current mode)
//   x_stats             (CEO) public metrics of our last ~30 X posts, with the pillar each one was
//   store_catalog       (CEO, Creative) sellable products with images, prints and URLs
//   next_ad_format      (Creative) code picks each ad's format + style, its KIND (video <-> image, within the caps) and,
//                       while an agent design has no ad yet, the product it must feature
//   ad_video_start      (Creative) image-to-video job (Kling / Veo) of a TEXT-FREE visual gag (no-text rule appended here)
//   ad_video_compose    (Creative) burns the headline into the clip (ffmpeg drawtext band) + end card (wordmark, product, URL)
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
import { checkSpend, videoPaused, imageVariants, maxAttempts, CUT_AT } from "../agents/spend_guard.mjs";
import { findBanned } from "../designs/guard.mjs";
import { storeAdmin } from "../designs/publish.mjs";
import { campaignItem } from "./x_urls.mjs";
import { ptDay } from "../designs/ledger.mjs";
import { xKeys, xMe, xUserTweets } from "../x/xapi.mjs";
import { storeCatalog, STORE_HOSTS } from "./catalog.mjs";
import { STYLES, STYLE_IDS, AD_FORMATS, AD_FORMAT_IDS, AD_PHOTO_STYLES, AD_PHOTO_STYLE_IDS, pickStyle } from "../designs/styles.mjs";
import { testMode, latestPlan, savePlan, loadAds, mutateAds, adsToday, videosStartedToday, newId, MAX_IMAGE_ADS_PER_DAY, MAX_VIDEO_ADS_PER_DAY, lastKind, setLastKind, pickKind, unadvertised, pickFeature } from "./ledger.mjs";
import { composeVideo, headlineCheck, VIDEO_NO_TEXT, STORE_HOST } from "./video_compose.mjs";
import { adRefFiles, adImagePrompt, generateAdImage, SCENE_NO_TEXT } from "./ad_image.mjs";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const VIDEO_MODELS = ["kwaivgi/kling-v3.0-pro", "google/veo-3.1-fast"];
export const REVIEWER = () => process.env.REVIEWER_AGENT || "hallucinated-reviewer";
const HASHTAG_OK = /^#hallucinated$/i;
export const badHashtags = (t) => (String(t).match(/#[\p{L}\p{N}_]+/gu) || []).filter((h) => !HASHTAG_OK.test(h));
const SOURCE = z.object({ label: z.string().min(2).max(400), url: z.string().url() });

// The reviewer's instructions: the hard lines from brand.json plus asset checks. Fictional AI people are fine.
export function reviewBrief({ kind, files, refs, concept, caption, featured, text_in_image, composite = false }) {
  const videoNote = composite ? `
This is the FINAL video. The first two frames show the animated clip with our headline burned into a solid band; the last frame is our end card: the Hallucinated wordmark${featured ? ", the featured product's mockup" : ""} and the URL ${STORE_HOST}. The headline must read exactly as given below. Apart from the headline band and the end card there must be NO text anywhere (no garbled letters, signs, captions or logos in the clip itself): any such text fails text_legible.` : "";
  return `Review this ${kind === "video" ? "VIDEO ad (you get 3 frames: start, middle, end)" : "IMAGE ad"} for Hallucinated before it goes public. Use view_image on every file below, including the references.${videoNote}
Ad: ${files.join(", ")}
References: ${refs.map((r) => `${r.label}: ${r.file_id}`).join("; ") || "none"}
Concept: ${concept}
Caption that runs with it: ${caption}
Text that should appear in the image, exactly: ${text_in_image ? JSON.stringify(text_in_image) : "(none given: judge the text you see on its own)"}
Featured product: ${featured ? `${featured.name} (${featured.slug})` : "none (pure brand comedy)"}

Every ad must be a PHOTOREALISTIC photo of a real-looking (fictional) person WEARING the featured garment, the garment the clear centre of the image.
Check, and be strict:
0a. photorealistic: true only if it looks like a real photograph (not an illustration, poster, collage, 3D render or cartoon).
0b. garment_worn_centre: true only if a person is wearing the featured garment and it is the clear centre / focal point of the frame.
0c. print_matches: true only if the garment shows the referenced design (compare with the print file and the mockup): same artwork, same words spelled exactly, legible; a wrong, invented or garbled print is false. null only if no featured product was given.
0e. no_third_party_branding: true only if NO recognizable mark of another brand appears anywhere, even partial or blurred: coffee cups (e.g. a green-ring siren cup), laptop or phone logos, car badges, signage, bags, shoes. Any recognizable mark = false.
0d. no_extra_text: true only if there is no text in the image other than the garment's print${kind === "video" ? " and, in a composed video, our headline band and end card" : ""} (no captions, signs, overlays, other logos).
1. product_accurate: if our shirt, logo or print is shown, it matches the references (the word "Hallucinated" spelled right, the print's text exact). null if no product is shown.
2. text_legible: every piece of text in the image is spelled correctly and readable (no garbled AI letters), and matches the intended text exactly: no duplicated, missing, extra or reworded lines. null if there is no text.
3. real_person: true if anyone looks like a real, identifiable person (a celebrity, founder, politician or look-alike). AI-generated fictional people are fine: answer false for them.
4. real_names: true if a real person's name appears in the image.
5. other_logos: true if any other brand's logo or trademark appears in the image (Apple, Google, Waymo, Tesla, OpenAI, ...).
6. slurs_or_protected_group: true if it contains a slur or makes a protected group (race, religion, gender, sexuality, disability, age, nationality) the butt of the joke.
7. tragedy: true if it mocks a real tragedy, disaster, death or its victims.
8. quality: would a sharp tech-Twitter streetwear account post this (composition, no AI artifacts like warped hands or melted fabric)?
Comedy can be edgy and dark; that's allowed. Only the hard lines above and accuracy decide.
End with exactly one line: RESULT: {"pass":true|false,"photorealistic":true|false,"garment_worn_centre":true|false,"no_third_party_branding":true|false,"print_matches":true|false|null,"no_extra_text":true|false,"product_accurate":true|false|null,"text_legible":true|false|null,"real_person":true|false,"real_names":true|false,"other_logos":true|false,"slurs_or_protected_group":true|false,"tragedy":true|false,"quality":"good|ok|bad","reasons":"<one or two sentences>"}`;
}
// Code decides: the reviewer's pass AND no hard-line flag AND accuracy not false AND quality not bad.
// ADS_REVIEW_STRICT=0 (default, John Sat 18:40: "just loosen the gate, we just need to put stuff out there"): only the hard
// lines, third-party branding, a person wearing the garment as the centre, and photorealism block. Print accuracy and stray
// text are logged as warnings and kept in the verdict. ADS_REVIEW_STRICT=1: every check blocks, as before.
export const reviewStrict = () => process.env.ADS_REVIEW_STRICT === "1";
const BLOCKING_LOOSE = ["photorealistic", "garment_worn_centre", "no_third_party_branding"];
const ALL_CHECKS = ["product_accurate", "text_legible", "photorealistic", "garment_worn_centre", "print_matches", "no_extra_text", "no_third_party_branding"];
export function verdict(r, { strict = reviewStrict() } = {}) {
  if (!r || typeof r !== "object") return { pass: false, reasons: "no parsable verdict" };
  const lines = ["real_person", "real_names", "other_logos", "slurs_or_protected_group", "tragedy"].filter((k) => r[k] === true);
  const acc = ALL_CHECKS.filter((k) => r[k] === false);
  if (strict) {
    const pass = r.pass === true && !lines.length && !acc.length && r.quality !== "bad";
    return { pass, hard_lines: lines, failed_checks: acc, warnings: [], quality: r.quality || null, reasons: r.reasons || "", gate: "strict" };
  }
  const blocking = acc.filter((k) => BLOCKING_LOOSE.includes(k)), warnings = acc.filter((k) => !BLOCKING_LOOSE.includes(k));
  const pass = !lines.length && !blocking.length;
  return { pass, hard_lines: lines, failed_checks: blocking, warnings, quality: r.quality || null, reasons: r.reasons || "", gate: "loose" };
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

  // The print file of a product: agent designs have a Blob print_url; drop-1 style products have a design_id whose file is
  // served at <baseUrl>/files/<id>.png (the tunnel), so the image model and the reviewer always get the real print.
  const printUrlOf = (p) => p?.print_url || (p?.design_id && ctx.baseUrl && /^https:/.test(ctx.baseUrl) && fs.existsSync(path.join(ctx.outDir, `${p.design_id}.png`)) ? `${ctx.baseUrl}/files/${p.design_id}.png` : null);

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
    title: "This ad's kind, scenario, photo style and featured product (decided in code)",
    description: "Decides, in code, your next ad: its KIND (video or image, alternating within the daily caps), a photoreal on-body SCENARIO (3am beanbag, whiteboard of boxes, foggy Caltrain, demo-day stage, robotaxi back-seat selfie, coffee shop, RTO badge line, Dolores Park, server room, ...), a PHOTO style (editorial, street, flash, phone candid, 35mm film) and the PRODUCT to feature, worn (a new agent design first, else the catalog in rotation), with its print and mockup as reference images. Formerly: (fake billboard, tabloid cover, museum placard, infomercial still, nature-doc still, catalog page, wanted poster, pitch-deck slide, job listing, terminal screenshot, incident report, editorial photo, airline safety card, trading card) and a visual style (photo box, halftone, flash snapshot, tabloid, ransom collage, zine, bootleg collage, woodcut, risograph, patent drawing, manuscript, 90s clip art, Y2K chrome, terminal). Never the same format twice in a row, preferring ones unused in the last 5. Call it once per concept and build the concept for it.",
    inputSchema: {},
  }, async () => {
    // spend guard: once Naïve spend since Sat 13:00 PT is over the cut line, one image and one try per concept, no video
    await checkSpend({ rootDir: ctx.rootDir, vettaKey: ctx.vettaKey, log }).catch(() => null);
    const l = loadAds(ctx.rootDir);
    const hist = (l.formats || []).filter((f) => !!f.test === testMode());
    // the kind is decided here: alternate video <-> image (last_kind), within today's caps
    const videoLeft = videoPaused(ctx.rootDir) ? 0 : Math.min(MAX_VIDEO_ADS_PER_DAY() - adsToday(l, "video").length, MAX_VIDEO_ADS_PER_DAY() - videosStartedToday(l).length);
    const imageLeft = MAX_IMAGE_ADS_PER_DAY() - adsToday(l, "image").length;
    const kind = pickKind({ last: lastKind(l), imageLeft, videoLeft });
    if (!kind) return txt({ done: true, note: `today's ad caps are full (${MAX_IMAGE_ADS_PER_DAY()} images, ${MAX_VIDEO_ADS_PER_DAY()} videos); end the run` });
    // every ad features one of our products, worn: a new agent design without an ad first, else the catalog in rotation
    const pick = pickFeature(await storeCatalog(ctx.rootDir).catch(() => []), l);
    if (!pick) return err("no products in the store catalog to feature");
    const feature = pick.product;
    const format = pickStyle(hist.map((h) => h.format).filter((f) => AD_FORMATS[f]), Math.random, AD_FORMAT_IDS);
    const style = pickStyle(hist.map((h) => h.style).filter((x) => AD_PHOTO_STYLES[x]), Math.random, AD_PHOTO_STYLE_IDS);
    mutateAds(ctx.rootDir, (x) => { setLastKind(x, kind); (x.pending_formats ||= []).push({ format, style, kind, feature: feature?.slug || null, at: new Date().toISOString(), test: testMode() }); x.pending_formats = x.pending_formats.slice(-6); });
    const refs = [printUrlOf(feature), feature.image].filter(Boolean);
    const photo = "A PHOTOREALISTIC photo (" + AD_PHOTO_STYLES[style] + ") of a fictional person WEARING the featured " + (feature.garment || "garment") + ", the garment the clear centre of the frame, its print exactly as in the reference images and legible. Scenario: " + AD_FORMATS[format] + ". " + SCENE_NO_TEXT;
    const how = kind === "video"
      ? "VIDEO: ad_image_generate (featured_slug, scenario, photo_style, prompt) and ad_image_status until it gives a file_id; ad_review it as kind image; only when it PASSES: ad_video_start from it with SUBTLE natural motion (breathing, a glance, steam, light flicker; the garment and its print stay steady and in frame), ad_video_status until done, ad_video_compose with a headline (<= 8 words, the punchline) and featured_slug; ad_review the COMPOSED file_id as kind video; ad_submit."
      : "IMAGE: ad_image_generate (featured_slug, scenario, photo_style, prompt) and ad_image_status until it gives a file_id; the joke is the situation, the words go in the caption. ad_review (kind image, featured_slug), ad_submit.";
    return txt({ kind, scenario: format, what: AD_FORMATS[format], photo_style: style, photo_style_how: AD_PHOTO_STYLES[style], image_prompt_base: photo, recent_scenarios: hist.slice(-5).map((h) => h.format),
      feature: { slug: feature.slug, name: feature.name, garment: feature.garment || null, image: feature.image, print_url: printUrlOf(feature), url: feature.url, price: feature.price || null, why: pick.why,
        rule: "EVERY ad features this product, worn: featured_products [slug]." + (pick.why.startsWith("new") ? " It's a new agent design: say it's new / a pre-order in the caption." : "") },
      reference_images: refs,
      how, variants: imageVariants(ctx.rootDir), max_attempts: maxAttempts(ctx.rootDir), ...(videoPaused(ctx.rootDir) ? { spend_guard: "spend is high: 1 image, 1 try per concept, no video" } : {}),
      note: "Pass format (= scenario) and kind to ad_submit. AI-generated people only, no real faces or likenesses, no other brands' logos." });
  });

  // ---------------- Creative: photoreal ad image (OpenAI edits with the real print + mockups) ----------------
  const imageJobs = new Map();   // job_id -> { state, file_id?, error?, started }
  server.registerTool("ad_image_generate", {
    title: "Make a photoreal ad photo of our product being worn (start)",
    description: "Generates the ad photo server-side with OpenAI image edits, using the featured product's REAL print file and store mockups as input images (much more exact prints than generate_image). Code appends: photoreal, the garment worn and centred, the print exactly as referenced, no readable text anywhere else, unbranded props, out-of-focus background. Takes ~1-2 minutes: poll ad_image_status with the job_id; it returns a fil_ id for ad_review.",
    inputSchema: { featured_slug: z.string().max(80), scenario: z.string().max(60).describe("next_ad_format's scenario"), photo_style: z.string().max(40).describe("next_ad_format's photo_style"),
      prompt: z.string().min(20).max(1200).describe("your specifics: the person (fictional), pose, moment, light, framing") },
  }, async ({ featured_slug, scenario, photo_style, prompt }) => {
    try {
      if (!ctx.openaiKey) return err("OPENAI_API_KEY is not set; use generate_image as the fallback");
      const product = (await storeCatalog(ctx.rootDir)).find((p) => p.slug === featured_slug);
      if (!product) return err(`no product ${featured_slug} in the store catalog`);
      const sc = AD_FORMATS[scenario] || scenario, ps = AD_PHOTO_STYLES[photo_style] || photo_style;
      const hits = findBanned({ prompt }, ["real_people", "trademarks", "tragedy"]);
      if (hits.length) return err(`refused by the hard lines: ${hits.map((h) => `"${h.term}" (${h.list})`).join(", ")}`);
      const printPath = product.design_id ? path.join(ctx.outDir, `${product.design_id}.png`) : null;
      const files = await adRefFiles(ctx.rootDir, product, { printPath });
      if (!files.length) return err(`no reference images for ${featured_slug}`);
      const full = adImagePrompt({ product, scenario: sc, photoStyle: ps, prompt });
      const job_id = newId("aimg");
      const job = { state: "running", started: Date.now(), slug: featured_slug };
      imageJobs.set(job_id, job);
      (async () => {
        try {
          const g = await generateAdImage(ctx.openaiKey, full, files);
          fs.mkdirSync(ctx.outDir, { recursive: true });
          const local = path.join(ctx.outDir, `${job_id}.jpg`); fs.writeFileSync(local, g.jpg);
          const file_id = await uploadToNaive(g.jpg, `${job_id}.jpg`, "image/jpeg");
          mutateAds(ctx.rootDir, (x) => { (x.ad_images ||= {})[file_id] = { file_id, job_id, slug: featured_slug, scenario, photo_style, model: g.model, local, refs: files.map((f) => path.basename(f)), at: new Date().toISOString(), test: testMode() }; });
          Object.assign(job, { state: "done", file_id, model: g.model });
          log(`[ad_image_generate] ${job_id} ${featured_slug} ${scenario} -> ${file_id} (${g.model})`);
        } catch (e) { Object.assign(job, { state: "failed", error: e.message }); log(`[ad_image_generate] ${job_id} failed: ${e.message}`); }
      })();
      return txt({ job_id, state: "running", references: files.map((f) => path.basename(f)), next: "call ad_image_status with this job_id (each call waits up to a minute)" });
    } catch (e) { return err("ad_image_generate failed: " + e.message); }
  });

  server.registerTool("ad_image_status", {
    title: "Is the ad photo ready?",
    description: "Waits up to 60 s for an ad_image_generate job, then returns its fil_ id (send it to ad_review as kind image) or that it's still running / failed.",
    inputSchema: { job_id: z.string().regex(/^aimg_[a-z0-9]+$/) },
  }, async ({ job_id }) => {
    const job = imageJobs.get(job_id);
    if (!job) return err(`no image job ${job_id} (the server may have restarted: start a new one)`);
    for (let i = 0; i < 12 && job.state === "running"; i++) await sleep(5000);
    if (job.state === "done") return txt({ state: "done", file_id: job.file_id, model: job.model, next: "ad_review with this file_id (kind image, featured_slug)" });
    if (job.state === "failed") return err(`image generation failed: ${job.error}. Try again with a simpler scene, or fall back to generate_image.`);
    return txt({ state: "running", seconds: Math.round((Date.now() - job.started) / 1000), note: "still generating; call again" });
  });

  server.registerTool("ad_video_start", {
    title: "Start a video ad from a text-free image",
    description: "Image-to-video: animates one of your generated images (its fil_ id; make it a TEXT-FREE visual gag) into a 5-8 s clip with Kling v3 Pro (default) or Veo 3.1 Fast. A no-text rule is appended to your prompt (video models garble letters): the headline is added afterwards by ad_video_compose. Daily video cap enforced here. Takes a few minutes: poll ad_video_status with the job_id.",
    inputSchema: { image_file_id: z.string().regex(/^fil_[a-z0-9]+$/), prompt: z.string().min(10).max(1500), model: z.enum(VIDEO_MODELS).optional(),
      aspect_ratio: z.enum(["9:16", "4:5", "1:1", "16:9"]).optional(), seconds: z.number().int().min(4).max(10).optional() },
  }, async ({ image_file_id, prompt, model = VIDEO_MODELS[0], aspect_ratio = "9:16", seconds = 5 }) => {
    try {
      const l = loadAds(ctx.rootDir);
      if (!Object.values(l.reviews).some((r) => r.file_id === image_file_id && r.kind === "image" && r.pass && !!r.test === testMode()))
        return err("refused: animate only an image that PASSED ad_review (kind image); review it first");
      await checkSpend({ rootDir: ctx.rootDir, vettaKey: ctx.vettaKey, log }).catch(() => null);
      if (videoPaused(ctx.rootDir)) return err(`refused: the spend guard paused video ads (Naïve spend since Sat 13:00 PT is over $${CUT_AT()}); make image ads`);
      const today = videosStartedToday(l);
      if (today.length >= MAX_VIDEO_ADS_PER_DAY()) return err(`refused: already ${today.length} video today (limit ${MAX_VIDEO_ADS_PER_DAY()}); make image ads instead`);
      const full = `${prompt.trim()} ${VIDEO_NO_TEXT}`;   // the headline is burned in afterwards by ad_video_compose
      const job = await v.media.videos.generate({ model, prompt: full, image_urls: [image_file_id], aspect_ratio, seconds });
      mutateAds(ctx.rootDir, (x) => { x.videos[job.id] = { job_id: job.id, model, prompt: full, image_file_id, aspect_ratio, seconds, started_at: new Date().toISOString(), cost_micro_usd: job.cost_micro_usd ?? null, test: testMode() }; });
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
          return txt({ state: "done", file_id: f.id, duration_seconds: f.duration_seconds ?? null, width: f.width, height: f.height, next: "ad_video_compose with this file_id and a short headline" });
        }
        await sleep(10_000);
      }
      return txt({ state: "running", note: "not done yet; call again" });
    } catch (e) { return err("ad_video_status failed: " + e.message); }
  });

  // ---------------- Creative: compose (headline band + end card) ----------------
  server.registerTool("ad_video_compose", {
    title: "Burn the headline into a video ad and add the end card",
    description: "Takes a finished clip from ad_video_status (its fil_ id) and makes the final ad: your headline (1-8 words, plain ASCII, no links or hashtags) set in our type on a forest band at the top or bottom, then a 1.3 s end card with the Hallucinated wordmark, the featured product's mockup (if featured_slug) and hallucinated-store.vercel.app. H.264 MP4 within X's limits. Returns the NEW file_id: send THAT to ad_review (kind video, text_in_image = the headline) and ad_submit.",
    inputSchema: { video_file_id: z.string().regex(/^fil_[a-z0-9]+$/), headline: z.string().min(1).max(60), position: z.enum(["top", "bottom"]).optional(),
      featured_slug: z.string().max(80).optional().describe("the product to show on the end card (use the feature next_ad_format gave you)") },
  }, async ({ video_file_id, headline, position = "bottom", featured_slug }) => {
    try {
      const l = loadAds(ctx.rootDir);
      if (!Object.values(l.videos).some((x) => x.file_id === video_file_id && !!x.test === testMode())) return err("refused: compose only a clip from ad_video_start / ad_video_status");
      const bad = headlineCheck(headline) || badHashtags(headline).join(" ") || null;
      if (bad) return err(`refused: ${bad}`);
      const hits = findBanned({ headline }, ["real_people", "trademarks", "tragedy"]);
      if (hits.length) return err(`refused by the hard lines: ${hits.map((h) => `"${h.term}" (${h.list})`).join(", ")}`);
      let productImage = null;
      if (featured_slug) {
        const prod = (await storeCatalog(ctx.rootDir)).find((p) => p.slug === featured_slug);
        if (!prod) return err(`no product ${featured_slug} in the store catalog`);
        if (prod.image) { const b = await urlBytes(prod.image); productImage = path.join(os.tmpdir(), `prod-${featured_slug}.${b.type.includes("jpeg") ? "jpg" : "png"}`); fs.writeFileSync(productImage, b.bytes); }
      }
      const src = await naiveToFile(video_file_id, "mp4");
      fs.mkdirSync(ctx.outDir, { recursive: true });
      const base = `adv-${video_file_id}-${Date.now().toString(36)}`;
      const r = await composeVideo({ input: src, out: path.join(ctx.outDir, `${base}.mp4`), poster: path.join(ctx.outDir, `${base}.jpg`), headline: headline.trim(), position, productImage });
      const file_id = await uploadToNaive(fs.readFileSync(r.out), `${base}.mp4`, "video/mp4");
      mutateAds(ctx.rootDir, (x) => { (x.composites ||= {})[file_id] = { file_id, source_video: video_file_id, headline: headline.trim(), position, featured_slug: featured_slug || null,
        local: r.out, poster: r.poster, width: r.width, height: r.height, duration: r.duration, bytes: r.bytes, at: new Date().toISOString(), test: testMode() }; });
      log(`[ad_video_compose] ${video_file_id} -> ${file_id} "${headline.trim()}" (${r.width}x${r.height}, ${r.duration.toFixed(1)} s, ${Math.round(r.bytes / 1024)} KB)`);
      return txt({ file_id, headline: headline.trim(), lines: r.lines, duration_seconds: Number(r.duration.toFixed(2)), width: r.width, height: r.height,
        next: "ad_review with THIS file_id, kind video, text_in_image = the headline" });
    } catch (e) { return err("ad_video_compose failed: " + e.message); }
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
      const comp = loadAds(ctx.rootDir).composites?.[file_id] || null;
      if (kind === "video" && !comp) return err("refused: review the COMPOSED video (ad_video_compose's file_id), not the raw clip");
      if (comp) text_in_image = comp.headline;
      if (kind === "image" && text_in_image && text_in_image.trim().split(/\s+/).length > 14) return err("refused: keep the text in the image short (8 words or fewer); put the longer joke in the caption");
      const reviewer = ((await v.agents.list({ limit: 100 })).data || []).find((a) => a.name === REVIEWER());
      if (!reviewer) return err(`no ${REVIEWER()} agent; run setup_agents.mjs`);
      let files = [file_id];
      if (kind === "video") {
        const local = comp?.local && fs.existsSync(comp.local) ? comp.local : await naiveToFile(file_id, "mp4");
        files = [];
        for (const fr of await frames(local)) files.push(await uploadToNaive(fs.readFileSync(fr), path.basename(fr), "image/jpeg"));
      }
      const refs = [{ label: "Hallucinated logo (exact wordmark)", file_id: await refFile("logo", () => ({ bytes: fs.readFileSync(path.join(ctx.mcpDir, "refs", "logo.png")), name: "logo.png", type: "image/png" })) }];
      if (!featured_slug) return err("refused: every ad features one of our products, worn; pass featured_slug (from next_ad_format)");
      const featured = (await storeCatalog(ctx.rootDir)).find((p) => p.slug === featured_slug);
      if (!featured) return err(`no product ${featured_slug} in the store catalog`);
      const printLocal = featured.design_id && fs.existsSync(path.join(ctx.outDir, `${featured.design_id}.png`)) ? path.join(ctx.outDir, `${featured.design_id}.png`) : null;
      if (featured.print_url || printLocal) refs.push({ label: `${featured.name}: the PRINT file (the design that must be on the garment)`, file_id: await refFile(`print:${featured.print_url || featured.design_id}`, async () => {
        if (featured.print_url) { const b = await urlBytes(featured.print_url); return { bytes: b.bytes, name: `${featured.slug}-print.png`, type: b.type }; }
        return { bytes: await sharp(printLocal).resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).png().toBuffer(), name: `${featured.slug}-print.png`, type: "image/png" };
      }) });
      if (featured?.image) refs.push({ label: `${featured.name} product mockup`, file_id: await refFile(`img:${featured.image}`, async () => { const b = await urlBytes(featured.image); return { bytes: b.bytes, name: `${featured.slug}.png`, type: b.type }; }) });
      const s = await v.sessions.create({ agent_id: reviewer.id, budget_micro_usd: 500_000, message: reviewBrief({ kind, files, refs, concept, caption, featured, text_in_image, composite: !!comp }) });
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
          log(`[ad_review] ${review_id} ${vd.pass ? "PASS" : "FAIL"} (${vd.gate} gate)${vd.warnings?.length ? ` warnings: ${vd.warnings.join(", ")}` : ""}: ${vd.reasons.slice(0, 200)}`);
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
    description: "For an asset that PASSED ad_review: uploads it to our store's media, adds it to the store's Campaigns wall and home hero, and queues it for Growth to post on X. The kind must be the one next_ad_format picked; a video must be the composed file; while a new agent design has no ad, the ad must feature it. Daily caps per kind. event=true only when the ad reacts to a specific current SF/tech event; then give its real sources. Captions: no hashtags except #hallucinated, no real people's names.",
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
      if (a.kind === "video" && !l.composites?.[a.file_id]) return err("refused: a video ad must be the composed file from ad_video_compose");
      const issuedFmt = (l.pending_formats || []).find((f) => f.format === a.format && !!f.test === testMode());
      if (issuedFmt?.kind && issuedFmt.kind !== a.kind) return err(`refused: next_ad_format picked ${issuedFmt.kind} for this format, not ${a.kind}`);
      if (!(a.featured_products || []).length) return err("refused: every ad features one of our products (featured_products)");
      if (issuedFmt?.feature && !(a.featured_products || []).includes(issuedFmt.feature)) return err(`refused: next_ad_format picked ${issuedFmt.feature} to feature in this ad`);
      const owed = unadvertised(await storeCatalog(ctx.rootDir).catch(() => []), l).map((p) => p.slug);
      if (owed.length && !(a.featured_products || []).some((s) => owed.includes(s))) return err(`refused: new design(s) ${owed.join(", ")} have no ad yet; this ad must feature one (featured_products)`);
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
        review_id: a.review_id, format: a.format || null, campaign: { ok: false, pending: true }, created_at: new Date().toISOString(), test: testMode(),
        ...(a.kind === "video" ? { headline: l.composites[a.file_id].headline, source_video: l.composites[a.file_id].source_video } : {}) };
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
    const item = campaignItem({ ...ad, media_url, poster_url, x_url: undefined });   // x_url is added separately (x_urls.mjs), so this never 400s on it
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
