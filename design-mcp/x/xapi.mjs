// Minimal X API v2 client, OAuth 1.0a user context (posts as the account that generated the access token).
// Keys come from .env: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET. Nothing here logs them.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const API = "https://api.x.com";
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function xKeys(env) {
  const k = (n) => (env.match(new RegExp(`^${n}\\s*=\\s*["']?([^\\s"']+)`, "m")) || [])[1];
  const keys = { ck: k("X_API_KEY"), cs: k("X_API_SECRET"), at: k("X_ACCESS_TOKEN"), as: k("X_ACCESS_SECRET") };
  return keys.ck && keys.cs && keys.at && keys.as ? keys : null;
}

// OAuth 1.0a header. Only query params + oauth params are signed (JSON and multipart bodies are not).
function oauth(keys, method, url) {
  const u = new URL(url);
  const o = { oauth_consumer_key: keys.ck, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: keys.at, oauth_version: "1.0" };
  const params = [...u.searchParams.entries(), ...Object.entries(o)].map(([a, b]) => [enc(a), enc(b)]).sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));
  const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(params.map(([a, b]) => `${a}=${b}`).join("&"))].join("&");
  o.oauth_signature = crypto.createHmac("sha1", `${enc(keys.cs)}&${enc(keys.as)}`).update(base).digest("base64");
  return "OAuth " + Object.entries(o).map(([a, b]) => `${enc(a)}="${enc(b)}"`).join(", ");
}

async function call(keys, method, pathAndQuery, { json, form } = {}) {
  const url = API + pathAndQuery;
  const headers = { Authorization: oauth(keys, method, url) };
  let body;
  if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const r = await fetch(url, { method, headers, body });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) { const e = new Error(`X ${method} ${pathAndQuery.split("?")[0]} ${r.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 400)}`); e.status = r.status; e.data = data; throw e; }
  return data;
}

export const xMe = (keys) => call(keys, "GET", "/2/users/me");
// The token's real permission as X sees it: "read", "read-write" or "read-write-directmessages".
export async function xAccessLevel(keys) {
  const url = API + "/1.1/account/verify_credentials.json?skip_status=true";
  const r = await fetch(url, { headers: { Authorization: oauth(keys, "GET", url) } });
  const me = await fetch(API + "/2/users/me", { headers: { Authorization: oauth(keys, "GET", API + "/2/users/me") } });
  return { v1_status: r.status, v1_access_level: r.headers.get("x-access-level"), v2_access_level: me.headers.get("x-access-level") };
}

// Re-encode a video to X's limits (<=1200 px wide portrait / 1920x1200 landscape, 30 fps, H.264 + AAC 44.1k).
export async function prepVideo(file) {
  const ff = await new Promise((res) => execFile("ffmpeg", ["-version"], (e) => res(e ? null : "ffmpeg")));
  if (!ff) return file;   // no ffmpeg on this machine: upload as-is
  const out = path.join(os.tmpdir(), `x-${crypto.randomBytes(4).toString("hex")}.mp4`);
  const vf = "scale='if(gt(iw,ih),min(1920,iw),min(1080,iw))':-2,fps=30,format=yuv420p";
  await new Promise((res, rej) => execFile("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", out], (e) => (e ? rej(e) : res())));
  return out;
}

