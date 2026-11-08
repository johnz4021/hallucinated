#!/bin/zsh -l
# Shows whether browser replies are on, today's replies and when the next one is allowed.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node x/browser_cli.mjs status
echo; echo "Done. You can close this window."
