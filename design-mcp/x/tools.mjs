// MCP tools that post to X through X's own API (our developer app), for when Naïve's posting is refused
// and for what Naïve can't do (replies, quote-posts). Registered only when the X keys are in .env.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createClient } from "@usenaive-sdk/vetta";
import { xKeys, xMe, xUpload, xTweet, xDelete, prepVideo, xSearch, xMentions, xGetTweet, engagedWithUs } from "./xapi.mjs";
import { readJson, writeJson } from "../lib/state.mjs";
import { adsEnv, AdsToken, adsCall } from "./ads.mjs";
import { stripeClient } from "../stripe/tools.mjs";
import { announceCheck, markAnnounced, newDesigns } from "../designs/tools.mjs";
import { PILLARS, LINK_WINDOW, nextPillar, linkAllowed, hasStoreLink, agentsLogEvents, pickSpotlight } from "../growth/pillars.mjs";
import { loadProposals } from "../designs/ledger.mjs";

const txt = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 2) }] });
const err = (m) => ({ isError: true, content: [{ type: "text", text: m }] });

// Image URLs we accept as media: our store (mockups) and our Vercel Blob store (prints, lookbook). Nothing else.
export const ownImageUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" && (x.host === "hallucinated-store.vercel.app" || /\.public\.blob\.vercel-storage\.com$/.test(x.host)); } catch { return false; } };

