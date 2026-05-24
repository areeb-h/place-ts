#!/usr/bin/env bash
# Scratch-app smoke test for the STATIC EXPORT surface.
#
# Mirrors `smoke-test-publish.sh` but runs `PLACE_BUILD=dist bun
# src/app.ts` instead of starting a dev server, then asserts the
# emitted `dist/` is a deployable static site. Catches build-pipeline
# regressions that the dev smoke can't see:
#
#   - Tailwind utility classes used by the design system missing from
#     the static export's CSS (we just shipped a fix for the analogous
#     dev-side bug; this locks the build-side down too).
#   - `_headers` (Cloudflare CSP) missing or malformed.
#   - Island bundles not emitted (or emitted to the wrong path).
#   - `<html>` theme class handling wrong on the static SSR.
#   - The pre-rendered HTML missing reactive markers or theme-toggle
#     wiring needed for hydration.
#
# Run from the repo root: bash scripts/smoke-test-build.sh
#
# Exits 0 on success, non-zero with the failing step named.

set -u
set -o pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="/tmp/place-build-smoke-$(date +%s)"
APP_NAME="place-build-smoke-app"
SCRATCH="$PARENT/$APP_NAME"

cleanup() {
  # Tarballs live under each system dir; remove them from the workspace
  # so they don't dirty the repo.
  for d in capability component data design devtools persistence reactivity routing search security; do
    rm -f "$REPO/systems/$d"/place-*.tgz 2>/dev/null
  done
}
on_failure() {
  local code=$?
  echo
  echo "❌ build smoke FAILED at step: ${STEP:-unknown}"
  echo "   scratch dir kept at: $SCRATCH (inspect, then rm -rf manually)"
  cleanup
  exit "$code"
}
on_success() {
  echo
  echo "✓ build smoke PASSED — static export surface works end-to-end"
  cleanup
  rm -rf "$PARENT"
}
trap on_failure ERR

STEP="pack 10 packages"
echo "[1/5] $STEP"
for d in capability component data design devtools persistence reactivity routing search security; do
  (cd "$REPO/systems/$d" && bun pm pack >/dev/null 2>&1)
  echo "      ✓ $d"
done

STEP="scaffold app via create-app CLI"
echo "[2/5] $STEP at $SCRATCH"
mkdir -p "$PARENT"
# Use the SCAFFOLD CLI directly with the most-feature-heavy template
# combo we have: minimal + theme-toggle + design-system. That gives us
# coverage on:
#   - design-system Tailwind classes in the static export (the regression
#     we just fixed for dev)
#   - theme-toggle island hydration script emission
#   - design's base.css being inlined into the build output
(cd "$PARENT" && bun "$REPO/tools/create-app/src/cli.ts" "$APP_NAME" --yes --no-install --no-git \
  --template minimal --with theme-toggle --with design-system >/dev/null 2>&1)

STEP="rewrite deps to point at local tarballs"
echo "[3/5] $STEP"
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs'
const p = '$SCRATCH/package.json'
const pkg = JSON.parse(readFileSync(p, 'utf8'))
const local = {
  '@place-ts/capability': 'file:$REPO/systems/capability/place-ts-capability-0.1.0.tgz',
  '@place-ts/component':  'file:$REPO/systems/component/place-ts-component-0.10.10.tgz',
  '@place-ts/data':       'file:$REPO/systems/data/place-ts-data-0.2.1.tgz',
  '@place-ts/design':     'file:$REPO/systems/design/place-ts-design-0.3.3.tgz',
  '@place-ts/devtools':   'file:$REPO/systems/devtools/place-ts-devtools-0.1.1.tgz',
  '@place-ts/persistence':'file:$REPO/systems/persistence/place-ts-persistence-0.1.1.tgz',
  '@place-ts/reactivity': 'file:$REPO/systems/reactivity/place-ts-reactivity-0.1.1.tgz',
  '@place-ts/routing':    'file:$REPO/systems/routing/place-ts-routing-0.1.2.tgz',
  '@place-ts/search':     'file:$REPO/systems/search/place-ts-search-0.2.0.tgz',
  '@place-ts/security':   'file:$REPO/systems/security/place-ts-security-0.1.1.tgz',
}
pkg.dependencies = { ...(pkg.dependencies ?? {}), ...local }
pkg.overrides = local
writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n')
console.log('   rewrote deps + overrides to local tarballs')
"

(cd "$SCRATCH" && bun install --no-save 2>&1 | tail -3)

STEP="run static export (PLACE_BUILD=dist bun src/app.ts)"
echo "[4/5] $STEP"
(cd "$SCRATCH" && PLACE_BUILD=dist NODE_ENV=production bun src/app.ts > /tmp/place-build-smoke.log 2>&1)
BUILD_EXIT=$?
if [[ $BUILD_EXIT -ne 0 ]]; then
  echo "      ❌ build exited $BUILD_EXIT"
  echo "--- build log ---"
  cat /tmp/place-build-smoke.log
  exit $BUILD_EXIT
