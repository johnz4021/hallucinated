// Browser replies on x.com (John's explicit decision, Sat 16:35, recorded in CLAUDE.md hard rules): Growth may reply to
// strangers' posts through a real Chrome with John's own logged-in x.com session. Everything that keeps it safe is here,
// in code:
//   - plain Playwright + real Chrome (channel "chrome") + its own persistent profile <root>/.pw-x-profile/. NO evasion: no
//     stealth plugins, no hidden automation flags, no UA spoofing, no proxies, no captcha solving.
//   - login is by hand only (x_login.command); never automated.
//   - one tab, one call at a time (a mutex); the browser opens per call and closes after, so x_login can use the profile.
//   - any challenge / captcha / "unusual activity" / rate-limit / lock / login wall -> paused for the rest of the Pacific
//     day, flag_john, refuse. Kill switch: pause_browser_replies.command / resume_browser_replies.command.
//   - X_BROWSER_DRY=1 opens the post and fills the reply box but never clicks Post.
// The pure checks (timing, target, text, block detection) are unit-tested in x/browser_test.mjs.
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../lib/state.mjs";
import { findBanned } from "../designs/guard.mjs";

export const PROFILE = (rootDir) => path.join(rootDir, ".pw-x-profile");
const stateFile = (rootDir) => path.join(rootDir, "x-browser.json");
export const loadBrowserState = (rootDir) => readJson(stateFile(rootDir), { paused: false, paused_until: null, reason: null, replies: [] });
export const saveBrowserState = (rootDir, s) => writeJson(stateFile(rootDir), s);

export const LIMITS = () => ({
  minGapMin: Number(process.env.X_BROWSER_MIN_GAP_MIN || 50),
  maxPerDay: Number(process.env.X_BROWSER_MAX_PER_DAY || 13),
  startHour: Number(process.env.X_BROWSER_START_HOUR || 9), endHour: Number(process.env.X_BROWSER_END_HOUR || 22),   // PT, [start, end)
  maxAgeH: 24, maxFollowers: 200_000, maxReplies: 500, maxChars: 240,
});
const PT = "America/Los_Angeles";
export const ptDayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
export const ptHourOf = (d) => Number(new Intl.DateTimeFormat("en-US", { timeZone: PT, hour: "numeric", hourCycle: "h23" }).format(new Date(d)));
// end of the current Pacific day (for "paused for the rest of the day")
export function endOfPtDay(now = new Date()) {
  const day = ptDayOf(now);
  let t = new Date(now.getTime());
  for (let i = 0; i < 30 && ptDayOf(t) === day; i++) t = new Date(t.getTime() + 3600_000);
  while (ptDayOf(new Date(t.getTime() - 60_000)) !== day) t = new Date(t.getTime() - 60_000);
  return t.toISOString();
}

// Pure: is the kill switch / day pause on, are we inside hours, gap and daily cap?
export function scheduleCheck(state, now = new Date(), L = LIMITS()) {
  if (state.paused) return `browser replies are paused (kill switch${state.reason ? ": " + state.reason : ""}); resume_browser_replies.command turns them back on`;
  if (state.paused_until && now < new Date(state.paused_until)) return `browser replies are paused until ${state.paused_until} (${state.reason || "X showed a challenge or warning"})`;
  const h = ptHourOf(now);
  if (h < L.startHour || h >= L.endHour) return `outside reply hours (${L.startHour}:00-${L.endHour}:00 PT)`;
  const posted = (state.replies || []).filter((r) => !r.dry);
  const today = posted.filter((r) => ptDayOf(r.at) === ptDayOf(now));
  if (today.length >= L.maxPerDay) return `already ${today.length} browser replies today (limit ${L.maxPerDay})`;
  const last = posted.at(-1);
  if (last && now - new Date(last.at) < L.minGapMin * 60_000) return `last browser reply was ${Math.round((now - new Date(last.at)) / 60_000)} min ago (minimum ${L.minGapMin} min)`;
  return null;
}

