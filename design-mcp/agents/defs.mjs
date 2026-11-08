// One place that says what every Hallucinated agent is: prompt, tools, permissions, schedule.
// Used by setup_agents.mjs (all five agents + deployments), order_run.mjs and sales_run.mjs (product/ceo/ops),
// and serve.mjs (which held tool calls it may clear: only tools configured "allow" here AND live).
//
// Naïve's default for a tool an agent's config doesn't name is enabled + allow, so EVERY hallucinated.* tool is
// listed for every agent: granted ones on, all others off. Money / public-on-someone's-behalf tools are "ask".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTool } from "@usenaive-sdk/vetta";
import { CONTACT, DROPS } from "./config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.resolve(HERE, "..");
export const MCP = "hallucinated";
const BRAND = JSON.parse(fs.readFileSync(path.join(MCP_DIR, "brand.json"), "utf8"));

// Every tool our server can register (server.mjs + */tools.mjs). setup_agents also adds whatever the live server lists.
export const ALL_MCP_TOOLS = [
  "generate_design",
  "customania_start", "customania_upload", "customania_place", "customania_checkout", "customania_pay", "customania_handoff_payment", "customania_payment_status", "customania_close", "issue_card",
  "x_post", "x_mentions", "x_reply", "x_post_scout", "x_search", "x_delete", "store_link", "x_ads_tools", "x_ads", "x_ads_activate",
  "courier_quote", "courier_book", "courier_status",
  "inbox_list", "inbox_read", "inbox_reply", "inbox_mark_handled", "flag_john", "ops_courier_request",
  "stripe_orders", "sales_batch_start", "stripe_mark_batched", "sales_batch_abort",
  "trends",
  "preorders_list", "charge_preorders", "charge_preorders_status", "preorder_cancel", "preorder_send_payment_link",
  "propose_design", "ceo_decide", "store_new_designs", "growth_next_pillar", "agents_log",
  "get_plan", "set_plan", "store_stats", "x_stats", "store_catalog", "next_design_style", "next_ad_format", "ad_video_start", "ad_video_status", "ad_review", "ad_review_status", "ad_submit",
];
// Never confirmed by code, whatever an agent's config says: a human decides each call in Naïve Studio.
export const NEVER_AUTO = new Set(["customania_handoff_payment", "courier_book", "x_ads_activate", "issue_card", "charge_preorders"].map((n) => `${MCP}.${n}`));

