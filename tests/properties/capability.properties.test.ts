// Property-based tests for @place-ts/capability.
//
// The cap stack has subtle invariants — nested provides + installs +
// random dispose ordering all need to leave the stack consistent.
// Property tests over random push/pop sequences verify these.

import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import { defineCapability } from '../../systems/capability/src/index.ts'

// ─── Provide / use round-trip ────────────────────────────────────────

describe('capability — property: provide/use scope semantics', () => {
  test('use() inside provide(impl, body) returns impl; tryUse() outside returns null', () => {
    fc.assert(
      fc.property(fc.integer(), (impl) => {
        const Cap = defineCapability<number>('PropTest')
        expect(Cap.tryUse()).toBeNull()
        Cap.provide(impl, () => {
          expect(Cap.use()).toBe(impl)
          expect(Cap.tryUse()).toBe(impl)
        })
        // After provide returns, the cap is gone.
        expect(Cap.tryUse()).toBeNull()
      }),
      { numRuns: 30 },
    )
  })

  test('nested provides shadow correctly; innermost wins', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 2, maxLength: 6 }), (impls) => {
        const Cap = defineCapability<number>('NestedTest')
        const recurse = (i: number): void => {
          if (i >= impls.length) {
            // At innermost depth, use() must return the last impl pushed.
            expect(Cap.use()).toBe(impls[impls.length - 1])
            return
          }
          Cap.provide(impls[i] as number, () => {
            expect(Cap.use()).toBe(impls[i]) // shadowed by THIS level
            recurse(i + 1)
            // After inner exits, this level's impl is on top again.
            expect(Cap.use()).toBe(impls[i])
          })
        }
        recurse(0)
        expect(Cap.tryUse()).toBeNull()
      }),
      { numRuns: 30 },
    )
  })

  test('install + dispose: any sequence leaves the stack consistent', () => {
    // Generate a random schedule of install/dispose ops and verify
    // that `tryUse()` after all disposers fire returns null.
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 12 }),
        // Shuffle of dispose-order indices.
        fc.array(fc.integer(), { minLength: 1, maxLength: 12 }),
        (impls, shuffleKeys) => {
          const Cap = defineCapability<number>('InstallTest')
          // Install all impls in order, collect disposers.
          const disposers = impls.map((impl) => ({
            impl,
            dispose: Cap.install(impl),
          }))
          // The LAST install is on top.
          expect(Cap.tryUse()).toBe(impls[impls.length - 1])
          // Dispose in a randomized order. The cap may pop arbitrary
          // entries from the middle; the top after each dispose is
          // whatever's left at the end of the stack.
          const sorted = disposers
            .map((d, i) => ({ d, key: shuffleKeys[i % shuffleKeys.length] ?? 0 }))
            .sort((a, b) => a.key - b.key)
            .map((x) => x.d)
          for (const d of sorted) d.dispose()
          // After all dispose, the cap is empty.
          expect(Cap.tryUse()).toBeNull()
        },
      ),
      { numRuns: 30 },
    )
  })

  test('use(fallback) returns the fallback when not provided; respects provide', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (fallback, provided) => {
        const Cap = defineCapability<number>('FallbackTest')
        // Outside provide: fallback wins.
        expect(Cap.use(fallback)).toBe(fallback)
        // Inside provide: provided wins.
        Cap.provide(provided, () => {
          expect(Cap.use(fallback)).toBe(provided)
        })
        // After provide: back to fallback.
        expect(Cap.use(fallback)).toBe(fallback)
      }),
      { numRuns: 30 },
    )
  })

  test('provide() pops on exception, leaving the stack balanced', () => {
    fc.assert(
      fc.property(fc.integer(), (impl) => {
        const Cap = defineCapability<number>('ThrowTest')
        expect(() =>
          Cap.provide(impl, () => {
            throw new Error('boom')
          }),
        ).toThrow(/boom/)
        // Stack is balanced — no leaked cap.
        expect(Cap.tryUse()).toBeNull()
      }),
      { numRuns: 20 },
    )
  })

  test('disposing the same install twice is idempotent', () => {
    const Cap = defineCapability<number>('IdempotentTest')
    const dispose = Cap.install(42)
    expect(Cap.use()).toBe(42)
    dispose()
    expect(Cap.tryUse()).toBeNull()
    expect(() => dispose()).not.toThrow()
    expect(Cap.tryUse()).toBeNull()
  })
})

// ─── Per-cap isolation ───────────────────────────────────────────────

describe('capability — property: per-cap isolation', () => {
  test('two distinct capabilities never interfere', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.integer(), (s, n) => {
        const A = defineCapability<string>('IsoA')
        const B = defineCapability<number>('IsoB')
        A.provide(s, () => {
          B.provide(n, () => {
            expect(A.use()).toBe(s)
            expect(B.use()).toBe(n)
          })
          // B is gone; A still here.
          expect(A.use()).toBe(s)
          expect(B.tryUse()).toBeNull()
        })
        expect(A.tryUse()).toBeNull()
        expect(B.tryUse()).toBeNull()
      }),
      { numRuns: 30 },
    )
  })
})
