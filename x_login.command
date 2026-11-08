#!/bin/zsh -l
# Opens the X browser profile at x.com/login. Log in to @hallucinateddpt BY HAND (password + 2FA), then close the window.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node x/browser_cli.mjs login
echo; echo "Done. You can close this window."
