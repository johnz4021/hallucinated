#!/bin/zsh -l
# One X API search for "AI agents" with your developer bearer token. Output -> naive.log
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node x/x_search_test.mjs
echo; echo "Done. You can close this window."