// media: a Naïve file id (fil_…), one of our design ids, a file name in our designs folder, or an https image URL on our store/Blob
async function resolveMedia(ctx, media) {
  if (/^https:\/\//.test(media)) {
    if (!ownImageUrl(media)) throw new Error(`media URL must be on hallucinated-store.vercel.app or our Vercel Blob store: ${media}`);
    const r = await fetch(media, { signal: AbortSignal.timeout(30_000) });
    const type = (r.headers.get("content-type") || "").split(";")[0];
    if (!r.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error(`media URL gave ${r.status} ${type || "no content-type"}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const f = path.join(os.tmpdir(), `xmedia-${Date.now()}.${type.split("/")[1].replace("jpeg", "jpg")}`);
    fs.writeFileSync(f, bytes);
    return f;
  }
  if (/^fil_/.test(media)) {
    const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: ctx.vettaKey });
    const bytes = Buffer.from(await v.files.downloadBytes(media));
    const ext = bytes.subarray(4, 8).toString() === "ftyp" ? ".mp4" : bytes.subarray(1, 4).toString() === "PNG" ? ".png" : bytes.subarray(0, 3).toString() === "GIF" ? ".gif" : ".jpg";
    const f = path.join(os.tmpdir(), `${media}${ext}`);
    fs.writeFileSync(f, bytes);
    return f;
  }
  const id = path.basename(String(media)).replace(/\.(png|jpg|mp4)$/i, "");
  for (const c of [path.join(ctx.outDir, `${id}-preview.png`), path.join(ctx.outDir, path.basename(String(media)))]) if (fs.existsSync(c)) return c;
  throw new Error(`media not found: ${media} (use a Naïve file id fil_… or a design id)`);
}

// Ad writes that would spend money; only x_ads_activate (a human approves it in Naïve) may do these.
const SPENDS = /^activate_|^resume_/;
const goesLive = (args) => /"(entity_status|status)"\s*:\s*"ACTIVE"/i.test(JSON.stringify(args || {}));

function registerAdsTools(server, ctx, env) {
  const creds = adsEnv(env);
  if (!creds.clientId || !fs.existsSync(path.join(ctx.rootDir, ".x-ads-token.json"))) { ctx.log?.("X Ads tools off: run x_ads_login.command once"); return; }
  const token = new AdsToken(ctx.rootDir, creds);
  const unwrap = (r) => (r?.content || []).map((c) => c.text ?? JSON.stringify(c)).join("\n").slice(0, 60_000);

  server.registerTool("x_ads_tools", {
    title: "List X Ads tools",
    description: "Lists the tools of X's Ads MCP (accounts, campaigns, line items, targeting, audiences, creatives, analytics) with their inputs. Call this first to see exact names and arguments.",
    inputSchema: { filter: z.string().optional().describe("substring to filter tool names, e.g. 'campaign' or 'targeting'") },
  }, async ({ filter }) => {
    try {
      const r = await adsCall(token, "__list__");
      const tools = r.tools.filter((t) => !filter || t.name.includes(filter)).map((t) => ({ name: t.name, description: (t.description || "").slice(0, 300), input: t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : [] }));
      return txt({ count: tools.length, tools });
    } catch (e) { return err(`x_ads_tools failed: ${e.message}`); }
  });

  server.registerTool("x_ads", {
    title: "Use X Ads (no spending)",
    description: "Calls one X Ads MCP tool by name with its arguments: research targeting and audience sizes, create PAUSED campaigns and line items (budget, schedule and bid live on the line item), create ad posts, promote posts, read analytics. Anything that would start spending (activate_*, setting status ACTIVE) is refused here; use x_ads_activate for that.",
    inputSchema: { tool: z.string(), args: z.record(z.any()).optional() },
  }, async ({ tool, args }) => {
    if (SPENDS.test(tool) || goesLive(args)) return err("refused: this would start spending. Use x_ads_activate, which needs a human's OK.");
    try { const r = await adsCall(token, tool, args); ctx.log?.(`[x_ads] ${tool} ${JSON.stringify(args || {}).slice(0, 200)}`); return { isError: !!r.isError, content: [{ type: "text", text: unwrap(r) }] }; }
    catch (e) { return err(`x_ads ${tool} failed: ${e.message}`); }
  });

  server.registerTool("x_ads_activate", {
    title: "Start an X ad spending (needs human OK)",
    description: "Activates a PAUSED campaign or line item so it starts spending. Always held for a human's approval in Naïve. Say the daily budget, total budget and end date in `summary` so the approver sees what they're agreeing to.",
    inputSchema: { kind: z.enum(["campaign", "line_item"]), args: z.record(z.any()).describe("exactly what activate_campaign / activate_line_item takes (account id + entity id)"), summary: z.string() },
  }, async ({ kind, args, summary }) => {
    try { const r = await adsCall(token, kind === "campaign" ? "activate_campaign" : "activate_line_item", args); ctx.log?.(`[x_ads_activate] ${kind} ${JSON.stringify(args)} :: ${summary}`); return { isError: !!r.isError, content: [{ type: "text", text: unwrap(r) }] }; }
    catch (e) { return err(`x_ads_activate failed: ${e.message}`); }
  });
}

// ---- posting guards (in code, not just prompts) -------------------------------------------------------------
// X_DRY_RUN=1: every posting tool logs what it would post and returns a fake id; the ledger goes to x-ledger.dry.json.
const DRY = () => process.env.X_DRY_RUN === "1";
const ledgerFile = (ctx) => path.join(ctx.rootDir, DRY() ? "x-ledger.dry.json" : "x-ledger.json");
const loadLedger = (ctx) => readJson(ledgerFile(ctx), { replied_authors: {}, scouted_authors: {}, posts: [] });
const saveLedger = (ctx, l) => writeJson(ledgerFile(ctx), l);
const since = (l, kind, ms) => l.posts.filter((p) => p.kind === kind && Date.now() - new Date(p.at).getTime() < ms);
const MAX_POSTS_DAY = () => Number(process.env.X_MAX_POSTS_PER_DAY || 12);   // Growth runs every 1.5 h, 08:20-23:20 (11 slots)
const MIN_GAP_MIN = () => Number(process.env.X_MIN_GAP_MIN || 45);
const MAX_REPLIES_DAY = () => Number(process.env.X_MAX_REPLIES_PER_DAY || 40);
const MAX_SCOUT_DAY = () => Number(process.env.X_MAX_SCOUT_PER_DAY || 10);

// The store link, read at call time (the storefront writes store.json; until then there is no link).
export function storeInfo(rootDir) {
  const s = readJson(path.join(rootDir, "store.json"), null);
  const url = s && (s.url || s.store_url);
  if (!url || !/^https:\/\//.test(url)) return { available: false };
  return { available: true, url, mode: s.mode || null, price: s.unit_amount != null ? `$${(s.unit_amount / 100).toFixed(0)}` : s.price || null,
    product: s.product?.name || null, sizes: s.product?.sizes || null, max_quantity: s.max_quantity || null, fulfilment: s.fulfilment || null,
    ...(s.mode === "test" ? { note: "store is in Stripe TEST mode: real cards are not charged yet" } : {}) };
}

export function registerXTools(server, ctx) {
  const env = fs.existsSync(path.join(ctx.rootDir, ".env")) ? fs.readFileSync(path.join(ctx.rootDir, ".env"), "utf8") : "";
  registerAdsTools(server, ctx, env);

  server.registerTool("store_link", {
    title: "The store link for posts",
    description: "Returns the live store URL (and price) from store.json, or available:false if the store isn't up yet. Check it before every post that should carry the link; if it's not available, post without a link or not at all. Never invent a URL.",
    inputSchema: {},
  }, async () => txt(storeInfo(ctx.rootDir)));

  const keys = xKeys(env);
  if (!keys) { ctx.log?.("X tools off: X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET not all in .env"); return; }
  const me = async () => ctx.xMe || (ctx.xMe = (await xMe(keys)).data);   // { id, username }

  async function publish({ text, media, reply_to, quote, kind }) {
    let media_ids;
    if (DRY()) {
      const id = `dry-${Date.now()}`;
      // still fetch the media in a dry run, so a broken image URL shows up in testing (it's just not uploaded)
      let mediaCheck = null;
      if (media) { const f = await resolveMedia(ctx, media); mediaCheck = `${path.basename(f)} ${fs.statSync(f).size} bytes`; }
      ctx.log?.(`[${kind} DRY RUN] would post${reply_to ? " reply to " + reply_to : ""}${quote ? " quoting " + quote : ""}${media ? ` with media ${media} (${mediaCheck})` : ""}: ${JSON.stringify(text)}`);
      return { id, url: `https://x.com/i/status/${id}`, text, dry_run: true, ...(mediaCheck ? { media_checked: mediaCheck } : {}) };
    }
    if (media) {
      let f = await resolveMedia(ctx, media);
      if (/\.mp4$/i.test(f)) f = await prepVideo(f);
      media_ids = [await xUpload(keys, f)];
    }
    const t = await xTweet(keys, { text, media_ids, reply_to, quote });
    const u = (await me().catch(() => ({})))?.username;
    const url = `https://x.com/${u || "i"}/status/${t.id}`;
    ctx.log?.(`[${kind}] ${url} ${JSON.stringify(text).slice(0, 160)}`);
    return { id: t.id, url, text: t.text };
  }

  server.registerTool("x_post", {
    title: "Post to X as @hallucinateddpt (original posts)",
    description: "Publishes an ORIGINAL post on the brand's X account (public and immediate). Optional media: an image URL on our store or Blob (e.g. a product mockup), a Naïve file id (fil_…) or a design id (posts its black-tee preview). pillar: the one growth_next_pillar gave you for this run. reply_to / quote only for threading under or quoting OUR OWN posts; replies to other people go through x_reply (people who engaged with us) or x_post_scout (everyone else, queued for John). Limits enforced here: at most X_MAX_POSTS_PER_DAY originals a day (default 12), at least X_MIN_GAP_MIN minutes apart (default 45), no exact repeats, and the store link in at most 1 of every 3 posts (new-design announcements exempt).",
    inputSchema: { text: z.string().min(1).max(280), media: z.string().optional(), reply_to: z.string().optional(), quote: z.string().optional(),
      pillar: z.enum(PILLARS).optional().describe("this run's content pillar, exactly as growth_next_pillar returned it"),
      announce_slug: z.string().optional().describe("when this post announces a new design from store_new_designs: its slug (each design is announced once; the text must include its product URL)") },
  }, async ({ text, media, reply_to, quote, pillar, announce_slug }) => {
    try {
      let ann = null;
      if (announce_slug) {
        ann = announceCheck(ctx.rootDir, stripeClient(ctx.rootDir).mode, announce_slug, text);
        if (!ann.ok) return err(`refused: ${ann.why}`);
      }
      const l = loadLedger(ctx);
      const g = l.growth || {};
      // the rotation is decided in code: an original post must use the pillar growth_next_pillar issued for this run
      if (!reply_to && g.pending?.pillar && Date.now() - new Date(g.pending.at).getTime() < 3 * 3600_000 && pillar !== g.pending.pillar)
        return err(`refused: this run's pillar is ${g.pending.pillar} (from growth_next_pillar), not ${pillar || "unspecified"}; pass pillar "${g.pending.pillar}"`);
      if (pillar === "new_design" && !announce_slug) return err("refused: a new_design post needs announce_slug (from growth_next_pillar)");
      const link = hasStoreLink(text, storeInfo(ctx.rootDir).url);
      if (!reply_to && link && !linkAllowed(l, pillar)) return err(`refused: the store link is in at most 1 of every ${LINK_WINDOW} posts and one of the last ${LINK_WINDOW - 1} had it; post this without the link`);
      for (const id of [reply_to, quote].filter(Boolean)) {
        if (DRY() && /^dry-/.test(id)) continue;
        const t = await xGetTweet(keys, id);
        if (t.author_id !== (await me()).id) return err(`refused: ${id} is not our post. Reply to people with x_reply (if they engaged with us) or x_post_scout (needs John's OK).`);
      }
      const day = since(l, "post", 86400_000);
      if (!reply_to && day.length >= MAX_POSTS_DAY()) return err(`refused: already ${day.length} original posts in the last 24 h (limit ${MAX_POSTS_DAY()})`);
      const last = day.filter((p) => !p.thread).at(-1);
      if (!reply_to && last && Date.now() - new Date(last.at).getTime() < MIN_GAP_MIN() * 60_000) return err(`refused: last original post was ${Math.round((Date.now() - new Date(last.at).getTime()) / 60_000)} min ago (minimum gap ${MIN_GAP_MIN()} min)`);
      if (l.posts.some((p) => p.text === text)) return err("refused: we already posted exactly this text");
      const r = await publish({ text, media, reply_to, quote, kind: "x_post" });
      const at = new Date().toISOString();
      l.posts.push({ kind: "post", id: r.id, at, text, thread: !!reply_to, has_link: link, ...(pillar ? { pillar } : {}), ...(media ? { media } : {}), ...(announce_slug ? { announces: announce_slug } : {}) });
      if (!reply_to && pillar) {
        l.growth = { ...g, pending: null, last_pillar: pillar, ...(pillar !== "new_design" ? { last_rotation: pillar } : {}),
          ...(pillar === "agents_log" ? { last_agents_log_at: at } : {}),
          ...(pillar === "spotlight" && g.pending?.spotlight_slug ? { spotlight_history: { ...(g.spotlight_history || {}), [g.pending.spotlight_slug]: at } } : {}) };
      }
      saveLedger(ctx, l);
      if (ann) markAnnounced(ctx.rootDir, ann.proposal_id, r.id);
      return txt({ ...r, media: media || null, ...(announce_slug ? { announced: announce_slug } : {}) });
    } catch (e) { return err(`x_post failed: ${e.message}`); }
  });

  // ---- content rotation (growth/pillars.mjs decides; state in this ledger) ----------------------------------------
  const sinceAgentsLog = (g) => g.last_agents_log_at || new Date(Date.now() - 24 * 3600_000).toISOString();
  async function spotlightCatalog() {
    const sc = stripeClient(ctx.rootDir);
    if (sc.error) return [];
    const s = readJson(path.join(ctx.rootDir, "store.json"), {});
    const base = (s.url || "https://hallucinated-store.vercel.app").replace(/\/$/, "");
    const listed = (sc.mode === "live" ? s.products : s.test?.products) || [];
    const designs = Object.values(loadProposals(ctx.rootDir).proposals).filter((p) => p.state === "published" && p.mode === sc.mode).map((p) => ({ slug: p.slug, product_id: p.publish.product_id }));
    const out = [];
    for (const it of [...listed, ...designs]) {
      if (!it.product_id || out.some((o) => o.slug === it.slug)) continue;
      const prod = ctx._prodCache?.[it.product_id] || await sc.call("GET", `/products/${it.product_id}`).catch(() => null);
      (ctx._prodCache ||= {})[it.product_id] = prod;
      if (!prod?.active || !["live", "preorder"].includes(prod.metadata?.status)) continue;
      out.push({ slug: it.slug, name: prod.name, description: prod.description, status: prod.metadata.status === "live" ? "in stock" : "pre-order", url: `${base}/p/${it.slug}`,
        image: (prod.images || []).find(ownImageUrl) || null, by_agents: prod.metadata?.origin === "agents" });
    }
    return out;
  }

  server.registerTool("growth_next_pillar", {
    title: "This run's content pillar (call before the original post)",
    description: "Decides, in code, what this run's ONE original post is about: new_design (an unannounced agent design: always first), else the rotation agents_log -> spotlight -> reply_bait -> joke, skipping pillars with nothing to say. Returns the pillar, the material to use (design, design-loop events, or a product with its image), whether this post may carry the store link (at most 1 in 3; announcements exempt), and recent post texts so you don't repeat yourself. Pass the pillar to x_post.",
    inputSchema: {},
  }, async () => {
    try {
      const sc = stripeClient(ctx.rootDir);
      const l = loadLedger(ctx), g = l.growth || {};
      const fresh = newDesigns(ctx.rootDir, sc.mode);
      const events = agentsLogEvents(loadProposals(ctx.rootDir).proposals, sc.mode, sinceAgentsLog(g));
      const catalog = await spotlightCatalog();
      const pillar = nextPillar({ lastRotation: g.last_rotation, hasNewDesign: fresh.length > 0, agentsLogNew: events.length > 0, spotlightAvailable: catalog.length > 0 });
      const spot = pillar === "spotlight" ? pickSpotlight(catalog, g.spotlight_history, (l.posts || []).filter((p) => p.kind === "post" && !p.thread).slice(-6)) : null;
      const material = pillar === "new_design" ? { design: fresh[0], media: fresh[0].image, announce_slug: fresh[0].slug }
        : pillar === "agents_log" ? { events, note: "Describe only what these events say happened (proposals, the CEO's decisions and reasons, publishes). Never invent a decision or a quote." }
        : pillar === "spotlight" ? { product: spot, media: spot?.image }
        : pillar === "reply_bait" ? { note: "A prompt that invites replies (people who reply get our one automated reply)." }
        : { note: "An original brand-voice joke about SF tech life in general. Never about a specific news item, trend, real person or company." };
      l.growth = { ...g, pending: { pillar, at: new Date().toISOString(), ...(spot ? { spotlight_slug: spot.slug } : {}) } };
      saveLedger(ctx, l);
      const recent = (l.posts || []).filter((p) => p.kind === "post").slice(-8).map((p) => ({ pillar: p.pillar || null, text: p.text }));
      ctx.log?.(`[growth_next_pillar] ${pillar} (last rotation ${g.last_rotation || "none"}, link ${linkAllowed(l, pillar) ? "allowed" : "not allowed"})`);
      return txt({ pillar, link_allowed: linkAllowed(l, pillar), store_url: storeInfo(ctx.rootDir).url || null, material, recent_posts: recent });
    } catch (e) { return err(`growth_next_pillar failed: ${e.message}`); }
  });

  server.registerTool("agents_log", {
    title: "What the agents did in the design loop (read-only)",
    description: "Recent events from the design loop: proposals by the Product agent, the CEO agent's approvals and rejections WITH their reasons, guardrail blocks, and publishes. Default: since the last agents_log post. Describe only what's here; never invent decisions.",
    inputSchema: { since: z.string().optional().describe("ISO time; default = the last agents_log post") },
  }, async ({ since }) => {
    const sc = stripeClient(ctx.rootDir);
    const g = loadLedger(ctx).growth || {};
    const events = agentsLogEvents(loadProposals(ctx.rootDir).proposals, sc.mode, since || sinceAgentsLog(g));
    return txt({ mode: sc.mode, since: since || sinceAgentsLog(g), count: events.length, events });
  });

  server.registerTool("x_mentions", {
    title: "Posts that reply to or mention us (read-only)",
    description: "Lists recent posts that reply to, mention or quote @hallucinateddpt, newest first, each marked engaged (true if it engaged with us) and already_replied (true if we already sent this PERSON our one automated reply). Only engaged posts whose author has no reply yet can get an x_reply.",
    inputSchema: { since_id: z.string().optional(), max: z.number().int().min(5).max(50).optional() },
  }, async ({ since_id, max }) => {
    try {
      const m = await me();
      const l = loadLedger(ctx);
      const posts = (await xMentions(keys, m.id, { since_id, max: max || 20 })).map((t) => ({
        id: t.id, url: t.url, author: t.author, author_id: t.author_id, followers: t.followers, created_at: t.created_at, text: t.text,
        engaged: engagedWithUs(t, m), already_replied: !!l.replied_authors[t.author_id], likes: t.like_count, replies: t.reply_count }));
      ctx.log?.(`[x_mentions] ${posts.length} (${posts.filter((p) => p.engaged && !p.already_replied).length} can get a reply)`);
      return txt({ me: m.username, count: posts.length, posts, newest_id: posts[0]?.id || since_id || null });
    } catch (e) { return err(`x_mentions failed: ${e.message}`); }
  });

  server.registerTool("x_reply", {
    title: "Reply once to someone who engaged with us",
    description: "Posts our ONE automated reply to a person who replied to, mentioned or quoted us. Checked here against X: the target post must engage with @hallucinateddpt, and its author must not have had an automated reply from us before (ever). Public and immediate. Keep it short, warm, in brand voice; no links unless they asked where to buy.",
    inputSchema: { in_reply_to: z.string().describe("id of THEIR post (from x_mentions)"), text: z.string().min(1).max(280) },
  }, async ({ in_reply_to, text }) => {
    try {
      const m = await me();
      const t = await xGetTweet(keys, in_reply_to);
      if (!engagedWithUs(t, m)) return err("refused: that post doesn't reply to, mention or quote us. Automated replies only go to people who engaged with us; draft it for x_post_scout instead.");
      const l = loadLedger(ctx);
      if (l.replied_authors[t.author_id]) return err(`refused: @${t.author} already got our one automated reply (${l.replied_authors[t.author_id].reply_id})`);
      if (since(l, "reply", 86400_000).length >= MAX_REPLIES_DAY()) return err(`refused: daily automated reply limit (${MAX_REPLIES_DAY()}) reached`);
      const r = await publish({ text, reply_to: in_reply_to, kind: "x_reply" });
      l.replied_authors[t.author_id] = { username: t.author, tweet_id: t.id, reply_id: r.id, at: new Date().toISOString() };
      l.posts.push({ kind: "reply", id: r.id, at: new Date().toISOString(), text, to: t.author });
      saveLedger(ctx, l);
      return txt({ ...r, replied_to: t.url });
    } catch (e) { return err(`x_reply failed: ${e.message}`); }
  });

  // X's API refuses replies/quotes to posts that don't mention us (403 "You can only reply to or quote posts where you
  // are mentioned or are the author", seen Sat 14:18). So scouting is a draft queue: nothing is posted by code. Each draft
  // gets an x.com intent link that opens the composer pre-filled; John posts the ones he likes by hand.
  server.registerTool("x_post_scout", {
    title: "Queue a reply/quote draft for a stranger's post (John posts it by hand)",
    description: "For conversations found with x_search, from people who did NOT engage with us: saves your drafted reply or quote to John's scout queue (scout-queue.json) with a one-click link. Nothing is posted: X's API doesn't allow replies to people who didn't mention us, so John posts the ones he likes himself. One per author, at most X_MAX_SCOUT_PER_DAY (default 10) a day. Draft only replies that add something (a joke that lands, a useful point); never spammy, never just a link.",
    inputSchema: {
      target_id: z.string().describe("id of the post to reply to or quote"),
      target_url: z.string().optional(),
      mode: z.enum(["reply", "quote"]),
      text: z.string().min(1).max(280),
      why: z.string().max(300).describe("one line for John: why this conversation, why this reply"),
    },
  }, async ({ target_id, mode, text, why }) => {
    try {
      const m = await me();
      const t = await xGetTweet(keys, target_id);
      if (t.author_id === m.id) return err("refused: that's our own post; use x_post");
      const l = loadLedger(ctx);
      if (l.scouted_authors[t.author_id]) return err(`refused: we already sent @${t.author} a scout ${l.scouted_authors[t.author_id].mode}`);
      if (since(l, "scout", 86400_000).length >= MAX_SCOUT_DAY()) return err(`refused: daily scout limit (${MAX_SCOUT_DAY()}) reached`);
      const at = new Date().toISOString();
      const intent = mode === "reply"
        ? `https://x.com/intent/post?in_reply_to=${encodeURIComponent(t.id)}&text=${encodeURIComponent(text)}`
        : `https://x.com/intent/post?text=${encodeURIComponent(text + " " + (t.url || `https://x.com/i/status/${t.id}`))}`;
      const qFile = path.join(ctx.rootDir, "scout-queue.json");
      const q = fs.existsSync(qFile) ? JSON.parse(fs.readFileSync(qFile, "utf8")) : [];
      q.push({ at, status: "pending", mode, to: t.author, target: t.url, target_text: String(t.text || "").slice(0, 280), draft: text, why, post_it: intent });
      fs.writeFileSync(qFile, JSON.stringify(q, null, 2));
      l.scouted_authors[t.author_id] = { username: t.author, tweet_id: t.id, mode, at, queued: true };
      l.posts.push({ kind: "scout", id: null, at, text, to: t.author, mode, why, queued: true });
      saveLedger(ctx, l);
      ctx.log?.(`[scout] queued ${mode} to @${t.author} (${t.url}): ${JSON.stringify(text)}`);
      return txt({ queued: true, posted: false, mode, target: t.url, note: "Saved to John's scout queue; he posts it by hand if he likes it. Nothing went out." });
    } catch (e) { return err(`x_post_scout failed: ${e.message}`); }
  });

  server.registerTool("x_search", {
    title: "Search recent X posts (read-only)",
    description: "Searches X posts from the last ~7 days with X's query syntax (e.g. '\"AI agents\" -is:retweet lang:en', 'from:someone', 'conversation_id:123'). Returns author, follower count, text, likes/reposts/replies and the post URL. Read-only. Use it to find conversations worth a reply and to read replies to our own posts. X's rules: never auto-reply to people found by keyword search; draft those for x_post_scout (John approves each).",
    inputSchema: { query: z.string(), max: z.number().int().min(10).max(50).optional() },
  }, async ({ query, max }) => {
    try { const posts = await xSearch(keys, query, max || 10); ctx.log?.(`[x_search] ${query} -> ${posts.length}`); return txt({ count: posts.length, posts }); }
    catch (e) { return err(`x_search failed: ${e.message}`); }
  });

  server.registerTool("x_delete", {
    title: "Delete one of our X posts",
    description: "Deletes a post from the brand's X account by id.",
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    if (DRY()) { ctx.log?.(`[x_delete DRY RUN] would delete ${id}`); return txt({ dry_run: true, deleted: id }); }
    try { const r = await xDelete(keys, id); ctx.log?.(`[x_delete] ${id}`); return txt(r.data || r); }
    catch (e) { return err(`x_delete failed: ${e.message}`); }
  });
}