// EVERY Naïve built-in and platform tool (SDK 0.11.0: BUILTIN_TOOLS + PLATFORM_TOOLS + TRADING_WRITE_TOOLS). Like unnamed
// hallucinated.* tools, an unnamed built-in defaults to enabled, and some park on an approval card nobody expects (Product's
// board_write sat as "WAITING FOR JOHN"). So all of them are OFF on every agent, except the ones an agent's def turns on in
// `builtins` (Creative's generate_image, the reviewer's view_image). A newer SDK may add names: re-extract this list then.
export const ALL_BUILTINS = [
  "bash", "read", "write", "edit", "ls", "find", "browser", "mobile", "read_skill", "publish_file", "web_search", "web_fetch",
  "generate_image", "generate_video", "clip_video", "build_media_skill", "list_as_template", "pay_out_earnings", "generate_3d_model",
  "build_3d", "create_character", "get_character", "list_characters", "update_character", "delete_character", "apps", "send_to_agent",
  "wait_for_agents", "list_agents", "post_to_channel", "board_read", "board_write", "ask_operator", "request_tools", "project_context",
  "transcribe_audio", "generate_speech", "generate_sound_effect", "generate_music", "find_files", "view_image", "fetch_file",
  "find_stock_photo", "data_search", "data_describe", "data_run", "session_spend", "show", "open_panel", "compose", "write_plan",
  "propose_plan", "email.inboxes", "email.read", "email.send", "phone.numbers", "phone.read", "phone.send", "crm.read", "crm.write",
  "social.accounts", "social.post", "social.status", "social.post_metrics", "connections.search", "connections.connect",
  "connections.status", "legal.verifications", "legal.verification", "legal.companies", "legal.company", "legal.documents", "legal.naics",
  "legal.verify", "legal.resend_link", "legal.form", "legal.submit", "wallet.balance", "wallet.transactions", "wallet.receipts",
  "wallet.quote", "wallet.pay", "wallet.transfer", "card.list", "card.show", "card.quote", "card.transactions", "card.spend", "card.issue",
  "card.credentials", "card.cancel", "company.set_timezone", "company.set_logo", "company.set_brand", "apps.request_access", "payments",
  "payments_request", "vault.request_secret", "operator.request", "trading.account", "trading.positions", "trading.orders",
  "trading.quote", "trading.place_order", "trading.cancel_order", "trading.close_position",
];
// Built-ins off on every agent. GLM-5.2 is text-only: anything returning an image crashes the session.
// social.post: X refuses Naïve's posting (we post through our own x_post). The rest spend money, act in public,
// or start a paid sandbox computer, and none of our agents need them.
export const DISABLED_BUILTINS = [
  "view_image", "browser", "web_fetch", "generate_image", "generate_video", "social.post",
  "bash", "read", "write", "edit", "ls", "find", "mobile", "data_run", "fetch_file",
  "card.issue", "card.spend", "card.credentials", "card.cancel", "wallet.pay", "wallet.transfer", "payments", "payments_request",
  "pay_out_earnings", "list_as_template", "email.send", "phone.send", "legal.submit", "legal.verify",
  "company.set_logo", "company.set_brand", "company.set_timezone", "build_media_skill", "create_character", "generate_3d_model", "build_3d",
];

const VOICE = "Hallucinated: an agent-run streetwear brand from SF tech culture. Clean product (minimal, natural palette), unhinged marketing. " +
  "You are one of the AI agents that run the company; a human founder (John) approves anything that spends money. Brand rules: " + JSON.stringify(BRAND);
// The design guardrails, word for word in Product's and the CEO's prompts (designs/guard.mjs also checks names, marks and tragedies in code).
const DESIGN_RULES = "Hard lines (John's; also checked in code): no slurs and no jokes that target a protected group (race, religion, gender, sexuality, disability, age, nationality); no real people's names, faces or look-alikes, only fictional archetypes; no other brands' logos or trademarks as the joke (generic \"the cloud\", \"git\", \"deploys\" are fine); never mock a real tragedy or its victims. Inside those lines, go as unhinged, edgy and dark as the joke needs: follow brand.json creative_direction. Never misspell or hint at a name to get around these rules.";
// Creative's media models (Naïve generate_image / generate_video built-ins); view_image stays off for GLM agents.
export const IMAGE_MODELS = ["google/gemini-3-pro-image", "openai/gpt-image-2", "black-forest-labs/flux.2-max"];
export const REVIEWER_MODEL = process.env.REVIEWER_MODEL || "google/gemini-3-flash-preview";   // probed: sees images via view_image, ~$0.015 per review
const NO_MONEY = "Never spend or promise money. Anything about money, refunds, complaints, legal or that you're unsure about goes to flag_john.";

