#!/bin/zsh -l
# Double-click once: connects X Ads to our tools. Your browser opens; approve as @hallucinateddpt.
# Saves the token to .x-ads-token.json (git-ignored). Output -> naive.log
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
lsof -ti tcp:8080 | xargs kill 2>/dev/null; sleep 1
node x/x_ads_login.mjs
echo; echo "Done. You can close this window. Restart serve.command so Growth gets the ads tools."
