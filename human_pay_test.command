#!/bin/zsh -l
# TEST of the human-pay handoff (don't pay): reuses the approved design, Ops builds a 4-shirt order to checkout,
# asks for your OK in Naïve Studio, then brings the checkout to the front and waits 3 min, then gives up. Nothing is paid.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
pkill -9 -f "agents/order_run.mjs" 2>/dev/null; sleep 2; pkill -f ".pw-chrome-profile" 2>/dev/null
HANDOFF_TIMEOUT_MIN=3 node agents/order_run.mjs --human-pay --design 9ab8a02eaec1 --skip-ceo
echo; echo "Done. Log is in order-runs/. You can close this window."
