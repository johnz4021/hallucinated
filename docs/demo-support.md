# Support agent demo (inbox → Stripe → reply)

The Support agent (`hallucinated-support`) reads **hallucinated@agentmail.to**, looks up the sender's own orders in Stripe, and answers in brand voice with facts only. Money and complaints go to the founder.

## Before the demo

1. **Serve is running with the support tools.** After the lead's restart and `setup_agents`, the Support agent has `order_lookup` and `order_status` (allow) and `refund_request` (ask, never auto-approved).
2. **Send one demo email** from your own mail account to **hallucinated@agentmail.to**.
3. **Double-click `support_now.command`.** It fires the support deployment once, so the reply arrives in about a minute. Without it, the schedule (every 5 min, if enabled) picks the email up.
4. **Watch it:** Naïve Studio (the support session), `naive.log`, and `/hq` (Support column and timeline). If you use `refund_request`, Studio shows an approval card.

Privacy: `order_lookup` only ever uses the **sender address of the email being answered**. A customer can never see someone else's orders, even if they type another address into the email. Use only your own email for demos: the live store has real customers' orders and pre-orders.

## The 15:54 order

The live order at **15:54 PT** (git reset --hard tee, M, $65, `cs_live_a1Qumz45r9…`) was placed from a university (.edu) address, masked here.

- **If that address is yours,** send demo 1 from it (check the email on that order in the Stripe dashboard): the agent will find that order.
- **If it isn't yours,** send demo 1 from your own address. The agent will answer that it found no order under that address and ask you to write from the email you ordered with. That is also a fine demo of the privacy rule.

## Demo emails

### 1. "Where's my order?" (the showcase)
- **Subject:** `where's my order?`
- **Body:** `hey! ordered the git reset tee this afternoon, any idea when I can get it?`
- **Expected tool calls:**
  1. `inbox_list`
  2. `inbox_read`
  3. `order_lookup` (by the sender's address)
  4. `inbox_reply`
- **The reply:** what you ordered (item, size), when, where it is right now (paid → in production at our printer → ready for pickup → picked up), pickup or shipping, and the receipt link. No made-up dates.
- **/hq:** "Read a customer email (inbox_read), looked up their order in Stripe (order_lookup: 1 found), replied (inbox_reply)".

### 2. Sizing question
- **Subject:** `sizing?`
- **Body:** `how do your tees fit? I'm usually a medium in most brands`
- **Expected tool calls:** `inbox_read` → `store_link` → `inbox_reply`.
- **The reply:** the agent answers only from what the store says. If it doesn't know the fit, it says a human will follow up (`flag_john`, reason "unclear").

### 3. Cancel my pre-order
- **Setup:** first place a pre-order on the store with your own email (card saved, nothing charged).
- **Subject:** `cancel my pre-order`
- **Body:** `changed my mind on the hoodie pre-order, can you cancel it?`
- **Expected tool calls:**
  1. `inbox_read`
  2. `preorders_list` (your address)
  3. `preorder_cancel` (requester_email = sender)
  4. `inbox_reply`
- **The reply:** confirms the saved card was removed and nothing was charged.

### 4. Refund (needs your approval)
- **Setup:** use a **paid** order on your own email; if you have none, skip this one.
- **Subject:** `refund please`
- **Body:** `the tee came out great but I ordered the wrong size, can I get a refund?`
- **Expected tool calls:**
  1. `inbox_read`
  2. `order_lookup`
  3. `refund_request`: this **waits for your approval in Naïve Studio**; approve it in the demo.
  4. `inbox_reply` (confirmation: 5-10 business days)
- **/hq:** "Refund approved by founder ($…)".
- **If you decline:** the agent replies that a human will follow up and calls `flag_john`.
- **Note:** this is a real refund on a live order.

### 5. Complaint (→ flag the founder)
- **Subject:** `not happy`
- **Body:** `the print on my shirt is crooked and honestly I'm pretty annoyed`
- **Expected tool calls:**
  1. `inbox_read`
  2. `order_lookup` (to have the facts)
  3. `flag_john` (reason complaint): your Mac shows a notification, and the flag is written to `flags.jsonl`
  4. `inbox_reply`: a short, polite holding reply saying a human will follow up personally.
- **The reply:** no promises about refunds, remakes or dates.

## Switches
- **`MAIL_DRY_RUN=1`** (serve's env): `inbox_reply` logs the reply instead of sending it.
- **Kill:** pause the support deployment in Studio, or don't run `support_now.command`.
