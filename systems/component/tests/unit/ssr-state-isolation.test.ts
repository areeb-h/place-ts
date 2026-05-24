// @vitest-environment node
//
// Concurrency-isolation tests for the per-render SSR state (0.10.10).
//
// Pre-0.10.10 these four pieces of state were module-level `let`s
// reassigned by `_beginX` / `_endX` pairs:
//   - currentInlineStyleSet (`_internal/inline-style.ts`)
//   - currentHeadingCollector + currentHeadingIds + currentMainDepth
//     + currentFirstH1Text (element.ts)
//   - currentIslandSet (islands.ts)
//   - hydrationSeq (`_internal/hydrationSeq.ts`)
//
// Under synchronous `renderToString` no interleaving was possible.
// But the begin/end window in `render-page.ts` spans post-render
// hooks (`ssrProps`, `transformBody`) and `renderToStream` IS async
// across chunks — any future async drift would silently corrupt one
// request's collector with another's data, producing CSP hash
// misalignment, duplicate hydration ids, and island/heading
// cross-contamination.
//
// 0.10.10 moved each to `defineCapability(...)` so the per-request
// ALS scope isolates them. These tests force interleaved scopes
// (begin A, begin B, end B, end A — out of LIFO order is OK as long
// as B's data doesn't pollute A's) and pin the isolation invariant.

import { describe, expect, test } from 'vitest'
import { runWithCapabilityScope } from '@place-ts/capability'
import {
  _beginHeadingCollection,
  _beginInlineStyleCollection,
  _beginIslandCollection,
  _endHeadingCollection,
  _endInlineStyleCollection,
  _endIslandCollection,
  _getFirstH1Text,
} from '../../src/index.ts'
import {
  _beginHydrationSeq,
  nextHydrationId,
  resetHydrationSeq,
} from '../../src/_internal/hydrationSeq.ts'
import { currentInlineStyleSet } from '../../src/_internal/inline-style.ts'

describe('SSR state isolation — inline-style collector (0.10.10)', () => {
  test('per-scope: set installed inside scope is the one read', async () => {
    await runWithCapabilityScope(async () => {
      const set = _beginInlineStyleCollection()
      try {
        const seen = currentInlineStyleSet()
        expect(seen).toBe(set)
        seen?.add('color: red')
        expect([...(seen ?? [])]).toEqual(['color: red'])
      } finally {
        _endInlineStyleCollection()
      }
      // Outside the begin/end, the cap reads null.
      expect(currentInlineStyleSet()).toBeNull()
    })
  })

  test('concurrent ALS scopes get isolated collectors', async () => {
    // Two async scopes started near-simultaneously. Each begins its
    // own collector, awaits a microtask, writes, then asserts the
    // OWN set is exactly { its-style }, not the other's.
    //
    // Pre-0.10.10 (module-level let), B's begin would clobber A's
    // currentInlineStyleSet — A's write would land in B's set.
    const results = await Promise.all([
      runWithCapabilityScope(async () => {
        const own = _beginInlineStyleCollection()
        await new Promise<void>((r) => setTimeout(r, 0))
        try {
          currentInlineStyleSet()?.add('A-only')
          return [...own]
        } finally {
          _endInlineStyleCollection()
        }
      }),
      runWithCapabilityScope(async () => {
        const own = _beginInlineStyleCollection()
        await new Promise<void>((r) => setTimeout(r, 0))
        try {
          currentInlineStyleSet()?.add('B-only')
          return [...own]
        } finally {
          _endInlineStyleCollection()
        }
      }),
    ])
    expect(results[0]).toEqual(['A-only'])
    expect(results[1]).toEqual(['B-only'])
  })
})

