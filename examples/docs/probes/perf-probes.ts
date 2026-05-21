// Performance probes — numbers we can publish + that gate Tier 2/3
// claims about speed. Each section runs in isolation and prints one
// line per probe. Re-run after a change to confirm direction.
//
// Run from project root:
//   bun examples/docs/probes/perf-probes.ts
//
// Probes:
//   1. renderToString throughput (pages/sec for trees of varying size).
//   2. mount time on an empty DOM (client-side rendering of a fresh tree).
//   3. hydrate time (adoption of an SSR'd DOM).
//   4. mount/unmount churn — proxy for SPA-nav cost (no layout chain).
//   5. heap deltas across N mount/unmount cycles (leak smoke test).
//
// Notes:
//   - happy-dom is imported directly so this runs standalone (not via vitest).
//   - Each timing is an average over N iterations; warmup runs are
//     discarded so JIT settles before measurement.
//   - performance.now() resolution under Bun is ~1µs; sample sizes are
//     chosen so total time per probe is in the 50-500 ms range.

import type { Child, View } from '@place-ts/component'
import { div, hydrate, li, p, renderToString, span, ul } from '@place-ts/component'
import { Window } from 'happy-dom'

// ─── DOM bootstrap ─────────────────────────────────────────────────────
// happy-dom Window installs document/window globals so the framework's
// DOM-reading code (`document.createElement`, etc.) works.

const win = new Window({ url: 'http://localhost/' })
const g = globalThis as Record<string, unknown>
g.window = win
g.document = win.document
g.HTMLElement = win.HTMLElement
g.Element = win.Element
g.Node = win.Node
g.MouseEvent = win.MouseEvent
g.Event = win.Event
g.NodeFilter = win.NodeFilter
g.SubmitEvent = win.SubmitEvent
g.MutationObserver = win.MutationObserver

// ─── Tree builders — vary size for cost-per-node measurements ─────────

function makeFlatList(n: number): View {
  const items: View[] = []
  for (let i = 0; i < n; i++) items.push(li({}, [`item ${i}`]))
  return div({ class: 'list' }, [ul({}, items)])
}

function makeNestedTree(depth: number, fanout: number): View {
  const build = (d: number): Child => {
    if (d === 0) return span({}, [`leaf-${d}`])
    const kids: Child[] = []
    for (let i = 0; i < fanout; i++) kids.push(build(d - 1) as Child)
    return div({ class: `d-${d}` }, [p({}, [`node-${d}`]), ...kids])
  }
  return build(depth) as View
}

function nodeCountOf(view: View): number {
  // Count by rendering once and counting tags. Cheap, accurate enough.
  const html = renderToString(view)
  return (html.match(/<[a-z]/g) ?? []).length
}

// ─── Microbench harness ───────────────────────────────────────────────

interface Bench {
  name: string
  setup?: () => void
  body: () => void
  cleanup?: () => void
}

function time(bench: Bench, iterations: number, warmup: number): number {
  for (let i = 0; i < warmup; i++) {
    bench.setup?.()
    bench.body()
    bench.cleanup?.()
  }
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    bench.setup?.()
    bench.body()
    bench.cleanup?.()
  }
  const elapsed = performance.now() - start
  return elapsed / iterations
}

const fmt = (ms: number): string =>
  ms >= 1 ? `${ms.toFixed(2)} ms` : `${(ms * 1000).toFixed(1)} µs`
const pad = (s: string, w: number, dir: 'l' | 'r' = 'r'): string =>
  dir === 'r' ? s.padStart(w) : s.padEnd(w)

// ─── Probe 1: renderToString throughput ────────────────────────────────

console.log('\n[1] renderToString throughput')
console.log('-'.repeat(70))
console.log(
  `${pad('tree', 22, 'l')} ${pad('nodes', 7)} ${pad('per-render', 12)} ${pad('renders/sec', 14)}`,
)
for (const [label, view] of [
  ['flat list (50)', makeFlatList(50)],
  ['flat list (500)', makeFlatList(500)],
  ['nested (d=5, f=3)', makeNestedTree(5, 3)],
  ['nested (d=7, f=3)', makeNestedTree(7, 3)],
] as const) {
  const nodes = nodeCountOf(view)
  const perCall = time({ name: label, body: () => void renderToString(view) }, 100, 5)
  const rps = Math.round(1000 / perCall)
  console.log(
    `${pad(label, 22, 'l')} ${pad(String(nodes), 7)} ${pad(fmt(perCall), 12)} ${pad(rps.toLocaleString(), 14)}`,
  )
}

// ─── Probe 2: mount time on empty DOM (no SSR adoption) ───────────────

