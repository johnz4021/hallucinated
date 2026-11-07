#!/bin/zsh -l
# Debug: how the Customania quantity window takes sizes. Never adds to cart.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
pkill -f "agents/order_run.mjs" 2>/dev/null; lsof -ti tcp:8787 | xargs kill 2>/dev/null; sleep 2; pkill -f ".pw-chrome-profile" 2>/dev/null; sleep 1
node customania/qty_debug.mjs
echo; echo "Done. You can close this window."
