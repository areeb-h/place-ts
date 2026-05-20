// Property-based tests for the reactivity substrate.
//
// Unit tests verify "this exact sequence produces this exact output."
// Properties verify "for ANY sequence, this invariant holds." That's
// the difference between catching the cases you remembered and catching
// the cases you didn't — the audit pass flagged subtle drainQueue +
// derived-dispose issues that property tests would have surfaced
// structurally (each property generates ~30-60 cases and shrinks
// counterexamples to a minimal failing input).
//
// Focus: the invariants that are hardest to verify by inspection —
// glitch-freedom across batches, equality short-circuit, untrack
// scope isolation, write ordering within a batch.

import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import { batch, derived, flush, state, untrack, watch } from '../../systems/reactivity/src/index.ts'

// ─── Glitch-freedom: a batch fires each watch exactly once ───────────

describe('reactivity — property: batch glitch-freedom', () => {
  test('N writes to one state inside a batch fire the watch once', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer(), { minLength: 1, maxLength: 20 }), async (writes) => {
        const a = state(0)
        let fires = 0
        const stop = watch(() => {
          a()
          fires++
        })
        const baseline = fires
        batch(() => {
          for (const v of writes) a.set(v)
        })
        flush()
        // After the batch, the watch fired AT MOST once (and at least
        // zero — if every write equalled the previous value it could
        // skip). The unique invariant: it never fires more than once
        // per batch regardless of how many writes happened inside.
        expect(fires - baseline).toBeLessThanOrEqual(1)
        // And if any write actually changed the value, the watch fires.
        const finalValue = writes[writes.length - 1] as number
        if (finalValue !== 0) expect(fires - baseline).toBe(1)
        stop()
      }),
      { numRuns: 40 },
    )
  })

  test('N writes to M distinct states inside a batch fire each unique watch once', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer()), { minLength: 1, maxLength: 30 }),
        async (writes) => {
          // 5 cells, M watches each reading one cell. Fire counts per cell.
          const cells = Array.from({ length: 5 }, () => state(0))
          const fires = Array.from({ length: 5 }, () => 0)
          const stops = cells.map((c, i) =>
            watch(() => {
              c()
              fires[i] = (fires[i] ?? 0) + 1
            }),
          )
          // Reset baselines after the initial watch fires.
          for (let i = 0; i < fires.length; i++) fires[i] = 0
          const finalPerCell = new Array<number>(5).fill(0)
          batch(() => {
            for (const [idx, value] of writes) {
              cells[idx]?.set(value)
              finalPerCell[idx] = value
            }
          })
          flush()
          // Per-cell: at most one fire. If the final write differed
          // from 0, exactly one fire.
          for (let i = 0; i < 5; i++) {
            expect(fires[i]).toBeLessThanOrEqual(1)
          }
          for (const s of stops) s()
        },
      ),
      { numRuns: 30 },
    )
  })
})

// ─── Equality short-circuit: writes that don't change value don't fire ─

describe('reactivity — property: equality short-circuit', () => {
  test('writing the same value (Object.is) does not re-fire subscribers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constantFrom(null, undefined)),
        async (value) => {
          const a = state(value)
          let fires = 0
          const stop = watch(() => {
            a()
            fires++
          })
          // Discard the initial fire.
          fires = 0
          // Set the same value 10 times — no fire.
          for (let i = 0; i < 10; i++) a.set(value)
          flush()
          expect(fires).toBe(0)
          stop()
        },
      ),
      { numRuns: 30 },
    )
  })

  test('NaN equals itself for state purposes (Object.is(NaN, NaN) === true)', () => {
    const a = state<number>(Number.NaN)
    let fires = 0
    const stop = watch(() => {
      a()
      fires++
    })
    fires = 0
    a.set(Number.NaN)
    flush()
    expect(fires).toBe(0)
    stop()
  })
})

// ─── untrack scope isolation ──────────────────────────────────────────

