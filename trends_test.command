#!/bin/zsh -l
# Double-click: proves Naïve's built-in socialData for trend research. Lists X / Reddit / TikTok / HN tools with prices,
# then runs ONE cheap X search for "AI agents" (refuses anything over $0.10). Output -> naive.log, trends-test.json
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/trends_test.mjs
echo; echo "Done. You can close this window."
