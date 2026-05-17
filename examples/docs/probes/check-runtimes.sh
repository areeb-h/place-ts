#!/usr/bin/env bash
# Verify framework inline runtimes are emitted on every page.
for p in / /getting-started /why /concepts/reactivity /recipes/forms /recipes/streaming /api/components; do
  body=$(curl -s --max-time 4 "http://localhost:5174${p}")
  tabs=$(printf '%s' "$body" | grep -oE '__placeTabs' | wc -l)
  spa=$(printf '%s' "$body" | grep -oE '__place_spa' | wc -l)
  printf "  %-30s __placeTabs=%d __place_spa=%d\n" "$p" "$tabs" "$spa"
done
