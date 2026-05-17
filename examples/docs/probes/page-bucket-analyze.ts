// Forensics for the 21 KB `page` bucket from the bundle breakdown.
// Builds a minimal page-using bundle with a source map, then parses
// the source map's mappings to attribute output bytes back to each
// source file. Output: a ranked table of contributors.
//
// Run from project root:
//   bun examples/docs/probes/page-bucket-analyze.ts

import { mkdir, writeFile } from 'fs/promises'
import { gzipSync } from 'zlib'

const PROBE_DIR = `${import.meta.dir}/.tmp/page-only`
const PROBE_ENTRY = `${PROBE_DIR}/entry.ts`

// Minimal page-using app. One page, one layout, one app() call. The
// rest of the framework's surface deliberately NOT used so we isolate
// what `page` drags in.
const PROBE_CODE = `
import { app, el, layout, page } from '@place/component'

const home = page('/', {
  view: () => el('h1', {}, ['hi']),
})

const root = layout({
  view: ({ children }) => el('div', {}, [children]),
})

export default app({
  pages: [home],
  layout: root,
})
`

await mkdir(PROBE_DIR, { recursive: true })
await writeFile(PROBE_ENTRY, PROBE_CODE)

const out = await Bun.build({
  entrypoints: [PROBE_ENTRY],
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'inline',
  // Match the framework's own client-bundle config so the probe
  // measures what the docs site actually ships.
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
})

if (!out.success) {
  for (const log of out.logs) console.error(log)
  process.exit(1)
}

const bundleText = await out.outputs[0].text()
// The "raw" we care about excludes the inline source map appended for
// analysis. Find the sourceMappingURL marker and slice it off so the
// reported total matches what a real production build (no source map)
// would ship.
const mapMarkerEarly = '//# sourceMappingURL=data:application/json;base64,'
const codeEnd = bundleText.lastIndexOf(mapMarkerEarly)
const codeText = codeEnd > 0 ? bundleText.slice(0, codeEnd) : bundleText
const totalRaw = new TextEncoder().encode(codeText).byteLength
const totalGz = gzipSync(codeText).byteLength
console.log(`page-only bundle (code only, no source map): ${totalRaw.toLocaleString()} B raw, ${totalGz.toLocaleString()} B gzipped\n`)

// ---------- Source-map extraction ----------
//
// Bun emits inline source maps as a base64-encoded JSON appended via
// `//# sourceMappingURL=data:application/json;base64,…`. Extract it.
const mapMarker = '//# sourceMappingURL=data:application/json;base64,'
const idx = bundleText.lastIndexOf(mapMarker)
if (idx < 0) {
  console.error('No inline source map found in bundle output')
  process.exit(1)
}
const b64 = bundleText.slice(idx + mapMarker.length).trim()
const mapJson = JSON.parse(atob(b64)) as {
  version: number
  sources: string[]
  mappings: string
}

// ---------- VLQ + mapping parse ----------
//
// Source-map V3 mappings: lines separated by ';', segments by ','.
// Each segment encodes [generatedColumn, sourceIndex, sourceLine,
// sourceColumn, (optional nameIndex)] as Base64 VLQ values.
// We only need to count generated-column-spans per sourceIndex.
const B64_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Map<string, number>()
for (let i = 0; i < B64_TABLE.length; i++) B64_INDEX.set(B64_TABLE[i] ?? '', i)

function decodeVlq(input: string, start: number): { value: number; next: number } {
  let result = 0
  let shift = 0
  let i = start
  while (true) {
    const ch = input[i]
    if (ch === undefined) throw new Error('truncated VLQ')
    const v = B64_INDEX.get(ch)
    if (v === undefined) throw new Error(`bad VLQ char: ${ch}`)
    i++
    const cont = (v & 0b100000) !== 0
    const digit = v & 0b011111
    result |= digit << shift
    shift += 5
    if (!cont) break
  }
  // ZigZag decode
  const negative = (result & 1) !== 0
  result >>>= 1
  return { value: negative ? -result : result, next: i }
}

// Generated text is split per line in source maps. We need the byte
// (well, code-unit) cost of each segment span — distance from the
// segment's generated column to the next segment's generated column
// on the same line, falling back to end-of-line.
const bundleLines = bundleText.split('\n')
const bytesPerSource = new Map<number, number>()

let sourceIndex = 0
let sourceLine = 0
let sourceCol = 0
const mappings = mapJson.mappings
const lines = mappings.split(';')

for (let li = 0; li < lines.length; li++) {
  const lineMappings = lines[li]
  if (!lineMappings) continue
  const generatedLineText = bundleLines[li] ?? ''
  const generatedLineLen = generatedLineText.length

  const segs = lineMappings.split(',')
  // First, parse all segments on this line to know their generated
  // columns so we can compute span length to the next segment.
  type Segment = { genCol: number; src: number | null }
  const parsed: Segment[] = []
  let genCol = 0
  for (const seg of segs) {
    if (seg.length === 0) continue
    let p = 0
    const dGen = decodeVlq(seg, p)
    p = dGen.next
    genCol += dGen.value
    if (p >= seg.length) {
      // 1-element segment — no source mapping
      parsed.push({ genCol, src: null })
      continue
    }
    const dSrc = decodeVlq(seg, p)
    p = dSrc.next
    sourceIndex += dSrc.value
    if (p < seg.length) {
      const dLine = decodeVlq(seg, p)
      p = dLine.next
      sourceLine += dLine.value
    }
    if (p < seg.length) {
      const dCol = decodeVlq(seg, p)
      p = dCol.next
      sourceCol += dCol.value
    }
    parsed.push({ genCol, src: sourceIndex })
  }
  // Attribute span lengths to sources.
  for (let i = 0; i < parsed.length; i++) {
    const cur = parsed[i]
    if (!cur || cur.src === null) continue
    const next = parsed[i + 1]
    const endCol = next ? next.genCol : generatedLineLen
    const span = Math.max(0, endCol - cur.genCol)
    bytesPerSource.set(cur.src, (bytesPerSource.get(cur.src) ?? 0) + span)
  }
}