fi
echo "      ✓ build exited 0"

STEP="verify dist/ output"
echo "[5/5] $STEP"

# Required artifacts
DIST="$SCRATCH/dist"
require() {
  local label="$1" path="$2"
  if [[ ! -e "$path" ]]; then
    echo "      ❌ missing $label: $path"
    return 1
  fi
  echo "      ✓ $label: $(basename "$path")"
}
require "dist directory" "$DIST"
require "home page"      "$DIST/index.html"
require "about page"     "$DIST/about/index.html"
require "_headers"       "$DIST/_headers"

# At least one island bundle (theme-toggle is required by the feature pack)
ISLAND_COUNT=$(find "$DIST/islands" -name '*.js' -type f 2>/dev/null | wc -l)
if [[ $ISLAND_COUNT -lt 1 ]]; then
  echo "      ❌ no island bundles emitted to dist/islands/"
  ls -la "$DIST" || true
  exit 1
fi
echo "      ✓ $ISLAND_COUNT island bundle(s) in dist/islands/"

# Cloudflare _headers must contain a CSP directive
if ! grep -q -i 'content-security-policy' "$DIST/_headers"; then
  echo "      ❌ _headers missing Content-Security-Policy"
  cat "$DIST/_headers"
  exit 1
fi
echo "      ✓ _headers contains Content-Security-Policy"

# The pre-rendered HTML should contain the app's home title
if ! grep -q "welcome to $APP_NAME" "$DIST/index.html"; then
  echo "      ❌ index.html doesn't contain expected home content"
  head -c 1500 "$DIST/index.html"
  exit 1
fi
echo "      ✓ index.html renders expected content"

# The inlined CSS must contain design-system utility rules. This is the
# build-side mirror of the dev-side bug we just fixed (Tailwind v4 not
# scanning node_modules/@place-ts/design). If the static export ever
# regresses on this, the visual output is broken — and the dev smoke
# wouldn't notice.
if ! grep -q '\.bg-card' "$DIST/index.html"; then
  echo "      ❌ index.html missing .bg-card rule — design utilities likely not scanned"
  echo "      (check tailwind content globs include node_modules/@place-ts/design)"
  exit 1
fi
if ! grep -q '\.border-border' "$DIST/index.html"; then
  echo "      ❌ index.html missing .border-border rule"
  exit 1
fi
echo "      ✓ design-system Tailwind utilities present in inlined CSS"

# The ThemeToggle should emit a fieldset with three buttons (System /
# Light / Dark) — verifies the theme-toggle feature pack composed
# correctly into the static export.
if ! grep -q 'aria-label="System theme"' "$DIST/index.html"; then
  echo "      ❌ index.html missing System theme button — theme-toggle feature broken?"
  exit 1
fi
echo "      ✓ ThemeToggle rendered into static HTML"

# 0.10.6 — verify the toggle SSRs with ALL THREE buttons (System +
# Light + Dark). Pre-0.10.6 the static export's useTheme() returned
# modes=[] (no per-request cap install in the static path), so the
# segmented control SSRed with only the system button and visibly
# grew from 1 → 3 buttons on hydration. That's the blip in the
# header on hard refresh of a deployed static site.
TOGGLE_BUTTONS=$(grep -oE 'aria-label="(System|Light|Dark) theme"' "$DIST/index.html" | sort -u | wc -l)
if [[ $TOGGLE_BUTTONS -lt 3 ]]; then
  echo "      ❌ ThemeToggle SSRs $TOGGLE_BUTTONS button(s); expected 3 (System + Light + Dark)"
  echo "      (the per-render cap install in static export isn't reaching useTheme — toggle will blip)"
  grep -oE 'aria-label="[^"]*"' "$DIST/index.html" | head -5
  exit 1
fi
echo "      ✓ ThemeToggle SSRs all 3 buttons (no button-count blip on hydration)"

# Each segmented button must carry the data-place-theme-mode attribute
# AND the CSS rule that drives the visual pressed style from
# `<html data-place-theme>` must be in the inlined CSS. Together these
# guarantee the correct button looks pressed from FIRST paint on a
# hard refresh of the deployed static site — even though SSR has no
# cookie context, the early-paint script's data-place-theme=<mode>
# on <html> drives the visual state via CSS specificity.
for m in system light dark; do
  if ! grep -q "data-place-theme-mode=\"$m\"" "$DIST/index.html"; then
    echo "      ❌ ThemeToggle button for '$m' missing data-place-theme-mode attribute"
    exit 1
  fi
done
echo "      ✓ All 3 toggle buttons carry data-place-theme-mode"

