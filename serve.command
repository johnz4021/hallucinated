#!/bin/zsh -l
# Double-click at the start and LEAVE THIS WINDOW OPEN: keeps our tools (design, Customania, X, inbox, Stripe, trends,
# courier) online for the Naïve agents all hackathon, repoints the agents if the tunnel changes, clears Naïve's spurious
# holds on "allow" tools for scheduled runs (never on "ask" tools), and keeps the Mac awake. Close it to stop.
# Optional switches (prefix the node line, e.g. X_DRY_RUN=1 node agents/serve.mjs):
#   X_DRY_RUN=1            posting tools log what they'd post and return fake ids (nothing reaches X)
#   MAIL_DRY_RUN=1         inbox_reply / preorder_send_payment_link log instead of sending
#   HOLDS_STRICT_PUBLIC=1  leave Naïve's "read people's data" holds on posts/replies/customer email for John
#   SALES_MIN_QTY=3        shirts before the hourly Ops loop batches (or SALES_MAX_WAIT_H=24 hours since the oldest sale)
#   TRENDS_DAILY_BUDGET_USD=0.50, X_MAX_POSTS_PER_DAY=6, X_MIN_GAP_MIN=45, HANDOFF_TIMEOUT_MIN=15
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
pkill -f "agents/serve.mjs" 2>/dev/null; sleep 1
node agents/serve.mjs
