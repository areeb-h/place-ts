#!/bin/bash
# Scaffold a fresh minimal+theme-toggle+design-system app at /tmp/preview-app,
# rewrite deps to local 0.10.6 / 0.3.2 / 0.8.8 tarballs, install. This is the
# app the Claude_Preview tool will launch so we can actually SEE the FOUC /
# blip the user is reporting and inspect what's happening at runtime.
set -e
export PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin

REPO=/home/areeb/projects/place-ts
APP=/tmp/preview-app
rm -rf "$APP"

# Pack tarballs
for d in capability component data design devtools persistence reactivity routing search security; do
  (cd "$REPO/systems/$d" && bun pm pack >/dev/null 2>&1)
done

# Scaffold
(cd /tmp && bun "$REPO/tools/create-app/src/cli.ts" preview-app --yes --no-install \
  --template minimal --with theme-toggle --with design-system >/dev/null 2>&1)

# Rewrite deps
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs'
const p = '$APP/package.json'
const pkg = JSON.parse(readFileSync(p, 'utf8'))
const local = {
  '@place-ts/capability': 'file:$REPO/systems/capability/place-ts-capability-0.1.0.tgz',
  '@place-ts/component':  'file:$REPO/systems/component/place-ts-component-0.10.6.tgz',
  '@place-ts/data':       'file:$REPO/systems/data/place-ts-data-0.2.1.tgz',
  '@place-ts/design':     'file:$REPO/systems/design/place-ts-design-0.3.2.tgz',
  '@place-ts/devtools':   'file:$REPO/systems/devtools/place-ts-devtools-0.1.1.tgz',
  '@place-ts/persistence':'file:$REPO/systems/persistence/place-ts-persistence-0.1.1.tgz',
  '@place-ts/reactivity': 'file:$REPO/systems/reactivity/place-ts-reactivity-0.1.0.tgz',
  '@place-ts/routing':    'file:$REPO/systems/routing/place-ts-routing-0.1.1.tgz',
  '@place-ts/search':     'file:$REPO/systems/search/place-ts-search-0.2.0.tgz',
  '@place-ts/security':   'file:$REPO/systems/security/place-ts-security-0.1.1.tgz',
}
pkg.dependencies = { ...(pkg.dependencies ?? {}), ...local }
pkg.overrides = local
writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n')
"

# Install
(cd "$APP" && bun install --no-save 2>&1 | tail -3)

# Cleanup tarballs
for d in capability component data design devtools persistence reactivity routing search security; do
  rm -f "$REPO/systems/$d"/place-*.tgz 2>/dev/null
done

echo "READY at $APP"