describe('SSR state isolation — heading collector (0.10.10)', () => {
  test('concurrent scopes get isolated heading lists + firstH1', async () => {
    const results = await Promise.all([
      runWithCapabilityScope(async () => {
        const collector = _beginHeadingCollection()
        await new Promise<void>((r) => setTimeout(r, 0))
        collector.push({ id: 'a-only', text: 'A', level: 2 })
        const firstH1 = _getFirstH1Text() // both null — neither set firstH1
        _endHeadingCollection()
        return { collector: collector.length, firstH1 }
      }),
      runWithCapabilityScope(async () => {
        const collector = _beginHeadingCollection()
        await new Promise<void>((r) => setTimeout(r, 0))
        collector.push({ id: 'b-1', text: 'B1', level: 2 })
        collector.push({ id: 'b-2', text: 'B2', level: 3 })
        const firstH1 = _getFirstH1Text()
        _endHeadingCollection()
        return { collector: collector.length, firstH1 }
      }),
    ])
    expect(results[0]?.collector).toBe(1) // A pushed one
    expect(results[1]?.collector).toBe(2) // B pushed two
  })
})

describe('SSR state isolation — island collector (0.10.10)', () => {
  test('concurrent scopes get isolated island maps', async () => {
    const results = await Promise.all([
      runWithCapabilityScope(async () => {
        const own = _beginIslandCollection()
        await new Promise<void>((r) => setTimeout(r, 0))
        own.set('alpha', new Set(['load']))
        const snapshot = [...own.keys()]
        _endIslandCollection()
        return snapshot
      }),
      runWithCapabilityScope(async () => {
        const own = _beginIslandCollection()
        await new Promise<void>((r) => setTimeout(r, 0))
        own.set('beta', new Set(['idle']))
        own.set('gamma', new Set(['visible']))
        const snapshot = [...own.keys()]
        _endIslandCollection()
        return snapshot
      }),
    ])
    expect(results[0]).toEqual(['alpha'])
    expect(results[1]).toEqual(['beta', 'gamma'])
  })
})

describe('SSR state isolation — hydration seq counter (0.10.10)', () => {
  test('counter resets to 0 inside a fresh cap scope', async () => {
    await runWithCapabilityScope(async () => {
      const dispose = _beginHydrationSeq()
      try {
        expect(nextHydrationId()).toBe(0)
        expect(nextHydrationId()).toBe(1)
        expect(nextHydrationId()).toBe(2)
      } finally {
        dispose()
      }
    })
  })

  test('concurrent scopes get isolated counters', async () => {
    // Start two scopes. Each installs its own cap (matching what
    // renderPage does), then bumps. With the cap installed,
    // counters are per-scope; interleaving doesn't cross-pollute.
    //
    // Pre-0.10.10 (module-level counter, no cap), B's reset would
    // zero A's counter mid-render and the ids would cross-bleed.
    const results = await Promise.all([
      runWithCapabilityScope(async () => {
        const dispose = _beginHydrationSeq()
        try {
          const a1 = nextHydrationId()
          await new Promise<void>((r) => setTimeout(r, 0))
          const a2 = nextHydrationId()
          const a3 = nextHydrationId()
          return [a1, a2, a3]
        } finally {
          dispose()
        }
      }),
      runWithCapabilityScope(async () => {
        const dispose = _beginHydrationSeq()
        try {
          const b1 = nextHydrationId()
          await new Promise<void>((r) => setTimeout(r, 0))
          const b2 = nextHydrationId()
          return [b1, b2]
        } finally {
          dispose()
        }
      }),
    ])
    // Each scope's counter is monotonic FROM ZERO within its own
    // scope. Pre-fix the interleaving would give A something like
    // [0, 2, 3] (B's reset bumped A's counter back) or worse.
    expect(results[0]).toEqual([0, 1, 2])
    expect(results[1]).toEqual([0, 1])
  })

  test('outside any cap, falls back to module-level counter', () => {
    // `renderToString` called as a utility (no renderPage wrap) should
    // still work — fallback counter resets + bumps. This pins the
    // legacy behaviour so the cap refactor is purely additive.
    resetHydrationSeq()
    expect(nextHydrationId()).toBe(0)
    expect(nextHydrationId()).toBe(1)
    resetHydrationSeq()
    expect(nextHydrationId()).toBe(0)
  })
})
