// Unit checks for the Naïve-browser backend with a fake browser (no network). node x/naive_browser_test.mjs
import assert from "node:assert/strict";
import { naiveReply, naiveSession, ACT_TYPE } from "./naive_browser.mjs";

const POST = "my AI agent deployed to prod on a friday and now it's the CTO";
function fake({ status = { status: "active", timeout_at: new Date(Date.now() + 3600_000).toISOString(), id: "brw_1" }, layers = "", account = "Hallucinated Goods @hallucinateddpt", page = POST, statusThrows = false, mangle = false, actPosts = false, reopen = true, homeAccount = null, homeUrl = null, homeThrows = 0 } = {}) {
  const calls = []; let box = "", url = "about:blank", dialog = false, toast = "";
  const b = {
    status: async () => { if (statusThrows) throw new Error("404 not_found: no browser is open on cmp_1"); return status; },
    close: async () => { calls.push(["close"]); statusThrows = true; return { status: "closed" }; },
    goto: async (u) => { calls.push(["goto", u]); if (/x\.com\/home/.test(u) && homeThrows-- > 0) throw new Error("the service is at capacity"); if (/x\.com\/home/.test(u) && homeAccount !== null) account = homeAccount; if (/x\.com\/home/.test(u) && homeUrl) { url = homeUrl; return { url }; } if (statusThrows && reopen) { statusThrows = false; status = { status: "active", timeout_at: new Date(Date.now() + 3600_000).toISOString(), id: "brw_new" }; } url = u; box = ""; dialog = false; return { url }; },
    click: async (s) => { calls.push(["click", s]); if (/"reply"\]$/.test(s)) dialog = true; if (/tweetButton/.test(s)) { dialog = false; toast = "Your post was sent. View"; } return {}; },
    type: async (s) => { calls.push(["type", s]); return {}; },   // X ignores it (as on the real site)
    act: async (instr, vars) => { calls.push(["act", instr, vars]); if (actPosts) { dialog = false; toast = "Your post was sent."; return {}; } box = mangle ? vars.reply.slice(1) : vars.reply; return {}; },
    extract: async ({ selector }) => ({ text: selector === "#layers" ? layers : /AccountSwitcher/.test(selector) ? account : /tweetText"\]$/.test(selector) ? page : /tweetTextarea_0/.test(selector) ? box : /toast/.test(selector) ? toast : /tweetButton/.test(selector) ? (dialog ? "Reply" : "") : "" }),
    links: async () => ({ url, links: [{ href: "https://x.com/hallucinateddpt/status/200", text: "" }, { href: "https://x.com/hallucinateddpt/status/300", text: "" }] }),
  };
  return { v: { computers: { browser: () => b } }, calls };
}
const base = { computerId: "cmp_1", postUrl: "https://x.com/dev/status/1", postText: POST, text: "friday deployed the agent" };
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log("ok", name); };

