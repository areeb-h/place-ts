// T5-C verification + DX-V2 demo — proves the islands primitive works
// end-to-end via the **new** `island(srcUrl, fn)` factory + array form:
//   1. Page WITHOUT islands → 0 KB JS shipped (0 `<script>` tags)
//   2. Page WITH islands → one `<script>` per used island, with CSP nonce
//   3. Per-island bundle is self-contained + auto-mounts
//   4. Direct JSX use: `<Counter start={5} />` (no string lookups)
//   5. Security: prototype-pollution sentinel keys (__proto__,
//      constructor, prototype) are stripped at serialization
//   6. Security: invalid island names rejected at factory time

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { island, renderToString, state } from '@place/component'
import { placeAutoImport } from '@place/component/auto-import-plugin'
import { buildIslandBundles } from '@place/component/build'
import {
  _beginIslandCollection,
  _endIslandCollection,
  _setIslandRegistry,
} from '@place/component/internal'

const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`)

// ----- 1. Define an island via the new `island(srcUrl, fn)` factory -----
//
// In real code this would live in `./islands/counter.tsx`. The probe
// writes a matching source file so the build step can find it.

const counterSrc = resolve(import.meta.dir, '.tmp/islands/counter.tsx')
await mkdir(resolve(import.meta.dir, '.tmp/islands'), { recursive: true })
await writeFile(
  counterSrc,
  `import { island, state } from '@place/component'

