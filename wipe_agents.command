#!/bin/zsh -l
# Double-click: deletes all hallucinated-* agents in Naïve (fresh start). The next order_run recreates product, ceo and ops.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/wipe_agents.mjs
echo; echo "Done. You can close this window."
