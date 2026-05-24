#!/usr/bin/env bash
# Scratch-app smoke test for the publish surface (plan step 6.4).
#
# Packs all 10 @place-ts/* tarballs, installs them into a fresh project
# OUTSIDE the workspace (so bun's workspace resolution doesn't paper
# over publish-time bugs), starts the dev server, hits `/`, asserts
# the route renders. Tears everything down at the end.
#
# Run from the repo root: bash scripts/smoke-test-publish.sh
#
# Exits 0 on success, non-zero with the failing step named.

set -u
set -o pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Scratch parent dir is timestamped to avoid collisions across runs.
# The scaffolded app lives at $PARENT/$APP_NAME — `welcome to $APP_NAME`
# is what the rendered HTML must contain.
PARENT="/tmp/place-smoke-$(date +%s)"
APP_NAME="place-smoke-app"
SCRATCH="$PARENT/$APP_NAME"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  # Tarballs live under each system dir; remove them from the workspace
  # so they don't dirty the repo.
  for d in capability component data design devtools persistence reactivity routing search security; do
    rm -f "$REPO/systems/$d"/place-*.tgz 2>/dev/null
  done
  # Leave SCRATCH around for inspection on failure; only nuke on
  # success (the trap below decides).
}
on_failure() {
  local code=$?
  echo
  echo "❌ smoke test FAILED at step: ${STEP:-unknown}"
  echo "   scratch dir kept at: $SCRATCH (inspect, then rm -rf manually)"
  cleanup
  exit "$code"
}
on_success() {
  echo
  echo "✓ smoke test PASSED — publish surface works end-to-end"
  cleanup
  rm -rf "$PARENT"
}
trap on_failure ERR

STEP="pack 10 packages"
echo "[1/6] $STEP"
for d in capability component data design devtools persistence reactivity routing search security; do
  (cd "$REPO/systems/$d" && bun pm pack >/dev/null 2>&1)
  echo "      ✓ $d"
done

STEP="scaffold app via create-app CLI"
echo "[2/6] $STEP at $SCRATCH"
# Use the canonical scaffolder so the smoke test exercises whatever shape
# the template actually ships — no parallel file-list to keep in sync.
# `--no-install` because we'll install ourselves after rewriting deps to
# local tarballs (the registry doesn't have these versions yet — that's
# the point of the smoke test).
mkdir -p "$PARENT"
# Scaffold WITH theme-toggle + design-system so this smoke also covers
# the 0.10.6 SSR-side blip fix: when a `place-theme=dark` cookie is
# sent, the SSR'd toggle should already have aria-pressed="true" on
# the Dark button (not on System). The cookie-curl check at the end
# of this script pins that behaviour down.
(cd "$PARENT" && bun "$REPO/tools/create-app/src/cli.ts" "$APP_NAME" --yes --no-install \
  --template minimal --with theme-toggle --with design-system >/dev/null 2>&1)
# The CLI scaffolds under $PARENT/$APP_NAME which IS $SCRATCH.

STEP="rewrite deps to point at local tarballs"
echo "[3/6] $STEP"
# The template declares its first-party @place-ts/* deps and tailwind. The
# registry doesn't have these versions yet (that's the point of this
# smoke test), so we:
#   1. Replace every @place-ts/* dep with a `file:` URL pointing at the
#      local tarball we just packed.
#   2. Add `overrides` for every @place-ts/* so transitive references
#      inside the tarballs (e.g. component depends on capability: ^0.1.0,
#      a version spec NOT a file: URL) also resolve to our tarballs.
# Non-@place-ts deps (tailwind etc.) keep their registry sources.
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs'
const p = '$SCRATCH/package.json'
const pkg = JSON.parse(readFileSync(p, 'utf8'))
const local = {
  '@place-ts/capability': 'file:$REPO/systems/capability/place-ts-capability-0.1.0.tgz',
  '@place-ts/component':  'file:$REPO/systems/component/place-ts-component-0.10.11.tgz',
  '@place-ts/data':       'file:$REPO/systems/data/place-ts-data-0.2.1.tgz',
  '@place-ts/design':     'file:$REPO/systems/design/place-ts-design-0.3.3.tgz',
  '@place-ts/devtools':   'file:$REPO/systems/devtools/place-ts-devtools-0.1.1.tgz',
  '@place-ts/persistence':'file:$REPO/systems/persistence/place-ts-persistence-0.1.1.tgz',
  '@place-ts/reactivity': 'file:$REPO/systems/reactivity/place-ts-reactivity-0.1.1.tgz',
  '@place-ts/routing':    'file:$REPO/systems/routing/place-ts-routing-0.1.2.tgz',
  '@place-ts/search':     'file:$REPO/systems/search/place-ts-search-0.2.0.tgz',
  '@place-ts/security':   'file:$REPO/systems/security/place-ts-security-0.1.1.tgz',
}
// Merge: keep tailwind + any other non-@place-ts/* deps, override every
// @place-ts/* with the local tarball.
pkg.dependencies = { ...(pkg.dependencies ?? {}), ...local }
pkg.overrides = local
writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n')
console.log('   rewrote deps + overrides to local tarballs')
"