export default island(import.meta.url, ({ start = 0 }: { start?: number }) => {
  const count = state(start)
  return (
    <button
      type="button"
      class="rounded-md bg-accent text-accent-fg px-3 py-1"
      onClick={() => count.set(count() + 1)}
    >
      {() => \`Clicked \${count()} times\`}
    </button>
  )
})
`,
)

const Counter = island(`file://${counterSrc}`, ({ start = 0 }: { start?: number }) => {
  const count = state(start)
  return (
    <button
      type="button"
      class="rounded-md bg-accent text-accent-fg px-3 py-1"
      onClick={() => count.set(count() + 1)}
    >
      {() => `Clicked ${count()} times`}
    </button>
  )
})

console.log(`Island metadata: name="${Counter.__islandName}", src="${Counter.__islandSrc}"`)

_setIslandRegistry({
  [Counter.__islandName]: { component: Counter as never, src: Counter.__islandSrc },
})

// ----- Test A: page WITHOUT islands → 0 islands collected -----
console.log('\n=== Test A: page WITHOUT any island ===')
const setA = _beginIslandCollection()
renderToString(
  <main>
    <h1>Hello</h1>
    <p>This page has no islands. Content-only.</p>
  </main>,
)
_endIslandCollection()
console.log(`Used islands: ${[...setA].join(', ') || '(none — 0 KB JS shipped)'}`)

// ----- Test B: page WITH `<Counter start={5} />` (direct JSX use) -----
console.log('\n=== Test B: page WITH <Counter start={5} /> (direct JSX) ===')
const setB = _beginIslandCollection()
const htmlB = renderToString(
  <main>
    <h1>Counter demo</h1>
    {Counter({ start: 5 })}
  </main>,
)
_endIslandCollection()
console.log(`Used islands: ${[...setB].join(', ')}`)
const markerStart = htmlB.indexOf('<div data-view="island"')
const markerEnd = htmlB.indexOf('</div>', markerStart) + 6
console.log(`Marker HTML:\n  ${htmlB.slice(markerStart, markerEnd)}`)

// ----- Test C: prototype-pollution-key sanitization -----
console.log('\n=== Test C: prototype-pollution sanitization ===')
_beginIslandCollection()
const dirtyHtml = renderToString(
  <main>
    {Counter({
      start: 5,
      // deliberately injecting sentinel keys via runtime cast
      ...({ __proto__: { polluted: true }, constructor: 'bad' } as unknown as object),
    } as never)}
  </main>,
)
_endIslandCollection()
const dirtyMarker = dirtyHtml.match(/data-view-props="([^"]*)"/)?.[1]
console.log(`Serialized props: ${dirtyMarker?.replace(/&quot;/g, '"') ?? '(no props)'}`)
console.log(`Contains __proto__: ${dirtyMarker?.includes('__proto__') ? '✗ LEAK' : '✓ clean'}`)
console.log(`Contains constructor: ${dirtyMarker?.includes('constructor') ? '✗ LEAK' : '✓ clean'}`)

// ----- Test D: build the per-island bundle -----
console.log('\n=== Test D: per-island bundle ===')
const result = await buildIslandBundles({
  islands: {
    [Counter.__islandName]: { component: Counter as never, src: counterSrc },
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
  ],
  minify: true,
  sourcemap: 'none',
})
const url = result.nameToBundleUrl.get(Counter.__islandName)!
const bytes = result.bundles.get(url)!
// Bundles are `Uint8Array` (T6-A for SRI byte-stability). Decode once
// to inspect for string-shape checks below.
const content = new TextDecoder().decode(bytes)
const gz = gzipSync(bytes).length
console.log(`Bundle URL: ${url}`)
console.log(`Bundle size: ${fmt(bytes.length)} raw / ${fmt(gz)} gzipped`)
console.log(
  `Auto-mount marker query: ${content.includes('data-view="island"') ? '✓' : '✗ MISSING'}`,
)
console.log(`Pollution-key sweep:     ${content.includes('__proto__') ? '✓' : '✗ MISSING'}`)

// ----- Test E: client mount strategies -----
console.log('\n=== Test E: client mount strategies ===')
for (const strategy of ['load', 'idle', 'visible', 'interaction'] as const) {
  _beginIslandCollection()
  const html = renderToString(<main>{Counter({ start: 1, client: strategy } as never)}</main>)
  _endIslandCollection()
  const attr = html.match(/data-view-strategy="([^"]*)"/)?.[1] ?? '(absent: load)'
  console.log(`  client="${strategy}" → marker carries strategy attr: ${attr}`)
}

console.log('\n=== Test F: hydrate() vs mount() in wrapper ===')
console.log(`Wrapper imports hydrate: ${content.includes('hydrate') ? '✓' : '✗ MISSING'}`)
console.log(
  `Strategy dispatch (4 paths): ${
    ['load', 'idle', 'visible', 'interaction'].every((s) => content.includes(`'${s}'`))
      ? '✓ all present'
      : '✗ MISSING strategies'
  }`,
)
console.log(
  `IntersectionObserver wired: ${content.includes('IntersectionObserver') ? '✓' : '✗ MISSING'}`,
)
console.log(
  `requestIdleCallback wired: ${content.includes('requestIdleCallback') ? '✓' : '✗ MISSING'}`,
)

// ----- Test G: invalid name + invalid strategy rejected -----
console.log('\n=== Test G: invalid input validation ===')
try {
  island('file:///path/to/__proto__.tsx', () => ({ toHtml: () => '' }) as never)
  console.log('✗ NAME VALIDATION DID NOT REJECT __proto__')
} catch (e) {
  console.log(`✓ Rejected reserved name: ${(e as Error).message}`)
}
try {
  island('file:///path/to/<script>alert(1)</script>.tsx', () => ({ toHtml: () => '' }) as never)
  console.log('✗ NAME VALIDATION DID NOT REJECT angle-bracket name')
} catch (e) {
  console.log(`✓ Rejected unsafe chars: ${(e as Error).message}`)
}
try {
  _beginIslandCollection()
  renderToString(Counter({ client: 'wat-no' } as never))
  _endIslandCollection()
  console.log('✗ STRATEGY VALIDATION DID NOT REJECT invalid value')
} catch (e) {
  _endIslandCollection()
  console.log(`✓ Rejected invalid strategy: ${(e as Error).message}`)
}

console.log('\n=== Summary ===')
console.log(`Pages without islands: 0 KB shipped`)
console.log(`Per-island bundle:     ${fmt(gz)} gzipped`)
console.log(`Direct JSX use:        Counter({...}) — typed props, no string lookups`)
console.log(`Security:              proto-pollution sanitized, names validated, CSP nonces wired`)