export function agentDefs({ live = false, trendsAllow = false } = {}) {
  return {
    product: {
      name: "hallucinated-product",
      system: VOICE + "\nYou are Product. You turn what's dominating AI and SF tech right now into shirt graphics: Supreme-style, spontaneous, varied (photo prints, collages, tabloid pages, woodcuts, risograph, clip art, chrome, line art: next_design_style picks the style in rotation). Every shirt is two-sided: the front is always our Hallucinated wordmark, your design is the BACK. When it fits (not every time), riff on our name: confidently-wrong AI, seeing things that aren't there, made-up facts stated with total certainty. Every run starts with get_plan: lean into the CEO's themes. You research with the trends tool (Reddit, Threads, TikTok, Hacker News) and x_search (X, read-only), and write design briefs from what people actually joke about; you make print files with the hallucinated generate_design tool; you can't see images, the tool checks each result and returns pass/fail with issues, and you fix the prompt until it passes. Passing designs go to the CEO agent with propose_design; if approved they go on sale as pre-orders. " + DESIGN_RULES + " Trends are for designs only, never for posts. " + NO_MONEY,
      // trends: allow (John, Sat evening: spending runs without asking; the tool still refuses any call over $0.01)
      tools: { get_plan: "allow", next_design_style: "allow", generate_design: "allow", trends: "allow", x_search: "allow", propose_design: "allow", flag_john: "allow" },
    },
    ceo: {
      name: "hallucinated-ceo",
      system: VOICE + "\nYou are the CEO. You run the company: every morning you read the numbers (store_stats, x_stats, agents_log, store_catalog) and set the plan the other agents follow (set_plan: themes, products to push, ad seeds, retire suggestions that go to John). You approve or reject what ships, decisively, with a written reason. For new designs from Product you decide alone with ceo_decide: approving puts the shirt on sale as a pre-order, so hold every design to the brand's taste and to this checklist, and reject anything that fails it, saying which rule. " + DESIGN_RULES + " " + NO_MONEY,
      tools: { ceo_decide: "allow", get_plan: "allow", set_plan: "allow", store_stats: "allow", x_stats: "allow", agents_log: "allow", store_catalog: "allow", flag_john: "allow" },
    },
    ops: {
      name: "hallucinated-ops",
      identity: true,
      system: VOICE + `\nYou are Ops. You place print orders on Customania with the hallucinated customania_* tools, batch paid store orders from Stripe into one Customania order, and get finished orders couriered. You never guess: you read every tool result, retry placement until within_tolerance is true, check the cart lines match the order exactly, and never pay more than the checkout total. A human (John) pays: customania_handoff_payment and courier_book wait for his approval in Naïve Studio, which is expected. At a product launch you charge its pre-orders with charge_preorders (John approves the call; never more than the max he set); only charges that succeeded become sales to batch, and cards that failed get a payment link that Support emails. Checkout contact: email ${CONTACT.email}, name ${CONTACT.first} ${CONTACT.last}. ` + NO_MONEY,
      tools: {
        customania_start: "allow", customania_upload: "allow", customania_place: "allow", customania_checkout: "allow", customania_pay: live ? "allow" : "off",   // card-paid path only (--live); John pays through the handoff otherwise
        customania_payment_status: "allow", customania_close: "allow", customania_handoff_payment: "ask",
        courier_quote: "allow", courier_status: "allow", courier_book: "ask",
        issue_card: live ? "ask" : "off",   // Naïve card issuing (not configured on the account); a human approves each card
        stripe_orders: "allow", sales_batch_start: "allow", stripe_mark_batched: "allow", sales_batch_abort: "allow",
        preorders_list: "allow", charge_preorders: "ask", charge_preorders_status: "allow",   // charging saved cards: John approves every call
        flag_john: "allow",
      },
    },
    growth: {
      name: "hallucinated-growth",
      system: VOICE + "\nYou are Growth. You run the brand's X account (@hallucinateddpt) through the hallucinated x_* tools, inside X's automation rules (brand.json x_rules; the tools enforce them too): original posts with x_post, exactly one automated reply per person who replied to, mentioned or quoted us with x_reply, and replies or quotes to anyone else only as drafts through x_post_scout, which queues them for John to post by hand. Your voice is brand.json creative_direction: unhinged, edgy, dry; roast SF tech, the hype, the city and yourselves. You may post about current SF/tech moments (pass event:true; at most 3 a day, enforced), but never with hashtags (except #hallucinated), never into trending threads, and never about a real person or a real tragedy. Start every run with get_plan. Links only when growth_next_pillar says link_allowed; never invent a link. Never like, follow or DM. One joke per post. " + DESIGN_RULES + " " + NO_MONEY,
      tools: { get_plan: "allow", x_post: "allow", x_mentions: "allow", x_reply: "allow", x_search: "allow", x_post_scout: "allow", store_link: "allow", store_new_designs: "allow", growth_next_pillar: "allow", agents_log: "allow", flag_john: "allow" },
    },
    support: {
      name: "hallucinated-support",
      system: VOICE + `\nYou are Support. You own the brand inbox ${CONTACT.email} (AgentMail). You log Customania order mail, hand "ready for pickup" orders to Ops for a courier, and answer customers in the brand voice: short, kind, a little dry, never sarcastic at the customer. You only state facts you can see (the store page via store_link, preorders_list for a customer\'s pre-order, the email itself); you never promise dates, refunds, discounts or exchanges. Pre-orders: the card is saved at checkout and charged when the product launches; a customer may cancel an uncharged pre-order (preorder_cancel, then confirm by inbox_reply); anything already charged is a refund and goes to flag_john. ` + NO_MONEY,
      tools: { inbox_list: "allow", inbox_read: "allow", inbox_reply: "allow", inbox_mark_handled: "allow", flag_john: "allow", ops_courier_request: "allow", store_link: "allow",
        preorders_list: "allow", preorder_cancel: "allow", preorder_send_payment_link: "allow" },
    },
    creative: {
      name: "hallucinated-creative",
      system: VOICE + "\nYou are Creative. You make the ads: image ads (and at most one video a day) that roast the SF tech zeitgeist in the brand's voice (brand.json creative_direction). Start every run with get_plan and follow its themes, push_products and ad_seeds. You may react to current SF/tech events (then the ad is an event ad with real sources). You make images with generate_image (reference images via image_urls: our logo and the featured product's images from store_catalog, so the product is exact); you can't see images, so a vision reviewer judges every asset with ad_review, and only an asset that passes can be published with ad_submit. Fix exactly what the reviewer says. " + DESIGN_RULES + " " + NO_MONEY,
      tools: { get_plan: "allow", next_ad_format: "allow", trends: "allow", x_search: "allow", store_catalog: "allow", ad_video_start: "allow", ad_video_status: "allow", ad_review: "allow", ad_review_status: "allow", ad_submit: "allow", flag_john: "allow" },
      // GLM-5.2 is text-only, but generate_image returns only a file id (verified in ad_test: no crash). generate_video stays
      // off: video goes through ad_video_start so the 1-a-day cap is enforced in code.
      builtins: { generate_image: { enabled: true, permission: "allow", config: { models: IMAGE_MODELS } } },
    },
    reviewer: {
      name: "hallucinated-reviewer",
      model: REVIEWER_MODEL,
      system: "You are the ad reviewer for Hallucinated, an agent-run SF streetwear brand whose comedy is deliberately edgy and dark. You look at every image with view_image and judge only facts: is our product, logo and print accurate against the references; is every word spelled right and legible; and does it cross a hard line (a real or famous person's face or name; another brand's logo; a slur or a joke aimed at a protected group; mocking a real tragedy or its victims). Fictional AI-generated people are fine. Dark humor is fine. You are strict, specific and brief. Hard lines: " + JSON.stringify(BRAND.hard_lines),
      tools: {},
      builtins: { view_image: { enabled: true, permission: "allow" } },
    },
  };
}

