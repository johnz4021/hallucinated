#!/bin/zsh -l
# Kill switch: stops the agents' LinkedIn posts until resume_linkedin.command.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node linkedin/ctl.mjs pause
echo; echo "Done. You can close this window."
