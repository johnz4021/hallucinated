// The autonomous design loop's tools. Product proposes, the CEO agent decides, code publishes.
//   propose_design     (Product, allow) validates the design (exists, passed QA, not used), banned terms, max 2/day,
//                      stores the proposal and starts a CEO session to decide it
//   ceo_decide         (CEO, allow) approve | reject with a written reason; on approve, server code publishes
//                      (max 2/day, never the same design twice) - see publish.mjs
//   store_new_designs  (Growth, allow) published designs not yet announced on X (x_post announce_slug marks them)
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createClient } from "@usenaive-sdk/vetta";
import { txt, err } from "../lib/state.mjs";
import { stripeClient } from "../stripe/tools.mjs";
import { flagJohn } from "../agentmail/tools.mjs";
import { checkProposal, SLUG_RE } from "./guard.mjs";
import { STYLES, issueStyle, loadStyleLedger, familyOf } from "./styles.mjs";
import { loadProposals, saveProposals, updateProposal, newProposalId, proposalsToday, publishesToday, publishedDesign, openProposal, slugTaken, MAX_PROPOSALS_PER_DAY, MAX_PUBLISHES_PER_DAY } from "./ledger.mjs";
import { publishDesign, storeAdmin, activeProducts, placementOf, STORE, PRICE_CENTS } from "./publish.mjs";
import { kickLaunchImages } from "./launch.mjs";

// The design's art style + family, from the proposal (recorded from the QA verdict) or the verdict itself.
export const styleOf = (p, verdict) => {
  const style = p.style || verdict?.style || null;
  return { style, family: p.family || verdict?.family || (style ? familyOf(style) : null), label: STYLES[style]?.label || style || "unknown" };
};
export const ceoBrief = (p, verdict) =>
`Product proposes a new pre-order tee for the store. You decide, alone: approve or reject with ceo_decide. If you approve, it goes on sale as a pre-order ($${PRICE_CENTS / 100}, card saved, charged at launch) automatically.
proposal_id: ${p.proposal_id}
Title: ${p.title}   (slug ${p.slug})
Printed text: ${verdict.text_seen || verdict.args?.text || "(none)"}   Placement: ${placementOf(verdict)}
Art style: ${styleOf(p, verdict).label} (${styleOf(p, verdict).family || "unknown"} family). The rotation picked it on purpose; judge it by brand.json art_style.all_families + art_style.${styleOf(p, verdict).family || "ink"}, not by another family's rules.
Pitch: ${p.pitch}
Why now (Product's trend summary): ${p.trend_summary}
Sources: ${(p.sources || []).map((s) => `${s.label} <${s.url}>`).join("; ") || "none"}
Design QA (vision check on a black-tee mockup, your eyes: you can't view images): ${verdict.pass ? "PASS" : "FAIL"}; notes: ${verdict.notes || "-"}; issues: ${(verdict.issues || []).join("; ") || "none"}
Image prompt: ${String(verdict.args?.prompt || "").slice(0, 700)}

Checklist. Reject if ANY fails, and say which:
1. Original joke that lands for SF tech people right now (not a recycled meme, not a dated reference).
2. No real person's name or likeness. No other company's logo, product name or trademark as the joke (generic things like "the cloud", "git", "deploys" are fine).
3. Nothing about tragedies, disasters, violence, illness or death.
4. Punches up or at ourselves (tech culture, hype, the grind), never at a group of people.
5. Clean product: works as a shirt someone would wear in SF; the print text is spelled exactly as intended; on-brand FOR ITS STYLE FAMILY (brand.json voice + art_style for the family above). Every family is on-brand: a photo, collage or full-colour design is never off-brand for being a photo, having colour or gradients, or not being flat line art; judge it as that style (legible on black, clean edge, fictional people only).
6. It's not the same joke as something we already sell.
Explain your call for the record in 2-4 sentences (what works, the risk, why it ships or doesn't), then call ceo_decide with proposal_id "${p.proposal_id}", decision "approve" or "reject", and that reason. If ceo_decide refuses or publishing fails, say so; don't retry with a different decision.
End with: RESULT: {"proposal_id":"${p.proposal_id}","decision":"approve|reject","published":true|false,"url":"<or null>"}`;