console.log('\n[2] mount time (fresh client render — no SSR)')
console.log('-'.repeat(70))
console.log(`${pad('tree', 22, 'l')} ${pad('nodes', 7)} ${pad('per-mount', 12)}`)
for (const [label, view] of [
  ['flat list (50)', makeFlatList(50)],
  ['flat list (500)', makeFlatList(500)],
  ['nested (d=5, f=3)', makeNestedTree(5, 3)],
  ['nested (d=7, f=3)', makeNestedTree(7, 3)],
] as const) {
  const nodes = nodeCountOf(view)
  let dispose: () => void = () => {}
  let host: HTMLElement
  const perCall = time(
    {
      name: label,
      setup: () => {
        host = document.createElement('div')
        document.body.appendChild(host)
      },
      body: () => {
        dispose = view.mount(host, null)
      },
      cleanup: () => {
        dispose()
        host.remove()
      },
    },
    50,
    3,
  )
  console.log(`${pad(label, 22, 'l')} ${pad(String(nodes), 7)} ${pad(fmt(perCall), 12)}`)
}

// ─── Probe 3: hydrate time (adoption of SSR DOM) ──────────────────────

console.log('\n[3] hydrate time (adoption of SSR DOM)')
console.log('-'.repeat(70))
console.log(`${pad('tree', 22, 'l')} ${pad('nodes', 7)} ${pad('per-hydrate', 12)}`)
for (const [label, view] of [
  ['flat list (50)', makeFlatList(50)],
  ['flat list (500)', makeFlatList(500)],
  ['nested (d=5, f=3)', makeNestedTree(5, 3)],
  ['nested (d=7, f=3)', makeNestedTree(7, 3)],
] as const) {
  const ssrHtml = renderToString(view)
  const nodes = nodeCountOf(view)
  let host: HTMLElement
  let dispose: () => void = () => {}
  const perCall = time(
    {
      name: label,
      setup: () => {
        host = document.createElement('div')
        host.innerHTML = ssrHtml
        document.body.appendChild(host)
      },
      body: () => {
        dispose = hydrate(view, host)
      },
      cleanup: () => {
        dispose()
        host.remove()
      },
    },
    50,
    3,
  )
  console.log(`${pad(label, 22, 'l')} ${pad(String(nodes), 7)} ${pad(fmt(perCall), 12)}`)
}

// ─── Probe 4: mount/unmount churn (SPA-nav cost proxy) ────────────────
// One cycle = mount + dispose + DOM teardown. Reflects what happens
// every time pageSlot.set(nextPageView) in boot() fires — the previous
// inner-page view disposes and the new one mounts.

console.log('\n[4] mount + unmount cycle (SPA-nav proxy)')
console.log('-'.repeat(70))
console.log(`${pad('tree', 22, 'l')} ${pad('nodes', 7)} ${pad('per-cycle', 12)}`)
for (const [label, view] of [
  ['flat list (50)', makeFlatList(50)],
  ['nested (d=5, f=3)', makeNestedTree(5, 3)],
  ['nested (d=7, f=3)', makeNestedTree(7, 3)],
] as const) {
  const nodes = nodeCountOf(view)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const perCall = time(
    {
      name: label,
      body: () => {
        const d = view.mount(host, null)
        d()
      },
    },
    50,
    3,
  )
  host.remove()
  console.log(`${pad(label, 22, 'l')} ${pad(String(nodes), 7)} ${pad(fmt(perCall), 12)}`)
}

// ─── Probe 5: heap growth trend (leak smoke test) ─────────────────────
// Bun doesn't expose forced GC, so a single `heapUsed` delta is noisy.
// Instead we measure the TREND: heap delta at 100 vs 1000 cycles. If
// the 1000-cycle delta is roughly 10× the 100-cycle delta, growth is
// linear in cycles → likely leak. If it's much less (or negative,
// meaning natural GC freed memory mid-measurement), the runtime is
// not retaining per-cycle state.

if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
  console.log('\n[5] heap growth trend (leak smoke — linear growth = leak)')
  console.log('-'.repeat(70))
  console.log(`${pad('tree', 22, 'l')} ${pad('Δ@100', 12)} ${pad('Δ@1000', 12)} ${pad('ratio', 8)}`)
  for (const [label, view] of [
    ['flat list (50)', makeFlatList(50)],
    ['nested (d=5, f=3)', makeNestedTree(5, 3)],
  ] as const) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    // Warm up so JIT + initial heap allocation are out of the readings.
    for (let i = 0; i < 100; i++) view.mount(host, null)()

    const measureCycles = (n: number): number => {
      const before = process.memoryUsage().heapUsed
      for (let i = 0; i < n; i++) view.mount(host, null)()
      const after = process.memoryUsage().heapUsed
      return after - before
    }
    const d100 = measureCycles(100)
    const d1000 = measureCycles(1000)
    const fmtMB = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1024 / 1024).toFixed(2)} MB`
    // Ratio close to 10 → linear growth (red flag). Negative deltas
    // (GC ran during measurement) collapse to "—" because the ratio
    // isn't meaningful.
    const ratio = d100 <= 0 || d1000 <= 0 ? '—' : `${(d1000 / d100).toFixed(1)}×`
    host.remove()
    console.log(
      `${pad(label, 22, 'l')} ${pad(fmtMB(d100), 12)} ${pad(fmtMB(d1000), 12)} ${pad(ratio, 8)}`,
    )
  }
}

console.log()
