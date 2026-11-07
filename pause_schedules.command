#!/bin/zsh -l
# Double-click: turns OFF every hallucinated deployment (agents stay as they are).
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/setup_agents.mjs --pause-schedules
echo; echo "Done. You can close this window."