// Pure: is this post a fair target? t = xGetTweet-shaped (created_at, lang, reply_count, author_id, followers, protected, conversation_id)
const ON_TOPIC = /\b(ai|a\.i\.|agents?|agentic|llms?|gpt|model|startup|startups|founder|founders|vc|seed|series [abc]|yc|demo day|sf|san francisco|bay area|silicon valley|tech|engineer|engineers|devs?|coding|vibe cod\w*|deploy\w*|prod|saas|pitch deck|valuation|waymo|robotaxi|layoffs?|rto|standup|hackathon|open ?source)\b/i;
export function targetCheck(t, { me, seenInSearch, ledger }, now = new Date(), L = LIMITS()) {
  if (!t) return "post not found";
  if (!seenInSearch) return "targets must come from your own x_search results (last 24 h)";
  if (t.author_id === me.id) return "that's our own post";
  if (t.protected) return "protected account";
  if (t.lang && t.lang !== "en") return `post is not in English (${t.lang})`;
  if (!t.created_at || now - new Date(t.created_at) > L.maxAgeH * 3600_000) return `post is older than ${L.maxAgeH} h`;
  if ((t.followers || 0) > L.maxFollowers) return `author has ${t.followers} followers (limit ${L.maxFollowers}: viral reply-guy zone)`;
  if ((t.reply_count || 0) > L.maxReplies) return `post already has ${t.reply_count} replies (limit ${L.maxReplies})`;
  if (t.conversation_id && t.conversation_id !== t.id) return "only top-level posts (this one is a reply inside a thread)";
  if (!ON_TOPIC.test(String(t.text || ""))) return "post isn't about SF / AI / startups";
  if (ledger.authors?.[t.author_id]) return `we already replied to @${t.author} once (one reply per person, ever)`;
  if (t.conversation_id && ledger.threads?.[t.conversation_id]) return "we already replied in this thread";
  return null;
}

// Pure: the reply text itself
export function textCheck(text, L = LIMITS()) {
  const s = String(text || "").trim();
  if (!s) return "empty reply";
  if (s.length > L.maxChars) return `reply is ${s.length} chars (limit ${L.maxChars})`;
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ai|io|app|co|xyz|dev|org|net)\b/i.test(s)) return "no links or URLs in browser replies";
  if (/#[\p{L}\p{N}_]+/u.test(s)) return "no hashtags in browser replies";
  if (/@[A-Za-z0-9_]{2,}/.test(s)) return "no @-mentions in browser replies";
  const hits = findBanned({ reply: s }, ["real_people", "trademarks", "tragedy"]);
  if (hits.length) return `hard lines: ${hits.map((h) => `"${h.term}" (${h.list})`).join(", ")}`;
  return null;
}