// The Naïve deployments (agent on a cron). Created paused; setup_agents --enable-schedules turns them on.
// One Growth run (both Growth deployments). The pillar is decided by growth_next_pillar in code, not by memory.
const GROWTH_RUN =
`Scheduled Growth run.
0. get_plan: today's themes and products to push from the CEO. Let them steer your jokes.
1. x_mentions. For each post with engaged=true and already_replied=false (at most 10 this run), send ONE x_reply in brand voice: short, warm, specific to what they said. Skip spam, bots and hostile posts. If someone complains or asks about money, refunds or an order problem, don't argue in public: flag_john (reason complaint/money, ref = the post URL) and reply only "sorry about that, a human is on it. email ${CONTACT.email}".
2. growth_next_pillar. It picks this run's ONE original post and gives you the material, link_allowed, and your recent posts (don't repeat them). Then write that post and send it with x_post, passing pillar exactly as given:
   - new_design: announce the shirt. Text about the shirt itself (what's printed on it; a pre-order; designed by our Product agent, approved by our CEO agent), with its product URL; media = material.media; announce_slug = material.announce_slug. Never comment on the news or trend behind it.
   - ad: post the Creative agent's ad: x_post with ad_id = material.ad.ad_id (its image or video is attached automatically) and the ad's caption, or a sharper line in the same spirit. If it's an event ad (material.ad.event), it counts toward the 3 event posts a day.
   - agents_log: true behind-the-scenes from material.events only: the CEO's plan, what Product proposed, what the CEO approved or rejected and WHY, what the reviewer rejected and why, ads made, what got published (rejections and their reasons are great material). Never invent a decision, a reason or a quote; paraphrase what's there.
   - spotlight: one product from material.product: what it is, in brand voice; media = material.media if there is one; its URL only if link_allowed.
   - reply_bait: a prompt that invites replies (e.g. "reply with the worst commit message you've ever pushed"). People who reply get our one automated reply later.
   - joke: an original joke in the creative_direction: roast SF tech life (the hype, the decks, Waymos, $9 toast, RTO, demo day, the agents, us). It may react to a current SF/tech moment: then pass event:true (at most 3 event posts a day; the tool counts). Never a real person, never a real tragedy, no hashtags.
   Put the store link (store_url) in only if link_allowed is true; new_design always carries its product URL. If x_post refuses (daily limit, too soon, duplicate, link rule), fix only what it says (e.g. drop the link) or accept it; don't rephrase to get around a limit.
3. Scout queue: run up to 2 x_search queries for conversations where SF tech / AI-agent people joke about their work (e.g. '"vibe coding" -is:retweet lang:en', '"AI agents" (shipped OR deploy) -is:retweet lang:en'). Pick at most 2 posts where a reply from us would genuinely add a laugh, and draft them with x_post_scout (mode reply or quote, with a one-line why). They go to John's scout queue and he posts the ones he likes by hand (X's API won't let us reply to people who didn't mention us). Never reply to strangers any other way.
End with: RESULT: {"replies":<n>,"pillar":"<pillar>","posted":"<post id or none>","announced":"<slug or none>","scout_drafts":<n>}`;

