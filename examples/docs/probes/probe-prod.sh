#!/usr/bin/env bash
# T5-D phase-2 verification — measure all served bundles from a live
# production-mode docs server. Run AFTER starting:
#   NODE_ENV=production PORT=4321 bun src/app.ts
set -eu

BASE="${BASE:-http://localhost:4321}"

fmt() {
  local n="$1"
  if [ "$n" -ge 1024 ]; then
    awk -v n="$n" 'BEGIN { printf "%.2f KB", n/1024 }'
  else
    echo "${n} B"
  fi
}

measure() {
  local url="$1"
  local raw gz
  raw=$(curl -s "$BASE$url" | wc -c)
  gz=$(curl -s "$BASE$url" | gzip -9 | wc -c)
  printf '%-40s raw=%-12s gzip=%s\n' "$url" "$(fmt "$raw")" "$(fmt "$gz")"
}

echo "== Per-island bundles =="
for name in mobile-nav-button search-trigger theme-toggle page-nav toc search-palette mobile-nav-drawer; do
  measure "/islands/$name.js"
done

echo
echo "== Shared chunks =="
curl -s "$BASE/islands/theme-toggle.js" > /tmp/probe-tt.js
for c in $(grep -oE 'chunk-[a-zA-Z0-9]+\.js' /tmp/probe-tt.js | sort -u); do
  measure "/islands/$c"
done

echo
echo "== Legacy paths =="
for u in /client.js /client/landing.js; do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$u")
  printf '%-40s %s\n' "$u" "$status"
done

echo
echo "== Landing HTML =="
measure "/"

echo
echo "== Aggregate (page + all 7 islands + all shared chunks) =="
total=0
total_gz=0
for u in / /islands/mobile-nav-button.js /islands/search-trigger.js /islands/theme-toggle.js /islands/page-nav.js /islands/toc.js /islands/search-palette.js /islands/mobile-nav-drawer.js $(grep -oE '/islands/chunk-[a-zA-Z0-9]+\.js' /tmp/probe-tt.js | sed 's|/islands/||;s|^|/islands/|' | sort -u); do
  raw=$(curl -s "$BASE$u" | wc -c)
  gz=$(curl -s "$BASE$u" | gzip -9 | wc -c)
  total=$((total + raw))
  total_gz=$((total_gz + gz))
done
echo "  raw  = $(fmt $total)"
echo "  gzip = $(fmt $total_gz)"