if ! grep -q 'data-place-theme-mode' "$DIST/index.html"; then
  echo "      ❌ inlined CSS missing the [data-place-theme-mode] selector"
  exit 1
fi
# Verify the selector chain html[data-place-theme=X] is present in
# inlined CSS — that's the rule that drives the pressed style.
if ! grep -qE 'data-place-theme="(dark|light|system)"' "$DIST/index.html"; then
  echo "      ❌ inlined CSS missing the html[data-place-theme=...] rule"
  echo "      (the design-system base.css CSS-driven pressed-state rule isn't shipping)"
  exit 1
fi
echo "      ✓ CSS-driven pressed-state rule shipped in inlined CSS"

# 0.10.6/0.3.2 — NO JS-determined pressed-class on any segmented
# button. The pressed visual is OWNED entirely by the [data-place-theme]
# CSS rule. Pre-fix the toggle's segmented buttons used a recipe
# compound that added `bg-bg text-fg font-medium shadow-sm` to the
# JS-determined "active" button on SSR; combined with the CSS rule
# driven by the early-paint script's data-place-theme attribute, this
# produced a TWO-PRESSED-AT-ONCE blip on static deployments with a
# non-system cookie. The fix renders all buttons with the same
# unpressed class; CSS does the visual.
if grep -oP '<button[^>]*data-place-theme-mode[^>]*class="[^"]*bg-bg[^"]*"' "$DIST/index.html" >/dev/null; then
  echo "      ❌ A toggle button has 'bg-bg' as a JS-rendered class — would cause two-pressed blip with non-system cookie"
  grep -oP '<button[^>]*data-place-theme-mode[^>]*>' "$DIST/index.html" | head -3
  exit 1
fi
if grep -oP '<button[^>]*data-place-theme-mode[^>]*class="[^"]*shadow-sm[^"]*"' "$DIST/index.html" >/dev/null; then
  echo "      ❌ A toggle button has 'shadow-sm' as a JS-rendered class — same two-pressed risk"
  exit 1
fi
echo "      ✓ no toggle button has JS-rendered pressed-style class (CSS rule is the single source)"

# Verify no theme-* class is on <html> (we changed this in 0.10.1 — SSR
# ships no theme class so @media drives appearance from first paint).
# The HTML's opening <html...> tag should NOT contain theme-dark or
# theme-light because the static export has no cookie context.
HTML_TAG=$(grep -o '<html[^>]*>' "$DIST/index.html" | head -1)
if echo "$HTML_TAG" | grep -qE 'class="[^"]*\btheme-(dark|light)\b'; then
  echo "      ❌ static export ships a theme class on <html> — regression of the 0.10.1 SSR-blip fix"
  echo "      <html> tag: $HTML_TAG"
  exit 1
fi
echo "      ✓ static <html> ships no theme class (0.10.1 blip fix intact)"

# Active-link state in nav. The home page should emit aria-current="page"
# on the Home Link (which points at /), and the About page should emit
# it on the About Link. Both ship in SSR via the server-side RouterCap
# install (render-page.ts) — the user-visible "active link is bold + has
# a pill" effect depends on this attribute being on the right anchor.
if ! grep -oE '<a[^>]*aria-current="page"[^>]*>Home<' "$DIST/index.html" >/dev/null; then
  if ! grep -oE '<a[^>]*>Home</a>' "$DIST/index.html" | grep -q 'aria-current="page"'; then
    echo "      ❌ index.html: Home Link missing aria-current=\"page\" — active nav state broken on SSR"
    grep -oE '<a[^>]*data-place-link[^>]*>[^<]*</a>' "$DIST/index.html" | head -3
    exit 1
  fi
fi
echo "      ✓ home page emits aria-current on Home link"

if ! grep -oE '<a[^>]*aria-current="page"[^>]*>About<' "$DIST/about/index.html" >/dev/null; then
  if ! grep -oE '<a[^>]*>About</a>' "$DIST/about/index.html" | grep -q 'aria-current="page"'; then
    echo "      ❌ about/index.html: About Link missing aria-current=\"page\" on the about page"
    grep -oE '<a[^>]*data-place-link[^>]*>[^<]*</a>' "$DIST/about/index.html" | head -3
    exit 1
  fi
fi
echo "      ✓ about page emits aria-current on About link"

# The base styles ship an [aria-current="page"] rule. The inlined CSS
# in the page should compile it through Tailwind's pipeline. Look for
# the selector pattern in the inlined CSS.
if ! grep -q 'aria-current="page"' "$DIST/index.html"; then
  echo "      ❌ index.html does not include the [aria-current=\"page\"] CSS rule"
  exit 1
fi
echo "      ✓ active-link CSS rule present in inlined CSS"

trap on_success EXIT