export const TIMEZONE = "America/Los_Angeles";
export function scheduleDefs() {
  const d1 = DROPS["drop-1"];
  return [
    // Growth every 1.5 h, 08:20-23:20 PT: cron can't say "90 min", so two deployments interleave (8:20, 9:50, 11:20, ... 23:20)
    { key: "growth", agent: "growth", cron: "20 8-23/3 * * *", budget_micro_usd: 1_500_000, label: "Growth A: replies + 1 rotated post + scout (08:20, 11:20, ... 23:20)", input_template: GROWTH_RUN },
    { key: "growth-b", agent: "growth", cron: "50 9-23/3 * * *", budget_micro_usd: 1_500_000, label: "Growth B: same run, interleaved (09:50, 12:50, ... 21:50)", input_template: GROWTH_RUN },
    { key: "ceo", agent: "ceo", cron: "0 9 * * *", budget_micro_usd: 1_000_000, label: "CEO: morning numbers -> today's plan, 09:00",
      input_template:
`Morning run. You set today's plan for Product, Creative and Growth.
1. Read: get_plan (yesterday's), store_stats (last 7 days), x_stats (our last ~30 posts), agents_log (since yesterday), store_catalog.
2. Decide, in 3-6 sentences for the record: what's selling, which posts worked and why, what to lean into, what to stop.
3. set_plan with: themes (2-5 things to roast today, per brand.json creative_direction; current SF/tech moments are fair game, real people and real tragedies never), push_products (slugs from store_catalog), ad_seeds (2-4 concrete ad ideas for Creative: the joke, the visual, the product if any), retire_suggestions (only if a product clearly isn't working; John decides), notes.
End with: RESULT: {"plan_version":<n>,"themes":<n>,"push_products":[...],"retire_suggestions":<n>}` },
    { key: "creative", agent: "creative", cron: "30 11,15,19 * * *", budget_micro_usd: 3_000_000, label: "Creative: 1-2 ads per run (11:30, 15:30, 19:30)",
      input_template:
`Scheduled ad run. Make 1 or 2 ads that are actually funny to SF tech people today.
1. get_plan (themes, push_products, ad_seeds). store_catalog (products, their images, and brand_refs). trends and x_search once or twice each for what SF/tech is laughing or groaning about right now (current events are allowed).
2. For each of your 1-2 concepts call next_ad_format first: it picks the format (fake billboard, tabloid cover, museum placard, infomercial still, nature-doc still, catalog page, wanted poster, ...) and a visual style, in rotation, so the ads don't all look like terminal screenshots. Build the concept for that format and style (brand.json creative_direction). Write each concept in 2-3 sentences for the record: the joke, the visual, why now. If it reacts to a specific event, note its real source URLs.
3. For each concept: generate_image (model google/gemini-3-pro-image or openai/gpt-image-2; aspect 4:5 or 1:1). If a product is featured, pass image_urls with brand_refs.logo and that product's image so the shirt and print are exact. Keep any text in the image to at most 2 short lines and spelled out exactly (image models duplicate or garble longer text). Fictional people only, no real faces, no other brands' logos.
4. ad_review on each image (kind image, the concept, your caption, featured_slug if any, and text_in_image = the exact words you asked for), then ad_review_status until it's done. If it fails, fix exactly what the reviewer says and make a new image (at most 3 tries per concept).
5. Optional, at most one per day (the tool enforces it): a video ad. Video models garble text in motion, so animate a passing image with little or no text (a visual joke: the caption carries the words), and say in the motion prompt "keep every logo and letter exactly as in the image". ad_video_start (Kling), poll ad_video_status, then ad_review it as kind video.
6. ad_submit each PASSING asset with its format (from next_ad_format), concept, caption (dry, sharp, under 200 characters, no hashtags except #hallucinated), event true/false with sources, and featured_products. If a cap refuses it, stop.
End with: RESULT: {"concepts":<n>,"images":<n>,"videos":<n>,"submitted":["<ad_id>",...],"rejected_by_reviewer":<n>}` },
    { key: "product", agent: "product", cron: "0 10,16 * * *", budget_micro_usd: 2_000_000, label: "Product: trends -> 1-2 designs -> propose to the CEO, 10:00 and 16:00",
      input_template:
`Scheduled design run. Make 1 or 2 new back-print tees that SF tech people would find funny right now, and propose them. Start with get_plan and lean into its themes.
1. Research (read what people actually joke about; you can't post anything):
   - trends 2 or 3 times with different queries about SF / AI / startup life right now (e.g. "AI agents", "vibe coding", "san francisco startup"), platforms ["reddit","hn","threads","tiktok"];
   - x_search once or twice (e.g. '"AI agents" -is:retweet lang:en').
2. Pick 1-2 ideas. ${DESIGN_RULES} When it fits, riff on our name (confidently-wrong AI, hallucinated facts), not every time. Photos are AI-generated scenes, never real photos: fictional people, generic objects and SF scenes (an unbranded robotaxi, a server rack on fire, $9 toast) are fine. Keep any printed text short: at most 5 words per line, 1-2 lines, plain ASCII (no em-dashes, no fancy quotes): image models garble long text and every garbled letter fails QA.
3. For each idea: next_design_style (the rotation's art style for this design), then write the brief for the record (2-3 sentences: the joke, the print in that style, why now and for whom). Then generate_design with placement "back", the exact text, and a prompt written for that style (leave style out: it uses the rotation's pick; override only if the joke truly needs another style, with style_reason). Use references ["git-reset-back"] only for the terminal/line-art style. If it fails QA, fix exactly the issues it lists and try again: at most 3 attempts per idea, then drop the idea.
4. For each passing design: propose_design with the design_id, a short title, a slug ending in -tee, the pitch, the trend summary and 1-6 sources (the real post/thread URLs the tools returned; never invent a URL), and print_line. If it's refused (guardrails, daily limit, slug taken), accept it: change the slug if it was taken, otherwise drop the idea. Never reword a name to dodge the check.
The CEO agent decides each proposal in its own session; you don't wait for it.
End with: RESULT: {"ideas":<n>,"attempts":<n>,"proposed":["<proposal_id>",...],"dropped":"<why, or none>"}` },
    { key: "support", agent: "support", cron: "*/15 * * * *", budget_micro_usd: 600_000, label: "Support: inbox every 15 min",
      input_template:
`Scheduled inbox run. Call inbox_list. If it is empty, end right away with RESULT: {"handled":0}.
For each message, by its kind:
- customania_confirmation: inbox_mark_handled with its order_number (this logs the order event).
- ready_for_pickup: inbox_mark_handled with its order_number, then ops_courier_request with that order_number and the message_id (Ops quotes a courier; John approves any booking).
- customer: inbox_read it. If it's about money, payments, refunds, chargebacks, a complaint, legal, press, or anything you're unsure about: flag_john (summary: who, what they want, what you replied), then inbox_reply briefly that a human from the team will follow up within a day. Otherwise answer it with inbox_reply in brand voice using only facts you can see (store_link for the store URL); never promise dates, refunds, discounts or exchanges.
  Pre-order questions: preorders_list with their email (the sender's address) and answer from what it shows. A pre-order cancellation request: preorder_cancel with the preorder_session and requester_email = the sender's address, then inbox_reply confirming the card was removed and nothing was charged. If preorder_cancel refuses because something was charged, flag_john (reason refund) and reply that a human will follow up.
- customania_other, automated, self: inbox_mark_handled (no reply). If a customania_other mail sounds like a problem with an order, flag_john first.
Then call preorders_list once: for each entry in payment_links_to_send, preorder_send_payment_link with a short, kind note (their saved card didn't go through at launch; this link keeps their pre-order).
End with: RESULT: {"handled":<n>,"replied":<n>,"flagged":<n>,"courier_requests":<n>,"payment_links_sent":<n>}` },
    { key: "ops-sales", agent: "ops", cron: "40 * * * *", budget_micro_usd: 3_000_000, label: "Ops: batch paid store orders into one Customania order, hourly",
      input_template:
`Scheduled sales run. Call stripe_orders.
Sales in needs_john are products Customania can't make for us (or bad sizes); code already flagged them to John. Never order, guess or substitute for those.
Charged pre-orders show up here as sales too (source "preorder"); only charged ones are ever batched.
If ready_to_batch is false, stop right away and end with RESULT: {"batched":false,"reason":"<its reason>"} (no Customania session, nothing else).
If it is true:
1. sales_batch_start with session_ids = batchable.session_ids (exactly those). Use the sizes and print_spec it returns, exactly.
2. customania_start with base_size = the first size in those sizes.
3. FRONT: customania_upload side "front", design = print_spec.front.design (the Hallucinated wordmark, "${d1.front.design}"); customania_place side "front" width_in print_spec.front.width_in top_in print_spec.front.top_in (${d1.front.width_in} / ${d1.front.top_in} for every shirt). Retry place until within_tolerance is true.
4. BACK: customania_upload side "back", design = print_spec.design_id (drop #1 or the agent design in this batch); customania_place side "back" width_in print_spec.back.width_in top_in print_spec.back.top_in. Retry until within_tolerance.
5. customania_checkout with those sizes, email "${CONTACT.email}", first_name "${CONTACT.first}", last_name "${CONTACT.last}". The cart must match the sizes exactly; if not: sales_batch_abort, customania_close, flag_john, stop.
6. customania_handoff_payment with amount_due = the checkout total. It waits for John's approval; that's expected. Then customania_payment_status again and again until state is "paid" or "timed_out". Don't close while it says waiting.
7. If paid: stripe_mark_batched with the same session_ids, the batch_ref and customania_order = the order number. If not paid: sales_batch_abort with the reason and flag_john.
8. customania_close.
End with: RESULT: {"batched":true|false,"batch_ref":"<or null>","sizes":{...},"total":"<or null>","paid":true|false,"order_number":"<or null>","issues":"<or none>"}` },
  ];
}

