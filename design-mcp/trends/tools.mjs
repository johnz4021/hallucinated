// trends(query, platforms): what people are saying about a topic right now, as compact text for Product's design briefs.
// Never for Growth posts (X rules: no automatic posts about trending topics).
//   reddit / threads / tiktok -> Naïve socialData (paid per call, ~$0.001-0.002); each tool's price is checked before
//                                every call (refused over $0.01, or if it isn't priced per call) and a daily cap applies
//                                (TRENDS_DAILY_BUDGET_USD, default 0.50; ledger in <root>/trends-spend.json)
//   hn                        -> Hacker News' free Algolia search API
//   x                         -> our own X API keys (x_search); Naïve's X data tools 404
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { createClient } from "@usenaive-sdk/vetta";
import { readJson, writeJson, txt, err } from "../lib/state.mjs";
import { xKeys, xSearch } from "../x/xapi.mjs";

const MAX_CALL_MICRO = 10_000;   // $0.01
const SD = {
  reddit: { platform: "reddit", hint: "search posts", name: "/api/v1/reddit/app/fetch_dynamic_search", args: (q) => ({ query: { query: q, sort: "TOP", time_range: "week", need_format: true } }),
    extract: (d) => (d?.children || []).map((c) => c.post).filter((p) => p?.postTitle).map((p) => ({ text: `r/${p.subreddit?.name || "?"}: ${p.postTitle.replace(/\s+/g, " ").slice(0, 200)}`, score: p.score ?? null, score_kind: "upvotes", comments: p.commentCount ?? null, url: p.permalink ? "https://reddit.com" + p.permalink : null })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8) },
  threads: { platform: "threads", hint: "search posts", name: "/api/v1/threads/web/search_posts", args: (q) => ({ query: { query: q } }) },
  tiktok: { platform: "tiktok", hint: "search videos", name: "/api/v1/tiktok/app/v3/fetch_video_search_result", args: (q) => ({ query: { keyword: q, count: 10, region: "US" } }) },
};
const TEXT_KEYS = ["postTitle", "title", "full_text", "text", "desc", "caption", "content", "selftext", "body"];
const SCORE_KEYS = ["score", "ups", "like_count", "digg_count", "likes", "favorite_count", "upvotes", "num_comments", "comment_count", "reply_count", "play_count"];
const ids = new Map();   // platform -> socialData tool id (module level: the MCP server is rebuilt per request)
const today = () => new Date().toISOString().slice(0, 10);

// Pull post-like objects out of any JSON shape: a text, a popularity number, a link. Deduped, top by score.
export function extractPosts(data, n = 8) {
  const seen = new Set(), out = [];
  const walk = (o, d) => {
    if (!o || typeof o !== "object" || d > 14) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    const tk = TEXT_KEYS.find((k) => typeof o[k] === "string" && o[k].trim().length >= 15);
    if (tk) {
      const t = o[tk].replace(/\s+/g, " ").trim().slice(0, 220);
      if (!seen.has(t)) {
        seen.add(t);
        const sk = SCORE_KEYS.find((k) => typeof o[k] === "number");
        const url = [o.permalink, o.url, o.share_url, o.link].find((u) => typeof u === "string" && /^(https?:|\/r\/)/.test(u));
        out.push({ text: t, score: sk ? o[sk] : null, score_kind: sk || null, url: url ? (url.startsWith("/r/") ? "https://reddit.com" + url : url) : null });
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, d + 1);
  };
  walk(data, 0);
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, n);
}

