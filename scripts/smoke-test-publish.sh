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
SCRATCH="/tmp/place-smoke-$(date +%s)"
APP_NAME="place-smoke-app"

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
  rm -rf "$SCRATCH"
}
trap on_failure ERR

STEP="pack 10 packages"
echo "[1/6] $STEP"
for d in capability component data design devtools persistence reactivity routing search security; do
  (cd "$REPO/systems/$d" && bun pm pack >/dev/null 2>&1)
  echo "      ✓ $d"
done

STEP="set up scratch dir"
echo "[2/6] $STEP at $SCRATCH"
mkdir -p "$SCRATCH/src/pages"
# Copy the template + substitute APP_NAME.
sed "s/__APP_NAME__/$APP_NAME/g" \
  "$REPO/tools/create-app/templates/minimal/package.json" > "$SCRATCH/package.json"
sed "s/__APP_NAME__/$APP_NAME/g" \
  "$REPO/tools/create-app/templates/minimal/src/app.ts" > "$SCRATCH/src/app.ts"
sed "s/__APP_NAME__/$APP_NAME/g" \
  "$REPO/tools/create-app/templates/minimal/src/pages/home.page.tsx" > "$SCRATCH/src/pages/home.page.tsx"
cp "$REPO/tools/create-app/templates/minimal/bunfig.toml" "$SCRATCH/bunfig.toml"
cp "$REPO/tools/create-app/templates/minimal/tsconfig.json" "$SCRATCH/tsconfig.json"
cp "$REPO/tools/create-app/templates/minimal/_gitignore" "$SCRATCH/.gitignore"

STEP="rewrite deps to point at local tarballs"
echo "[3/6] $STEP"
# The minimal template only declares @place-ts/component but the package
# depends transitively on @place-ts/capability, @place-ts/reactivity,
# @place-ts/routing. Two-pronged fix:
#   1. Declare all four @place-ts/* deps at the root so they all resolve.
#   2. Add `overrides` for every @place-ts/* so transitive references in
#      the tarball (which read `@place-ts/capability: 0.1.0` — a version
#      spec, not a file:) get force-redirected to the local tarball
#      instead of being fetched from the registry (which doesn't have
#      them yet — that's the whole point of this smoke test).
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs'
const p = '$SCRATCH/package.json'
const pkg = JSON.parse(readFileSync(p, 'utf8'))
const local = {
  '@place-ts/capability': 'file:$REPO/systems/capability/place-ts-capability-0.1.0.tgz',
  '@place-ts/component':  'file:$REPO/systems/component/place-ts-component-0.1.0.tgz',
  '@place-ts/reactivity': 'file:$REPO/systems/reactivity/place-ts-reactivity-0.1.0.tgz',
  '@place-ts/routing':    'file:$REPO/systems/routing/place-ts-routing-0.1.0.tgz',
  '@place-ts/security':   'file:$REPO/systems/security/place-ts-security-0.1.0.tgz',
}
pkg.dependencies = local
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

trap on_success EXIT
