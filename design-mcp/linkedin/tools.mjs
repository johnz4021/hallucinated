// LinkedIn tools for Growth: one daily "takeover" post on JOHN'S OWN profile through the official API (li.mjs; scope
// w_member_social; token from linkedin/login.mjs). Replaces the lead's placeholder (the original was lost, Sat 22:48).
//   linkedin_images  (allow) candidate images we own: live photoreal ads first (posted / queued, non-test), then launch shots
//   linkedin_post    (ask, in NEVER_AUTO: John approves each post in Naïve Studio) text + 1-4 images (4:5 1080x1350 crops) + sponsor @mentions;
//                    hard cap 1 post per Pacific day (LI_MAX_PER_DAY), kill switch (pause_linkedin / resume_linkedin)
// LI_DRY=1 (or LINKEDIN_DRY_RUN=1): builds the full payload (uploads skipped) and returns it without posting.
// Ledger: <root>/linkedin-ledger.json (dry: linkedin-ledger.dry.json): { paused, reason, posts: [...] }. Org ids: linkedin-orgs.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { readJson, writeJson, txt, err } from "../lib/state.mjs";
import { loadAds } from "../creative/ledger.mjs";
import { findBanned } from "../designs/guard.mjs";
import { loadToken, uploadImage, createPost, buildCommentary, postBody, orgByVanity } from "./li.mjs";

const STORE = "https://hallucinated-store.vercel.app";
const OWN = (u) => { try { const x = new URL(u); return x.protocol === "https:" && (x.host === "hallucinated-store.vercel.app" || /\.public\.blob\.vercel-storage\.com$/.test(x.host)); } catch { return false; } };
export const dryMode = () => process.env.LI_DRY === "1" || process.env.LINKEDIN_DRY_RUN === "1";
const ledgerFile = (root) => path.join(root, dryMode() ? "linkedin-ledger.dry.json" : "linkedin-ledger.json");
export const loadLedger = (root) => readJson(ledgerFile(root), { paused: false, reason: null, posts: [] });
const saveLedger = (root, l) => writeJson(ledgerFile(root), l);
// the kill switch lives in the LIVE ledger, whatever the mode
// honest disclosure, added in code to every post (CLAUDE.md LinkedIn rule)
export const FOOTER = "Written by our AI Growth agent. Hallucinated is run by AI agents; a human approves the posts.";
export const withFooter = (text) => (String(text).includes(FOOTER) ? String(text) : `${String(text).trim()}\n\n${FOOTER}`);
export const killSwitch = (root) => readJson(path.join(root, "linkedin-ledger.json"), {});
const MAX_PER_DAY = () => Number(process.env.LI_MAX_PER_DAY || 1);
const ptDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));

// Post formats after the takeover opener (John: "then in whatever joking format they want"); rotated in code, no repeats in a row
export const LI_FORMATS = {
  press_release: "a fake press release (FOR IMMEDIATE RELEASE, dateline San Francisco, quotes from the CEO agent)",
  influencer_listicle: "a LinkedIn-influencer listicle: '7 things we learned taking over a human's LinkedIn' with one-line points",
  org_chart_memo: "an internal org-chart memo announcing the new structure (John reports to the agents now)",
  performance_review: "a performance review of John written by the agents: strengths, growth areas, rating",
  hiring_post: "a hiring post: 'We're hiring (a human, to pay for things)', with requirements and perks",
  all_hands_update: "a quarterly all-hands update with fake OKRs and real numbers from the agents' log",
  incident_postmortem: "an incident postmortem: 'Incident: the agents took over LinkedIn', timeline, root cause, action items",
};
export function pickLiFormat(lastFormat, rng = Math.random) {
  const pool = Object.keys(LI_FORMATS).filter((f) => f !== lastFormat);
  return pool[Math.floor(rng() * pool.length)];
}
// The sponsors we tag (company pages). vanity = LinkedIn's company URL slug, used only for the API lookup.
export const SPONSORS = [
  { name: "Naïve", vanity: "usenaive" }, { name: "AgentMail", vanity: "agentmail" }, { name: "MobileRun", vanity: "mobilerun" },
  { name: "Stripe", vanity: "stripe" }, { name: "Vercel", vanity: "vercel" },
];
const SPONSOR_TERMS = ["naive", "naïve", "usenaive", "agentmail", "mobilerun", "stripe", "vercel", "linkedin"];

