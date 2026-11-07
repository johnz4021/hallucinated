#!/bin/zsh -l
# Double-click: creates/updates all five hallucinated-* agents (prompts, tools, permissions) and their Naïve deployments.
# New deployments are created OFF; existing ones keep their state. Start serve.command first so agents get the live tool URL.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/setup_agents.mjs
echo; echo "Done. You can close this window."
