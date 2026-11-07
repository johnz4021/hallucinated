#!/bin/zsh -l
# Double-click: ONE public video post on the brand account via X's API (the drop video, re-encoded for X). Output -> naive.log
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node x/x_api_test.mjs --video
echo; echo "Done. You can close this window."