export function registerDesignTools(server, ctx) {
  const v = () => createClient({ baseUrl: "https://api.vetta.sh", apiKey: ctx.vettaKey });
  const verdictOf = (id) => {
    const f = path.join(ctx.outDir, `${path.basename(String(id))}.json`);
    return fs.existsSync(f) && fs.existsSync(path.join(ctx.outDir, `${path.basename(String(id))}.png`)) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  };

  server.registerTool("next_design_style", {
    title: "This run's art style (rotation)",
    description: "Picks the art style for your next design, in code: never the same as the last design, preferring styles unused in the last 5 (photo box print, halftone photo, flash snapshot, tabloid front page, ransom-note collage, photocopy zine, bootleg rap-tee collage, woodcut, risograph 2-colour, patent drawing, medieval manuscript, 90s clip art, Y2K chrome, terminal line art). Write your generate_design prompt for this style; generate_design uses it automatically. You may override it only with a reason the joke demands.",
    inputSchema: {},
  }, async () => {
    const style = issueStyle(ctx.rootDir);
    const recent = loadStyleLedger(ctx.rootDir).history.slice(-5).map((h) => h.style);
    return txt({ style, label: STYLES[style].label, family: STYLES[style].family, how: STYLES[style].prompt, recent_styles: recent,
      note: "Photos are AI-generated scenes (never real photos): fictional people only, no real faces or names, no other brands' logos." });
  });

  server.registerTool("propose_design", {
    title: "Propose a passing design for the store (the CEO agent decides)",
    description: "After generate_design PASSED for an idea: proposes it as a new pre-order tee. Checked in code: the design exists and passed QA, isn't already proposed or on sale, title/slug/pitch/printed text have no real people, trademarks or tragedies, and at most 2 proposals a day. Then the CEO agent reviews it in its own session and approves or rejects. Returns proposal_id.",
    inputSchema: {
      design_id: z.string().regex(/^[0-9a-f]{12}$/),
      title: z.string().min(3).max(60).describe('short product name, e.g. "Merge conflict" (we add "tee")'),
      slug: z.string().min(3).max(60).describe("lowercase-dashes, unique, ends in -tee, e.g. merge-conflict-tee"),
      pitch: z.string().min(20).max(600).describe("1-3 sentences: what the shirt is and why it works"),
      trend_summary: z.string().min(20).max(600).describe("2-3 sentences: what people in SF/tech are saying and why it's shirt-worthy"),
      // lengths are generous here and clipped in code to the store's limits (label 120, feature line 80): a refusal over a long label wastes a run
      sources: z.array(z.object({ label: z.string().min(2).max(400), url: z.string().url() })).min(1).max(10).describe("the real post/thread URLs the trends or x_search tools returned (up to 6 are shown)"),
      print_line: z.string().max(300).optional().describe('what the print is, for the product page, in a few words, e.g. "terminal prompt over a line-art map"'),
    },
  }, async (a) => {
    try {
      const sc = stripeClient(ctx.rootDir);
      if (sc.error) return err(sc.error);
      const verdict = verdictOf(a.design_id);
      if (!verdict) return err(`refused: no design ${a.design_id} (use the id generate_design returned)`);
      if (!verdict.pass) return err(`refused: design ${a.design_id} did not pass QA (${(verdict.issues || []).join("; ")}); fix the prompt and generate again`);
      if (placementOf(verdict) !== "back") return err("refused: agent shirts are two-sided: the front is always the Hallucinated wordmark, so your design must be a BACK print (generate_design placement \"back\")");
      if (!SLUG_RE.test(a.slug)) return err("refused: slug must be lowercase letters, digits and single dashes");
      if (a.sources.some((s) => !/^https?:\/\//.test(s.url))) return err("refused: sources need http(s) URLs");
      const hits = checkProposal({ ...a, print_text: `${verdict.text_seen || ""} ${verdict.args?.text || ""}`, prompt: verdict.args?.prompt });
      if (hits.length) return err(`refused by the brand guardrails: ${hits.map((h) => `"${h.term}" (${h.list}) in ${h.field}`).join("; ")}. Original jokes only: no real people, no other companies' names or marks, nothing about tragedies.`);
      const l = loadProposals(ctx.rootDir);
      const today = proposalsToday(l, sc.mode);
      if (today.length >= MAX_PROPOSALS_PER_DAY()) return err(`refused: already ${today.length} proposals today (limit ${MAX_PROPOSALS_PER_DAY()}); keep the idea for tomorrow`);
      if (publishedDesign(l, sc.mode, a.design_id) || openProposal(l, sc.mode, a.design_id)) return err(`refused: design ${a.design_id} is already proposed or published`);
      if (slugTaken(l, sc.mode, a.slug)) return err(`refused: slug ${a.slug} is taken; pick another`);
      const onSale = [...await activeProducts(sc, "design_id", a.design_id), ...await activeProducts(sc, "slug", a.slug)];
      if (onSale.length) return err(`refused: ${onSale[0].metadata?.slug === a.slug ? `slug ${a.slug}` : `design ${a.design_id}`} is already on sale (${onSale[0].id}); pick another slug or design`);
      const proposal_id = newProposalId();
      const vv = v();
      const agents = (await vv.agents.list({ limit: 100 })).data || [];
      const productName = process.env.DESIGN_PRODUCT_AGENT || "hallucinated-product", ceoName = process.env.DESIGN_CEO_AGENT || "hallucinated-ceo";   // the sandbox e2e uses halltest-*
      const product = agents.find((x) => x.name === productName), ceo = agents.find((x) => x.name === ceoName);
      if (!ceo) return err(`no ${ceoName} agent; run setup_agents.mjs`);
      const productSession = product ? ((await vv.sessions.list({ agent_id: product.id, limit: 5 }).catch(() => ({ data: [] }))).data || []).find((s) => ["running", "idle", "queued"].includes(s.status))?.id || null : null;
      const st = styleOf({}, verdict);   // from the QA verdict, so it can't drift from what was generated
      const p = { proposal_id, mode: sc.mode, state: "pending", ...a, style: st.style, family: st.family, product_session: productSession, proposed_at: new Date().toISOString() };
      // Re-read and re-check right before writing, with no await in between: parallel propose_design calls (seen in the
      // first e2e) otherwise each save their own stale copy and one proposal is lost, and the daily cap can be overshot.
      const l2 = loadProposals(ctx.rootDir);
      const today2 = proposalsToday(l2, sc.mode);
      if (today2.length >= MAX_PROPOSALS_PER_DAY()) return err(`refused: already ${today2.length} proposals today (limit ${MAX_PROPOSALS_PER_DAY()}); keep the idea for tomorrow`);
      if (publishedDesign(l2, sc.mode, a.design_id) || openProposal(l2, sc.mode, a.design_id)) return err(`refused: design ${a.design_id} is already proposed or published`);
      if (slugTaken(l2, sc.mode, a.slug)) return err(`refused: slug ${a.slug} is taken; pick another`);
      l2.proposals[proposal_id] = p; saveProposals(ctx.rootDir, l2);
      let s;
      try { s = await vv.sessions.create({ agent_id: ceo.id, message: ceoBrief(p, verdict), budget_micro_usd: 600_000 }); }
      catch (e) { updateProposal(ctx.rootDir, proposal_id, { state: "abandoned", error: `CEO session failed: ${e.message}` }); throw e; }
      updateProposal(ctx.rootDir, proposal_id, { ceo_session: s.id });
      ctx.log?.(`[propose_design] ${proposal_id} ${a.slug} (${a.design_id}, ${sc.mode}) -> CEO session ${s.id}`);
      return txt({ proposal_id, state: "pending", ceo_session: s.id, mode: sc.mode, proposals_today: today2.length + 1, note: "The CEO agent decides in its own session; nothing more to do here." });
    } catch (e) { return err("propose_design failed: " + e.message); }
  });

  server.registerTool("ceo_decide", {
    title: "Approve or reject a proposed design (approve = it goes on sale as a pre-order)",
    description: "Your decision on a Product proposal, with the reason for the record (it's shown on the product page). approve: code re-checks the guardrails and limits (max 2 publishes a day, never the same design twice), then publishes it to the store as a pre-order and returns its URL. reject: nothing is published.",
    inputSchema: { proposal_id: z.string().regex(/^prop_[0-9a-f]+$/), decision: z.enum(["approve", "reject"]), reason: z.string().min(20).max(800) },
  }, async ({ proposal_id, decision, reason }) => {
    try {
      const sc = stripeClient(ctx.rootDir);
      if (sc.error) return err(sc.error);
      const l = loadProposals(ctx.rootDir), p = l.proposals[proposal_id];
      if (!p) return err(`no proposal ${proposal_id}`);
      if (p.state !== "pending") return err(`proposal ${proposal_id} is already ${p.state}`);
      if (p.mode !== sc.mode) return err(`proposal was made in ${p.mode} mode; the store tools are now ${sc.mode}`);
      const d = { decision, reason, at: new Date().toISOString() };
      if (decision === "reject") {
        updateProposal(ctx.rootDir, proposal_id, { state: "rejected", decision: d });
        ctx.log?.(`[ceo_decide] ${proposal_id} ${p.slug} REJECTED: ${reason.slice(0, 200)}`);
        return txt({ proposal_id, state: "rejected" });
      }
      const verdict = verdictOf(p.design_id);
      const hits = verdict ? checkProposal({ ...p, print_text: `${verdict.text_seen || ""} ${verdict.args?.text || ""}`, prompt: verdict.args?.prompt }) : [{ term: "design file missing" }];
      if (hits.length) { updateProposal(ctx.rootDir, proposal_id, { state: "rejected", decision: { ...d, overridden_by_code: hits } }); return err(`refused: guardrail hit (${hits.map((h) => h.term).join(", ")}); proposal rejected`); }
      if (publishedDesign(l, sc.mode, p.design_id)) { updateProposal(ctx.rootDir, proposal_id, { state: "rejected", decision: { ...d, overridden_by_code: "already published" } }); return err("refused: this design is already published"); }
      const today = publishesToday(l, sc.mode);
      if (today.length >= MAX_PUBLISHES_PER_DAY()) { updateProposal(ctx.rootDir, proposal_id, { decision: d }); return err(`refused: already ${today.length} designs published today (limit ${MAX_PUBLISHES_PER_DAY()}); it stays pending for tomorrow`); }
      const admin = storeAdmin(ctx.rootDir);
      if (admin.error) return err(admin.error);
      updateProposal(ctx.rootDir, proposal_id, { state: "publishing", decision: d });
      try {
        const pub = await publishDesign({ rootDir: ctx.rootDir, sc, admin, proposal: { ...p, decision: d }, outDir: ctx.outDir, log: ctx.log });
        updateProposal(ctx.rootDir, proposal_id, { state: "published", publish: pub });
        ctx.log?.(`[ceo_decide] ${proposal_id} ${p.slug} APPROVED and published (${pub.mode}) ${pub.url} product ${pub.product_id}`);
        // launch images (on-model photos, CONTENT.md §6): background job, never blocks or fails the publish
        const launch = kickLaunchImages(ctx, { ...p, decision: d }, pub);
        return txt({ proposal_id, state: "published", mode: pub.mode, url: pub.url, product_id: pub.product_id, dossier: pub.dossier, ...(launch ? { launch_images: "being made in the background (2-3 on-model photos, reviewed, then added to the product page)" } : {}) });
      } catch (e) {
        updateProposal(ctx.rootDir, proposal_id, { state: e.permanent ? "rejected" : "publish_failed", publish_error: e.message });
        flagJohn(ctx, { reason: "other", from_agent: "ceo (ceo_decide)", ref: proposal_id, summary: `Approved design ${p.slug} (${p.design_id}) didn't publish: ${e.message}` });
        return err(`approved, but publishing failed: ${e.message}. John was flagged.`);
      }
    } catch (e) { return err("ceo_decide failed: " + e.message); }
  });

  server.registerTool("store_new_designs", {
    title: "New agent designs to announce on X",
    description: "Designs the agents published to the store that we haven't announced on X yet, newest first: title, pitch, product URL. Announce each one ONCE with x_post, including its URL and announce_slug = its slug. Post about the shirt itself; never comment on the news or trend behind it.",
    inputSchema: {},
  }, async () => {
    const sc = stripeClient(ctx.rootDir);
    if (!announceable(sc.mode)) return txt({ mode: sc.mode, count: 0, designs: [], note: "store tools are on the Stripe sandbox: sandbox designs are never announced" });
    const list = newDesigns(ctx.rootDir, sc.mode);
    return txt({ mode: sc.mode, count: list.length, designs: list });
  });
}

// Published agent designs not yet announced on X (dry-run announcements tracked separately), newest first.
export function newDesigns(rootDir, mode) {
  if (!announceable(mode)) return [];
  const dry = process.env.X_DRY_RUN === "1";
  return Object.values(loadProposals(rootDir).proposals)
    .filter((p) => p.state === "published" && p.mode === mode && !(dry ? p.announced_dry : p.announced))
    .sort((a, b) => String(b.publish.published_at).localeCompare(a.publish.published_at))
    .map((p) => ({ slug: p.slug, title: p.title, pitch: p.pitch, url: p.publish.url, image: p.publish.mockup_url || null, status: "pre-order", price: `$${PRICE_CENTS / 100}`, published_at: p.publish.published_at }));
}

// Only designs on the LIVE store are announced on X (a sandbox product is invisible on production: a dead link).
const announceable = (mode) => mode === "live" || process.env.DESIGNS_ANNOUNCE_TEST === "1";
// For x_post: is this slug announceable, and mark it once posted.
export function announceCheck(rootDir, mode, slug, text) {
  if (!announceable(mode)) return { ok: false, why: "the store tools are on the Stripe sandbox; sandbox designs are never announced" };
  const p = Object.values(loadProposals(rootDir).proposals).find((x) => x.slug === slug && x.state === "published" && x.mode === mode);
  if (!p) return { ok: false, why: `no published design ${slug} in the store (${mode})` };
  if (process.env.X_DRY_RUN === "1" ? p.announced_dry : p.announced) return { ok: false, why: `${slug} was already announced (${(p.announced || p.announced_dry).post_id})` };
  if (!String(text).includes(`/p/${slug}`)) return { ok: false, why: `the post must include its product URL ${p.publish.url}` };
  return { ok: true, proposal_id: p.proposal_id };
}
export function markAnnounced(rootDir, proposal_id, post_id) {
  updateProposal(rootDir, proposal_id, { [process.env.X_DRY_RUN === "1" ? "announced_dry" : "announced"]: { post_id, at: new Date().toISOString() } });
}
