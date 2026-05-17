// Bundle-size probes — additive entries that measure the marginal byte
// cost of each subsystem. Each probe includes EVERY identifier the
// previous probe used plus a few more, so diffs are always positive
// and attributable.
//
// Run from project root:
//   bun examples/docs/probes/bundle-probes.ts

import { mkdir, writeFile } from 'fs/promises'
import { gzipSync } from 'zlib'

interface Probe {
  name: string
  components: readonly string[]
  body: string
}

// Identifiers re-exported by `@place/component`, grouped by subsystem.
const SUBSYS = {
  reactivity: ['state', 'watch', 'derived', 'untrack', 'batch', 'resource', 'peek', 'flush'],
  jsxRuntime: ['el', 'Fragment', 'mount', 'renderToString'],
  hydration: ['hydrate', '_setHydrated', '_drainHydrationDeltas'],
  components: ['component', 'Show', 'Activity', 'ClientOnly', 'Deferred', 'Tabs'],
  routing: ['Link'], // RouterCap is in @place/routing, not re-exported
  capability: ['cap', 'provide'],
  theme: ['themeTokens', 'setTheme', 'readThemeFromRequest', 'themeCookieHeader'],
  cookies: ['cookie', 'cookieState', 'parseCookieHeader'],
  form: ['Form', 'action'],
  virtualList: ['virtualList'],
  suspense: ['suspense'],
  page: ['page', 'layout', 'app'],
  url: ['urlState'],
} as const

function makeBody(idents: readonly string[]): string {
  // For each identifier, emit a `__use(X)` line so the bundler can't
  // tree-shake it. The body's correctness doesn't matter — we just
  // need each name to be a value reference.
  const importLine = `import { ${idents.join(', ')} } from '@place/component'`
  const useLines = idents.map((n) => `__use(${n})`).join('\n')
  return `${importLine}
const __use = (x: unknown) => { ;(globalThis as Record<string, unknown>).__sink = x }
${useLines}`
}

const PROBES: Probe[] = (() => {
  const additive: Probe[] = []
  let acc: string[] = []
  for (const [name, names] of Object.entries(SUBSYS)) {
    acc = [...acc, ...names]
    additive.push({ name: `+ ${name}`, components: [...acc], body: makeBody(acc) })
  }
  return additive
})()

interface ProbeResult {
  name: string
  raw: number
  gzipped: number
}

async function measureProbe(p: Probe): Promise<ProbeResult> {
  const dir = `${import.meta.dir}/.tmp/${p.name.replace(/[^a-z0-9]/gi, '_')}`
  await mkdir(dir, { recursive: true })
  const entry = `${dir}/entry.ts`
  await writeFile(entry, p.body)
  const out = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
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
    return { name: p.name, raw: -1, gzipped: -1 }
  }
  const buf = await out.outputs[0].arrayBuffer()
  const raw = buf.byteLength
  const gz = gzipSync(new Uint8Array(buf)).byteLength
  return { name: p.name, raw, gzipped: gz }
}

const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`)
const pad = (s: string, w: number, dir: 'l' | 'r' = 'r'): string =>
  dir === 'r' ? s.padStart(w) : s.padEnd(w)

console.log(
  `${pad('probe', 22, 'l')} ${pad('raw', 9)} ${pad('gzip', 9)} ${pad('Δraw', 9)} ${pad('Δgzip', 9)}`,
)
console.log('-'.repeat(64))
let prev: ProbeResult | null = null
for (const p of PROBES) {
  const r = await measureProbe(p)
  if (r.raw < 0) {
    console.log(`${pad(p.name, 22, 'l')}  build FAILED`)
    continue
  }
  const drr = prev !== null ? r.raw - prev.raw : r.raw
  const dgr = prev !== null ? r.gzipped - prev.gzipped : r.gzipped
  console.log(
    `${pad(p.name, 22, 'l')} ${pad(fmt(r.raw), 9)} ${pad(fmt(r.gzipped), 9)} ${pad((drr >= 0 ? '+' : '') + fmt(drr), 9)} ${pad((dgr >= 0 ? '+' : '') + fmt(dgr), 9)}`,
  )
  prev = r
}
