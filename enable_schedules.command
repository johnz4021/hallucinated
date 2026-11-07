#!/bin/zsh -l
# Double-click: same as setup_agents.command, then turns ON every deployment (Growth every 3 h, Support every 15 min,
# Ops sales hourly). Undo with pause_schedules.command.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/setup_agents.mjs --enable-schedules
echo; echo "Done. You can close this window."
