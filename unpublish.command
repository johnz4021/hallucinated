#!/bin/zsh -l
# Double-click (or: ./unpublish.command <slug>): takes an agent-designed product off the LIVE store. Archives the Stripe
# product and its prices, removes its "why this exists" dossier and refreshes the site. Agents can't do this; only you.
# For the sandbox instead: STRIPE_LIVE_OK=0 ./unpublish.command <slug>
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
export STRIPE_LIVE_OK=${STRIPE_LIVE_OK:-1}
SLUG="$1"
[ -z "$SLUG" ] && read "SLUG?Slug to take off the store (e.g. merge-conflict-tee): "
node designs/unpublish.mjs "$SLUG"
echo; echo "Done. You can close this window."
