#!/bin/zsh -l
# Double-click: tests the Hallucinated design tool (OpenAI -> MCP server -> Naïve designer agent). Output -> naive.log, design-test/
# Add --direct after run_test.mjs below to also re-run the standalone generation test.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
if [ ! -d node_modules/sharp ]; then echo "Installing dependencies…"; npm i --silent >> ../naive.log 2>&1; fi
node run_test.mjs
echo; echo "Done. You can close this window."
