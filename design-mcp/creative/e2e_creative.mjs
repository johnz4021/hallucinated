process.on("unhandledRejection", (e) => { console.error(e); });
// Phase 4 end-to-end, isolated from John's live agents:
//   own MCP server + tunnel + vault ("halltest-mcp"); Stripe sandbox; ADS_TEST=1 (campaigns written with test:true,
//   test caps, the live Growth never sees these ads); X_DRY_RUN=1 (nothing reaches X); throwaway agents
//   halltest-ceo / -creative / -reviewer / -growth built from the real defs (Growth without x_post_scout).
//   1. CEO morning run -> plan   2. Creative: 2 image ads + 1 video ad, each passed by the vision reviewer
//   3. Growth run -> the ad pillar post (dry)   Assets are saved to order-runs/<time>_creative-e2e/assets/.
//   node creative/e2e_creative.mjs [--keep]       (refuses if STRIPE_LIVE_OK=1)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Tunnel, bin, install } from "cloudflared";
import { createClient } from "@usenaive-sdk/vetta";
import { startServer } from "../server.mjs";
import { agentDefs, scheduleDefs, defsByName, upsertAgent, pickModel, autoConfirmable } from "../agents/defs.mjs";
import { runSession, sleep } from "../agents/runtime.mjs";
import { BILLING } from "../agents/config.mjs";
import { envKey, readJson } from "../lib/state.mjs";
import { stripeClient } from "../stripe/tools.mjs";
import { loadAds, latestPlan } from "./ledger.mjs";

if (process.env.STRIPE_LIVE_OK === "1") { console.error("refused: run WITHOUT STRIPE_LIVE_OK"); process.exit(1); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, ".."), ROOT = path.resolve(MCP_DIR, "..");
if (stripeClient(ROOT).mode !== "test") { console.error("refused: not the Stripe sandbox"); process.exit(1); }
Object.assign(process.env, { ADS_TEST: "1", X_DRY_RUN: "1", MAIL_DRY_RUN: "1", X_MIN_GAP_MIN: "0", REVIEWER_AGENT: "halltest-reviewer", ADS_MAX_IMAGES_PER_DAY: "10", ADS_MAX_VIDEOS_PER_DAY: "5" });
const KEEP = process.argv.includes("--keep");
const RUN = path.join(ROOT, "order-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "_creative-e2e");
const ASSETS = path.join(RUN, "assets");
fs.mkdirSync(ASSETS, { recursive: true });
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(RUN, "run.log"), l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const record = { started: new Date().toISOString(), sessions: [] };
const save = () => fs.writeFileSync(path.join(RUN, "record.json"), JSON.stringify(record, null, 2));
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });

// ---- test server
const token = crypto.randomBytes(16).toString("hex");
const ctx = { openaiKey: envKey(ROOT, "OPENAI_API_KEY"), vettaKey: envKey(ROOT, "VETTA_API_KEY"), outDir: path.join(ROOT, "design-test"),
  runsDir: path.join(ROOT, "customania-runs"), rootDir: ROOT, mcpDir: MCP_DIR, log, billing: BILLING };
const server = await startServer({ port: 0, token, ctx });
if (!fs.existsSync(bin)) await install(bin);
const tunnel = Tunnel.quick(`http://localhost:${server.address().port}`);
const url = await new Promise((res, rej) => { tunnel.once("url", res); tunnel.once("error", rej); setTimeout(() => rej(new Error("tunnel timeout")), 60000); });
await new Promise((res) => { tunnel.once("connected", res); setTimeout(res, 15000); });
ctx.baseUrl = url;
for (const o of ((await v.vaults.list().catch(() => ({ data: [] }))).data || []).filter((x) => x.display_name === "halltest-mcp")) await v.vaults.delete(o.id).catch(() => {});
const vault = await v.vaults.create({ display_name: "halltest-mcp" });
await v.vaults.credentials.create(vault.id, { kind: "static_bearer", key: "hallucinated_mcp_token", value: token, mcp_server_url: url + "/mcp" });
await sleep(3000);

