#!/bin/zsh -l
# Double-click: the real store -> printer order. Ops batches the paid store orders into ONE Customania order, you approve the
# handoff card in Naïve Studio and pay in the Chrome checkout, then the sales are marked batched in Stripe. Keep serve.command open.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
node agents/sales_run.mjs --human-pay
echo; echo "Done. You can close this window."
