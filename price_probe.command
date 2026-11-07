#!/bin/zsh -l
# Reads Customania prices for a few print sizes and quantities. Never adds to cart or checks out.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
pkill -f ".pw-chrome-profile" 2>/dev/null
node customania/price_probe.mjs 9ab8a02eaec1 --back-only
echo; echo "Done. You can close this window."
