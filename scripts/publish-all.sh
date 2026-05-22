#!/usr/bin/env bash
# Publish every public @place-ts/* workspace package to npm in the
# right order (deps before dependents). Handles the `workspace:*`
# rewrite that `npm publish` doesn't do for you — without leaving the
# in-place rewrite committed.
#
# Usage:
#   bash scripts/publish-all.sh             # publishes everything
#   bash scripts/publish-all.sh --dry-run   # prep + pack only, no upload
#
# Pre-requisite: you're logged in to npm (`npm whoami` returns your
# user); each package's version in its package.json is the new version
# you want to publish.

set -e
set -u
set -o pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN="${1:-}"

# Publish order: deps before dependents.
PACKAGES=(
  capability
  reactivity
  routing
  security
  data
  persistence
  search
  component
  design
  devtools
)
TOOLS=(
  place
  create-app
)

revert() {
  echo
  echo "↻ reverting in-place workspace:* rewrites"
  (cd "$REPO" && git checkout -- systems tools 2>/dev/null) || true
}
trap revert EXIT INT TERM

echo "▶ Step 1/3: prep — rewriting workspace:* to concrete version pins"
bun "$REPO/scripts/prep-publish.ts" --apply

echo
echo "▶ Step 2/3: publish each package in dependency order"
for d in "${PACKAGES[@]}"; do
  pkg_dir="$REPO/systems/$d"
  if [[ ! -d "$pkg_dir" ]]; then
    echo "   skip systems/$d (not present)"
    continue
  fi
  name=$(node -p "require('$pkg_dir/package.json').name")
  version=$(node -p "require('$pkg_dir/package.json').version")
  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "   would publish $name@$version (dry-run: pack only)"
    (cd "$pkg_dir" && bun pm pack >/dev/null)
    echo "     packed: $pkg_dir/*.tgz"
  else
    echo "   publish $name@$version"
    (cd "$pkg_dir" && npm publish)
  fi
done

for d in "${TOOLS[@]}"; do
  pkg_dir="$REPO/tools/$d"
  if [[ ! -d "$pkg_dir" ]]; then
    echo "   skip tools/$d (not present)"
    continue
  fi
  name=$(node -p "require('$pkg_dir/package.json').name")
  version=$(node -p "require('$pkg_dir/package.json').version")
  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "   would publish $name@$version (dry-run: pack only)"
    (cd "$pkg_dir" && bun pm pack >/dev/null)
    echo "     packed: $pkg_dir/*.tgz"
  else
    echo "   publish $name@$version"
    (cd "$pkg_dir" && npm publish)
  fi
done

echo
echo "▶ Step 3/3: revert local workspace:* rewrites (trap runs this)"
# Trap will fire on EXIT.

echo
echo "✓ publish-all done"