await ok("session: no computer; renew=false reports closed / expiring", async () => {
  assert.equal((await naiveSession(fake().v, null)).expired, true);
  assert.match((await naiveSession(fake({ statusThrows: true }).v, "c", { renew: false })).reason, /no browser is open/);
  assert.match((await naiveSession(fake({ status: { status: "closed", timeout_at: new Date().toISOString() } }).v, "c", { renew: false })).reason, /closed/);
});
await ok("Naïve at capacity on status or reopen -> transient skip, never expired/paused", async () => {
  const busy = { computers: { browser: () => ({ status: async () => { throw new Error("the service is at capacity"); } }) } };
  const r1 = await naiveSession(busy, "c"); assert.equal(r1.transient, true); assert.equal(r1.expired, undefined);
  const reopenBusy = { computers: { browser: () => ({ status: async () => { throw new Error("404 not_found: no browser is open"); }, goto: async () => { throw new Error("429 rate_limited"); } }) } };
  const r2 = await naiveSession(reopenBusy, "c"); assert.equal(r2.transient, true); assert.equal(r2.expired, undefined);
  const r3 = await naiveReply({ ...base, v: busy, dry: true });
  assert.equal(r3.transient, true); assert.equal(r3.expired, undefined); assert.equal(r3.logged_out, undefined);
});
await ok("session renewal: none open / closed / expiring -> new browser on the same computer via goto", async () => {
  const f1 = fake({ statusThrows: true }); const r1 = await naiveSession(f1.v, "c");
  assert.equal(r1.ok, true); assert.equal(r1.renewed, true); assert.equal(r1.session, "brw_new"); assert.deepEqual(f1.calls, [["goto", "https://x.com/home"]]);
  const f2 = fake({ status: { status: "active", timeout_at: new Date(Date.now() + 60_000).toISOString(), id: "brw_old" } }); const r2 = await naiveSession(f2.v, "c");
  assert.equal(r2.renewed, true); assert.deepEqual(f2.calls.map((c) => c[0]), ["close", "goto"]);
  const f3 = fake({ statusThrows: true, reopen: false }); const r3 = await naiveSession(f3.v, "c");
  assert.equal(r3.ok, false); assert.equal(r3.expired, true); assert.match(r3.reason, /new one isn't usable/);
});
await ok("dry: types, verifies, never clicks post, discards the draft, ends home", async () => {
  const f = fake(); const r = await naiveReply({ ...base, v: f.v, dry: true });
  assert.equal(r.ok, true); assert.equal(r.dry, true);
  assert.ok(!f.calls.some(([k, s]) => k === "click" && /tweetButton/.test(s)), "clicked post in dry mode");
  const tail = f.calls.slice(-3).map((c) => c[1]);
  assert.match(tail[0], /app-bar-close/); assert.match(tail[1], /confirmationSheetCancel/); assert.equal(tail[2], "https://x.com/home");
  assert.match(f.calls.find(([k]) => k === "click")[1], /tabindex="-1"\] \[data-testid="reply"\]/);
});
const noWait = async () => {};
await ok("logged out on the post page AND home (login redirect) -> logged_out (pause + flag, never log in)", async () => {
  const r = await naiveReply({ ...base, v: fake({ account: "Sign in", layers: "Don't miss what's happening. Log in", homeUrl: "https://x.com/i/flow/login" }).v, dry: true, wait: noWait });
  assert.equal(r.logged_out, true); assert.equal(r.blocked, undefined); assert.match(r.reason, /both logged out/);
});
await ok("post page didn't load but home is logged in -> transient skip, no pause", async () => {
  const f = fake({ account: "", homeAccount: "Hallucinated Goods @hallucinateddpt" });
  const r = await naiveReply({ ...base, v: f.v, dry: true, wait: noWait });
  assert.equal(r.logged_out, undefined); assert.equal(r.transient, true); assert.match(r.reason, /didn't load/);
  assert.ok(f.calls.some(([k, u]) => k === "goto" && /x\.com\/home/.test(u)));
});
await ok("Naïve at capacity on the home re-check: retried, then transient skip (no pause)", async () => {
  const r = await naiveReply({ ...base, v: fake({ account: "", homeThrows: 5 }).v, dry: true, wait: noWait });
  assert.equal(r.logged_out, undefined); assert.equal(r.transient, true); assert.match(r.reason, /didn't answer/);
  const r2 = await naiveReply({ ...base, v: fake({ account: "", homeThrows: 1, homeAccount: "@hallucinateddpt" }).v, dry: true, wait: noWait });
  assert.equal(r2.transient, true); assert.match(r2.reason, /didn't load/);   // one 429, then home shows the account
});
await ok("home loads but still no account and no login wall -> unknown -> transient (no pause)", async () => {
  const r = await naiveReply({ ...base, v: fake({ account: "" }).v, dry: true, wait: noWait });
  assert.equal(r.transient, true); assert.equal(r.logged_out, undefined);
});
await ok("X challenge in #layers -> blocked", async () => {
  const r = await naiveReply({ ...base, v: fake({ layers: "We noticed unusual activity. Verify you are human" }).v, dry: true });
  assert.match(r.blocked, /unusual/);
});
await ok("post text mentioning rate limits is NOT a block", async () => {
  const r = await naiveReply({ ...base, postText: "hit the rate limit again, try again later lol", v: fake({ page: "hit the rate limit again, try again later lol" }).v, dry: true });
  assert.equal(r.ok, true);
});
await ok("wrong post on the page -> refuse", async () => {
  const r = await naiveReply({ ...base, v: fake({ page: "something else entirely" }).v, dry: true });
  assert.match(r.reason, /different post/);
});
await ok("act types via a %variable% only; mangled text -> home + refuse, never clicks post", async () => {
  const f0 = fake(); await naiveReply({ ...base, v: f0.v, dry: true });
  const a = f0.calls.find(([k]) => k === "act");
  assert.equal(a[1], ACT_TYPE); assert.ok(a[1].includes("%reply%") && !a[1].includes(base.text)); assert.deepEqual(a[2], { reply: base.text });
  assert.equal(ACT_TYPE, "type %reply% into the reply box");   // typing only: nothing about clicking or navigating
  assert.equal(f0.calls.filter(([k]) => k === "act").length, 1);
  const f = fake({ mangle: true }); const r = await naiveReply({ ...base, v: f.v, dry: false, verify: async () => "x" });
  assert.match(r.reason, /different text/); assert.ok(!f.calls.some(([k, s]) => k === "click" && /tweetButton/.test(s)));
  assert.match(f.calls.at(-2)[1], /confirmationSheetCancel/); assert.deepEqual(f.calls.at(-1), ["goto", "https://x.com/home"]);
});
await ok("if act ever closes the dialog / sends: unconfirmed, stop", async () => {
  const f = fake({ actPosts: true }); const r = await naiveReply({ ...base, v: f.v, dry: true });
  assert.equal(r.ok, false); assert.equal(r.unconfirmed, true); assert.match(r.reason, /closed while typing/);
});
await ok("real post: clicks post, verifies newest of ours via the API callback", async () => {
  const f = fake(); const seen = [];
  const r = await naiveReply({ ...base, v: f.v, dry: false, verify: async (ids) => { seen.push(...ids); return ids[0] === "300" ? "https://x.com/hallucinateddpt/status/300" : null; } });
  assert.equal(r.ok, true); assert.equal(r.url, "https://x.com/hallucinateddpt/status/300");
  assert.deepEqual(seen.slice(0, 2), ["300", "200"]);   // newest first
  assert.ok(f.calls.some(([k, s]) => k === "click" && /#layers \[data-testid="tweetButton"\]/.test(s)));
});
console.log(`\n${n} checks passed`);
