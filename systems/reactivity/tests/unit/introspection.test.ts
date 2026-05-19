// @vitest-environment happy-dom
//
// Tests for the dev-only reactive-graph introspection API
// (`inspectGraph` / `onGraphTick`). The happy-dom environment gives
// the module a `window`, so `GRAPH_DEV` is true and nodes register.
//
// The node registry is module-global and accumulates across tests,
// so every test finds ITS nodes by a distinctive value rather than
// asserting on the total node count.

import { describe, expect, test } from 'vitest'
import {
  _popDevScope,
  _pushDevScope,
  derived,
  flush,
  type GraphSnapshot,
  inspectActivity,
  inspectGraph,
  onGraphTick,
  state,
  watch,
} from '../../src/index.ts'

/** Find the snapshot node whose value preview matches `preview`. */
function nodeByValue(snap: GraphSnapshot, preview: string) {
  return snap.nodes.find((n) => n.value === preview)
}

describe('inspectGraph — node enumeration', () => {
  test('a raw state appears as kind "state" with a value preview', () => {
    state(778001)
    const node = nodeByValue(inspectGraph(), '778001')
    expect(node).toBeDefined()
    expect(node?.kind).toBe('state')
    expect(node?.status).toBe('clean')
  })

  test('a derived appears as kind "derived" once read', () => {
    const base = state(778002)
    const d = derived(() => base() + 1)
    d() // force first computation
    const node = nodeByValue(inspectGraph(), '778003')
    expect(node).toBeDefined()
    expect(node?.kind).toBe('derived')
  })

  test('a watch appears as kind "watch" with no value', () => {
    const s = state(778004)
    let seen = 0
    const stop = watch(() => {
      s()
      seen++
    })
    const watchNode = inspectGraph().nodes.find((n) => n.kind === 'watch' && n.sources.length > 0)
    expect(watchNode).toBeDefined()
    expect(watchNode?.value).toBeUndefined()
    expect(seen).toBe(1)
    stop()
  })

  test('value preview tracks writes', () => {
    const s = state(778005)
    expect(nodeByValue(inspectGraph(), '778005')).toBeDefined()
    s.set(778006)
    expect(nodeByValue(inspectGraph(), '778005')).toBeUndefined()
    expect(nodeByValue(inspectGraph(), '778006')).toBeDefined()
  })
})

describe('inspectGraph — dependency edges', () => {
  test('a derived lists its source state, and the state lists the derived as a dependent', () => {
    const base = state('edge-src-9001')
    const d = derived(() => `${base()}-derived`)
    d()
    const snap = inspectGraph()
    const srcNode = nodeByValue(snap, '"edge-src-9001"')
    const derivedNode = nodeByValue(snap, '"edge-src-9001-derived"')
    expect(srcNode).toBeDefined()
    expect(derivedNode).toBeDefined()
    expect(derivedNode?.sources).toContain(srcNode?.id)
    expect(srcNode?.dependents).toContain(derivedNode?.id)
  })

  test('node ids are unique and stable', () => {
    state('id-stable-9002')
    const first = nodeByValue(inspectGraph(), '"id-stable-9002"')?.id
    const second = nodeByValue(inspectGraph(), '"id-stable-9002"')?.id
    expect(first).toBeDefined()
    expect(first).toBe(second)
  })
})

describe('inspectGraph — value previews', () => {
  test('shapes: string / number / boolean / array / object / function', () => {
    state('a'.repeat(200))
    state([1, 2, 3])
    state({ x: 1 })
    state(() => () => {})
    const snap = inspectGraph()
    const values = snap.nodes.map((n) => n.value)
    expect(values.some((v) => v?.startsWith('"aaa') && v.endsWith('…"'))).toBe(true)
    expect(values).toContain('Array(3)')
    expect(values).toContain('{…}')
  })
})

