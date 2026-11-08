// x_browser_reply's default backend: Naïve's hosted browser on a computer whose browser carries John's saved x.com login
// (context_name in the computer's config; John logged in once by hand via the Studio live view). We never log in ourselves.
// Actions: goto / click / extract / links are deterministic. The ONE model step is typing: Naïve's `type` doesn't reach X's
// Draft.js editor (Sat 17:10: performed:true, box empty), so the reply is typed with act("type %reply% into the reply box",
// {reply}) - the text travels as a variable, never to the model, never in a result. act never clicks Post and never
// navigates; the box is then extracted and must hold the exact text before Post is clicked (deterministically).
// No observe / screenshot (no images). The browser runs with stealth, captcha solving and proxy all OFF.
// Session renewal: when the browser has closed or is about to expire, a goto opens a new one on the SAME computer (its
// saved login comes back); logged-in is then checked by text. Only a logged-out X pauses replies and flags John.
// The computer id lives in <root>/x-browser.json (naive_computer_id); naive_browser_status.command sets / checks it.
// The SDK attaches an Idempotency-Key to every browser action (goto included).
import { detectBlock } from "./browser.mjs";

export const HANDLE = "hallucinateddpt";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const FOCAL = 'article[data-testid="tweet"][tabindex="-1"]';   // the post a status page is about
const FIRST = 'article[data-testid="tweet"]';
// the lead's wording; a longer "don't click anything" instruction made the provider refuse ("could not complete that action")
export const ACT_TYPE = "type %reply% into the reply box";

// The hosted browser on this computer, renewed if needed. -> { ok, b, timeout_at, session, renewed? } | { ok:false, expired, reason }
// Renewal: closed / missing / under minLeftMs left -> (close) + goto x.com/home, which opens a new browser on the same
// computer with its config (saved login included). Logged-in is checked by the caller, by text.
export async function naiveSession(v, computerId, { minLeftMs = 3 * 60_000, renew = true, log = () => {} } = {}) {
  if (!computerId) return { ok: false, expired: true, reason: "no Naïve browser computer set (naive_browser_status.command <cmp_id>)" };
  const b = v.computers.browser(computerId);
  const read = async () => { try { return await b.status(); } catch (e) { if (/404|not.found|no browser/i.test(e.message)) return null; throw e; } };
  let st;
  try { st = await read(); } catch (e) { return { ok: false, expired: true, reason: `browser status failed: ${e.message.slice(0, 120)}` }; }
  const usable = (x) => x && x.status === "active" && new Date(x.timeout_at) - Date.now() >= minLeftMs;
  if (usable(st)) return { ok: true, b, timeout_at: st.timeout_at, session: st.id };
  if (!renew) return { ok: false, expired: true, reason: !st ? "no browser is open on the Naïve computer" : `the Naïve browser session is ${st.status} (until ${st.timeout_at})` };
  const why = !st ? "no browser was open" : st.status !== "active" ? `the browser was ${st.status}` : `the browser expires at ${st.timeout_at}`;
  log(`[x_browser_reply naive] ${why}: opening a new browser on ${computerId}`);
  try {
    if (st && st.status === "active") await b.close().catch(() => {});
    await b.goto("https://x.com/home");
    st = await read();
  } catch (e) { return { ok: false, expired: true, reason: `${why} and a new one didn't open (${e.message.slice(0, 120)})` }; }
  if (!usable(st)) return { ok: false, expired: true, reason: `${why} and the new one isn't usable (${st ? st.status : "none"})` };
  return { ok: true, b, timeout_at: st.timeout_at, session: st.id, renewed: true };
}

const ex = async (b, selector) => { try { return norm((await b.extract({ selector })).text); } catch { return ""; } };
// logged in as us? the side-nav account button shows "@hallucinateddpt"
export async function loggedInAs(b) { const t = await ex(b, '[data-testid="SideNav_AccountSwitcher_Button"]'); return t.toLowerCase().includes(`@${HANDLE}`); }
// What X itself shows: URL + the overlay layer (#layers: dialogs, toasts, challenges). Posts' own text is NOT checked,
// so a dev joking about "rate limits" doesn't stop us.
async function blockCheck(b, url) { return detectBlock({ url, text: await ex(b, "#layers") }); }
// Throw away an unsent reply: close the dialog, pick "Discard" on X's save-draft sheet, then home. (A plain goto with text
// in the box hangs on the page's leave-site prompt: seen Sat 17:12.)
export async function discard(b) {
  await b.click('#layers [data-testid="app-bar-close"]').catch(() => {});
  await sleep(600);
  await b.click('#layers [data-testid="confirmationSheetCancel"]').catch(() => {});   // "Discard" (Confirm = "Save")
  await sleep(400);
  await b.goto("https://x.com/home").catch(() => {});
  return (await ex(b, "#layers")) === "";
}

