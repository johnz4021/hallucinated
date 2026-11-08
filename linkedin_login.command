#!/bin/zsh -l
# Double-click once: connects your LinkedIn so the Growth agent can post to YOUR profile (you approve each post in Studio).
# Needs LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET in .env and the redirect URL http://127.0.0.1:8080/linkedin/callback in the app.
[ -f ~/.zshrc ] && source ~/.zshrc
cd "$(dirname "$0")/design-mcp" || exit 1
lsof -ti tcp:8080 | xargs kill 2>/dev/null; sleep 0.5
node linkedin/login.mjs && node linkedin/login.mjs --check
echo; echo "Restart serve.command so the agents get the LinkedIn tools. You can close this window."
