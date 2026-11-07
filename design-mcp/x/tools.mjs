// MCP tools that post to X through X's own API (our developer app), for when Naïve's posting is refused
// and for what Naïve can't do (replies, quote-posts). Registered only when the X keys are in .env.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createClient } from "@usenaive-sdk/vetta";
import { xKeys, xMe, xUpload, xTweet, xDelete, prepVideo, xSearch } from "./xapi.mjs";
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

export function registerXTools(server, ctx) {
  const env = fs.existsSync(path.join(ctx.rootDir, ".env")) ? fs.readFileSync(path.join(ctx.rootDir, ".env"), "utf8") : "";
  registerAdsTools(server, ctx, env);
  const keys = xKeys(env);
  if (!keys) { ctx.log?.("X tools off: X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET not all in .env"); return; }

  server.registerTool("x_post", {
    title: "Post to X as @hallucinateddpt",
    description: "Publishes a post on the brand's X account through X's API. Optional media: a Naïve file id (fil_…, image or video) or a design id (posts its black-tee preview). Videos are re-encoded to X's limits automatically. reply_to = a post id to reply to; quote = a post id to quote. Returns the post id and URL. Public and immediate.",
    inputSchema: {
      text: z.string().max(280),
      media: z.string().optional(),
      reply_to: z.string().optional(),
      quote: z.string().optional(),
    },
  }, async ({ text, media, reply_to, quote }) => {
    try {
      let media_ids;
      if (media) {
        let f = await resolveMedia(ctx, media);
        if (/\.mp4$/i.test(f)) f = await prepVideo(f);
        media_ids = [await xUpload(keys, f)];
      }
      const t = await xTweet(keys, { text, media_ids, reply_to, quote });
      const me = ctx.xUser || (ctx.xUser = (await xMe(keys).catch(() => ({}))).data?.username);
      const url = `https://x.com/${me || "i"}/status/${t.id}`;
      ctx.log?.(`[x_post] ${url} ${JSON.stringify(text).slice(0, 120)}`);
      return txt({ id: t.id, url, text: t.text, media: media || null });
    } catch (e) { return err(`x_post failed: ${e.message}`); }
  });

  server.registerTool("x_search", {
    title: "Search recent X posts (read-only)",
    description: "Searches X posts from the last ~7 days with X's query syntax (e.g. '\"AI agents\" -is:retweet lang:en', 'from:someone', 'conversation_id:123'). Returns author, follower count, text, likes/reposts/replies and the post URL. Read-only. Use it to find conversations worth a reply and to read replies to our own posts. X's rules: never auto-reply to people found by keyword search; put those drafts in the approval queue for a human.",
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
    try { const r = await xDelete(keys, id); ctx.log?.(`[x_delete] ${id}`); return txt(r.data || r); }
    catch (e) { return err(`x_delete failed: ${e.message}`); }
  });
}
