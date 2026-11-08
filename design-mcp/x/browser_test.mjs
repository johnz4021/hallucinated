// Unit checks for x_browser_reply's pure guards (no browser, no network). node x/browser_test.mjs
import assert from "node:assert/strict";
import { scheduleCheck, targetCheck, textCheck, detectBlock, endOfPtDay, ptDayOf, ptHourOf, withBrowserLock, LIMITS } from "./browser.mjs";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok", name); };
const L = { ...LIMITS(), minGapMin: 50, maxPerDay: 13, startHour: 9, endHour: 22 };
const at = (iso) => new Date(iso);
// 2026-11-07 is PST (UTC-8): 12:00 PT = 20:00Z
const noon = at("2026-11-07T20:00:00Z");

ok("pt helpers", () => { assert.equal(ptHourOf(noon), 12); assert.equal(ptDayOf(noon), "2026-11-07"); assert.equal(ptDayOf(at("2026-11-08T07:59:00Z")), "2026-11-07"); });
ok("endOfPtDay = next PT midnight", () => { assert.equal(endOfPtDay(noon), "2026-11-08T08:00:00.000Z"); assert.equal(endOfPtDay(at("2026-11-08T07:30:00Z")), "2026-11-08T08:00:00.000Z"); });

ok("schedule: fresh state inside hours is allowed", () => assert.equal(scheduleCheck({ replies: [] }, noon, L), null));
ok("schedule: kill switch", () => assert.match(scheduleCheck({ paused: true, replies: [] }, noon, L), /paused \(kill switch/));
ok("schedule: day pause", () => { assert.match(scheduleCheck({ paused_until: "2026-11-08T08:00:00Z", replies: [] }, noon, L), /paused until/); assert.equal(scheduleCheck({ paused_until: "2026-11-07T19:00:00Z", replies: [] }, noon, L), null); });
ok("schedule: hours 09-22 PT", () => {
  assert.match(scheduleCheck({ replies: [] }, at("2026-11-07T16:59:00Z"), L), /outside reply hours/);   // 08:59
  assert.equal(scheduleCheck({ replies: [] }, at("2026-11-07T17:00:00Z"), L), null);                    // 09:00
  assert.equal(scheduleCheck({ replies: [] }, at("2026-11-08T05:59:00Z"), L), null);                    // 21:59
  assert.match(scheduleCheck({ replies: [] }, at("2026-11-08T06:00:00Z"), L), /outside reply hours/);   // 22:00
});
ok("schedule: 50 min gap (dry runs don't count; unconfirmed does)", () => {
  assert.match(scheduleCheck({ replies: [{ at: "2026-11-07T19:20:00Z" }] }, noon, L), /40 min ago/);
  assert.equal(scheduleCheck({ replies: [{ at: "2026-11-07T19:10:00Z" }] }, noon, L), null);
  assert.equal(scheduleCheck({ replies: [{ at: "2026-11-07T19:55:00Z", dry: true }] }, noon, L), null);
  assert.match(scheduleCheck({ replies: [{ at: "2026-11-07T19:55:00Z", unconfirmed: true }] }, noon, L), /min ago/);
});
ok("schedule: 13 a day", () => {
  const replies = Array.from({ length: 13 }, (_, i) => ({ at: new Date(at("2026-11-07T17:00:00Z").getTime() + i * 60_000).toISOString() }));
  assert.match(scheduleCheck({ replies }, at("2026-11-08T05:00:00Z"), L), /already 13/);
  const yesterday = replies.map((r) => ({ at: new Date(new Date(r.at).getTime() - 86400_000).toISOString() }));
  assert.equal(scheduleCheck({ replies: yesterday }, noon, L), null);
});

const me = { id: "999" };
const base = { id: "1", author_id: "42", author: "dev", followers: 3000, protected: false, lang: "en", reply_count: 12, conversation_id: "1",
  created_at: "2026-11-07T15:00:00Z", text: "my AI agent deployed to prod on a friday and now it's the CTO" };
const ctxOk = { me, seenInSearch: true, ledger: { authors: {}, threads: {} } };
ok("target: a good one passes", () => assert.equal(targetCheck(base, ctxOk, noon, L), null));
ok("target: refusals", () => {
  assert.match(targetCheck(null, ctxOk, noon, L), /not found/);
  assert.match(targetCheck(base, { ...ctxOk, seenInSearch: false }, noon, L), /x_search/);
  assert.match(targetCheck({ ...base, author_id: "999" }, ctxOk, noon, L), /our own/);
  assert.match(targetCheck({ ...base, protected: true }, ctxOk, noon, L), /protected/);
  assert.match(targetCheck({ ...base, lang: "es" }, ctxOk, noon, L), /English/);
  assert.match(targetCheck({ ...base, created_at: "2026-11-06T19:00:00Z" }, ctxOk, noon, L), /older than 24/);
  assert.match(targetCheck({ ...base, created_at: undefined }, ctxOk, noon, L), /older than 24/);
  assert.match(targetCheck({ ...base, followers: 250_000 }, ctxOk, noon, L), /followers/);
  assert.match(targetCheck({ ...base, reply_count: 501 }, ctxOk, noon, L), /replies/);
  assert.match(targetCheck({ ...base, text: "lovely sunset at the beach today" }, ctxOk, noon, L), /SF \/ AI/);
  assert.match(targetCheck(base, { ...ctxOk, ledger: { authors: { 42: {} }, threads: {} } }, noon, L), /one reply per person/);
  assert.match(targetCheck({ ...base, id: "2" }, { ...ctxOk, ledger: { authors: {}, threads: { 1: {} } } }, noon, L), /this thread/);
});

ok("text: good reply passes", () => assert.equal(textCheck("the agent didn't deploy on friday, friday deployed the agent", L), null));
ok("text: refusals", () => {
  assert.match(textCheck("   ", L), /empty/);
  assert.match(textCheck("x".repeat(241), L), /241 chars/);
  assert.match(textCheck("see https://hallucinated-store.vercel.app", L), /links/);
  assert.match(textCheck("buy at hallucinated.shop.com", L), /links/);
  assert.match(textCheck("same energy #buildinpublic", L), /hashtags/);
  assert.match(textCheck("ask @sama", L), /@-mentions/);
});

ok("detectBlock", () => {
  assert.equal(detectBlock({ url: "https://x.com/dev/status/1", text: "my AI agent deployed to prod Reply Repost Like" }), null);
  assert.match(detectBlock({ hasCaptchaFrame: true }), /captcha/);
  assert.match(detectBlock({ url: "https://x.com/i/flow/login?redirect_after_login=%2F" }), /redirected/);
  assert.match(detectBlock({ url: "https://x.com/account/access" }), /redirected/);
  assert.match(detectBlock({ text: "We noticed unusual activity on your account" }), /unusual/);
  assert.match(detectBlock({ text: "Your account has been locked." }), /locked/);
  assert.match(detectBlock({ text: "Please verify you are human" }), /human-verification/);
  assert.match(detectBlock({ text: "You are over the daily limit for sending posts." }), /rate limit/);
  assert.match(detectBlock({ text: "Something went wrong. Try again later." }), /rate limit/);
  assert.match(detectBlock({ text: "Don’t miss what’s happening. People on X are the first to know. Log in" }), /login wall/);
});

// mutex: two calls never overlap, and a failure doesn't jam the lock
let active = 0, maxActive = 0;
const job = (ms, fail) => withBrowserLock(async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, ms)); active--; if (fail) throw new Error("boom"); return ms; });
const res = await Promise.allSettled([job(30), job(10, true), job(5)]);
ok("lock: serial, survives a failure", () => { assert.equal(maxActive, 1); assert.equal(res[0].value, 30); assert.equal(res[1].status, "rejected"); assert.equal(res[2].value, 5); });

console.log(`\n${n} checks passed`);