export function registerTrendsTools(server, ctx) {
  const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: ctx.vettaKey });
  const env = fs.existsSync(path.join(ctx.rootDir, ".env")) ? fs.readFileSync(path.join(ctx.rootDir, ".env"), "utf8") : "";
  const xk = xKeys(env);
  const spendFile = path.join(ctx.rootDir, "trends-spend.json");
  const cap = () => Math.round(Number(process.env.TRENDS_DAILY_BUDGET_USD || 0.5) * 1e6);

  async function runSocial(p, query) {
    const spec = SD[p];
    let id = ids.get(p);
    if (!id) {
      const r = await v.socialData.searchTools({ query: spec.hint, platform: spec.platform, limit: 10 });
      id = (r.data || []).find((t) => t.name === spec.name)?.id;
      if (!id) throw new Error(`${spec.name} not in Naïve's catalog right now`);
      ids.set(p, id);
    }
    const d = await v.socialData.getTool(id);   // free; price is re-read before every paid call
    if (d.price?.basis !== "per_call" || !(d.price.micro_usd <= MAX_CALL_MICRO)) throw new Error(`refused: ${spec.name} costs ${d.price?.text} (limit $0.01 per call)`);
    const led = readJson(spendFile, {});
    const spent = led[today()]?.micro_usd || 0;
    if (spent + d.price.micro_usd > cap()) throw new Error(`refused: daily trends budget used ($${(spent / 1e6).toFixed(3)} of $${(cap() / 1e6).toFixed(2)})`);
    led[today()] = { micro_usd: spent + d.price.micro_usd, calls: (led[today()]?.calls || 0) + 1 };
    writeJson(spendFile, led);   // count it before the call: a timed-out run may still be billed
    const r = await v.socialData.run({ tool_id: id, ...spec.args(query) });
    if (r.status !== "succeeded") throw new Error(`run ${r.status}`);
    const data = r.data ?? r.result ?? r;
    const posts = (spec.extract && spec.extract(data)) || [];
    return { cost_usd: d.price.micro_usd / 1e6, posts: posts.length ? posts : extractPosts(data) };
  }

  async function runHN(query) {
    const since = Math.floor(Date.now() / 1000) - 14 * 86400;
    const r = await fetch(`https://hn.algolia.com/api/v1/search?${new URLSearchParams({ query, tags: "story", numericFilters: `created_at_i>${since}`, hitsPerPage: "15" })}`, { signal: AbortSignal.timeout(20_000) });
    const j = await r.json();
    const posts = (j.hits || []).map((h) => ({ text: h.title, score: h.points, score_kind: "points", comments: h.num_comments, url: `https://news.ycombinator.com/item?id=${h.objectID}` }))
      .sort((a, b) => b.score - a.score).slice(0, 8);
    return { cost_usd: 0, posts };
  }

  async function runX(query) {
    if (!xk) throw new Error("X keys not in .env");
    const posts = (await xSearch(xk, `${query} -is:retweet -is:reply lang:en`, 25))
      .map((p) => ({ text: p.text.replace(/\s+/g, " ").slice(0, 220), score: p.like_count, score_kind: "likes", author: p.author, url: p.url }))
      .sort((a, b) => b.score - a.score).slice(0, 8);
    return { cost_usd: 0, posts };
  }

  server.registerTool("trends", {
    title: "What people are saying about a topic (for design briefs)",
    description: "Searches recent posts about `query` on the chosen platforms and returns the most popular ones as compact text (text, score, link). For Product's design research only. reddit/threads/tiktok cost about $0.001-0.002 per platform per call (daily cap applies); hn and x are free. Default platforms: hn, reddit.",
    inputSchema: {
      query: z.string().min(2).max(120),
      platforms: z.array(z.enum(["reddit", "threads", "tiktok", "hn", "x"])).min(1).max(5).optional(),
    },
  }, async ({ query, platforms = ["hn", "reddit"] }) => {
    const res = {};
    await Promise.all([...new Set(platforms)].map(async (p) => {
      const work = p === "hn" ? runHN(query) : p === "x" ? runX(query) : runSocial(p, query);
      try { res[p] = await Promise.race([work, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 70 s")), 70_000))]); }
      catch (e) { res[p] = { error: e.message }; }
    }));
    const cost = Object.values(res).reduce((a, r) => a + (r.cost_usd || 0), 0);
    ctx.log?.(`[trends] "${query}" ${platforms.join(",")} cost $${cost.toFixed(3)}: ${Object.entries(res).map(([p, r]) => `${p}=${r.error ? "ERR " + r.error : r.posts.length}`).join(" ")}`);
    const lines = [`trends for "${query}" (cost $${cost.toFixed(3)}; today's spend $${((readJson(spendFile, {})[today()]?.micro_usd || 0) / 1e6).toFixed(3)} of $${(cap() / 1e6).toFixed(2)})`];
    for (const p of platforms) {
      const r = res[p];
      lines.push(`\n## ${p}${r?.error ? ": " + r.error : ""}`);
      for (const x of r?.posts || []) lines.push(`- [${x.score ?? "?"}${x.score_kind ? " " + x.score_kind : ""}] ${x.text}${x.url ? " <" + x.url + ">" : ""}`);
      if (r && !r.error && !r.posts.length) lines.push("- (nothing found)");
    }
    return Object.values(res).every((r) => r.error) ? err(lines.join("\n")) : txt(lines.join("\n"));
  });
}