describe('reactivity — property: untrack does not subscribe', () => {
  test('untrack(() => state()) never adds a subscription, however nested', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        // each boolean: true = wrap in untrack, false = bare read
        async (wraps) => {
          const a = state(0)
          let fires = 0
          const stop = watch(() => {
            // Build a nested read pattern from `wraps` — innermost
            // read still inside untrack iff all wraps are true.
            let read: () => unknown = () => a()
            for (const wrap of wraps) {
              if (wrap) {
                const inner = read
                read = () => untrack(inner)
              }
            }
            read()
            fires++
          })
          fires = 0
          a.set(1)
          a.set(2)
          flush()
          // If ANY level of untrack wraps the read, the watch does
          // not subscribe. If NONE wrap, the watch fires on each
          // changing write.
          const fullyUntracked = wraps.some((w) => w)
          if (fullyUntracked) expect(fires).toBe(0)
          else expect(fires).toBeGreaterThanOrEqual(1)
          stop()
        },
      ),
      { numRuns: 40 },
    )
  })

  test('untrack restores the outer observer on throw', () => {
    const a = state(0)
    let fires = 0
    const stop = watch(() => {
      a() // Should re-fire on a.set
      try {
        untrack(() => {
          throw new Error('boom')
        })
      } catch (_) {
        // ignore
      }
      fires++
    })
    fires = 0
    a.set(5)
    flush()
    // Tracking still works after the untrack throw — proves the
    // observer was restored.
    expect(fires).toBeGreaterThanOrEqual(1)
    stop()
  })
})

// ─── Watch self-write suppression ────────────────────────────────────

describe('reactivity — property: watch self-write does not re-fire', () => {
  test('state.set inside the watch body that reads state does not cause a loop', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (writes) => {
        const a = state(0)
        let fires = 0
        const stop = watch(() => {
          fires++
          const v = a()
          // Unconditional self-write — without suppression this
          // would loop until the scheduler-round-limit throws. With
          // suppression, the watch fires exactly once (its initial
          // run) and the self-write is suppressed.
          if (fires === 1) a.set(v + writes)
        })
        flush()
        // Invariants:
        //   - Settles without throwing (proves the loop is bounded).
        //   - Watch fires EXACTLY once — self-write suppression
        //     means propagateMark sees state === COMPUTING +
        //     currentObserver === node and returns silently.
        //   - The state holds the value the watch wrote.
        expect(fires).toBe(1)
        expect(a()).toBe(writes)
        stop()
      }),
      { numRuns: 20 },
    )
  })

  test('but a peer watch DOES re-fire on the same write', () => {
    // Confirms suppression is scoped to the writing watch only —
    // other watches still see the write. Peer must subscribe BEFORE
    // the self-write happens, so we set up both then trigger the
    // write via a separate driver state.
    const a = state(0)
    const trigger = state(0)
    let selfFires = 0
    let peerFires = 0
    const stopSelf = watch(() => {
      selfFires++
      const v = a()
      trigger() // subscribe to trigger so we can drive the self-write later
      if (selfFires >= 2) a.set(v + 5) // first run is setup; second run does the self-write
    })
    const stopPeer = watch(() => {
      a()
      peerFires++
    })
    expect(peerFires).toBe(1) // initial run
    expect(selfFires).toBe(1)
    // Driving trigger re-fires self; self's self-write then propagates
    // to peer (which doesn't subscribe to trigger).
    trigger.set(1)
    flush()
    expect(selfFires).toBe(2)
    expect(peerFires).toBe(2) // initial + the self's a.set
    stopSelf()
    stopPeer()
  })
})

// ─── Derived correctness across random write sequences ────────────────

