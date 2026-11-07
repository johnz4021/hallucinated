#!/bin/zsh -l
# Double-click: Ops reads the paid store orders from Stripe and builds ONE Customania cart for them (drop #1 design + placement),
# verifies it, then STOPS before payment and closes it. Nothing is paid or marked. Output -> order-runs/<time>_sales-dry/
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/sales_run.mjs --dry
echo; echo "Done. You can close this window."
