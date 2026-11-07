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

const txt = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 2) }] });
const err = (m) => ({ isError: true, content: [{ type: "text", text: m }] });

// media: a Naïve file id (fil_…), one of our design ids, or a file name in our designs folder
async function resolveMedia(ctx, media) {
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
const MAX_POSTS_DAY = () => Number(process.env.X_MAX_POSTS_PER_DAY || 6);
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
      ctx.log?.(`[${kind} DRY RUN] would post${reply_to ? " reply to " + reply_to : ""}${quote ? " quoting " + quote : ""}${media ? " with media " + media : ""}: ${JSON.stringify(text)}`);
      return { id, url: `https://x.com/i/status/${id}`, text, dry_run: true };
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
    description: "Publishes an ORIGINAL post on the brand's X account (public and immediate). Optional media: a Naïve file id (fil_…) or a design id (posts its black-tee preview). reply_to / quote only for threading under or quoting OUR OWN posts; replies to other people go through x_reply (people who engaged with us) or x_post_scout (everyone else, needs John's OK). Limits enforced here: at most X_MAX_POSTS_PER_DAY originals a day (default 6), at least X_MIN_GAP_MIN minutes apart (default 45), no exact repeats.",
    inputSchema: { text: z.string().min(1).max(280), media: z.string().optional(), reply_to: z.string().optional(), quote: z.string().optional() },
  }, async ({ text, media, reply_to, quote }) => {
    try {
      const l = loadLedger(ctx);
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
      l.posts.push({ kind: "post", id: r.id, at: new Date().toISOString(), text, thread: !!reply_to });
      saveLedger(ctx, l);
      return txt({ ...r, media: media || null });
    } catch (e) { return err(`x_post failed: ${e.message}`); }
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

  server.registerTool("x_post_scout", {
    title: "Reply to or quote a stranger's post (John approves each one)",
    description: "For conversations found with x_search, from people who did NOT engage with us: posts your drafted reply or quote-post. Every call is held for John's approval in Naïve Studio; the card shows your draft, the target and your reason. One per author, at most X_MAX_SCOUT_PER_DAY (default 10) a day. Draft only replies that add something (a joke that lands, a useful point); never spammy, never just a link.",
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
      const r = await publish({ text, ...(mode === "reply" ? { reply_to: target_id } : { quote: target_id }), kind: "x_post_scout" });
      l.scouted_authors[t.author_id] = { username: t.author, tweet_id: t.id, post_id: r.id, mode, at: new Date().toISOString() };
      l.posts.push({ kind: "scout", id: r.id, at: new Date().toISOString(), text, to: t.author, mode, why });
      saveLedger(ctx, l);
      return txt({ ...r, mode, target: t.url });
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
