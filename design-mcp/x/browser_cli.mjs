// The by-hand side of x_browser_reply (launchers in the repo root):
//   node x/browser_cli.mjs login           x_login.command: opens the X profile at x.com/login; John logs in BY HAND
//                                          (password, 2FA), then closes the window. Nothing is typed or clicked for him.
//   node x/browser_cli.mjs pause [reason]  pause_browser_replies.command (kill switch, stays on until resume)
//   node x/browser_cli.mjs resume          resume_browser_replies.command (also clears a "rest of today" pause)
//   node x/browser_cli.mjs status          state, today's replies, next allowed time
//   node x/browser_cli.mjs dry <url> <text>  opens the post and fills the reply box, never posts (the X_BROWSER_DRY test)
// Login uses the same Playwright-launched Chrome as the tool on purpose: a profile logged in from a normal Chrome
// can't be read by it (different keychain), so the session wouldn't carry over.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE, loadBrowserState, saveBrowserState, scheduleCheck, ptDayOf, LIMITS, endOfPtDay, browserReply, textCheck } from "./browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [cmd, ...rest] = process.argv.slice(2);
const st = loadBrowserState(ROOT);

if (cmd === "login") {
  const { chromium } = await import("playwright");
  let ctx;
  try { ctx = await chromium.launchPersistentContext(PROFILE(ROOT), { channel: "chrome", headless: false, viewport: null }); }
  catch (e) { console.error(/already|in use|Singleton/i.test(e.message) ? "The X profile is already open (a reply may be running). Try again in a minute." : e.message); process.exit(1); }
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto("https://x.com/login").catch(() => {});
  console.log("A Chrome window is open at x.com/login.\nLog in to @hallucinateddpt yourself (password, 2FA). When you see the home timeline, close the window.");
  await new Promise((resolve) => {
    ctx.on("close", resolve);
    const check = () => { if (!ctx.pages().length) ctx.close().catch(() => {}).then(resolve); };
    ctx.on("page", (p) => p.on("close", check));
    page.on("close", check);
  });
  console.log("Window closed; the login is saved in .pw-x-profile/ (only on this Mac).");
} else if (cmd === "pause") {
  Object.assign(st, { paused: true, reason: rest.join(" ") || "paused by hand" });
  saveBrowserState(ROOT, st);
  console.log("Browser replies are PAUSED (kill switch). resume_browser_replies.command turns them back on.");
} else if (cmd === "resume") {
  Object.assign(st, { paused: false, paused_until: null, reason: null });
  saveBrowserState(ROOT, st);
  console.log("Browser replies are back on (still limited: hours, gap, daily cap).");
} else if (cmd === "status") {
  const L = LIMITS(), today = (st.replies || []).filter((r) => !r.dry && ptDayOf(r.at) === ptDayOf(new Date()));
  console.log(`paused: ${st.paused}${st.paused_until ? `, paused until ${st.paused_until}` : ""}${st.reason ? ` (${st.reason})` : ""}`);
  console.log(`today: ${today.length}/${L.maxPerDay} replies; gap ${L.minGapMin} min; hours ${L.startHour}:00-${L.endHour}:00 PT`);
  for (const r of today) console.log(`  ${r.at} -> ${r.target}${r.url ? " = " + r.url : ""}${r.unconfirmed ? " (unconfirmed)" : ""}`);
  console.log(`right now: ${scheduleCheck(st) || "a reply would be allowed"}`);
  // logged in? read the profile's own x.com cookies (no page is opened, nothing is sent to X)
  const fs = await import("node:fs");
  if (!fs.existsSync(PROFILE(ROOT))) console.log("x.com session: none (run x_login.command)");
  else {
    const { chromium } = await import("playwright");
    try {
      const ctx = await chromium.launchPersistentContext(PROFILE(ROOT), { channel: "chrome", headless: true });
      const c = await ctx.cookies("https://x.com");
      await ctx.close();
      const auth = c.find((k) => k.name === "auth_token"), twid = c.find((k) => k.name === "twid");
      console.log(`x.com session: ${auth ? `logged in${twid ? ` (twid ${decodeURIComponent(twid.value)})` : ""}, expires ${auth.expires > 0 ? new Date(auth.expires * 1000).toISOString().slice(0, 10) : "with session"}` : "NOT logged in (run x_login.command)"}`);
    } catch (e) { console.log(/already|in use|Singleton/i.test(e.message) ? "x.com session: profile is open in a Chrome window right now (close the x_login window, then check again)" : `x.com session: couldn't read (${e.message.split("\n")[0]})`); }
  }
} else if (cmd === "dry") {
  const [url, ...words] = rest, text = words.join(" ") || "test reply, not posted";
  if (!/^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(url || "")) { console.error("usage: dry <https://x.com/<user>/status/<id>> [text]"); process.exit(1); }
  const bad = textCheck(text); if (bad) { console.error(`text refused: ${bad}`); process.exit(1); }
  const r = await browserReply({ rootDir: ROOT, postUrl: url, text, dry: true, log: console.log });
  if (r.blocked) { Object.assign(st, { paused_until: endOfPtDay(), reason: `X showed: ${r.blocked} (dry test)` }); saveBrowserState(ROOT, st); }
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
} else {
  console.error("usage: node x/browser_cli.mjs login | pause [reason] | resume | status | dry <url> [text]");
  process.exit(1);
}
