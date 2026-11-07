#!/bin/zsh -l
# Double-click: shows Growth's pending scout drafts (replies to strangers X won't let the API send).
# Each has a "post it" link that opens X's composer pre-filled; you press Post yourself if you like it.
cd "$(dirname "$0")" || exit 1
[ -f scout-queue.json ] || { echo "No scout drafts yet."; exit 0; }
python3 -c "
import json
q=[d for d in json.load(open('scout-queue.json')) if d.get('status')=='pending']
print(f'{len(q)} pending scout drafts\n')
for d in q:
  print(f\"[{d['at'][:16]}] {d['mode']} to @{d['to']}  {d['target']}\n  they said: {d['target_text'][:200]}\n  our draft: {d['draft']}\n  why: {d['why']}\n  post it:   {d['post_it']}\n\")
"
