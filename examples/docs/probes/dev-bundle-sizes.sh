#!/usr/bin/env bash
# Dev-mode bundle sizes (compares against the production-bundle probe
# to show how close whitespace-minified dev gets to fully-minified prod).
set -euo pipefail
for u in mobile-nav-button search-trigger theme-toggle code-block typing-code page-nav toc search-palette mobile-nav-drawer; do
  body=$(curl -s --max-time 3 "http://localhost:5174/islands/${u}.js")
  raw=${#body}
  gz=$(printf '%s' "$body" | gzip -nc | wc -c)
  printf "  %-22s %6d B raw / %5d B gz\n" "$u" "$raw" "$gz"
done
echo "---"
first=$(curl -s "http://localhost:5174/islands/theme-toggle.js")
for c in $(printf '%s' "$first" | grep -oE 'chunk-[a-z0-9]+' | sort -u); do
  body=$(curl -s --max-time 3 "http://localhost:5174/islands/${c}.js")
  raw=${#body}
  gz=$(printf '%s' "$body" | gzip -nc | wc -c)
  printf "  %-22s %6d B raw / %5d B gz\n" "$c" "$raw" "$gz"
done
