#!/bin/zsh -l
# Double-click: checks the X developer keys in .env, then makes ONE public text post on the brand account via X's API.
# To test video instead: edit the last node line to add --video. Output -> naive.log
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node x/x_api_test.mjs
echo; echo "Done. You can close this window."
