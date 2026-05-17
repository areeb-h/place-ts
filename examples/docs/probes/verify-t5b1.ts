// T5-B-1 verification probe — runs the REAL splitter (the same one
// `serve()` now calls when `clientEntries` is provided) over the
// docs app's per-route entry map. Measures each bundle.

import { gzipSync } from 'zlib'
import { resolve } from 'path'

import { buildRouteSplitBundles } from '../../../systems/component/src/build/route-splitter.ts'
import { placeAutoImport } from '../../../systems/component/src/auto-import-plugin.ts'

const DOCS_ROOT = resolve(import.meta.dir, '..')

const clientEntries: Record<string, string> = {
  '/': './src/pages/index.page.tsx',
  '/getting-started': './src/pages/getting-started.page.tsx',
  '/why': './src/pages/why.page.tsx',
  '/concepts/reactivity': './src/pages/concepts/reactivity.page.tsx',
  '/concepts/capabilities': './src/pages/concepts/capabilities.page.tsx',
  '/concepts/routes-as-values': './src/pages/concepts/routes-as-values.page.tsx',
  '/concepts/ssr': './src/pages/concepts/ssr.page.tsx',
  '/concepts/security': './src/pages/concepts/security.page.tsx',
  '/api/page': './src/pages/api/page.page.tsx',
  '/api/app': './src/pages/api/app.page.tsx',
  '/api/layout': './src/pages/api/layout.page.tsx',
  '/api/state': './src/pages/api/state.page.tsx',
  '/api/components': './src/pages/api/components.page.tsx',
  '/api/action': './src/pages/api/action.page.tsx',
  '/api/defineCapability': './src/pages/api/define-capability.page.tsx',
  '/api/motion': './src/pages/api/motion.page.tsx',
  '/api/design': './src/pages/api/design.page.tsx',
  '/recipes': './src/pages/recipes/index.page.tsx',
  '/recipes/forms': './src/pages/recipes/forms.page.tsx',
  '/recipes/data-fetching': './src/pages/recipes/data-fetching.page.tsx',
  '/recipes/auth': './src/pages/recipes/auth.page.tsx',
  '/recipes/streaming': './src/pages/recipes/streaming.page.tsx',
  '/recipes/theming': './src/pages/recipes/theming.page.tsx',
  '/examples': './src/pages/examples.page.tsx',
  '/roadmap': './src/pages/roadmap.page.tsx',
}

// Resolve to absolute paths so the splitter can find them when run from
// project root.
const resolvedEntries: Record<string, string> = {}
for (const [route, src] of Object.entries(clientEntries)) {
  resolvedEntries[route] = resolve(DOCS_ROOT, src)
}

const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`)

console.log('Running route splitter on the docs app...')
const start = performance.now()
const result = await buildRouteSplitBundles({
  clientEntries: resolvedEntries,
  clientEntry: resolve(DOCS_ROOT, 'src/app.ts'),
  clientPath: '/client.js',
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
})
const elapsed = performance.now() - start
console.log(`Splitter ran in ${elapsed.toFixed(0)}ms`)
console.log(`Total bundles emitted: ${result.bundleCount}`)
console.log(`Total bytes (raw): ${fmt(result.totalBytes)}`)
console.log('')

console.log('=== Per-bundle sizes ===')
console.log(`${'url'.padEnd(60)} ${'raw'.padStart(11)} ${'gzip'.padStart(11)}`)
console.log('-'.repeat(85))
const bundleList = [...result.bundles.entries()]
  .map(([url, content]) => ({ url, raw: content.length, gz: gzipSync(content).length }))
  .sort((a, b) => b.raw - a.raw)
let totalGz = 0
for (const b of bundleList) {
  console.log(`${b.url.padEnd(60)} ${fmt(b.raw).padStart(11)} ${fmt(b.gz).padStart(11)}`)
  totalGz += b.gz
}
console.log('-'.repeat(85))
console.log(`Total gzipped (all bundles): ${fmt(totalGz)}`)

console.log('')
console.log('=== Per-route mapping ===')
for (const [route, bundle] of result.routeToBundle) {
  const b = result.bundles.get(bundle)!
  const gz = gzipSync(b).length
  console.log(`${route.padEnd(40)} -> ${bundle.padEnd(40)}  ${fmt(gz).padStart(11)}`)
}
console.log(`Fallback (clientEntry default): ${result.defaultBundleUrl ?? '(none)'}`)

console.log('')
console.log('=== Summary ===')
const perRoute = [...result.routeToBundle.entries()].map(([route, bundleUrl]) => {
  const content = result.bundles.get(bundleUrl)!
  return { route, gz: gzipSync(content).length }
})
const avgGz = perRoute.reduce((a, b) => a + b.gz, 0) / perRoute.length
const minGz = Math.min(...perRoute.map((r) => r.gz))
const maxGz = Math.max(...perRoute.map((r) => r.gz))

// Find shared chunks (entries in bundles map NOT in routeToBundle values).
const routeBundles = new Set([...result.routeToBundle.values()])
const sharedBundles = [...result.bundles.entries()]
  .filter(([url]) => !routeBundles.has(url) && url !== result.defaultBundleUrl)
  .map(([url, content]) => ({ url, gz: gzipSync(content).length }))
const sharedTotalGz = sharedBundles.reduce((a, b) => a + b.gz, 0)

console.log(`Route bundles (just route's own code): avg ${fmt(avgGz)}, min ${fmt(minGz)}, max ${fmt(maxGz)}`)
console.log(`Shared chunks (loaded once, cached): ${sharedBundles.length} chunks, ${fmt(sharedTotalGz)} total`)
console.log(`First-load (route + all shared): ~${fmt(avgGz + sharedTotalGz)} avg per page`)
console.log(`Compare: pre-T5-B-1 single-bundle: 62.20 KB per page`)
const winPct = (((62 * 1024 - (avgGz + sharedTotalGz)) / (62 * 1024)) * 100).toFixed(0)
console.log(`Win: ~${winPct}% reduction on first load; near 100% on subsequent navigations`)