STEP="bun install"
echo "[4/6] $STEP"
(cd "$SCRATCH" && bun install --no-save 2>&1 | tail -5)

STEP="start dev server"
echo "[5/6] $STEP"
# Pin a deterministic port so the smoke test doesn't race with whatever
# else is on the box. The framework's default-port-walk would otherwise
# pick something different each run.
export PORT=7788
(cd "$SCRATCH" && PORT=$PORT bun src/app.ts > /tmp/place-smoke-server.log 2>&1) &
SERVER_PID=$!
# Give the server up to 10 seconds to come up.
PORT_RE='http://localhost:([0-9]+)'
ACTUAL_PORT=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "      ❌ server died before serving"
    echo "--- server log ---"
    cat /tmp/place-smoke-server.log
    exit 1
  fi
  # Parse the actual port the framework chose (may differ from $PORT
  # if the framework auto-walks). Re-read every iteration; the log
  # grows during startup.
  if [[ -z "$ACTUAL_PORT" ]]; then
    if line=$(grep -oE "http://localhost:[0-9]+" /tmp/place-smoke-server.log 2>/dev/null | head -1); then
      ACTUAL_PORT="${line##*:}"
    fi
  fi
  if [[ -n "$ACTUAL_PORT" ]]; then
    if curl -fsS "http://localhost:$ACTUAL_PORT/" -o /tmp/place-smoke-home.html 2>/dev/null; then
      break
    fi
  fi
  sleep 1
done
if [[ ! -s /tmp/place-smoke-home.html ]]; then
  echo "      ❌ server never responded (actual port: ${ACTUAL_PORT:-unknown})"
  echo "--- server log ---"
  cat /tmp/place-smoke-server.log
  exit 1
fi
echo "      ✓ server responded on :$ACTUAL_PORT"

STEP="verify rendered HTML"
echo "[6/6] $STEP"
if ! grep -q "welcome to $APP_NAME" /tmp/place-smoke-home.html; then
  echo "      ❌ home page didn't render expected content"
  echo "--- got ---"
  head -c 1200 /tmp/place-smoke-home.html
  exit 1
fi
echo "      ✓ home page rendered ('welcome to $APP_NAME' found)"

# 0.10.6 — SSR-side blip fix. With a `place-theme=dark` cookie set
# on the request, the server-side useTheme() reads the active theme
# from the per-request cap (the same channel cookie() uses), and the
# ThemeToggle's segmented control SSRs with aria-pressed="true" on
# Dark — not on System. Pre-0.10.6 it was always System on SSR, and
# the hydration boundary visibly snapped to Dark — that's the blip.
STEP="verify SSR toggle pressed-state matches cookie (0.10.6)"
echo "      $STEP"
curl -fsS -H 'Cookie: place-theme=dark' \
  "http://localhost:$ACTUAL_PORT/" -o /tmp/place-smoke-home-darkcookie.html 2>/dev/null
if [[ ! -s /tmp/place-smoke-home-darkcookie.html ]]; then
  echo "      ❌ server didn't respond with cookie set"
  exit 1
fi
if ! grep -oE '<a[^>]*aria-label="Dark theme"[^>]*aria-pressed="true"' \
    /tmp/place-smoke-home-darkcookie.html >/dev/null && \
   ! grep -oE '<a[^>]*aria-pressed="true"[^>]*aria-label="Dark theme"' \
    /tmp/place-smoke-home-darkcookie.html >/dev/null && \
   ! grep -oE '<button[^>]*aria-label="Dark theme"[^>]*aria-pressed="true"' \
    /tmp/place-smoke-home-darkcookie.html >/dev/null && \
   ! grep -oE '<button[^>]*aria-pressed="true"[^>]*aria-label="Dark theme"' \
    /tmp/place-smoke-home-darkcookie.html >/dev/null; then
  echo "      ❌ Dark button does NOT have aria-pressed=true in SSR HTML"
  echo "      (the SSR cap fix isn't reaching useTheme — toggle will blip)"
  grep -oE '<button[^>]*aria-label="[^"]*"[^>]*aria-pressed="[^"]*"' \
    /tmp/place-smoke-home-darkcookie.html | head -5
  exit 1
fi
echo "      ✓ Dark button is aria-pressed=true on SSR (no hydration blip)"

if grep -oE '<button[^>]*aria-label="System theme"[^>]*aria-pressed="true"' \
    /tmp/place-smoke-home-darkcookie.html >/dev/null || \
   grep -oE '<button[^>]*aria-pressed="true"[^>]*aria-label="System theme"' \
    /tmp/place-smoke-home-darkcookie.html >/dev/null; then
  echo "      ❌ System button is aria-pressed=true even with place-theme=dark cookie"
  exit 1
fi
echo "      ✓ System button is NOT pressed when cookie=dark"

trap on_success EXIT
