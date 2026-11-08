#!/bin/zsh -l
# Demo: fire the Support agent once now (reads the inbox, looks up orders, replies). The schedule is not changed.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/support_now.mjs
echo; echo "Done. You can close this window."