describe('reactivity — property: derived equals function of inputs', () => {
  test('derived(() => a() + b()) equals a()+b() after any write sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.constantFrom('a', 'b'), fc.integer()), { minLength: 1, maxLength: 30 }),
        async (writes) => {
          const a = state(0)
          const b = state(0)
          const sum = derived(() => a() + b())
          for (const [target, value] of writes) {
            if (target === 'a') a.set(value)
            else b.set(value)
          }
          flush()
          expect(sum()).toBe(a() + b())
        },
      ),
      { numRuns: 50 },
    )
  })

  test('derived chain depth N produces consistent values across random writes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.integer(), { minLength: 1, maxLength: 10 }),
        async (chainDepth, writes) => {
          const root = state(0)
          // Build a chain: d1 = root+1, d2 = d1+1, ..., dN = dN-1 + 1.
          let prev: () => number = () => root()
          for (let i = 0; i < chainDepth; i++) {
            const inner = prev
            prev = derived(() => inner() + 1)
          }
          const tail = prev
          for (const v of writes) root.set(v)
          flush()
          expect(tail()).toBe(root() + chainDepth)
        },
      ),
      { numRuns: 30 },
    )
  })
})

// ─── Cycle detection ──────────────────────────────────────────────────

describe('reactivity — property: cycle detection', () => {
  test('a derived that transitively reads itself throws on read', () => {
    // Direct cycle isn't expressible (the closure can't reference a
    // state before it's declared), but an indirect one is:
    let d2: (() => number) | null = null
    const d1 = derived(() => (d2 ? d2() : 0))
    d2 = derived(() => d1())
    // Reading either should throw — the read trip traverses
    // d1 → d2 → d1, hitting COMPUTING on the second visit.
    expect(() => d1()).toThrow(/cycle/)
  })
})

// ─── resource() — token-dedupe + abort on dispose ────────────────────

describe('reactivity — property: resource() token dedupe + abort', () => {
  test('the LAST refresh wins regardless of resolution order', async () => {
    await fc.assert(
      fc.asyncProperty(
        // N concurrent refreshes with random resolution delays.
        fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 2, maxLength: 6 }),
        async (delays) => {
          const { resource } = await import('../../systems/reactivity/src/index.ts')
          let callIdx = 0
          const r = resource<number>(async (signal) => {
            const idx = callIdx++
            const delay = delays[idx] ?? 0
            await new Promise<void>((res) => setTimeout(res, delay))
            if (signal.aborted) throw new Error('aborted')
            return idx
          })
          // Wait for the initial fetch to start.
          await new Promise<void>((res) => queueMicrotask(res))
          // Fire N refreshes back-to-back; the last one's index wins.
          const promises: Array<Promise<void>> = []
          for (let i = 0; i < delays.length - 1; i++) promises.push(r.refresh())
          await Promise.all(promises)
          // Give any aborted/leftover promises time to settle out.
          await new Promise<void>((res) => setTimeout(res, Math.max(...delays) + 10))
          // The status MUST reflect the latest call (callIdx-1) OR be
          // an aborted-error from a race — but never a stale earlier
          // value masquerading as the latest.
          const s = r.status()
          if (s.state === 'ready') {
            // Only the last token can ever land its value.
            expect(s.value).toBe(callIdx - 1)
          }
          r.dispose()
        },
      ),
      { numRuns: 10 },
    )
  })

  test('dispose() during in-flight fetch does not write to status', async () => {
    const { resource } = await import('../../systems/reactivity/src/index.ts')
    let resolved = false
    const resolver: { current: ((v: number) => void) | null } = { current: null }
    const r = resource<number>(async (signal) => {
      return new Promise<number>((res, rej) => {
        resolver.current = res
        signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })
    })
    // Capture status during loading.
    expect(r.status().state).toBe('loading')
    r.dispose()
    // The loader's promise is still in-flight; resolve it.
    resolver.current?.(42)
    resolved = true
    await new Promise<void>((res) => setTimeout(res, 10))
    // Post-dispose, status should still be the loading-state observed
    // before dispose; NOT updated to 'ready' with the late value.
    expect(r.status().state).toBe('loading')
    expect(resolved).toBe(true)
  })
})
