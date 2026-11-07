#!/bin/zsh -l
# Double-click: connects the brand's X account to Naïve. Output -> naive.log
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")"
mkdir -p .naive-test && cp scripts/connect_x.mjs .naive-test/ && cd .naive-test
[ -f package.json ] || npm init -y >/dev/null 2>&1
[ -d node_modules/@usenaive-sdk/vetta ] || npm i @usenaive-sdk/vetta@latest --silent >> ../naive.log 2>&1
node connect_x.mjs
echo; echo "Done. You can close this window."