// Upload an image or video; returns the media id once X has processed it (or throws).
export async function xUpload(keys, file, { deadlineMs = 70_000 } = {}) {
  const buf = fs.readFileSync(file);
  const isVideo = /\.(mp4|mov)$/i.test(file);
  const type = isVideo ? "video/mp4" : /\.png$/i.test(file) ? "image/png" : /\.gif$/i.test(file) ? "image/gif" : "image/jpeg";
  const category = isVideo ? "tweet_video" : /\.gif$/i.test(file) ? "tweet_gif" : "tweet_image";
  const end = Date.now() + deadlineMs;
  // INIT (v2 dedicated path; fall back to the older command style if this account's tier doesn't have it)
  let id;
  try {
    const r = await call(keys, "POST", "/2/media/upload/initialize", { json: { media_type: type, total_bytes: buf.length, media_category: category } });
    id = r.data?.id || r.data?.media_id || r.id;
    for (let i = 0, seg = 0; i < buf.length; i += 4 * 1024 * 1024, seg++) {
      const f = new FormData(); f.append("segment_index", String(seg)); f.append("media", new Blob([buf.subarray(i, i + 4 * 1024 * 1024)]), "chunk");
      await call(keys, "POST", `/2/media/upload/${id}/append`, { form: f });
    }
    var fin = await call(keys, "POST", `/2/media/upload/${id}/finalize`);
  } catch (e) {
    if (e.status !== 404 && e.status !== 405) throw e;
    const f0 = new FormData(); f0.append("command", "INIT"); f0.append("media_type", type); f0.append("total_bytes", String(buf.length)); f0.append("media_category", category);
    const r = await call(keys, "POST", "/2/media/upload", { form: f0 });
    id = r.data?.id || r.media_id_string || r.data?.media_id;
    for (let i = 0, seg = 0; i < buf.length; i += 4 * 1024 * 1024, seg++) {
      const f = new FormData(); f.append("command", "APPEND"); f.append("media_id", id); f.append("segment_index", String(seg)); f.append("media", new Blob([buf.subarray(i, i + 4 * 1024 * 1024)]), "chunk");
      await call(keys, "POST", "/2/media/upload", { form: f });
    }
    const ff = new FormData(); ff.append("command", "FINALIZE"); ff.append("media_id", id);
    fin = await call(keys, "POST", "/2/media/upload", { form: ff });
  }
  let info = fin?.data?.processing_info || fin?.processing_info;
  while (info && !["succeeded", "failed"].includes(info.state)) {
    if (Date.now() > end) throw new Error(`media ${id} still processing; try again in a minute`);
    await sleep(Math.min((info.check_after_secs || 2) * 1000, 5000));
    const st = await call(keys, "GET", `/2/media/upload?command=STATUS&media_id=${id}`);
    info = st?.data?.processing_info || st?.processing_info;
  }
  if (info?.state === "failed") throw new Error(`X could not process the media: ${JSON.stringify(info.error || info).slice(0, 300)}`);
  return String(id);
}

export async function xTweet(keys, { text, media_ids, reply_to, quote }) {
  const body = { text };
  if (media_ids?.length) body.media = { media_ids };
  if (reply_to) body.reply = { in_reply_to_tweet_id: String(reply_to) };
  if (quote) body.quote_tweet_id = String(quote);
  const r = await call(keys, "POST", "/2/tweets", { json: body });
  return r.data;   // { id, text }
}

export const xDelete = (keys, id) => call(keys, "DELETE", `/2/tweets/${id}`);

// Recent search (last ~7 days) as the account: read-only. Returns posts with like/repost/reply counts and author handles.
export async function xSearch(keys, query, max = 10) {
  const qs = new URLSearchParams({ query, max_results: String(Math.min(Math.max(max, 10), 100)), "tweet.fields": "public_metrics,created_at,author_id,conversation_id", expansions: "author_id", "user.fields": "username,public_metrics" });
  const r = await call(keys, "GET", `/2/tweets/search/recent?${qs}`);
  const users = Object.fromEntries((r.includes?.users || []).map((u) => [u.id, u]));
  return (r.data || []).map((t) => ({ id: t.id, url: `https://x.com/${users[t.author_id]?.username || "i"}/status/${t.id}`, author: users[t.author_id]?.username,
    followers: users[t.author_id]?.public_metrics?.followers_count, text: t.text, created_at: t.created_at, ...t.public_metrics }));
}

