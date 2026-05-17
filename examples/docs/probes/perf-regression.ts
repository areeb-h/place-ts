// T6-H: perf regression probe.
//
// User report: "page transition is really slow now compared to before"
// + "sometimes it takes a lot of time to load when hard refreshed."
//
// This probe hits a running dev server and measures:
//   1. Server-side TTFB for HTML page responses (cold + warm)
//   2. Per-island bundle fetch time
//   3. Total network bytes per page (HTML + all island JS)
//   4. Gzip ratio (raw vs gzipped) for the bundles
//   5. Same-route hot-refresh under sequential load
//
// Usage:
//   bun examples/docs/probes/perf-regression.ts <base-url>
//
// Default base URL is http://localhost:5174.

import { gzipSync } from 'node:zlib'

const baseUrl = process.argv[2] ?? 'http://localhost:5174'

const ROUTES = [
  '/',
  '/concepts/reactivity',
  '/api/components',
  '/why',
  '/recipes',
  '/getting-started',
]

const fmt = (n: number): string => {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}
const fmtMs = (ms: number): string => `${ms.toFixed(1)}ms`

interface FetchTiming {
  readonly url: string
  readonly status: number
  readonly bytes: number
  readonly ms: number
  readonly body: string
}

async function timedFetch(url: string): Promise<FetchTiming> {
  const start = performance.now()
  const res = await fetch(url)
  const body = await res.text()
  const ms = performance.now() - start
  return { url, status: res.status, bytes: body.length, ms, body }
}

console.log('\n== T6-H perf-regression probe ==')
console.log(`base URL: ${baseUrl}\n`)

// 1. Server-side TTFB across routes (3 runs each — first is cold).
console.log('=== Server-side HTML page timings (3 runs per route) ===')
console.log(`${'route'.padEnd(28)} run1     run2     run3     size`)
console.log('-'.repeat(72))
for (const route of ROUTES) {
  const runs: number[] = []
  for (let i = 0; i < 3; i++) {
    const t = await timedFetch(`${baseUrl}${route}`)
    runs.push(t.ms)
  }
  const last = await timedFetch(`${baseUrl}${route}`)
  console.log(
    `${route.padEnd(28)} ${runs.map((m) => fmtMs(m).padStart(7)).join('  ')}  ${fmt(last.bytes).padStart(6)}`,
  )
}

// 2. Island bundle fetch + gzip.
console.log('\n=== Island bundle sizes (raw + gzip) ===')
const indexHtml = (await timedFetch(`${baseUrl}/`)).body
const scriptUrls = [...indexHtml.matchAll(/src="(\/islands\/[^"]+)"/g)].map((m) => m[1] as string)
let totalRaw = 0
let totalGz = 0
console.log(`${'url'.padEnd(40)} raw     gzip    ratio`)
console.log('-'.repeat(72))
for (const u of scriptUrls) {
  const t = await timedFetch(`${baseUrl}${u}`)
  const gz = gzipSync(t.body).length
  totalRaw += t.bytes
  totalGz += gz
  console.log(
    `${u.padEnd(40)} ${fmt(t.bytes).padStart(7)} ${fmt(gz).padStart(7)} ${(gz / t.bytes).toFixed(2).padStart(6)}`,
  )
}
console.log('-'.repeat(72))
console.log(`${'TOTAL'.padEnd(40)} ${fmt(totalRaw).padStart(7)} ${fmt(totalGz).padStart(7)}`)

// 3. Same-route hot-refresh under sequential load.
console.log('\n=== Hot-refresh (10 sequential hits of /concepts/reactivity) ===')
const hotRuns: number[] = []
for (let i = 0; i < 10; i++) {
  const t = await timedFetch(`${baseUrl}/concepts/reactivity`)
  hotRuns.push(t.ms)
}
const sortedHot = [...hotRuns].sort((a, b) => a - b)
const p50 = sortedHot[Math.floor(sortedHot.length / 2)] ?? 0
const p95 = sortedHot[Math.floor(sortedHot.length * 0.95)] ?? 0
const max = sortedHot[sortedHot.length - 1] ?? 0
console.log(`p50=${fmtMs(p50)}  p95=${fmtMs(p95)}  max=${fmtMs(max)}`)
console.log(`runs: ${hotRuns.map((m) => fmtMs(m)).join('  ')}`)

// 4. Inline-sourcemap inflation check.
console.log('\n=== Inline-sourcemap inflation (dev only) ===')
const firstIsland = scriptUrls[0]
if (firstIsland !== undefined) {
  const body = (await timedFetch(`${baseUrl}${firstIsland}`)).body
  const sourcemapMatch = body.match(/\/\/# sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/=]+/)
  if (sourcemapMatch) {
    const smapBytes = sourcemapMatch[0].length
    const codeBytes = body.length - smapBytes
    console.log(
      `${firstIsland}: code=${fmt(codeBytes)}  sourcemap=${fmt(smapBytes)} (${((smapBytes / body.length) * 100).toFixed(0)}% of bytes)`,
    )
    console.log(`production builds drop sourcemap; same bundle would ship ~${fmt(codeBytes)} bytes.`)
  } else {
    console.log(`(no inline sourcemap detected — bundle is bare JS)`)
  }
}

console.log('\n== probe done ==')
