#!/bin/zsh -l
# Double-click: the whole drop #1 chain in Naïve (Product designs -> CEO approves -> Ops builds the Customania order).
# DRY: Ops fills the test card if there is one, then STOPS before Pay. Nothing is bought.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
pkill -f ".pw-chrome-profile" 2>/dev/null
node agents/order_run.mjs --dry "$@"
echo; echo "Done. Log is in order-runs/. You can close this window."
