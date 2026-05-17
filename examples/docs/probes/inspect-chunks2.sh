#!/usr/bin/env bash
# Inspect what each shared chunk contains.
set -u
chunks=$(curl -s --max-time 4 "http://localhost:5174/islands/code-block.js" | grep -oE 'chunk-[a-z0-9]+' | sort -u)
chunks="$chunks $(curl -s --max-time 4 "http://localhost:5174/islands/typing-code.js" | grep -oE 'chunk-[a-z0-9]+' | sort -u)"
chunks=$(printf '%s\n' $chunks | sort -u)
for c in $chunks; do
  body=$(curl -s --max-time 3 "http://localhost:5174/islands/${c}.js")
  size=${#body}
  preview=$(printf '%s' "$body" | head -c 300)
  printf "=== %s (%d B) ===\n%s\n\n" "$c" "$size" "$preview"
done
