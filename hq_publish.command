#!/bin/zsh -l
# Double-click: builds the /hq mission-control document and uploads it to the store once (serve.command also does this every 60 s).
# Add --dry after hq_publish.mjs below to only write hq.json locally.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/hq_publish.mjs --once
echo; echo "Done. You can close this window."
