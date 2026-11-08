#!/bin/zsh -l
# Turns the agents' LinkedIn posts back on (still 1 per Pacific day).
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node linkedin/ctl.mjs resume
echo; echo "Done. You can close this window."
