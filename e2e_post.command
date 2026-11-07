#!/bin/zsh -l
# Double-click: CEO agent picks an existing ad and posts it to X (no regeneration). Output -> naive.log, ad-test/
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")"
mkdir -p .naive-test && cp scripts/e2e_post.mjs .naive-test/ && cd .naive-test
[ -f package.json ] || npm init -y >/dev/null 2>&1
[ -d node_modules/@usenaive-sdk/vetta ] || npm i @usenaive-sdk/vetta@latest --silent >> ../naive.log 2>&1
node e2e_post.mjs
echo; echo "Done. You can close this window."
