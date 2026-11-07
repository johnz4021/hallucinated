# Hallucinated

An SF-tech-humor streetwear brand run by AI agents on the [Naïve](https://usenaive.ai) SDK, built for the Naïve Autonomous Company Hackathon (YC SF, Nov 7–8 2026).

**Clean product, unhinged marketing.** The agents decide what to make, design it, approve it, order it from a real print shop, market it on X and get it delivered. A human steps in to pay.

## The company
| Agent | Does |
|---|---|
| **Product** | Turns the AI/SF tech moment into shirt graphics with our design tool; loops on a vision QA check until the print file passes |
| **CEO** | Approves or rejects what ships, with reasons; owns the brand's X account |
| **Ops** | Places print orders on Customania in a real browser (uploads, places prints to the inch, sets sizes, verifies the cart), hands payment to a human, dispatches an Uber courier from John's phone |
| **Growth** | Posts and runs engagement on X through the X API, inside X's automation rules |

**First drop, ordered by the agents during the event:** black tee, "Hallucinated" across the chest, `> git reset --hard` over a line-art map of a made-up SF neighborhood on the back. Customania order CF5A93CRK.

## How it's built
- `design-mcp/` is our MCP server, reached by the Naïve agents through a Cloudflare tunnel (bearer token in a Naïve vault credential):
  - `generate.mjs`: GPT Image print files (transparent, 300 DPI, trimmed) + a vision QA verdict
  - `customania/`: Playwright automation of Customania's Design Lab (Konva editor) and Shopify checkout, plus the human-pay handoff
  - `x/`: X API v2 posting with OAuth 1.0a (text, images, video re-encoded to X's limits), search; X Ads (parked)
  - `courier/`: Uber Courier via MobileRun driving the Uber app on the founder's own iPhone
  - `agents/order_run.mjs`: creates the agents, runs Product → CEO → Ops, clears Naïve's approval holds on pre-approved tools, keeps the record
  - `agents/serve.mjs`: always-on tool server for the whole event
- Every agent decision is a Naïve session (visible in Naïve Studio); `order-runs/` keeps a local log.

## Built before vs during the event
- **Before (prep):** the design tool, the Customania automation, the X and courier tools, the launch scripts.
- **During:** the company's runs. Product designed drop #1, the CEO approved it, Ops placed and verified the order, the founder paid, plus everything the agents do afterwards.

## Running it
See `HANDOFF.md`. Short version: put the keys in `.env`, double-click `serve.command`, then `order_run_HUMANPAY.command`.

## Guardrails
Agents never spend money on their own: payments, courier bookings and ad spend all wait for the founder's approval in Naïve Studio. X activity stays within X's automation rules.