describe('onGraphTick', () => {
  test('fires (coalesced) after a write settles', async () => {
    const s = state(0)
    let ticks = 0
    const off = onGraphTick(() => {
      ticks++
    })
    s.set(1)
    s.set(2)
    s.set(3)
    // Coalesced to one microtask-deferred notification.
    await Promise.resolve()
    await Promise.resolve()
    expect(ticks).toBe(1)
    off()
    s.set(4)
    await Promise.resolve()
    expect(ticks).toBe(1)
  })

  test('a tick listener that writes state does not feed back into a loop', async () => {
    // The devtools re-snapshots into its own state cell from inside
    // the tick callback — that write must NOT schedule another tick,
    // or it loops forever. The re-entrancy guard breaks the feedback.
    const trigger = state(900100)
    const sink = state(0)
    let runs = 0
    const off = onGraphTick(() => {
      runs++
      sink.set(sink.peek() + 1)
    })
    trigger.set(900101)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(runs).toBe(1) // exactly one tick — no feedback loop
    trigger.set(900102)
    await Promise.resolve()
    await Promise.resolve()
    expect(runs).toBe(2) // a fresh app-originated write still ticks
    off()
  })
})

describe('_pushDevScope — scope tagging', () => {
  test('a node created inside a scope carries that scope', () => {
    _pushDevScope('scope-test-island')
    state('scoped-9101')
    _popDevScope()
    const node = nodeByValue(inspectGraph(), '"scoped-9101"')
    expect(node?.scope).toBe('scope-test-island')
  })

  test('a node created outside any scope has no scope', () => {
    state('unscoped-9102')
    const node = nodeByValue(inspectGraph(), '"unscoped-9102"')
    expect(node?.scope).toBeUndefined()
  })

  test('scopes nest — innermost wins', () => {
    _pushDevScope('outer-9103')
    _pushDevScope('inner-9103')
    state('nested-9103')
    _popDevScope()
    state('outer-only-9103')
    _popDevScope()
    const snap = inspectGraph()
    expect(nodeByValue(snap, '"nested-9103"')?.scope).toBe('inner-9103')
    expect(nodeByValue(snap, '"outer-only-9103"')?.scope).toBe('outer-9103')
  })

  test('popping past empty is harmless; later nodes stay unscoped', () => {
    _popDevScope()
    _popDevScope()
    state('after-overpop-9104')
    expect(nodeByValue(inspectGraph(), '"after-overpop-9104"')?.scope).toBeUndefined()
  })
})

describe('inspectActivity — the temporal log', () => {
  test('a value-changing write appends an entry with from / to', () => {
    const s = state(940001)
    s.set(940002)
    const entry = inspectActivity().find((e) => e.to === '940002')
    expect(entry).toBeDefined()
    expect(entry?.from).toBe('940001')
    expect(entry?.to).toBe('940002')
  })

  test('the entry carries the writing node’s scope', () => {
    _pushDevScope('activity-island-9402')
    const s = state(940010)
    _popDevScope()
    s.set(940011)
    const entry = inspectActivity().find((e) => e.to === '940011')
    expect(entry?.scope).toBe('activity-island-9402')
  })

  test('a no-op write (equal value) records nothing', () => {
    const s = state(940020)
    const before = inspectActivity().length
    s.set(940020)
    expect(inspectActivity().length).toBe(before)
  })

  test('entries are ordered oldest-first with monotonic seq', () => {
    const s = state(940030)
    s.set(940031)
    s.set(940032)
    const log = inspectActivity()
    const a = log.findIndex((e) => e.to === '940031')
    const b = log.findIndex((e) => e.to === '940032')
    expect(a).toBeGreaterThanOrEqual(0)
    expect(b).toBeGreaterThan(a)
    expect((log[b]?.seq ?? 0) > (log[a]?.seq ?? 0)).toBe(true)
  })
})

describe('graph lifecycle', () => {
  test('disposing a watch removes it from the graph', () => {
    const s = state('dispose-9003')
    const stop = watch(() => {
      s()
    })
    const before = inspectGraph().nodes.filter((n) => n.kind === 'watch').length
    stop()
    flush()
    const after = inspectGraph().nodes.filter((n) => n.kind === 'watch').length
    expect(after).toBe(before - 1)
  })
})
