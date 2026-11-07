# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Hallucinated: agent-run streetwear brand (Naïve hackathon, YC SF, Sat 7 → Sun 8 Nov 2026)

Read `HANDOFF.md` before changing anything: it has every launcher, flag, ID, gotcha and the subagent briefs.
Plan and decisions (the "why"): https://claude.ai/artifact/E2ZaBhbUs9qwTDbT54oNsA

## What this is
A streetwear brand on SF tech humor, run by Naïve agents (`@usenaive-sdk/vetta`). Clean product, unhinged marketing. Demo: show what the agents did and decided, and where a human stepped in.

## Status (Sat 13:05)
- **Drop #1 ordered end to end by agents during the event.** Product designed `bc1dbe9d9aae` (`> git reset --hard` over a line-art SF map), the CEO approved with reasons, Ops placed front + back on Customania and checked out 4 black tees (S/M/L/XL), John paid through the handoff: **order CF5A93CRK, $204.22**, pickup at Customania, 3251 20th Ave. Sessions: product `ses_h2jy2sam2jcmmcmt12zqd9zx7g`, ceo `ses_b4rztbp3drbhszjs3ednfwp784`, ops `ses_s1e299kvr9f6z3gm2aq6fzezdx`. Log: `../order-runs/2026-11-07T20-50-19_humanpay/` (in the archive folder; that run used the archive's launchers). HANDOFF's `9ab8a02eaec1` is the Friday-night test design, not drop #1.
- Working tools: design (`generate_design`), Customania order + human-pay handoff, X posting (`x_post`/`x_delete`, our X API keys; Naïve's own posting is refused by X), courier dispatch via MobileRun on John's iPhone (`courier_quote`/`courier_book`/`courier_status`), always-on server (`serve.command`).
- Research: Naïve `socialData` works for Reddit/Threads/TikTok/HN (~$0.001/call). Its X tools are listed but return 404. X search through our own keys **works** (Sat 13:11, 10 real posts): MCP tool `x_search` (read-only) for Growth's scout queue and for reading replies to our posts.
- Parked: X Ads (permission form pending), Naïve card issuing (not configured on the account), so **a human pays for everything**.

## Status (Sat 14:10)
- **Storefront live, Stripe TEST mode:** https://hallucinated-store.vercel.app (Vercel team `john-1006`, Hobby). Phase 1 = one-page drop-1 store, $65, S–XL, SF pickup (price and copy final per John). Stripe account is a **sandbox** (`acct_1UZH4h…`, "Hallucinated Goods sandbox"); key in `.env` as `STRIPE_SECRET_KEY`. The Stripe CLI is logged in to a *different* account; never rely on it.
- **Phase 2 storefront in progress (preview only):** catalog = Stripe Products/Prices (per-size Prices with metadata), banners/lookbook on Vercel Blob with an admin API, cart, AI lookbook imagery, **pre-orders** (Checkout setup mode: card saved, charged at launch by the agents' `charge_preorders`, ask). Contract: `store.json` (`order_shape`, `catalog_source`) and `storefront/CONTENT.md`. Production stays phase 1 until reviewed.
- **Agents built** (`design-mcp/agents/defs.mjs` is the single source of truth: every tool named per agent; unnamed tools would default to enabled+allow in Naïve). `setup_agents.mjs` is idempotent and creates the deployments **paused**: growth (every 3 h), support (15 min), ops-sales (hourly). Enable with `enable_schedules.command`. `serve.mjs` clears Naïve's spurious holds only for tools that are `allow` in defs AND the live config; `NEVER_AUTO` tools (handoff, courier_book, charge_preorders, x_post_scout, ads, cards) always wait for John.
- **Sales e2e passed up to payment (14:05):** 2 Stripe test orders → `sales_run.mjs --human-pay` → Ops batch lock → Customania cart verified (M1 L2, $153.16) → handoff card; denied on purpose, batch aborted, test orders still unbatched.
- Dry-run switches: `X_DRY_RUN=1`, `MAIL_DRY_RUN=1` (env on serve). `STRIPE_LIVE_OK=1` must be in serve's *process* env (not `.env`) for live Stripe keys.
- Unknown: whether the AgentMail key can send mail (never tested).

## Status (Sat 14:20): LIVE
- **Store live with real payments:** https://hallucinated-store.vercel.app = full phase-2 store, Stripe **live** on `acct_1UZH4b…` (Hallucinated Goods). Drop-1 tee buy-now; hoodie/cap/tote/bone tee as pre-orders (placeholder prices, John OK'd going live with them; Customania feasibility unchecked; nobody is charged until `charge_preorders`, ask). `.env` has both `STRIPE_SECRET_KEY` (sandbox, previews/e2e) and `STRIPE_LIVE_SECRET_KEY`; `STRIPE_LIVE_OK=1` (exported by serve/sales launchers) makes the agents use the live one. Vercel prod env: live key + `ALLOW_LIVE_STRIPE=1` + `STORE_ADMIN_SECRET`.
- **Growth loop live:** deployment `dep_xkzj…` enabled, every 3 h at :20 (08:20–23:20 PT). First live post 14:18: https://x.com/hallucinateddpt/status/2119192715997168049. Support and ops-sales deployments still **paused**.
- **X API limit:** replies/quotes only to posts that mention us or are ours (403 otherwise). So `x_post_scout` no longer posts: it queues drafts in `scout-queue.json` with an x.com intent link and John posts by hand (`scout_queue.command`). `x_reply` to people who mention us still works.

## Next
1. ~~Stripe live, then Growth live~~ done 14:20. Remaining: a real-card purchase check (John, refundable). John: activate payments on a real (non-sandbox) Stripe account, add `STRIPE_LIVE_SECRET_KEY` to `.env`, decide Vercel Pro and Stripe Tax. Lead: live key on Vercel prod only, run phase-1 `setup-stripe` from commit `111328a` (the working tree is phase 2), redeploy current prod (`vercel redeploy`, not a fresh deploy of the working tree), one real purchase check, `store.json` mode live, restart serve with `STRIPE_LIVE_OK=1`. Then enable the growth deployment and fire one run.
2. Review and promote phase-2 storefront; wire Growth/Product to publish banners via the content admin API.
3. Later (John): sales batching once a day: `ops-sales` cron `"40 * * * *"` → `"0 21 * * *"` in `defs.mjs` plus `SALES_MIN_QTY=1`.
4. Dropped for now (John, 14:07): order ledger + 7 pm courier pickup run. Parked code: session scratchpad `parked-pickup/` (not in repo). Customania automation stays as is.
5. Last, only if time: a dashboard. Naïve Studio already shows chats, tool calls and approvals.

## Repo layout
```
hallucinated/                  <- this repo (inside "Hallucinated Designs/", which is the pre-event archive)
  CLAUDE.md  README.md  HANDOFF.md  .gitignore  .env (local only)
  *.command                    launchers: double-click on the Mac (each cd's into design-mcp/ or scripts/)
  design-mcp/                  our MCP tool server + agents (Node; node_modules is local only)
    server.mjs generate.mjs brand.json refs/
    customania/  agents/  x/  courier/
  scripts/                     standalone Naïve scripts (X connect, post checks, ad tests); run via .naive-test/
  brand/                       logo print files
  design-test/  e2e/           local-only data the code reads (git-ignored): design files, the X-ready video
```
Runtime output (all git-ignored, created on first run): `naive.log`, `serve.log`, `order-runs/`, `customania-runs/`, `.serve.json`, `.pw-chrome-profile/` (fresh Chrome profile for Customania; first run may show a cookie banner).

## Commands
There is no build, lint or test suite. Plain Node ESM (`.mjs`), no TypeScript, no dotenv: each entry script regex-parses `../.env` itself. Every `*_test.mjs` hits real services (OpenAI, Naïve, X, Customania, MobileRun), so running one can cost money or post publicly. Read it before you run it.
```sh
cd design-mcp && npm install                              # once (playwright uses the installed Chrome)
cd design-mcp && node agents/serve.mjs                    # = serve.command: MCP server + tunnel, repoints agents
cd design-mcp && node agents/order_run.mjs --dry --design <id> --skip-ceo   # chain up to checkout, no payment
cd design-mcp && node x/x_search_test.mjs                 # single-tool test; pattern: <area>/<name>_test.mjs
```
Before running a `.command` launcher, read it: most `pkill` the old `serve.mjs`/`order_run.mjs`/Chrome-profile processes first. `order_run.mjs` flags are listed in HANDOFF.md. `scripts/*.mjs` don't run in place: their launchers copy them into `.naive-test/` (a throwaway npm package) and run them there.

**Git:** this folder is not its own git repo. `git rev-parse --show-toplevel` returns the home directory (`/Users/johnzhang`), so `git status`/`commit` here act on the whole home dir. Don't commit from here unless John runs `git init` in this folder first.

## Architecture (the parts that span files)
- **Tool server:** `design-mcp/server.mjs` `startServer({port, token, ctx})` serves stateless Streamable-HTTP MCP at `/mcp` (bearer auth), `/files` (= `ctx.outDir`, design PNGs), `/runs` (checkout screenshots) and `/health`. Tools are `generate_design` plus `register{Customania,X,Courier}Tools(server, ctx)` from each `<area>/tools.mjs`. A new tool area follows the same pattern: add `<area>/tools.mjs` and call it from `server.mjs`.
- **`ctx`** is built by the process that starts the server (`agents/serve.mjs`, or `agents/order_run.mjs` when serve isn't running): API keys, `identityId`, `rootDir`/`outDir`/`runsDir`, `log`, `billing` (from `agents/config.mjs`) and `baseUrl` (the current tunnel URL, used to build public file links). Tools get keys and paths from `ctx`, not from env.
- **Reachability:** a cloudflared quick tunnel. The URL changes on every start, so serve.mjs recreates the `hallucinated-mcp` Naïve vault (a `static_bearer` credential bound to the URL; Naïve forbids auth headers in `mcp_servers`), then repoints every `hallucinated-*` agent and writes `.serve.json`. `order_run.mjs` reads `.serve.json` to reuse the running server.
- **Agents** are defined in code in `agents/order_run.mjs`: system prompt, model, `mcp_servers`, and tool permissions via `withTool(t, "hallucinated.<tool>", {enabled, permission})`. It disables the image-returning built-ins on every agent, runs Product → CEO → Ops as Naïve sessions, clears Naïve's spurious approval holds on `allow` tools with `sessions.confirmTool` (never on `ask` tools), nudges stalled turns, and writes `order-runs/<run>/record.json`. New agents (Growth, support) should follow the same pattern.
- **Customania** (`customania/customania.mjs`): one Playwright session class per order (real Chrome, persistent `.pw-chrome-profile`). It drives the Konva editor inside iframe `#qsmziFrameCont` and then Shopify checkout. Open sessions and payment handoffs live in server memory, which is why the server must not restart mid-order.
- **Naïve SDK docs:** the best reference is the type defs at `design-mcp/node_modules/@usenaive-sdk/vetta/dist/index.d.ts`.

## How to work here
- Runs happen on this Mac. Double-click the `.command` launchers in the repo root. Logs: `naive.log`, `serve.log`, `order-runs/<run>/`.
- Start `serve.command` and leave it open for anything recurring. **Restart it after editing tool code**, but never during an order (it holds open Customania sessions and payment handoffs in memory).
- Naïve project = whatever `VETTA_API_KEY` points at (currently "Test Studio"). `wipe_agents.command` deletes all `hallucinated-*` agents; `order_run.mjs` recreates product/ceo/ops.
- New MCP tool → register it in `design-mcp/server.mjs`, then enable it per agent with `withTool(...)` (`allow`, or `ask` for anything that spends money or acts publicly on someone else's behalf).
- Keep every tool call under ~90 s (the Cloudflare quick tunnel cuts requests at ~100 s): long work = start-then-poll.
- Agents run on GLM-5.2, which is text-only: never give them tools that return images (`view_image`, `browser`, `web_fetch`).

## Hard rules
- **No spending without John's explicit OK.** Payments, courier bookings, ad activation and card issuing stay `ask` in Naïve and are never auto-approved by code. Card numbers never pass through an agent or chat.
- **Secrets stay in `.env`** (`VETTA_API_KEY`, `OPENAI_API_KEY`, `AGENTMAIL_API_KEY`, `X_*`, `MOBILERUN_API_KEY`). Never print, log or commit them. `.gitignore` also excludes the browser profile, checkout screenshots and run logs (they contain John's billing address and email).
- **X: API only, within X's automation rules.** No scripting x.com, no keyword-based auto-replies to people who didn't engage with us, no auto-likes, no bulk follows, no automatic posts about trending topics.
- Don't work around bot detection (no proxies or stealth tricks to get past a site's checks). The Uber cloud-phone route failed for that reason; the courier runs on John's own phone.
- Be honest in the demo: the tooling was built before the event (see README); the company's runs happened during it.