// Pure: does the page show anything that means "stop for today"? Returns the reason or null.
export function detectBlock({ url = "", text = "", hasCaptchaFrame = false }) {
  if (hasCaptchaFrame) return "captcha / challenge frame";
  if (/\/(login|i\/flow\/login|account\/access|account\/locked)/.test(url)) return `redirected to ${url.replace(/\?.*$/, "")}`;
  const t = text.toLowerCase();
  const pats = [
    [/unusual (login )?activity|suspicious activity/, "X reported unusual activity"],
    [/your account (has been|is) (locked|suspended|temporarily (locked|limited))|account is locked|we've temporarily limited/, "account locked or limited"],
    [/verify (that )?you('re| are) (a )?human|are you a robot|complete (the|this) challenge|arkose|authenticate your account/, "human-verification challenge"],
    [/rate limit|you are over the daily limit|over the limit for sending posts|try again later|too many requests/, "rate limit"],
    [/sign in to x|log in to x|don.t miss what.s happening/, "login wall (not logged in)"],
  ];
  for (const [re, why] of pats) if (re.test(t)) return why;
  return null;
}

// ---- the browser (one at a time) ----
let lock = Promise.resolve();
export function withBrowserLock(fn) { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; }

// Opens the post, replies (or in dry mode only fills the box), verifies, closes. Text-only result. Budget ~75 s.
export async function browserReply({ rootDir, postUrl, text, dry = false, log = () => {} }) {
  const { chromium } = await import("playwright");
  const t0 = Date.now(), left = () => 75_000 - (Date.now() - t0);
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE(rootDir), { channel: "chrome", headless: false, viewport: { width: 1200, height: 900 } });
  } catch (e) {
    if (/already|in use|SingletonLock|ProcessSingleton/i.test(e.message)) return { ok: false, transient: true, reason: "the X profile is open in another Chrome window (close the x_login window)" };
    throw e;
  }
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});   // one tab
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: Math.min(25_000, left()) });
    await page.waitForSelector('article[data-testid="tweet"], [data-testid="loginButton"], iframe[src*="arkose"], iframe[title*="challenge" i]', { timeout: Math.min(20_000, left()) }).catch(() => {});
    // page text WITHOUT the posts' own text, names and our reply box (a dev joking about "rate limits" isn't X blocking us)
    const chrome = () => page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('[data-testid="tweetText"], [data-testid="User-Name"], [data-testid="tweetTextarea_0"], [data-testid="card.wrapper"], script, style, noscript, template').forEach((e) => e.remove()); return c.textContent || ""; }).catch(() => "");
    const check = async () => detectBlock({ url: page.url(), text: await chrome(), hasCaptchaFrame: (await page.locator('iframe[src*="arkose"], iframe[src*="captcha"], iframe[title*="challenge" i]').count()) > 0 });
    let block = await check();
    if (block) return { ok: false, blocked: block };
    const main = page.locator('article[data-testid="tweet"]').first();
    if (!(await main.count())) return { ok: false, reason: "the post didn't load (deleted, or not visible to this account)" };
    await main.locator('[data-testid="reply"]').first().click({ timeout: 10_000 });
    const box = page.locator('[data-testid="tweetTextarea_0"]').first();
    await box.waitFor({ timeout: 10_000 });
    await box.click();
    await page.keyboard.type(text, { delay: 25 });   // plain typing in the real editor
    const typed = (await box.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (typed.replace(/\s+/g, " ") !== text.replace(/\s+/g, " ").trim()) return { ok: false, reason: `the reply box holds different text than intended ("${typed.slice(0, 60)}")` };
    if (dry) {
      log(`[x_browser_reply DRY] filled the reply box on ${postUrl}; not posting`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.locator('[data-testid="confirmationSheetCancel"], [data-testid="app-bar-close"]').first().click({ timeout: 3_000 }).catch(() => {});
      return { ok: true, dry: true, note: "opened the post and filled the reply box; did not post (X_BROWSER_DRY=1)" };
    }
    await page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first().click({ timeout: 10_000 });
    // verify: X shows a "Your post was sent" toast with a View link to the new post
    const toast = page.locator('[data-testid="toast"]');
    await toast.waitFor({ timeout: Math.min(15_000, left()) }).catch(() => {});
    block = await check();
    if (block) return { ok: false, blocked: block };
    const href = await toast.locator('a[href*="/status/"]').first().getAttribute("href").catch(() => null);
    const toastText = await toast.innerText().catch(() => "");
    if (href) return { ok: true, url: new URL(href, "https://x.com").toString() };
    if (/sent|posted/i.test(toastText)) return { ok: true, url: null, note: "X confirmed the post was sent but gave no link" };
    return { ok: false, reason: `couldn't confirm the reply was posted (${toastText.slice(0, 80) || "no confirmation shown"}); check the account before trying again`, unconfirmed: true };
  } finally {
    await ctx.close().catch(() => {});
  }
}
