#!/bin/zsh -l
# Double-click: the REAL drop #1 order. Ops issues one Naïve card per order (each needs your approval in Naïve Studio)
# and pays Customania with it. Asks you to type LIVE first.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
echo "This places REAL Customania orders paid with Naïve prepaid cards (about \$460 for 10 shirts)."
printf "Type LIVE to continue: "; read ans
[ "$ans" = "LIVE" ] || { echo "Cancelled."; exit 0; }
pkill -f ".pw-chrome-profile" 2>/dev/null
node agents/order_run.mjs --live "$@"
echo; echo "Done. Log is in order-runs/. You can close this window."
