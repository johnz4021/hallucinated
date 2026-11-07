#!/bin/zsh -l
# Double-click at the start and LEAVE THIS WINDOW OPEN: keeps our tools (design, Customania, X, cards) online for the
# Naïve agents all hackathon, repoints the agents if the tunnel changes, and keeps the Mac awake. Close it to stop.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
pkill -f "agents/serve.mjs" 2>/dev/null; sleep 1
node agents/serve.mjs