// Pure: today's cap + kill switch (dry posts never count)
export function scheduleCheck(live, now = new Date()) {
  if (live.paused) return `LinkedIn posting is paused (${live.reason || "kill switch"}); resume_linkedin.command turns it back on`;
  const today = (live.posts || []).filter((p) => !p.dry && ptDay(p.at) === ptDay(now));
  return today.length >= MAX_PER_DAY() ? `already ${today.length} LinkedIn post today (limit ${MAX_PER_DAY()})` : null;
}
// Pure: the text (hard lines, sponsor names allowed)
export function textCheck(text) {
  const t = String(text || "").trim();
  if (t.length < 60) return "the post is too short";
  if (t.length > 2800) return `the post is ${t.length} characters (max 2800)`;
  const hits = findBanned({ text: t }, ["real_people", "trademarks", "tragedy"]).filter((h) => !SPONSOR_TERMS.includes(String(h.term).toLowerCase()));
  return hits.length ? `hard lines: ${hits.map((h) => `"${h.term}" (${h.list})`).join(", ")}` : null;
}
// Pure: candidate images, ads first (image ads, then video posters), newest first; then launch shots
export function candidates(ads, launch) {
  const out = [];
  const live = Object.entries(ads || {}).map(([k, a]) => ({ ...a, id: a.id || k })).filter((a) => !a.test && ["posted", "queued"].includes(a.state)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const a of live) { const url = a.kind === "image" ? a.media_url : a.poster_url; if (url && OWN(url)) out.push({ id: `ad:${a.id}`, url, source: `ad (${a.kind})`, about: (a.caption || a.concept || "").slice(0, 160), featured: a.featured_products || [] }); }
  for (const d of Object.values(launch?.designs || {})) for (const p of d.passes || []) if (p.blob_url && OWN(p.blob_url)) out.push({ id: `launch:${d.slug}:${p.view}`, url: p.blob_url, source: `launch shot (${p.view})`, about: (p.alt || "").slice(0, 160), featured: [d.slug] });
  return out;
}
// The sponsors' org urns: cache (linkedin-orgs.json, may be filled by hand) -> API by vanity name -> null (plain name)
export async function resolveOrgs(root, t, { lookup = orgByVanity } = {}) {
  const file = path.join(root, "linkedin-orgs.json"), cache = readJson(file, {});
  const out = [];
  for (const s of SPONSORS) {
    let c = cache[s.name];
    if (!c?.urn && !(c?.tried_at && Date.now() - new Date(c.tried_at).getTime() < 6 * 3600_000) && t) {
      const r = await lookup(t, s.vanity);
      c = r?.urn ? { urn: r.urn, via: "api", name_on_linkedin: r.name || null, at: new Date().toISOString() } : { urn: null, tried_at: new Date().toISOString(), why: r?.error || "not found" };
      // only an exact name match counts (never a guess)
      if (c.urn && c.name_on_linkedin && c.name_on_linkedin.toLowerCase().replace(/ï/g, "i") !== s.name.toLowerCase().replace(/ï/g, "i")) c = { urn: null, tried_at: c.at, why: `name on LinkedIn is "${c.name_on_linkedin}"` };
      cache[s.name] = c;
    }
    out.push({ name: s.name, urn: c?.urn || null });
  }
  writeJson(file, cache);
  return out;
}
// 4:5 1080x1350 crop (attention-centred) -> temp JPEG path
async function crop45(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const f = path.join(os.tmpdir(), `li-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.jpg`);
  await sharp(Buffer.from(await r.arrayBuffer())).resize(1080, 1350, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 90, mozjpeg: true }).toFile(f);
  return f;
}