// -> { ok, dry?, url?, blocked?, expired?, reason?, unconfirmed? }  Budget ~75 s.
export async function naiveReply({ v, computerId, postUrl, postText, text, dry = false, verify, log = () => {} }) {
  const t0 = Date.now(), left = () => 75_000 - (Date.now() - t0);
  const s = await naiveSession(v, computerId, { log });
  if (!s.ok) return s;
  const b = s.b;
  const g = await b.goto(postUrl);
  // logged in first (a logged-out page also shows a login wall, which is a re-login, not an X block)
  if (!(await loggedInAs(b))) return { ok: false, logged_out: true, reason: `the browser is not logged in to X as @${HANDLE}${s.renewed ? " after reopening it" : ""} (${g.url})` };
  let block = await blockCheck(b, g.url);
  if (block) return { ok: false, blocked: block };
  // the right post? its text must match what the API says (first 40 characters, links stripped)
  let focalSel = FOCAL, shown = await ex(b, `${FOCAL} [data-testid="tweetText"]`);
  if (!shown) { focalSel = FIRST; shown = await ex(b, `${FIRST} [data-testid="tweetText"]`); }
  const want = norm(String(postText || "").replace(/https?:\/\/\S+/g, "")).slice(0, 40);
  if (want && !norm(shown).startsWith(want.slice(0, Math.min(want.length, 25)))) return { ok: false, reason: `the page shows a different post ("${shown.slice(0, 50)}")` };
  await b.click(`${focalSel} [data-testid="reply"]`);
  // The reply dialog opens in #layers. Naïve's deterministic `type` doesn't reach X's Draft.js editor (tested Sat 17:10:
  // performed:true, box stays empty), so ONLY the typing is done with `act`, the text passed as a %variable% (never sent
  // to the model, never in a result). act never clicks Post and never navigates; everything after it is deterministic.
  const box = '#layers [data-testid="tweetTextarea_0"]';
  let opened = false;
  for (let i = 0; i < 4 && !opened && left() > 40_000; i++) { if ((await ex(b, '#layers [data-testid="tweetButton"]')) || (await ex(b, box)) !== "") opened = true; else await sleep(1000); }
  if (!opened) { await discard(b); return { ok: false, reason: "the reply dialog didn't open" }; }
  try {
    await b.act(ACT_TYPE, { reply: text });
  } catch (e) { await discard(b); return { ok: false, reason: `typing failed: ${e.message.slice(0, 120)}` }; }
  // act must not have sent anything: the dialog is still open and no "sent" toast
  const sentToast = await ex(b, '#layers [data-testid="toast"]');
  if (/sent|posted/i.test(sentToast) || !(await ex(b, '#layers [data-testid="tweetButton"]'))) {
    log(`[x_browser_reply naive] WARNING: the reply dialog closed during typing (${sentToast || "no toast"})`);
    return { ok: false, unconfirmed: true, reason: `the reply dialog closed while typing (${sentToast.slice(0, 60) || "no toast"}); check @${HANDLE} before trying again` };
  }
  const typed = await ex(b, box);
  if (norm(typed) !== norm(text)) {
    await discard(b);
    return { ok: false, reason: `the reply box holds different text than intended ("${typed.slice(0, 60)}")` };
  }
  block = await blockCheck(b, "");
  if (block) { await discard(b); return { ok: false, blocked: block }; }
  if (dry) {
    log(`[x_browser_reply naive DRY] reply box on ${postUrl} holds the exact draft; not posting, discarding it`);
    const clean = await discard(b);
    return { ok: true, dry: true, note: `opened the post, typed the reply (act), the box held the exact text; did not post (X_BROWSER_DRY=1); draft discarded${clean ? "" : " (the overlay wasn't empty afterwards: check the live view)"}` };
  }
  await b.click('#layers [data-testid="tweetButton"]');   // deterministic; never via act
  // verify: a toast, then our own replies page; the newest of our status links is checked against the API by `verify`
  let toast = "";
  for (let i = 0; i < 4 && left() > 25_000; i++) { await sleep(1500); toast = await ex(b, '#layers [data-testid="toast"]'); block = await blockCheck(b, ""); if (block) return { ok: false, blocked: block }; if (toast) break; }
  await b.goto(`https://x.com/${HANDLE}/with_replies`);
  block = await blockCheck(b, "");
  if (block) return { ok: false, blocked: block };
  const ls = (await b.links({ contains: `/${HANDLE}/status/`, limit: 50 }).catch(() => ({ links: [] }))).links || [];
  const ids = [...new Set(ls.map((l) => (l.href.match(/\/status\/(\d+)/) || [])[1]).filter(Boolean))].sort((a, c) => (BigInt(c) > BigInt(a) ? 1 : -1)).slice(0, 5);
  const url = verify ? await verify(ids) : null;
  await b.goto("https://x.com/home").catch(() => {});
  if (url) return { ok: true, url };
  if (/sent|posted/i.test(toast)) return { ok: true, url: null, note: "X said the post was sent, but it isn't on our replies page yet" };
  return { ok: false, unconfirmed: true, reason: `couldn't confirm the reply was posted (${toast.slice(0, 80) || "no confirmation"}); check @${HANDLE} before trying again` };
}

// naive_browser_status.command: text-only "is it open and logged in as us" (opens x.com/home; nothing is typed or posted)
export async function naiveCheck(v, computerId, { log = () => {} } = {}) {
  const s = await naiveSession(v, computerId, { minLeftMs: 0, log });
  if (!s.ok) return s;
  const g = await s.b.goto("https://x.com/home");
  const block = await blockCheck(s.b, g.url);
  const links = ((await s.b.links({ limit: 200 }).catch(() => ({ links: [] }))).links || []).map((l) => l.href);
  const compose = links.some((h) => /\/compose\/post/.test(h)), profile = links.some((h) => new RegExp(`x\\.com/${HANDLE}(\\?|$|/)`, "i").test(h) || h === `/${HANDLE}`);
  const me = await loggedInAs(s.b);
  const onHome = /x\.com\/home/.test(g.url);
  return { ok: !block && onHome && (me || (compose && profile)), renewed: !!s.renewed, url: g.url, on_home: onHome, compose_link: compose, profile_link: profile, account_button: me, block: block || null, timeout_at: s.timeout_at, session: s.session };
}
