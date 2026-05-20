// T5-D verification — build the docs site's island bundles via the
// real `buildIslandBundles` pipeline and measure each.
//
// Run from project root:
//   bun examples/docs/probes/measure-docs-islands.ts

import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

import { buildIslandBundles } from '../../../systems/component/src/build/island-bundler.ts'
import { placeAutoImport } from '../../../systems/component/src/auto-import-plugin.ts'
import { ThemeToggle } from '../src/components/theme-toggle.tsx'

const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`)

console.log('Building docs island bundles…')
const t0 = performance.now()
const result = await buildIslandBundles({
  islands: {
    [ThemeToggle.__islandName]: {
      component: ThemeToggle as never,
      src: ThemeToggle.__islandSrc,
    },
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
  entriesDir: resolve(import.meta.dir, '.tmp/docs-islands'),
})
const elapsed = performance.now() - t0
console.log(`Built in ${elapsed.toFixed(0)}ms.`)

console.log('')
console.log(`${'island'.padEnd(28)} ${'url'.padEnd(36)} ${'raw'.padStart(11)} ${'gzip'.padStart(11)}`)
console.log('-'.repeat(90))
for (const [name, url] of result.nameToBundleUrl) {
  const content = result.bundles.get(url)!
  console.log(
    `${name.padEnd(28)} ${url.padEnd(36)} ${fmt(content.length).padStart(11)} ${fmt(gzipSync(content).length).padStart(11)}`,
  )
}
