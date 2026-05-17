#!/usr/bin/env bash
# Verify the framework's early-paint platform script is emitted on
# every islands-mode page.
for p in / /getting-started /why /api/components /concepts/reactivity /recipes/forms /api/state; do
  body=$(curl -s --max-time 4 "http://localhost:5174${p}")
  early=$(printf '%s' "$body" | grep -oE 'dataset\.placePlatform' | wc -l)
  spans=$(printf '%s' "$body" | grep -oE 'place-platform-' | wc -l)
  printf "  %-30s early=%d platform-spans=%d\n" "$p" "$early" "$spans"
done