// ---------- Aggregate by source file ----------
type Row = { source: string; bytes: number }
const rows: Row[] = []
for (const [idx, bytes] of bytesPerSource) {
  const name = mapJson.sources[idx] ?? `(unknown #${idx})`
  rows.push({ source: name, bytes })
}
rows.sort((a, b) => b.bytes - a.bytes)

// Group: framework systems / devalue / app / other
type Bucket = { name: string; bytes: number; rows: Row[] }
const buckets: Record<string, Bucket> = {
  'reactivity': { name: 'reactivity', bytes: 0, rows: [] },
  'routing': { name: 'routing', bytes: 0, rows: [] },
  'capability': { name: 'capability', bytes: 0, rows: [] },
  'component/index.ts': { name: 'component/index.ts', bytes: 0, rows: [] },
  'component/app.ts': { name: 'component/app.ts', bytes: 0, rows: [] },
  'component/action.ts': { name: 'component/action.ts', bytes: 0, rows: [] },
  'component/cache.ts': { name: 'component/cache.ts', bytes: 0, rows: [] },
  'component/meta.ts': { name: 'component/meta.ts', bytes: 0, rows: [] },
  'component/security-headers.ts': { name: 'component/security-headers.ts', bytes: 0, rows: [] },
  'component/theme.ts': { name: 'component/theme.ts', bytes: 0, rows: [] },
  'component/jsx-runtime.ts': { name: 'component/jsx-runtime.ts', bytes: 0, rows: [] },
  'component/link.ts': { name: 'component/link.ts', bytes: 0, rows: [] },
  'component/cookies.ts': { name: 'component/cookies.ts', bytes: 0, rows: [] },
  'component/recipe.ts': { name: 'component/recipe.ts', bytes: 0, rows: [] },
  'component/twmerge.ts': { name: 'component/twmerge.ts', bytes: 0, rows: [] },
  'component/utils': { name: 'component/utils/*', bytes: 0, rows: [] },
  'component/runtime': { name: 'component/__place_runtime.ts', bytes: 0, rows: [] },
  'component/build-static.ts': { name: 'component/build-static.ts', bytes: 0, rows: [] },
  'component/form.ts': { name: 'component/form.ts', bytes: 0, rows: [] },
  'devalue': { name: 'devalue (vendored)', bytes: 0, rows: [] },
  'app': { name: 'probe app code', bytes: 0, rows: [] },
  'other': { name: 'other', bytes: 0, rows: [] },
}

const classify = (src: string): keyof typeof buckets => {
  if (src.includes('/reactivity/')) return 'reactivity'
  if (src.includes('/routing/')) return 'routing'
  if (src.includes('/capability/')) return 'capability'
  if (src.includes('devalue')) return 'devalue'
  if (src.endsWith('entry.ts') || src.endsWith('.tmp/page-only/entry.ts')) return 'app'
  if (src.includes('/component/src/index.ts')) return 'component/index.ts'
  if (src.includes('/component/src/app.ts')) return 'component/app.ts'
  if (src.includes('/component/src/action.ts')) return 'component/action.ts'
  if (src.includes('/component/src/cache.ts')) return 'component/cache.ts'
  if (src.includes('/component/src/meta.ts')) return 'component/meta.ts'
  if (src.includes('/component/src/security-headers.ts')) return 'component/security-headers.ts'
  if (src.includes('/component/src/theme.ts')) return 'component/theme.ts'
  if (src.includes('/component/src/jsx-runtime.ts')) return 'component/jsx-runtime.ts'
  if (src.includes('/component/src/link.ts')) return 'component/link.ts'
  if (src.includes('/component/src/cookies.ts')) return 'component/cookies.ts'
  if (src.includes('/component/src/recipe.ts')) return 'component/recipe.ts'
  if (src.includes('/component/src/twmerge.ts')) return 'component/twmerge.ts'
  if (src.includes('/component/src/__place_runtime.ts')) return 'component/runtime'
  if (src.includes('/component/src/build-static.ts')) return 'component/build-static.ts'
  if (src.includes('/component/src/form.ts')) return 'component/form.ts'
  if (src.includes('/component/src/utils/')) return 'component/utils'
  return 'other'
}

for (const r of rows) {
  const b = classify(r.source)
  const bucket = buckets[b]
  if (!bucket) continue
  bucket.bytes += r.bytes
  bucket.rows.push(r)
}

const sortedBuckets = Object.values(buckets)
  .filter((b) => b.bytes > 0)
  .sort((a, b) => b.bytes - a.bytes)

const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)
const pct = (n: number): string => `${((n / totalRaw) * 100).toFixed(1)}%`

console.log('Bucketed (raw bytes in minified bundle, sorted):')
console.log()
console.log(`${'bucket'.padEnd(36)} ${'bytes'.padStart(10)} ${'%'.padStart(7)}`)
console.log('-'.repeat(56))
let attributed = 0
for (const b of sortedBuckets) {
  console.log(`${b.name.padEnd(36)} ${fmt(b.bytes).padStart(10)} ${pct(b.bytes).padStart(7)}`)
  attributed += b.bytes
}
console.log('-'.repeat(56))
console.log(
  `${'attributed total'.padEnd(36)} ${fmt(attributed).padStart(10)} ${pct(attributed).padStart(7)}`,
)
console.log(`${'unattributed (minifier glue)'.padEnd(36)} ${fmt(totalRaw - attributed).padStart(10)}`)
