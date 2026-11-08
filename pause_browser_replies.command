#!/bin/zsh -l
# Kill switch: stops x_browser_reply until resume_browser_replies.command.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node x/browser_cli.mjs pause
echo; echo "Done. You can close this window."
