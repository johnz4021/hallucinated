# Hallucinated: handoff for Saturday (read this first)

> **Repo moved (Sat 13:10):** this file now lives in `Hallucinated Designs/hallucinated/`, the repo. The parent folder is the pre-event archive; its copies of the launchers still work but log separately. Don't run `serve.command` from both places at once. The root Naïve scripts are now in `scripts/`. `new_project.command` is obsolete (this subfolder is the fresh project).

State as of Sat 2026-11-07 ~01:00 PT. Plan doc (the "why", decisions, brand): https://claude.ai/artifact/E2ZaBhbUs9qwTDbT54oNsA
This file is the "how": what exists in this folder, how to run it, and what will bite you.

> **Sat 12:55: drop #1 ordered by the agents during the event.** Design `bc1dbe9d9aae`, CEO approved, Ops placed + verified the cart, John paid via the handoff: Customania order **CF5A93CRK**, $204.22 (S/M/L/XL black). Sessions: product `ses_h2jy2sam2jcmmcmt12zqd9zx7g`, ceo `ses_b4rztbp3drbhszjs3ednfwp784`, ops `ses_s1e299kvr9f6z3gm2aq6fzezdx`. Staying in the "Test Studio" Naïve project (no new project). Courier works on John's iPhone (dry run passed); `MOBILERUN_API_KEY` is in `.env`. Trends: Naïve socialData works for Reddit/Threads/TikTok/HN; its X tools 404; X search via our keys works (`x_search` tool, read-only). Start with `CLAUDE.md` for the short version.

## The event
- Naïve Autonomous Company Hackathon, YC SF, **Sat 12:00 → Sun 12:00**. Must use the Naïve SDK. Demo shows what the agents did, what they decided, where a human stepped in.
- Hallucinated = agent-run streetwear brand on SF tech humor. Clean product, unhinged marketing. Agents run on `zai-org/GLM-5.2-FP8` (text-only: **any tool that returns an image crashes the session**, so `view_image`, `browser`, `web_fetch` are disabled on our agents).

## What works (tested Fri night)
| Piece | Status |
|---|---|
| Design tool (`hallucinated.generate_design`, our MCP) | Works. GPT Image + vision QA, transparent 300 DPI PNG trimmed to the artwork. Light ink only, near-black knocked out |
| Product → CEO → Ops chain in Naïve (`agents/order_run.mjs`) | Works end to end through Customania checkout |
| Drop #1 design | **`9ab8a02eaec1`** = `> git reset --hard` over a line-art SF map (bone on black, eucalyptus pin). CEO approved. File: `design-test/9ab8a02eaec1.png` |
| Customania order via MCP tools (start/upload/place/checkout) | Works. Front wordmark 10 in wide 1.5 in down, back 11 in wide 1 in down, all within tolerance. Cart verified against the order |
| Human-pay handoff (`customania_handoff_payment` + `customania_payment_status`) | Built; first test showed the filled checkout correctly. Start-then-poll version needs one passing run (`human_pay_test.command`) |
| X posting | Naïve's `social.post` is refused by X for every post ("the network refused it"). **Our own route works**: `hallucinated.x_post` / `x_delete` (X API v2, OAuth 1.0a, keys in `.env`, token is read-write). Test post went live 02:08 Sat: https://x.com/i/status/2119009206720410012. Videos are re-encoded to X limits if ffmpeg is on the Mac (`brew install ffmpeg`) |
| Ads (Gemini 3 Pro Image, Kling 3.0 video) | Work via Naïve `generate_image`/`generate_video` |

