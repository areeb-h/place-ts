#!/bin/bash
export PATH="$HOME/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -e
cd "$HOME/projects/place-ts"
for d in capability component data design devtools persistence reactivity routing search security; do
  (cd "systems/$d" && bun pm pack >/dev/null 2>&1)
done
cd "$HOME/projects/place-hello"
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs'
const p = process.env.HOME + '/projects/place-hello/package.json'
const pkg = JSON.parse(readFileSync(p, 'utf8'))
const repo = process.env.HOME + '/projects/place-ts'
const local = {
  '@place-ts/capability': 'file:' + repo + '/systems/capability/place-ts-capability-0.1.0.tgz',
  '@place-ts/component':  'file:' + repo + '/systems/component/place-ts-component-0.4.0.tgz',
  '@place-ts/data':       'file:' + repo + '/systems/data/place-ts-data-0.1.0.tgz',
  '@place-ts/design':     'file:' + repo + '/systems/design/place-ts-design-0.2.1.tgz',
  '@place-ts/devtools':   'file:' + repo + '/systems/devtools/place-ts-devtools-0.1.0.tgz',
  '@place-ts/persistence':'file:' + repo + '/systems/persistence/place-ts-persistence-0.1.0.tgz',
  '@place-ts/reactivity': 'file:' + repo + '/systems/reactivity/place-ts-reactivity-0.1.0.tgz',
  '@place-ts/routing':    'file:' + repo + '/systems/routing/place-ts-routing-0.1.0.tgz',
  '@place-ts/search':     'file:' + repo + '/systems/search/place-ts-search-0.1.0.tgz',
  '@place-ts/security':   'file:' + repo + '/systems/security/place-ts-security-0.1.0.tgz',
}
pkg.dependencies = { ...(pkg.dependencies ?? {}), ...local }
pkg.devDependencies = { ...(pkg.devDependencies ?? {}), '@place-ts/devtools': local['@place-ts/devtools'] }
pkg.overrides = local
writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n')
"
bun install 2>&1 | tail -3
echo done