const TWEET_FIELDS = "author_id,conversation_id,created_at,in_reply_to_user_id,referenced_tweets,entities,public_metrics,lang";
const mapTweet = (t, users) => ({ id: t.id, author_id: t.author_id, author: users[t.author_id]?.username, followers: users[t.author_id]?.public_metrics?.followers_count, protected: !!users[t.author_id]?.protected, lang: t.lang || null,
  text: t.text, created_at: t.created_at, conversation_id: t.conversation_id, in_reply_to_user_id: t.in_reply_to_user_id || null,
  referenced: (t.referenced_tweets || []).map((r) => ({ type: r.type, id: r.id })), mentions: (t.entities?.mentions || []).map((m) => ({ id: m.id, username: m.username })),
  url: `https://x.com/${users[t.author_id]?.username || "i"}/status/${t.id}`, ...t.public_metrics });

// Posts that mention or reply to the account (replies to our posts start with @us, so they're mentions too). Read-only.
export async function xMentions(keys, userId, { since_id, max = 20 } = {}) {
  const qs = new URLSearchParams({ max_results: String(Math.min(Math.max(max, 5), 100)), "tweet.fields": TWEET_FIELDS,
    expansions: "author_id,referenced_tweets.id.author_id", "user.fields": "username,public_metrics" });
  if (since_id) qs.set("since_id", since_id);
  const r = await call(keys, "GET", `/2/users/${userId}/mentions?${qs}`);
  const users = Object.fromEntries((r.includes?.users || []).map((u) => [u.id, u]));
  const refAuthors = Object.fromEntries((r.includes?.tweets || []).map((t) => [t.id, t.author_id]));
  return (r.data || []).map((t) => ({ ...mapTweet(t, users), referenced: (t.referenced_tweets || []).map((x) => ({ type: x.type, id: x.id, author_id: refAuthors[x.id] || null })) }));
}

// One post by id, with the author of any post it replies to or quotes (to check it engaged with us).
export async function xGetTweet(keys, id) {
  const qs = new URLSearchParams({ "tweet.fields": TWEET_FIELDS, expansions: "author_id,referenced_tweets.id.author_id", "user.fields": "username,public_metrics,protected" });
  const r = await call(keys, "GET", `/2/tweets/${encodeURIComponent(id)}?${qs}`);
  const users = Object.fromEntries((r.includes?.users || []).map((u) => [u.id, u]));
  const refAuthors = Object.fromEntries((r.includes?.tweets || []).map((t) => [t.id, t.author_id]));
  const t = mapTweet(r.data, users);
  t.referenced = (r.data.referenced_tweets || []).map((x) => ({ type: x.type, id: x.id, author_id: refAuthors[x.id] || null }));
  return t;
}

// Did this post engage with us: a reply to us, a mention of us, or a quote of our post (and not our own post)?
export function engagedWithUs(t, me) {
  if (!t || t.author_id === me.id) return false;
  if (t.in_reply_to_user_id === me.id) return true;
  if ((t.mentions || []).some((m) => m.id === me.id || String(m.username).toLowerCase() === String(me.username).toLowerCase())) return true;
  return (t.referenced || []).some((r) => (r.type === "quoted" || r.type === "replied_to") && r.author_id === me.id);
}

// Our own recent posts with their public metrics (for the CEO's x_stats). Read-only.
export async function xUserTweets(keys, userId, max = 30) {
  const qs = new URLSearchParams({ max_results: String(Math.min(Math.max(max, 5), 100)), "tweet.fields": "public_metrics,created_at,organic_metrics", exclude: "retweets" });
  let r;
  try { r = await call(keys, "GET", `/2/users/${userId}/tweets?${qs}`); }
  catch (e) { if (e.status !== 403 && e.status !== 400) throw e; qs.set("tweet.fields", "public_metrics,created_at"); r = await call(keys, "GET", `/2/users/${userId}/tweets?${qs}`); }
  return (r.data || []).map((t) => ({ id: t.id, url: `https://x.com/i/status/${t.id}`, created_at: t.created_at, text: t.text, ...t.public_metrics, ...(t.organic_metrics ? { impressions: t.organic_metrics.impression_count } : {}) }));
}
