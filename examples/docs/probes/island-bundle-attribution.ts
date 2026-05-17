// T5-E pre-work: what's actually in the per-island bundle?
//
// Sourcemap-based byte attribution for a sample island. Output tells
// us which source files contribute what — so we know which systems
// (component, reactivity, etc.) are bloating the floor, and which
// could be conditionally stripped via per-system __PLACE_USES_X__
// defines.

import { gzipSync } from 'zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const TMP = resolve(import.meta.dir, '.tmp/island-bundle-audit')
await mkdir(TMP, { recursive: true })

const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`)

// Write a minimal island source: signal-driven counter.
const islandSrc = resolve(TMP, 'counter.tsx')
await writeFile(
  islandSrc,
  `import { island, state } from '@place/component'

export default island(import.meta.url, ({ start = 0 }: { start?: number }) => {
  const count = state(start)
  return <button onClick={() => count.set(count() + 1)}>{count}</button>
})
`,
)

// Write the auto-mount wrapper (manually, mirroring what the bundler
// generates — we want to measure the WRAPPER + ISLAND combined since
// that's what serve() ships).
const frameworkSrc = resolve(ROOT, 'systems/component/src/index.ts')
const wrapperSrc = resolve(TMP, 'wrapper.entry.ts')
await writeFile(
  wrapperSrc,
  `import islandComponent from ${JSON.stringify(islandSrc)}
import { hydrate, mount } from ${JSON.stringify(frameworkSrc)}

// Mimic the bundler's footer so the size matches what users ship.
// T8-C wire format: unified `data-view-*` attributes (ADR 0030).
const NAME = 'counter'
function readProps(el: HTMLElement): Record<string, unknown> {
  const raw = el.dataset.viewProps
  if (!raw) return {}
  try { return JSON.parse(raw) as Record<string, unknown> } catch { return {} }
}
function hydrateOne(el: HTMLElement): void {
  if (el.dataset.viewMounted === '1') return
  el.dataset.viewMounted = '1'
  const view = islandComponent(readProps(el))
  if (view && typeof view.hydrate === 'function' && el.firstChild) {
    hydrate(view, el)
  } else {
    mount(view, el)
  }
}
function scanAndSchedule(): void {
  const selector = '[data-view="island"][data-view-id="' + NAME + '"]'
  for (const el of document.querySelectorAll(selector)) hydrateOne(el as HTMLElement)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanAndSchedule)
else scanAndSchedule()
`,
)

const out = await Bun.build({
  entrypoints: [wrapperSrc],
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
const jsOut = out.outputs.find((o) => o.path.endsWith('.js'))!
const mapOut = out.outputs.find((o) => o.path.endsWith('.js.map'))!
const bundleText = await jsOut.text()
const mapText = await mapOut.text()
console.log(`Bundle: ${fmt(bundleText.length)} raw / ${fmt(gzipSync(bundleText).length)} gzipped`)

// Parse sourcemap, attribute bytes per source.
interface SourceMap {
  version: number
  sources: string[]
  mappings: string
}
const map = JSON.parse(mapText) as SourceMap
console.log(`Sources in sourcemap: ${map.sources.length}`)

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
  const negate = result & 1
  result >>>= 1
  return negate ? -result : result
}

function attribute(bundle: string, map: SourceMap): Map<string, number> {
  const counts = new Map<number, number>()
  const lines = bundle.split('\n')
  const mappingLines = map.mappings.split(';')
  let lastSource = 0
  for (let lineIdx = 0; lineIdx < mappingLines.length; lineIdx++) {
    const segs = mappingLines[lineIdx]!.split(',').filter(Boolean)
    let lastGenCol = 0
    for (let segIdx = 0; segIdx < segs.length; segIdx++) {
      const seg = segs[segIdx]!
      const pos = { i: 0 }
      const genColDelta = decodeVLQ(seg, pos)
      if (isNaN(genColDelta)) continue
      const genCol = lastGenCol + genColDelta
      if (pos.i < seg.length) {
        const srcDelta = decodeVLQ(seg, pos)
        if (!isNaN(srcDelta)) lastSource += srcDelta
      }
      const nextGenCol =
        segIdx + 1 < segs.length
          ? lastGenCol + genColDelta + decodeVLQ(segs[segIdx + 1]!, { i: 0 })
          : (lines[lineIdx]?.length ?? 0)
      const span = Math.max(0, nextGenCol - genCol)
      counts.set(lastSource, (counts.get(lastSource) ?? 0) + span)
      lastGenCol = genCol
    }
  }
  const out = new Map<string, number>()
  for (const [idx, bytes] of counts) {
    const src = map.sources[idx]
    if (src) out.set(src, bytes)
  }
  return out
}

const sourceBytes = attribute(bundleText, map)

// Bucket by system.
const buckets = new Map<string, number>()
for (const [src, bytes] of sourceBytes) {
  const normalized = src.replace(/^.*place-ts\//, '')
  let bucket = 'other'
  const sysMatch = normalized.match(/^systems\/([^/]+)\//)
  if (sysMatch) bucket = `systems/${sysMatch[1]}`
  else if (normalized.includes('.tmp/island-bundle-audit')) bucket = 'island + wrapper (user code)'
  else if (normalized.includes('node_modules')) bucket = 'node_modules'
  else bucket = `other: ${normalized}`
  buckets.set(bucket, (buckets.get(bucket) ?? 0) + bytes)
}

const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1])
const total = sorted.reduce((a, b) => a + b[1], 0)
console.log('')
console.log('=== Per-bucket attribution ===')
console.log(`${'bucket'.padEnd(48)} ${'raw'.padStart(11)} ${'% bundle'.padStart(10)}`)
console.log('-'.repeat(75))
for (const [name, bytes] of sorted) {
  const pct = ((bytes / total) * 100).toFixed(1)
  console.log(`${name.padEnd(48)} ${fmt(bytes).padStart(11)} ${pct.padStart(9)}%`)
}

console.log('')
console.log('=== Per-source attribution (top 15) ===')
const topSources = [...sourceBytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
for (const [src, bytes] of topSources) {
  const short = src.replace(/^.*place-ts\//, '').slice(0, 60)
  console.log(`${short.padEnd(64)} ${fmt(bytes).padStart(11)}`)
}
