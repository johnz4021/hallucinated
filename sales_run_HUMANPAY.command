#!/bin/zsh -l
# Double-click: the real store -> printer order. Ops batches the paid store orders into ONE Customania order, you approve the
# handoff card in Naïve Studio and pay in the Chrome checkout, then the sales are marked batched in Stripe. Keep serve.command open.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
export STRIPE_LIVE_OK=1   # store is live (Sat 14:25): agents read STRIPE_LIVE_SECRET_KEY; unset to use the sandbox test key
node agents/sales_run.mjs --human-pay
echo; echo "Done. You can close this window."
