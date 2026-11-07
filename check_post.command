#!/bin/zsh -l
# Double-click: polls the CEO's X post until it is live or failed. Output -> naive.log
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")"
mkdir -p .naive-test && cp scripts/check_post.mjs .naive-test/ && cd .naive-test
[ -d node_modules/@usenaive-sdk/vetta ] || npm i @usenaive-sdk/vetta@latest --silent >> ../naive.log 2>&1
node check_post.mjs
echo; echo "Done. You can close this window."
