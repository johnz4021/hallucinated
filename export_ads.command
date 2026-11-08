#!/bin/zsh -l
# Double-click: pulls every live, reviewer-passed ad into ad-library/ (with INDEX.md: captions + X links), then opens it.
cd "$(dirname "$0")" || exit 1
python3 scripts/export_ads.py && open ad-library
