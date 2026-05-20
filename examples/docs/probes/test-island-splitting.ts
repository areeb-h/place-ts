// Hypothesis test — when multiple islands share the framework
// runtime, does `splitting: true` extract a shared chunk and shrink
// the total bytes a page with N islands ships?

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { placeAutoImport } from '../../../systems/component/src/auto-import-plugin.ts'
import { buildIslandBundles } from '../../../systems/component/src/build/island-bundler.ts'

const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`)

// Generate 3 distinct islands, all using state() so they each pull the
// framework runtime in.
const TMP = resolve(import.meta.dir, '.tmp/multi-islands')
await mkdir(TMP, { recursive: true })
const islands: Record<string, { component: never; src: string }> = {}
for (const name of ['alpha', 'beta', 'gamma']) {
  const src = resolve(TMP, `${name}.tsx`)
  await writeFile(
    src,
    `import { island, state } from '@place/component'

export default island(import.meta.url, ({ start = 0 }: { start?: number }) => {
  const count = state(start)
  return (
    <button onClick={() => count.set(count() + 1)}>
      ${name}: {() => String(count())}
    </button>
  )
})
`,
  )
  islands[name] = { component: null as never, src }
}

console.log('Building 3 islands…')
const result = await buildIslandBundles({
  islands,
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
const allEntries = [...result.bundles.entries()].sort((a, b) => b[1].length - a[1].length)
let totalRaw = 0
let totalGz = 0
for (const [url, content] of allEntries) {
  const gz = gzipSync(content).length
  console.log(`${url.padEnd(50)} ${fmt(content.length).padStart(11)} ${fmt(gz).padStart(11)}`)
  totalRaw += content.length
  totalGz += gz
}
console.log('-'.repeat(75))
console.log(`Total (raw / gzip): ${fmt(totalRaw)} / ${fmt(totalGz)}`)
console.log('')
console.log('What a page with all 3 islands ships:')
const entries = [...result.nameToBundleUrl.values()]
const entryGz = entries.reduce((a, u) => a + gzipSync(result.bundles.get(u)!).length, 0)
const sharedGz = totalGz - entryGz
console.log(`  Entries: ${entries.length} × ${fmt(entryGz / entries.length)} ≈ ${fmt(entryGz)} gzipped`)
console.log(`  Shared chunks: ${fmt(sharedGz)} gzipped (loaded once, cached)`)
console.log(`  First-load total: ${fmt(entryGz + sharedGz)}`)
console.log(`  Per-island avg first-load cost: ${fmt((entryGz + sharedGz) / entries.length)}`)
console.log('')
console.log('Compare:')
console.log(`  Old per-island (no splitting): 3 × ~10 KB = ~30 KB`)
console.log(`  Per-route (T5-B-1): ~14 KB per page`)
console.log(`  Astro per-component: 3-5 KB`)
