#!/bin/zsh -l
# Text-only check of the Naive hosted X browser: open, unexpired, logged in as @hallucinateddpt. Optional arg: a new cmp_ id.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node x/browser_cli.mjs naive-status "$@"
echo; echo "Done. You can close this window."
