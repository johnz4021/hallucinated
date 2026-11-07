#!/bin/zsh -l
# Diagnosis: X sign-in WITHOUT ads permissions. If this works, X is refusing the ads permissions (enable Ads Project access).
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
lsof -ti tcp:8080 | xargs kill 2>/dev/null; sleep 1
node x/x_ads_login.mjs --basic
echo; echo "Done. You can close this window."