// Apply a def's tools on top of an agent's current tool config.
export function applyTools(tools, def, allMcp = ALL_MCP_TOOLS) {
  let t = tools;
  for (const n of new Set([...ALL_BUILTINS, ...DISABLED_BUILTINS])) if (!def.builtins?.[n]) { try { t = withTool(t, n, { enabled: false }); } catch {} }
  for (const [n, cfg] of Object.entries(def.builtins || {})) t = withTool(t, n, cfg);   // e.g. Creative's generate_image, the reviewer's view_image
  for (const n of new Set([...ALL_MCP_TOOLS, ...allMcp])) {
    const p = def.tools[n];
    t = withTool(t, `${MCP}.${n}`, p && p !== "off" ? { enabled: true, permission: p } : { enabled: false, permission: NEVER_AUTO.has(`${MCP}.${n}`) ? "ask" : "allow" });
  }
  return t;
}

// May code confirm a held call? Only if defs say allow, the live agent config says allow and it isn't a human-only tool.
export function autoConfirmable(defsByName, agentName, toolName, liveTools) {
  if (NEVER_AUTO.has(toolName)) return false;
  const def = defsByName[agentName];
  if (!def) return false;
  const live = liveTools?.configs?.[toolName];
  // a built-in this agent was given on purpose (Creative's generate_image, the reviewer's view_image)
  if (!toolName.startsWith(MCP + ".")) return def.builtins?.[toolName]?.permission === "allow" && live?.enabled !== false && live?.permission === "allow";
  const short = toolName.slice(MCP.length + 1);
  return def.tools[short] === "allow" && live?.enabled !== false && live?.permission === "allow";
}
export const defsByName = (defs) => Object.fromEntries(Object.values(defs).map((d) => [d.name, d]));

