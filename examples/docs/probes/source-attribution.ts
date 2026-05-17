// T5-A follow-on — sourcemap-based byte attribution.
//
// Walks the docs app's bundle sourcemap and aggregates the bundle's
// output bytes by source-file. Groups source files into buckets:
//   - /systems/<name>/    → per-system contribution
//   - /examples/docs/     → docs-app code (pages, layout, components)
//   - node_modules        → external deps (should be tiny: framework is
//                           workspace deps)
//   - <other>             → anything that doesn't fit
//
// Approach: Bun.build with `sourcemap: 'external'` produces a .js.map
// alongside the .js. The sourcemap's `mappings` field encodes which
// source file each output position came from. We walk the mappings,
// count output bytes per source file, then bucket.

import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { gzipSync } from 'zlib'

interface SourceMap {
  version: number
  sources: string[]
  mappings: string
}

const ROOT = resolve(import.meta.dir, '../../..')
const DOCS_ENTRY = resolve(import.meta.dir, '../src/app.ts')

const fmt = (n: number): string =>
  n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`

// VLQ (variable-length quantity) base64 decoder — sourcemaps encode
// each segment as a series of VLQ-encoded integers.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_DECODE = new Map<string, number>()
for (let i = 0; i < B64.length; i++) B64_DECODE.set(B64[i]!, i)

function decodeVLQ(s: string, pos: { i: number }): number {
  let result = 0
  let shift = 0
  let cont = 0
  do {
    const ch = s[pos.i++]
    if (ch === undefined) return NaN
    const v = B64_DECODE.get(ch)
    if (v === undefined) return NaN
    cont = v & 32
    result |= (v & 31) << shift
    shift += 5
  } while (cont)
  // The lowest bit is the sign; the rest is the magnitude.
  const negate = result & 1
  result >>>= 1
  return negate ? -result : result
}

interface SourceContribution {
  source: string
  bytes: number
}

function attributeBytes(bundle: string, map: SourceMap): SourceContribution[] {
  const counts = new Map<number, number>() // sourceIndex → bytes
  const lines = bundle.split('\n')
  // Decode mappings line by line.
  const mappingLines = map.mappings.split(';')
  let lastSource = 0
  for (let lineIdx = 0; lineIdx < mappingLines.length; lineIdx++) {
    const segments = mappingLines[lineIdx]!.split(',').filter(Boolean)
    if (segments.length === 0) continue
    // Each segment: [genCol, sourceIdx, srcLine, srcCol, [nameIdx]]
    // (deltas, not absolutes). We only need sourceIdx.
    let lastGenCol = 0
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx]!
      const pos = { i: 0 }
      const genColDelta = decodeVLQ(seg, pos)
      if (isNaN(genColDelta)) continue
      const genCol = lastGenCol + genColDelta
      // Only present if segment has source info (segments can be
      // generated-only with just one VLQ).
      if (pos.i < seg.length) {
        const srcIdxDelta = decodeVLQ(seg, pos)
        if (!isNaN(srcIdxDelta)) {
          lastSource = lastSource + srcIdxDelta
        }
      }
      // Compute byte span: from this segment's genCol to the next
      // segment's genCol (or end of line).
      const nextGenCol =
        segIdx + 1 < segments.length
          ? (() => {
              const nextPos = { i: 0 }
              return lastGenCol + genColDelta + decodeVLQ(segments[segIdx + 1]!, nextPos)
            })()
          : (lines[lineIdx]?.length ?? 0)
      const span = Math.max(0, nextGenCol - genCol)
      counts.set(lastSource, (counts.get(lastSource) ?? 0) + span)
      lastGenCol = genCol
    }
  }
  const out: SourceContribution[] = []
  for (const [idx, bytes] of counts) {
    const source = map.sources[idx]
    if (source) out.push({ source, bytes })
  }
  out.sort((a, b) => b.bytes - a.bytes)
  return out
}

// Bucket assignment: turn an absolute or relative source path into a
// human-readable bucket name.
function bucketFor(source: string): string {
  // Bun emits sourcemap paths relative to the bundle output. Normalize:
  const s = source.replace(/^\.\.\//g, '').replace(/^.*place-ts\//, '')
  if (s.includes('node_modules')) return 'node_modules (external)'
  const sysMatch = s.match(/^systems\/([^/]+)\//)
  if (sysMatch) return `systems/${sysMatch[1]}`
  if (s.startsWith('examples/docs/src/pages/')) {
    const pageMatch = s.match(/^examples\/docs\/src\/pages\/([^/]+(?:\/[^/]+)?)/)
    return `docs page: ${pageMatch?.[1] ?? '<unknown>'}`
  }
  if (s.startsWith('examples/docs/src/components/')) {
    const compMatch = s.match(/^examples\/docs\/src\/components\/([^/]+)/)
    return `docs component: ${compMatch?.[1] ?? '<unknown>'}`
  }
  if (s.startsWith('examples/docs/src/layouts/')) return 'docs layout'
  if (s.startsWith('examples/docs/src/')) return 'docs other'
  return `other: ${s}`
}

// Build with external sourcemap so we can read it back.
console.log('Building docs app with external sourcemap...')
const out = await Bun.build({
  entrypoints: [DOCS_ENTRY],
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'external',
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
})
if (!out.success) {
  for (const log of out.logs) console.error(log)
  process.exit(1)
}

const jsOutput = out.outputs.find((o) => o.path.endsWith('.js'))!
const mapOutput = out.outputs.find((o) => o.path.endsWith('.js.map'))
if (!mapOutput) {
  console.error('No sourcemap output found — Bun.build sourcemap config may have changed')
  process.exit(1)
}

const bundleText = await jsOutput.text()
const mapText = await mapOutput.text()
const map = JSON.parse(mapText) as SourceMap

console.log(`Bundle: ${fmt(bundleText.length)} raw / ${fmt(gzipSync(bundleText).length)} gzipped`)
console.log(`Sources in sourcemap: ${map.sources.length}`)

const contributions = attributeBytes(bundleText, map)

// Bucket aggregate.
const buckets = new Map<string, { bytes: number; sources: string[] }>()
for (const c of contributions) {
  const b = bucketFor(c.source)
  const bucket = buckets.get(b) ?? { bytes: 0, sources: [] }
  bucket.bytes += c.bytes
  bucket.sources.push(c.source)
  buckets.set(b, bucket)
}
const sortedBuckets = [...buckets.entries()].sort((a, b) => b[1].bytes - a[1].bytes)

// Estimate per-bucket gzip impact: since gzip is non-linear, the
// "gzip equivalent" of a bucket is `bucket.bytes / totalRaw * totalGzip`.
const totalRaw = bundleText.length
const totalGzip = gzipSync(bundleText).length

console.log('\n=== Top 20 buckets ===')
console.log(`${'bucket'.padEnd(40)} ${'raw bytes'.padStart(12)} ${'~gzipped'.padStart(12)} ${'% total'.padStart(8)}`)
console.log('-'.repeat(80))
for (const [name, b] of sortedBuckets.slice(0, 20)) {
  const pct = ((b.bytes / totalRaw) * 100).toFixed(1)
  const gz = Math.round((b.bytes / totalRaw) * totalGzip)
  console.log(`${name.padEnd(40)} ${fmt(b.bytes).padStart(12)} ${fmt(gz).padStart(12)} ${pct.padStart(7)}%`)
}

// Top 30 individual contributors.
console.log('\n=== Top 30 individual sources ===')
console.log(`${'source'.padEnd(60)} ${'raw bytes'.padStart(12)}`)
console.log('-'.repeat(75))
for (const c of contributions.slice(0, 30)) {
  const short = c.source.replace(/^.*place-ts\//, '').slice(0, 58)
  console.log(`${short.padEnd(60)} ${fmt(c.bytes).padStart(12)}`)
}

// Write markdown report.
const mdLines: string[] = []
mdLines.push('# T5-A — sourcemap byte attribution')
mdLines.push('')
mdLines.push(`> Generated by \`examples/docs/probes/source-attribution.ts\` on ${new Date().toISOString().slice(0, 10)}.`)
mdLines.push('> Re-run via `bun examples/docs/probes/source-attribution.ts`.')
mdLines.push('')
mdLines.push(`## Bundle headline`)
mdLines.push('')
mdLines.push(`- **Bundle total:** ${fmt(totalRaw)} raw / ${fmt(totalGzip)} gzipped`)
mdLines.push(`- **Sources counted:** ${map.sources.length}`)
mdLines.push('')
mdLines.push('## Bucketed contribution')
mdLines.push('')
mdLines.push('Each bucket\'s `~gzipped` is a linear-share estimate (raw ratio × total gzipped). Gzip is non-linear so this is approximate; use raw bytes for precise comparison.')
mdLines.push('')
mdLines.push('| Bucket | Raw bytes | ~Gzipped | % of bundle |')
mdLines.push('|---|---:|---:|---:|')
for (const [name, b] of sortedBuckets) {
  const pct = ((b.bytes / totalRaw) * 100).toFixed(1)
  const gz = Math.round((b.bytes / totalRaw) * totalGzip)
  mdLines.push(`| ${name} | ${fmt(b.bytes)} | ${fmt(gz)} | ${pct}% |`)
}
mdLines.push('')
mdLines.push('## Top 30 individual sources')
mdLines.push('')
mdLines.push('| Source | Raw bytes |')
mdLines.push('|---|---:|')
for (const c of contributions.slice(0, 30)) {
  const short = c.source.replace(/^.*place-ts\//, '')
  mdLines.push(`| \`${short}\` | ${fmt(c.bytes)} |`)
}
mdLines.push('')
mdLines.push('## Reading the table')
mdLines.push('')
mdLines.push('Buckets with `systems/<name>` prefix tell us each system\'s contribution to the bundle. Watch for:')
mdLines.push('')
mdLines.push('- A system being LARGE but used by FEW pages — that\'s a leak per-route splitting fixes.')
mdLines.push('- A docs page bucket being LARGE — that page is doing too much; consider splitting interactive bits into islands.')
mdLines.push('- The single-largest source — often `index.ts` of `@place/component`, which is the framework barrel.')
mdLines.push('')

const outPath = resolve(ROOT, 'docs/probes/source-attribution.md')
await mkdir(dirname(outPath), { recursive: true })
await writeFile(outPath, mdLines.join('\n'))
console.log(`\nWritten: ${outPath}`)
