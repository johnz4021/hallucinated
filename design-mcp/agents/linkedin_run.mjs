process.on("unhandledRejection", (e) => { console.error(e); });
// One Growth session that writes a LinkedIn post for John's profile and submits it with linkedin_post, which waits
// for John's approval in Naïve Studio. Applies defs.mjs to the Growth agent first (so it has the LinkedIn tools).
//   node agents/linkedin_run.mjs ["extra angle for the post"]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
import { agentDefs, defsByName, upsertAgent, pickModel } from "./defs.mjs";
import { connectTools, runSession } from "./runtime.mjs";
import { BILLING } from "./config.mjs";
import { envKey } from "../lib/state.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, ".."), ROOT = path.resolve(MCP_DIR, "..");
const RUN = path.join(ROOT, "order-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "_linkedin");
fs.mkdirSync(RUN, { recursive: true });
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(RUN, "run.log"), l + "\n"); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: envKey(ROOT, "VETTA_API_KEY") });
const identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
const ctx = { openaiKey: envKey(ROOT, "OPENAI_API_KEY"), vettaKey: envKey(ROOT, "VETTA_API_KEY"), identityId: identity?.id, outDir: path.join(ROOT, "design-test"),
  runsDir: path.join(ROOT, "customania-runs"), rootDir: ROOT, mcpDir: MCP_DIR, log, billing: BILLING, cardName: `${BILLING.first} ${BILLING.last}` };
const conn = await connectTools(v, { ROOT, ctx, log });
const DEFS = agentDefs({});
const growth = await upsertAgent(v, DEFS.growth, { model: await pickModel(v), mcpUrl: conn.publicUrl + "/mcp", log });
const angle = process.argv.slice(2).join(" ");
const message = `One-off: write ONE LinkedIn post for John's personal profile and submit it with linkedin_post.
Think out loud briefly, for the record.
1. agents_log: get the true record of what the agents did since the hackathon started (Sat 1 pm). Use only facts from it, from store_link, and from these confirmed ones: drop #1 was ordered from Customania for $204.22 (John paid through the handoff); Ops booked an Uber Courier from John's phone to pick it up at 7:30 pm.
2. THE FRAME, unmistakable in the first two lines: John's AI agents have TAKEN OVER his LinkedIn for a hackathon (the Naïve hackathon at YC, SF) and are posting as him; he only approves. Write in the agents' own voice, first person PLURAL ("we"), never as John ("I"), e.g. "We are John's AI agents. We have taken over his LinkedIn for the hackathon." The whole post is about the takeover; after that opener use the format linkedin_images gives you (format, format_how: a fake press release, an influencer listicle, an org-chart memo, a performance review of John, a hiring post...), dry and funny: who did what (Product, CEO, Ops, Growth, Support, Creative), the best real failures (rejections, typos, anything absurd in the log), the store link hallucinated-store.vercel.app, and that it was built at the Naïve Autonomous Company Hackathon at YC. Say the models in product photos are AI-generated. Under 1,300 characters, short paragraphs, at most 2 hashtags.${angle ? `\nExtra angle from John: ${angle}` : ""}
3. linkedin_images, pick the single best image (the git-reset-hard-tee back shot if it's there), then linkedin_post with text, image, alt_text and format (from linkedin_images). It waits for John's approval in Naïve Studio; that's expected.
End with: RESULT: {"posted":true|false,"url":"<or null>","image":"<file or null>"}`;
try {
  const r = await runSession(v, { label: "growth", agent: growth, message, budget: 1_000_000, identity: identity?.id, byName: defsByName(DEFS), log, maxMin: 30 });
  log(`result: ${JSON.stringify(r.result) || r.text.slice(0, 300)}`);
} catch (e) { log("STOPPED: " + e.message); }
conn.stop();
process.exit(0);
