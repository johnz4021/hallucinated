#!/bin/zsh -l
# Drop #1, fallback payment: Product designs -> CEO approves -> Ops builds ONE Customania order (S1 M2 L2 XL1 by default)
# and leaves the checkout open in Chrome with everything filled. YOU enter a card and press Pay; Ops records the order.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
pkill -9 -f "agents/order_run.mjs" 2>/dev/null; sleep 2; pkill -f ".pw-chrome-profile" 2>/dev/null
node agents/order_run.mjs --human-pay "$@"
echo; echo "Done. Log is in order-runs/. You can close this window."
