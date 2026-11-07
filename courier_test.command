#!/bin/zsh -l
# Double-click: quote-only Uber Courier test on your phone through MobileRun's API (books nothing). Output -> naive.log
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node courier/courier_test.mjs
echo; echo "Done. You can close this window."
