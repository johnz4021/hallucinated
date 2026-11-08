#!/bin/zsh -l
# Turns x_browser_reply back on (clears the kill switch and any rest-of-day pause).
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node x/browser_cli.mjs resume
echo; echo "Done. You can close this window."
