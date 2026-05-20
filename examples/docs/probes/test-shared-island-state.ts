// Hypothesis test: can two islands share a module-level signal via a
// third "shared" module + `splitting: true`?
//
// If yes, the MobileNavButton + MobileNavDrawer pattern (separate
// islands sharing `state(false)` for open/closed) works without any
// new framework primitive — just put the shared state in its own
// module and import from both islands.

import { gzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { buildIslandBundles } from '../../../systems/component/src/build/island-bundler.ts'
import { placeAutoImport } from '../../../systems/component/src/auto-import-plugin.ts'

const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`)

const TMP = resolve(import.meta.dir, '.tmp/shared-state')
await mkdir(TMP, { recursive: true })

// Shared module: holds the signal both islands read/write.
await writeFile(
  resolve(TMP, 'shared.ts'),
  `import { state } from '@place/component'
export const open = state(false)
`,
)

// Island A: the "button" that toggles the shared signal.
const islandASrc = resolve(TMP, 'opener.tsx')
await writeFile(
  islandASrc,
  `import { island } from '@place/component'
import { open } from './shared.ts'

export default island(import.meta.url, () => (
  <button onClick={() => open.set(!open())}>
    {() => (open() ? 'Close' : 'Open')}
  </button>
))
`,
)

// Island B: the "drawer" that reads the shared signal.
const islandBSrc = resolve(TMP, 'drawer.tsx')
await writeFile(
  islandBSrc,
  `import { island } from '@place/component'
import { open } from './shared.ts'

export default island(import.meta.url, () => (
  <div hidden={() => !open()}>
    {() => (open() ? 'I am open!' : 'I am closed!')}
  </div>
))
`,
)

console.log('Building two islands that import the same shared module…')
const result = await buildIslandBundles({
  islands: {
    opener: { component: null as never, src: islandASrc },
    drawer: { component: null as never, src: islandBSrc },
  },
  bundlePrefix: '/islands',
  plugins: [placeAutoImport()],
  define: { __PLACE_BROWSER__: 'true' },
  external: [
    '@tailwindcss/node',
    '@tailwindcss/oxide',
    'tailwindcss',
    'lightningcss',
    'bun:sqlite',
    'bun:test',
    'bun:ffi',
    'bun:redis',
  ],
  minify: true,
  sourcemap: 'none',
  entriesDir: resolve(TMP, 'entries'),
})

console.log('')
console.log(`Total bundles: ${result.bundles.size}`)
console.log('')
console.log(`${'url'.padEnd(50)} ${'raw'.padStart(11)} ${'gzip'.padStart(11)}`)
console.log('-'.repeat(75))
for (const [url, content] of result.bundles) {
  console.log(
    `${url.padEnd(50)} ${fmt(content.length).padStart(11)} ${fmt(gzipSync(content).length).padStart(11)}`,
  )
}

// Check: does the SHARED module appear in a chunk (good) or in BOTH entries (bad)?
console.log('')
console.log('=== Sharing check ===')
// Bundles are `Uint8Array` (T6-A SRI byte-stability). Decode for the
// shape-pattern probes below.
const dec = new TextDecoder()
const opener = dec.decode(result.bundles.get(result.nameToBundleUrl.get('opener')!)!)
const drawer = dec.decode(result.bundles.get(result.nameToBundleUrl.get('drawer')!)!)

// Heuristic: count `state(false)` or `state2(false)` initialization in each.
// If shared, the initialization should be in ONE chunk, not duplicated.
const stateInitPattern = /state[a-zA-Z0-9_$]*\(!1\)|state[a-zA-Z0-9_$]*\(false\)|state[a-zA-Z0-9_$]*\(\)/g
const openerHasInit = (opener.match(stateInitPattern) || []).length > 0
const drawerHasInit = (drawer.match(stateInitPattern) || []).length > 0
console.log(`Opener bundle has state() init pattern: ${openerHasInit}`)
console.log(`Drawer bundle has state() init pattern: ${drawerHasInit}`)

// Look for cross-bundle imports in entries.
const openerImports = (opener.match(/import.*from\s*"[^"]*\.js"/g) || [])
const drawerImports = (drawer.match(/import.*from\s*"[^"]*\.js"/g) || [])
console.log(`Opener entry imports: ${openerImports.length}`)
for (const i of openerImports) console.log(`    ${i}`)
console.log(`Drawer entry imports: ${drawerImports.length}`)
for (const i of drawerImports) console.log(`    ${i}`)

const chunkUrls = [...result.bundles.keys()].filter((u) => /chunk-/.test(u))
console.log(`Shared chunks: ${chunkUrls.length}`)
for (const u of chunkUrls) {
  const cBytes = result.bundles.get(u)!
  const c = dec.decode(cBytes)
  const hasShared = stateInitPattern.test(c)
  console.log(`  ${u}: ${fmt(cBytes.length)}  has-state-init=${hasShared}`)
}

console.log('')
console.log('=== Verdict ===')
console.log('If `opener` and `drawer` entries are TINY and a shared chunk')
console.log('contains the state init, two islands genuinely share the signal.')
console.log('Both bundles loaded on the page → both reference the same module → same state.')
