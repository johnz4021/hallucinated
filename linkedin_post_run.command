#!/bin/zsh -l
# Double-click: the Growth agent writes one LinkedIn post (from the agents' log) and submits it; approve or deny it in
# Naïve Studio. Needs serve.command running (restarted after linkedin_login). Dry run: LINKEDIN_DRY_RUN=1 on serve.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/linkedin_run.mjs "$@"
