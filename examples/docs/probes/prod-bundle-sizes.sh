#!/usr/bin/env bash
# One-off prod bundle size probe. Hits each island URL, prints raw + gzip.
set -euo pipefail
for u in mobile-nav-button search-trigger theme-toggle code-block typing-code page-nav toc search-palette mobile-nav-drawer; do
  body=$(curl -s --max-time 3 "http://localhost:5174/islands/${u}.js")
  raw=${#body}
  gz=$(printf '%s' "$body" | gzip -nc | wc -c)
  printf "  %-22s %6d B raw / %6d B gz\n" "$u" "$raw" "$gz"
done
echo "---"
# Shared chunks discovered from the first island bundle
first=$(curl -s "http://localhost:5174/islands/theme-toggle.js")
for c in $(printf '%s' "$first" | grep -oE 'chunk-[a-z0-9]+'); do
  body=$(curl -s --max-time 3 "http://localhost:5174/islands/${c}.js")
  raw=${#body}
  gz=$(printf '%s' "$body" | gzip -nc | wc -c)
  printf "  %-22s %6d B raw / %6d B gz\n" "$c" "$raw" "$gz"
done