## Hard facts learned
- **Naïve card issuing is not configured on this account**: `identities.cards.issue/quote` → `501 feature_not_configured`. So **a human pays** (John). If Naïve enables it: per-card max is **$150** (hard-coded `CARD_MAX_LOAD_MICRO_USD = 150e6` in the SDK), Shopify takes one card per order.
- **Customania pricing (Men's Premium Tee, black)**: front+back = **$47/shirt flat** (10 shirts dropped to $42.30 each). Back-only = $37/shirt. Print size doesn't change price. SF tax 8.625%. 4 shirts = $188 + $16.22 = **$204.22**.
- Customania said: order by **1 pm Saturday** → likely ready same day. Checkout page says "usually ready in 2–4 days", so **call them at 11:00** to confirm same-day pickup for an order placed ~12:15. Pickup: 3251 20th Ave, SF. Pickup name John Zhang.
- Dezign Lab (other supplier, ~$35/shirt pre-tax, email orders) wanted orders Fri/early Sat. Not used for drop #1.

## Bugs fixed that will come back if you rewrite things
1. **Customania qty window**: the editor opens on one size/color row that can never go below 1 (default Small/Black). Fix: `customania_start(base_size)` opens the product on a size the order includes, and `setQuantities` uses the editor's own `.btnQtyPlus/.btnQtyMinus` buttons (typed values are ignored for that row; raise before lowering). Checkout refuses if the cart's size breakdown ≠ the order.
2. **Cloudflare quick tunnel cuts requests at ~100 s (HTTP 524)**. Any MCP tool must return in < 90 s. Long waits = start-then-poll (see payment handoff).
3. **Naïve re-holds "allow" tools for approval** (2nd+ call of the same MCP tool, sometimes the same `tool_call_id` twice). `order_run.mjs` clears holds on our own `hallucinated.*` tools via `sessions.confirmTool` (and re-confirms after 15 s). `hallucinated.customania_handoff_payment` and `hallucinated.issue_card` are left for a human in Studio on purpose.
4. Naïve's built-in `card.issue` isn't offered to our agents (they `request_tools` it, then it only appears next turn). We use our own `hallucinated.issue_card` instead.
5. Agents sometimes end a turn without finishing → `order_run.mjs` nudges up to 2× with `sessions.send`.
6. Old runs held port 8787 → server now listens on port 0 (any free port); launchers `pkill -9` old runs and the tunnel.
7. Vision QA was failing designs for the dark preview background → prompt says the flat fill is the shirt stand-in.

## How to run (double-click the `.command` files on the Mac; each `cd`s into `design-mcp`)
| Launcher | Does |
|---|---|
| `serve.command` | **Start first and leave open all hackathon.** Always-on MCP server + tunnel; repoints every `hallucinated-*` agent at the current URL, reopens the tunnel if it drops, keeps the Mac awake (`caffeinate`), writes `.serve.json`. `order_run.mjs` reuses it when it's up (no second server). Note: tool settings like `HANDOFF_TIMEOUT_MIN` are read by this process, so set them here |
| `order_run_HUMANPAY.command` | **The real drop #1 order.** Product designs → CEO approves → Ops builds ONE order → you approve the handoff card in Naïve Studio → pay in the Chrome checkout that comes to the front. Add `--design 9ab8a02eaec1 --skip-ceo` (edit the file) to reuse the approved design |
| `human_pay_test.command` | Same, reusing the design, 3-min timeout. **Don't pay** |
| `order_run_dry.command` / `order_run_dry_reuse.command` | Chain, stops before payment |
| `order_run_LIVE.command` / `payment_test.command` | Card-paid path (needs Naïve card issuing) |
| `price_probe.command`, `qty_debug.command` | Debug tools; never add to cart |
| `design_test.command`, `e2e_post.command`, `check_post.command` | Design-agent test, CEO posts to X, check post status |

`order_run.mjs` flags: `--dry` | `--live` | `--human-pay`, `--design <id>`, `--skip-ceo`, `--sizes M:1,L:2`, `--one`, `--approve-cards`. Env: `HANDOFF_TIMEOUT_MIN` (default 15), `MAX_PER_ORDER`, `CARD_MAX_USD`, `ORDER_EMAIL`.
Order spec at the top of `order_run.mjs`: default sizes S1 M1 L1 XL1; contact `hallucinated@agentmail.to`, pickup name John Zhang; billing 1616 E 56th St, Chicago IL 60637.
Logs: `order-runs/<timestamp>_<mode>/run.log` + `record.json` (Naïve session ids), `naive.log` (everything), screenshots in `customania-runs/<cs_id>/`.

## Files
- `.env` — `VETTA_API_KEY` (Naïve, has billing scopes), `OPENAI_API_KEY`, `AGENTMAIL_API_KEY`. **Never print or commit.**
- `design-mcp/server.mjs` — MCP server (Streamable HTTP, stateless, bearer auth; `/files` = designs, `/runs` = screenshots).
- `design-mcp/generate.mjs` — `generate_design`. `brand.json` = palette, art style, banned list, QA checks, reference images (`refs/logo.png`, `refs/git-reset-back.png`).
- `design-mcp/customania/customania.mjs` — Playwright session class (real Chrome, persistent profile `.pw-chrome-profile`, Konva editor in iframe `#qsmziFrameCont`, design node = Group `name="group"`, print area = red-stroked Rect).
- `design-mcp/customania/tools.mjs` — MCP tools: `customania_start/upload/place/checkout/pay/handoff_payment/payment_status/close`, `issue_card`.
- `design-mcp/agents/order_run.mjs` — the orchestrator: starts MCP server + cloudflared tunnel, puts the bearer token in a Naïve vault `static_bearer` credential (Naïve forbids auth headers in `mcp_servers`), (re)creates agents `hallucinated-product/-ceo/-ops`, runs sessions, auto-clears holds, writes the record.
- Naïve SDK: `@usenaive-sdk/vetta` v0.11.0 (`createClient({baseUrl:"https://api.vetta.sh", apiKey})`); type defs in `design-mcp/node_modules/@usenaive-sdk/vetta/dist/index.d.ts` are the best docs. Identity: `idn_aw9sxgqbfm88tztm8djt6jy60h` (Hallucinated, holds the X account).


## Saturday build order
1. **11:00** call Customania (same-day pickup for ~12:15 order; can a courier collect under John's name?). Ask Naïve: enable card issuing? raise $150? why isn't `card.issue` offered?
2. **12:00** `serve.command` (leave open), then `order_run_HUMANPAY.command` (4 shirts, ~$204). John approves + pays. Pick up Sat evening.
3. **AgentMail support/ops agent**: `check_inbox` MCP tool on AgentMail (`AGENTMAIL_API_KEY`, inbox `hallucinated@agentmail.to`), polled every 10–15 min; confirms the order + "ready for pickup" emails, answers or flags customer mail.
4. **Optional, John to decide**: Stripe Payment Link + one-page Vercel storefront for preorders, link in Growth's posts (earlier plan said no public preorders; revenue is the strongest traction signal).
5. **Apify** trend scrapers (X/Reddit) feeding Product briefs and Growth's quote-post targets.
6. Growth on X via our `x_post` tool (also does replies and quote-posts). Give Growth `hallucinated.x_post` and turn off `social.post`. Never automate x.com in a browser. Kling videos are 1292×1604, over X's 1200-px portrait width; `x_post` re-encodes them (needs ffmpeg on the Mac: `brew install ffmpeg`, else uploads as-is).
7. Stretch: MobileRun books a courier when the pickup email arrives (only if Customania allows courier pickup).

## Parallel build after the order: two subagents
The main session runs the 12:00 order (and keeps `serve.command` up), then launches two subagents with the briefs below and reviews what they return. They share one contract: **the store's Stripe price ID + URL** (A → B) and **the order format** (B → A): `{ stripe_session_id, size, email, name, paid_at }`.

### Brief: Subagent A, storefront (Vercel + Stripe)
- **Design first:** load and follow the `frontend-design` skill before writing any UI (if it isn't installed, say so and follow its principles anyway). Commit to a deliberate aesthetic that matches the brand: minimal, natural palette from `brand.json` (bone, eucalyptus, forest, rust, sand), quiet clean product presentation, with the humor carried by the copy, not by visual noise. No generic template look.
- **Goal:** a one-page store for drop #1 (black tee, front wordmark, back `> git reset --hard` map, design `9ab8a02eaec1`), live on Vercel, real Stripe Checkout.
- **Build:** Next.js (App Router) or a static page plus one serverless function `POST /api/checkout` that creates a Stripe Checkout Session (mode `payment`, size S/M/L/XL as metadata or one price per size, collect email + name). Success and cancel pages. Brand: palette from `design-mcp/brand.json`, copy in the dry insider voice, a clear "this company is run by AI agents" line, link to https://x.com/hallucinateddpt. Images: `design-test/9ab8a02eaec1-preview.png` + the wordmark (`design-mcp/refs/logo.png`); no real people or brands.
- **Keys:** `STRIPE_SECRET_KEY` (and publishable key if needed) go in **Vercel env vars only**, never the repo. Build and test in **Stripe test mode**. Switch to live keys only after John says so.
- **Orders:** no webhook into the laptop (the tunnel URL changes). Agent B reads paid Checkout Sessions straight from the Stripe API. Optionally add a `checkout.session.completed` webhook to a Vercel function that only logs.
- **Done when:** the Vercel URL works on mobile, a test-mode purchase completes and appears in Stripe with size + email, and the price ID + URL are written to `store.json` in the project root.
- **John decides:** price (cost is ~$51/shirt with tax at Customania front+back), and fulfilment wording (pickup at the demo / shipped after the drop).

### Brief: Subagent B, agents (Naïve)
- **Context:** read this whole file first. Agents run on GLM-5.2 (text-only; no image-returning tools), our MCP tools must return in < 90 s, and Naïve re-holds "allow" tools (see `order_run.mjs` for how holds are cleared).
- **Always-on tools:** `serve.command` keeps the MCP server + tunnel up and repoints every `hallucinated-*` agent at it. Build on that; don't start extra servers.
- **Growth agent** (`hallucinated-growth`): `hallucinated.x_post` (allow), Naïve `generate_image`/`generate_video` for ads, `social.post` off (X refuses it). Posts on a schedule (Naïve cron/schedules — check `index.d.ts`) every 2–3 h, each post with the store link from `store.json`. Voice: dry, insider, unhinged-but-not-mean; brand rules in `brand.json`. Later: replies/quote-posts on trends (needs mentions/search; X API reads).
- **Growth on X, within X's automation rules** (scripting x.com, keyword-based auto-replies, auto-likes, bulk follows and automatic trend posts are all banned and get accounts suspended): (1) reply-bait posts ("reply with the worst commit message you've pushed; the agents put the best one on a shirt") and one automated reply per person who replies or mentions us (they opted in); (2) scheduled original posts; (3) a scout queue: Growth finds conversations via API search and drafts replies/quotes, John approves each one before it goes out.
- **X Ads: parked.** X hasn't granted ads permissions yet (an application form is pending), so the sign-in fails at X's approval page. The code is ready and off: `x_ads_tools` / `x_ads` / `x_ads_activate` only switch on once `x_ads_login.command` succeeds and writes `.x-ads-token.json`. Until then Growth can draft ad campaigns (copy, creative, targeting, budget) for John to launch by hand at ads.x.com. Don't build anything else for ads today.
- **Inbox agent** (`hallucinated-support`): new MCP tools `inbox_list` / `inbox_read` / `inbox_reply` on AgentMail (`AGENTMAIL_API_KEY`, inbox `hallucinated@agentmail.to`). Every 15 min: log Customania confirmations and "ready for pickup" mails, answer customer questions, flag anything about money or complaints to John.
- **Store → Ops loop:** MCP tool `stripe_orders(since)` reading paid Checkout Sessions (Stripe API, key in `.env` as `STRIPE_SECRET_KEY`). Ops batches paid orders into one Customania order via the existing tools and `customania_handoff_payment` (John pays). Never pays on its own.
- **Product trends:** Apify actor(s) for X/Reddit trends behind a `trends()` tool, feeding Product's next brief.
- **Order ledger + pickup run (priority: live by 6:45 pm Sat).** Tools `orders_list` / `orders_update` over a local `orders.json` (order_number, supplier, sizes, total, paid, ready_by, store_closes, status `paid|ready|courier_booked|delivered|picked_up_by_hand`, notes, courier task/price). Ops writes an entry after every paid order (`order_run.mjs` too). **Seed now:** `CF5A93CRK`, Customania, S/M/L/XL black, $204.22 paid, status paid. **Trigger = email:** the inbox agent (AgentMail, every 15 min) reads a pickup note (John relays Customania's phone confirmation from his Gmail: "CF5A93CRK ready, pick up by 7:30 pm, they close at 8"; a real Customania "ready for pickup" email counts the same), sets the order to `ready` with ready_by 7:30 pm / store_closes 8 pm, and hands off to Ops. Never fabricate supplier emails. **Pickup run:** at ~7:00 pm PT (book so the courier reaches the store before ready_by), Ops: `courier_quote` (Customania → YC, 560 20th St) → `courier_book` with max_price ≈ quote + $5 (**permission ask**: John approves) → `courier_status` until matched → update the ledger, tell John the ETA. **Backstop:** a Naïve schedule at 7:00 pm PT daily runs the same pickup run for any `ready` order. If no courier is matched by 7:20 pm, mark `picked_up_by_hand` pending and alert John (store closes 8). The iPhone must be connected to MobileRun at run time.
- **Courier: built.** MobileRun drives the Uber app on **John's own iPhone** ("Johnsiphone", connected via `mobilerun-ios`; keep it plugged into the Mac and connected). Dry run passed Sat 12:25: Uber Courier, pickup Customania 3251 20th Ave (meet at curb, John Zhang), dropoff Y Combinator 560 20th St, $18.37 standard / $13.66 flexible window, ~6 min to pickup, nothing booked. Tools on our server: `courier_quote` (dry run, allow), `courier_book(order_number, max_price_usd)` (real charge, Naïve "ask", never auto-approved), `courier_status(task_id)` (waits ≤60 s; phone tasks take 3–5 min). Needs `MOBILERUN_API_KEY` in `.env` (MobileRun dashboard → API Keys). Test: `courier_test.command` (quote only). Wire-up: when the inbox agent sees Customania's "ready for pickup" email, Ops quotes, then books with John's OK. The cloud-phone route failed (Uber's sign-in blocks cloud phones); don't use proxies to get around that.
- **Done when:** Growth posted twice on schedule with the store link, the inbox agent answered a test email, and a test-mode Stripe purchase showed up in Ops's batch.

## Rules
- Never complete a purchase or payment without John's explicit OK; card numbers never pass through an agent or the chat (server-side reveal only).
- Customania checkout uses the agent inbox + John's name/billing (approved by John).
- X stays API-only. Keep all secrets in `.env`.