export function registerLinkedInTools(server, ctx) {
  const root = ctx.rootDir;
  server.registerTool("linkedin_images", {
    title: "Images for the LinkedIn post",
    description: "Candidate images we own for today's LinkedIn post: live photoreal ads first (posted or queued; video ads give their poster frame), then launch shots of the agents' designs. Each has an id (pass 1-4 ids to linkedin_post), its public URL, its source and what it shows. All AI-generated photos of fictional people.",
    inputSchema: {},
  }, async () => {
    const c = candidates(loadAds(root).ads, readJson(path.join(root, "launch-images.json"), {}));
    // today's format, picked in code (no repeat of the last post's format); kept as pending until linkedin_post uses it
    const l = loadLedger(root);
    const format = l.pending_format && Date.now() - new Date(l.pending_format.at).getTime() < 6 * 3600_000 ? l.pending_format.format : pickLiFormat(l.last_format);
    if (!l.pending_format || l.pending_format.format !== format) { l.pending_format = { format, at: new Date().toISOString() }; saveLedger(root, l); }
    return txt({ count: c.length, images: c.slice(0, 12), format, format_how: LI_FORMATS[format], allowed_today: !scheduleCheck(killSwitch(root)), why_not: scheduleCheck(killSwitch(root)),
      voice: "first person plural: John's AI agents taking over his LinkedIn; never write as John" });
  });

  server.registerTool("linkedin_post", {
    title: "Post the daily LinkedIn takeover on John's profile",
    description: "Publishes ONE post on John's personal LinkedIn (official API): your text, 1-4 of our images by id from linkedin_images (cropped to 4:5), and @mentions of our sponsors' company pages (Naïve, AgentMail, MobileRun, Stripe, Vercel). Write \"@Stripe\" etc. in the text where you want each tag; any sponsor not written in the text is thanked in a closing line; a sponsor whose page can't be resolved stays a plain name. Checked in code: 1 post per Pacific day, kill switch, hard lines, our images only. Returns the post URL.",
    inputSchema: { text: z.string().min(60).max(2800), image_ids: z.array(z.string()).min(1).max(4).optional(), mentions: z.array(z.string()).max(5).optional(),
      image: z.string().optional().describe("(older form) one image id or URL"), alt_text: z.string().max(300).optional(),
      format: z.string().max(40).optional().describe("the format linkedin_images gave you") },
  }, async ({ text, image_ids, mentions = SPONSORS.map((s) => s.name), image, alt_text, format }) => {
    try {
      const dry = dryMode();
      const sched = scheduleCheck(killSwitch(root));
      if (sched && !dry) return err(`refused: ${sched}`);
      const bad = textCheck(text);
      if (bad) return err(`refused: ${bad}`);
      const unknown = mentions.filter((m) => !SPONSORS.some((s) => s.name.toLowerCase() === m.toLowerCase()));
      if (unknown.length) return err(`refused: mentions are only our sponsors (${SPONSORS.map((s) => s.name).join(", ")}); not ${unknown.join(", ")}`);
      const cands = candidates(loadAds(root).ads, readJson(path.join(root, "launch-images.json"), {}));
      const ids = image_ids?.length ? image_ids : image ? [image] : [];
      const picked = ids.map((id) => cands.find((c) => c.id === id) || (OWN(id) ? { id, url: id, about: "" } : null));
      if (!picked.length) return err("refused: pick 1-4 images by id from linkedin_images");
      if (picked.some((p) => !p)) return err(`refused: unknown image id(s) ${ids.filter((_, i) => !picked[i]).join(", ")} (use ids from linkedin_images; images must be ours)`);
      const t = loadToken(root);
      if (!t && !dry) return err("LinkedIn isn't connected (or the token expired): John runs linkedin_login.command");
      const orgs = (await resolveOrgs(root, t)).filter((o) => mentions.some((m) => m.toLowerCase() === o.name.toLowerCase()));
      const commentary = buildCommentary(withFooter(text), orgs);
      const alt = (p) => (alt_text || p.about || "AI-generated photo of a fictional person wearing a Hallucinated tee").slice(0, 300);
      if (dry) {
        const images = picked.map((p, i) => ({ urn: `urn:li:image:DRY-${i + 1}`, alt: alt(p), source_url: p.url }));
        const body = postBody(t || { person_urn: "urn:li:person:DRY" }, { commentary, images });
        const l = loadLedger(root); l.posts = [...(l.posts || []), { at: new Date().toISOString(), dry: true, chars: text.length, images: images.length, mentions: orgs, format: format || l.pending_format?.format || null }].slice(-50); saveLedger(root, l);
        ctx.log?.(`[linkedin_post DRY] ${images.length} image(s), mentions ${orgs.map((o) => `${o.name}:${o.urn ? "tagged" : "plain"}`).join(" ")}`);
        return txt({ dry_run: true, connected: !!t, mentions: orgs, commentary, body, image_sources: images.map((i) => i.source_url), note: "nothing uploaded or posted (LI_DRY)" });
      }
      const images = [];
      for (const p of picked) { const f = await crop45(p.url); images.push({ urn: await uploadImage(t, f), alt: alt(p) }); fs.rmSync(f, { force: true }); }
      const r = await createPost(t, { commentary, images });
      const l = loadLedger(root);
      const used = format || l.pending_format?.format || null;
      l.posts = [...(l.posts || []), { at: new Date().toISOString(), id: r.id, url: r.url, chars: text.length, images: images.length, format: used, mentions: orgs.map((o) => ({ name: o.name, tagged: !!o.urn })) }].slice(-200);
      if (used) l.last_format = used;
      l.pending_format = null;
      saveLedger(root, l);
      ctx.log?.(`[linkedin_post] posted ${r.url} (${images.length} image(s); tagged ${orgs.filter((o) => o.urn).map((o) => o.name).join(", ") || "none"})`);
      return txt({ posted: true, url: r.url, images: images.length, mentions: orgs.map((o) => ({ name: o.name, tagged: !!o.urn })) });
    } catch (e) { return err("linkedin_post failed: " + e.message); }
  });
}
