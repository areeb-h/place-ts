#!/usr/bin/env bash
# Inspect what the shared chunks contain.
set -u
for c in chunk-3cxgdp6v chunk-b2wyvd5x chunk-csm5f59h chunk-e4k5ztpv; do
  body=$(curl -s --max-time 3 "http://localhost:5174/islands/${c}.js")
  size=${#body}
  preview=$(printf '%s' "$body" | head -c 240)
  printf "=== %s (%d B) ===\n%s\n\n" "$c" "$size" "$preview"
done