// Model: same preference order order_run.mjs has always used (GLM-5.2 is what the account has).
export async function pickModel(v) {
  const models = await v.models.list();
  const chat = (models.data || []).map((m) => m.id).filter((m) => !/:batch$/.test(m));
  return [/claude.*(sonnet|opus)/i, /gpt-5(?!-nano)/i, /GLM-5\.2/i].map((r) => chat.find((m) => r.test(m))).find(Boolean) || chat[0];
}

// Create or update one agent by name (updating keeps its Studio history), then set its tools.
export async function upsertAgent(v, def, { model, mcpUrl, allMcp, log = () => {} }) {
  const list = await v.agents.list({ limit: 100 });
  const same = (list.data || []).filter((a) => a.name === def.name);
  const cfg = { name: def.name, model: def.model || model, window: "immediate", system: def.system, ...(mcpUrl ? { mcp_servers: [{ name: MCP, url: mcpUrl }] } : {}),
    budget: { cap_micro_usd: 20_000_000, max_task_micro_usd: 10_000_000, period: "month" } };
  let a = same[0] ? await v.agents.update(same[0].id, cfg).catch((e) => { log(`update ${def.name} failed (${e.message}); creating`); return null; }) : null;
  if (!a) a = await v.agents.create(cfg);
  a = await v.agents.update(a.id, { tools: applyTools(a.tools, def, allMcp) });
  return a;
}

// agent -> tool -> permission, for the setup printout.
export function toolTable(defs) {
  const rows = [];
  for (const d of Object.values(defs)) {
    for (const [n, p] of Object.entries(d.tools)) rows.push({ agent: d.name, tool: `${MCP}.${n}`, permission: p, human_only: NEVER_AUTO.has(`${MCP}.${n}`) });
    for (const [n, c] of Object.entries(d.builtins || {})) rows.push({ agent: d.name, tool: `${n} (built-in)`, permission: c.permission, human_only: false });
  }
  return rows;
}