// ---- throwaway agents from the real defs
const real = agentDefs({});
const defs = {
  ceo: { ...real.ceo, name: "halltest-ceo" },
  creative: { ...real.creative, name: "halltest-creative" },
  reviewer: { ...real.reviewer, name: "halltest-reviewer" },
  growth: { ...real.growth, name: "halltest-growth", tools: Object.fromEntries(Object.entries(real.growth.tools).filter(([k]) => k !== "x_post_scout")) },
};
const byName = defsByName(defs);
const model = await pickModel(v);
const agents = {};
for (const [k, d] of Object.entries(defs)) {
  agents[k] = await upsertAgent(v, d, { model, mcpUrl: url + "/mcp", log });
  const on = Object.entries(agents[k].tools.configs).filter(([n, c]) => c.enabled !== false && (n.startsWith("hallucinated.") || d.builtins?.[n])).map(([n, c]) => `${n.replace("hallucinated.", "")}:${c.permission}`);
  log(`agent ${agents[k].name} (${agents[k].model}): ${on.join(" ")}`);
}
log(`== creative e2e on ${url} (sandbox, ADS_TEST, X dry run)`);

// background hold clearing for every halltest session (reviewer sessions are started by ad_review, not by us)
const ids = Object.fromEntries(Object.values(agents).map((a) => [a.id, a]));
const clearer = setInterval(async () => {
  const held = ((await v.sessions.list({ stop_reason: "awaiting_approval", limit: 50 }).catch(() => ({ data: [] }))).data || []).filter((s) => ids[s.agent_id]);
  for (const s of held) for (const a of (s.pending_actions || []).filter((x) => x.kind !== "question"))
    if (autoConfirmable(byName, ids[s.agent_id].name, a.name, ids[s.agent_id].tools))
      await v.sessions.confirmTool(s.id, { tool_call_id: a.tool_call_id, decision: "allow", scope: "session", reason: "test agent config: allow" }).catch(() => {});
}, 7000);

const tpl = (k) => scheduleDefs().find((s) => s.key === k).input_template;
const runAgent = async (label, k, message, budget, maxMin) => {
  const r = await runSession(v, { label, agent: agents[k], message, budget, byName, log, maxMin, onRecord: (x) => { record.sessions.push(x); save(); } }).catch((e) => ({ error: e.message }));
  Object.assign(record.sessions.at(-1) || {}, { status: r.status, result: r.result, text: r.text?.slice(-1500), error: r.error });
  save();
  return r;
};

// 1. CEO (--skip-ceo: reuse the latest plan)
if (!process.argv.includes("--skip-ceo")) await runAgent("ceo", "ceo", tpl("ceo"), 1_000_000, 12);
record.plan = latestPlan(ROOT); save();
log(`PLAN v${record.plan?.version}: ${JSON.stringify(record.plan?.plan)}`);

// 2. Creative: by default exactly 2 image ads and 1 video ad; --images N --video 0|1 for a focused pass
const nImg = Number((process.argv.join(" ").match(/--images (\d)/) || [])[1] ?? 2), wantVideo = !process.argv.includes("--video 0");
// phase 8: code picks the kind (video <-> image). Start the test pair on video by setting the test-mode last_kind to image.
if (wantVideo) { const { mutateAds, setLastKind } = await import("./ledger.mjs"); mutateAds(ROOT, (x) => setLastKind(x, "image")); }
const creativeMsg = `TEST RUN (sandbox; nothing goes public): make exactly ${wantVideo ? 1 + nImg : nImg} ads this run (call next_ad_format once per ad; it picks video first, then image).\n` + tpl("creative");
const t0 = new Date().toISOString();
await runAgent("creative", "creative", creativeMsg, 6_000_000, 45);

// 3. Growth (dry) - the ad pillar comes first now that ads are queued
const growthMsg = tpl("growth").split("\n").filter((l) => !/^3\. Scout queue/.test(l)).join("\n");
await runAgent("growth", "growth", growthMsg, 1_000_000, 12);
clearInterval(clearer);

