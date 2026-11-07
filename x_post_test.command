#!/bin/zsh -l
# Double-click: PUBLIC test posts on @hallucinateddpt: 1) text only, 2) the drop video re-encoded for X. Output -> naive.log
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")"
mkdir -p .naive-test && cp scripts/x_post_test.mjs .naive-test/ && cd .naive-test
[ -f package.json ] || npm init -y >/dev/null 2>&1
[ -d node_modules/@usenaive-sdk/vetta ] || npm i @usenaive-sdk/vetta@latest --silent >> ../naive.log 2>&1
node x_post_test.mjs
echo; echo "Done. You can close this window."
