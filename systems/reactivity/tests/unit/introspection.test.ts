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
  derived,
  flush,
  type GraphSnapshot,
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