// ---- collect: ads, reviews, assets, costs
const l = loadAds(ROOT);
const ads = Object.values(l.ads).filter((a) => a.test && a.created_at >= t0);
const reviews = Object.values(l.reviews).filter((r) => r.test && r.started_at >= t0);
for (const a of ads) {
  const ext = a.kind === "video" ? "mp4" : "png";
  try { fs.writeFileSync(path.join(ASSETS, `${a.id}.${ext}`), Buffer.from(await v.files.downloadBytes(a.naive_file_id))); } catch (e) { log(`save ${a.id}: ${e.message}`); }
}
for (const r of reviews) if (!ads.some((a) => a.naive_file_id === r.file_id)) {
  try { fs.writeFileSync(path.join(ASSETS, `rejected-${r.review_id}-${r.file_id}.${r.kind === "video" ? "mp4" : "png"}`), Buffer.from(await v.files.downloadBytes(r.file_id))); } catch {}
}
const xl = readJson(path.join(ROOT, "x-ledger.dry.json"), { posts: [] });
const growthPost = (xl.posts || []).filter((p) => p.kind === "post" && p.at >= t0).at(-1) || null;
// image prices are in generate_image's own output; sessions report their consumption
const cev = []; const cs = record.sessions.find((s) => s.label === "creative");
if (cs) for (let after; ;) { const p = await v.sessions.events(cs.session, { limit: 100, ...(after !== undefined ? { after_seq: after } : {}) }); cev.push(...p.data); if (p.data.length < 100) break; after = p.data.at(-1).seq; }
const imageCosts = cev.filter((e) => e.type === "tool.completed" && e.data?.name === "generate_image").map((e) => Number((String(e.data.output).match(/cost \$([0-9.]+)/) || [])[1] || 0));
for (const s of record.sessions) { const st = await v.sessions.get(s.session).catch(() => null); s.consumed_usd = st ? st.consumed_micro_usd / 1e6 : null; }
const reviewerUsd = reviews.reduce((n, r) => n + (r.cost_usd || 0), 0);
const videos = Object.values(l.videos).filter((x) => x.test && x.started_at >= t0);
record.summary = {
  plan: record.plan,
  ads: ads.map((a) => ({ id: a.id, kind: a.kind, concept: a.concept, caption: a.caption, event: a.event, sources: a.sources, featured_products: a.featured_products, media_url: a.media_url, poster_url: a.poster_url, campaign: a.campaign,
    review: (({ pass, hard_lines, failed_checks, quality, reasons }) => ({ pass, hard_lines, failed_checks, quality, reasons }))(l.reviews[a.review_id] || {}) })),
  reviews: reviews.map((r) => ({ review_id: r.review_id, kind: r.kind, file_id: r.file_id, pass: r.pass, hard_lines: r.hard_lines, failed_checks: r.failed_checks, reasons: r.reasons, cost_usd: r.cost_usd })),
  growth_post: growthPost,
  costs: { image_generations: imageCosts.length, images_usd: Number(imageCosts.reduce((a, b) => a + b, 0).toFixed(3)), videos: videos.map((x) => ({ model: x.model, cost_usd: x.cost_micro_usd != null ? x.cost_micro_usd / 1e6 : null })),
    reviewer_usd: Number(reviewerUsd.toFixed(3)), sessions_usd: Object.fromEntries(record.sessions.map((s) => [s.label, s.consumed_usd])) },
};
save();
log(`SUMMARY ${JSON.stringify(record.summary, null, 1)}`);

if (!KEEP) {
  for (const a of Object.values(agents)) await v.agents.delete(a.id).then(() => log(`deleted agent ${a.name}`)).catch((e) => log(`delete ${a.name}: ${e.message}`));
  await v.vaults.delete(vault.id).then(() => log("deleted vault halltest-mcp")).catch((e) => log("vault delete: " + e.message));
}
try { tunnel.stop(); } catch {} server.close();
log(`record: order-runs/${path.basename(RUN)}/record.json; assets in ${path.relative(ROOT, ASSETS)}/`);
log("== creative e2e done");
process.exit(0);
