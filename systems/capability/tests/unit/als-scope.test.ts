// @vitest-environment node
//
// runWithCapabilityScope() boundary tests. Caps installed inside one
// scope must not be visible to another concurrent scope; module-level
// (closure stack) baselines must remain visible inside scopes; disposers
// fire correctly across scope unwinds.

import { describe, expect, test } from 'vitest'
import { defineCapability, runWithCapabilityScope } from '../../src/index.ts'

describe('runWithCapabilityScope — per-request capability isolation', () => {
  test('a cap installed inside one scope is invisible in another concurrent scope', async () => {
    const Cap = defineCapability<string>('Test')

    // Two concurrent scopes that interleave their installs and reads.
    // Without ALS isolation, scope B would observe scope A's install.
    const observed: { a: string | null; b: string | null } = { a: null, b: null }
    let releaseA: () => void
    const aHasInstalled = new Promise<void>((r) => {
      releaseA = r
    })

    const scopeA = runWithCapabilityScope(async () => {
      Cap.install('from-A')
      // Signal scope B that A has installed.
      releaseA()
      // Yield so B gets to read while A's install is still on its stack.
      await new Promise((r) => setTimeout(r, 5))
      observed.a = Cap.tryUse()
    })

    const scopeB = runWithCapabilityScope(async () => {
      // Wait until A has installed, then read from B's scope.
      await aHasInstalled
      observed.b = Cap.tryUse()
    })

    await Promise.all([scopeA, scopeB])

    expect(observed.a).toBe('from-A') // A sees its own install
    expect(observed.b).toBeNull() // B does NOT see A's install
  })

  test('module-level (closure) installs are visible inside scopes as a baseline', async () => {
    const Cap = defineCapability<string>('Logger')
    const dispose = Cap.install('module-baseline')
    try {
      const insideScope = await runWithCapabilityScope(() => Cap.use())
      expect(insideScope).toBe('module-baseline')
    } finally {
      dispose()
    }
  })

  test('scope-local install shadows the closure baseline inside the scope only', async () => {
    const Cap = defineCapability<string>('Logger')
    const disposeBaseline = Cap.install('baseline')
    try {
      const insideScope = await runWithCapabilityScope(() => {
        const disposeInside = Cap.install('scoped')
        try {
          return Cap.use() // 'scoped' shadows 'baseline' inside the scope
        } finally {
          disposeInside()
        }
      })
      expect(insideScope).toBe('scoped')
      // Outside the scope: still the baseline.
      expect(Cap.use()).toBe('baseline')
    } finally {
      disposeBaseline()
    }
  })

  test("a scope's install does NOT mutate the closure baseline", async () => {
    const Cap = defineCapability<string>('Logger')
    await runWithCapabilityScope(() => {
      Cap.install('scoped-only')
      expect(Cap.use()).toBe('scoped-only')
    })
    // Back outside: nothing was installed at module level.
    expect(Cap.tryUse()).toBeNull()
  })

  test('many concurrent scopes — none see each others installs', async () => {
    const Cap = defineCapability<number>('Worker')
    const N = 20

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runWithCapabilityScope(async () => {
          Cap.install(i)
          // Yield several times so all 20 scopes interleave.
          for (let j = 0; j < 3; j++) await new Promise((r) => setTimeout(r, 0))
          return Cap.use()
        }),
      ),
    )

    // Each scope must observe its OWN install, not any other's.
    expect(results).toEqual(Array.from({ length: N }, (_, i) => i))
  })

  test('provide() inside a scope is request-local too', async () => {
    const Cap = defineCapability<string>('Test')
    let inner = ''
    let leaked: string | null = null

    await Promise.all([
      runWithCapabilityScope(() => {
        Cap.provide('A', () => {
          inner = Cap.use()
        })
      }),
      runWithCapabilityScope(async () => {
        // Yield so the other scope's provide is in-flight.
        await new Promise((r) => setTimeout(r, 1))
        leaked = Cap.tryUse()
      }),
    ])

    expect(inner).toBe('A')
    expect(leaked).toBeNull()
  })

  test('disposer for a scoped install is a no-op if fired after scope unwound', async () => {
    const Cap = defineCapability<string>('Test')
    let dispose: () => void = () => {}

    await runWithCapabilityScope(() => {
      dispose = Cap.install('inside')
      expect(Cap.use()).toBe('inside')
    })
    // Scope has unwound; the entry is gc'd along with the scope's Map.
    // Calling dispose now must be safe (no throw, no module-level mutation).
    expect(() => dispose()).not.toThrow()
    expect(Cap.tryUse()).toBeNull()
  })

  test('outside any scope, installs go to the closure stack (browser-compat path)', () => {
    const Cap = defineCapability<string>('Test')
    const dispose = Cap.install('module-level')
    try {
      // No scope wrapping: behavior must match pre-ALS code.
      expect(Cap.use()).toBe('module-level')
    } finally {
      dispose()
    }
    expect(Cap.tryUse()).toBeNull()
  })

  test('runWithCapabilityScope returns the function value (sync inside)', async () => {
    expect(await runWithCapabilityScope(() => 42)).toBe(42)
  })

  test('runWithCapabilityScope returns the resolved value (async inside)', async () => {
    expect(
      await runWithCapabilityScope(async () => {
        await new Promise((r) => setTimeout(r, 1))
        return 'done'
      }),
    ).toBe('done')
  })
})
