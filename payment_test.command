#!/bin/zsh -l
# Payment-path test John approved (2026-11-06): reuses the approved drop #1 design, Ops places ONE 1-shirt order
# (front+back, ~$102) and tries to pay it with a freshly issued Naïve card (card approval granted for this run).
# With no Naïve credit, card issuance should fail and nothing is charged.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
pkill -f "agents/order_run.mjs" 2>/dev/null; sleep 2; pkill -f ".pw-chrome-profile" 2>/dev/null
node agents/order_run.mjs --live --one --approve-cards --design 9ab8a02eaec1 --skip-ceo --sizes M:1
echo; echo "Done. Log is in order-runs/. You can close this window."
