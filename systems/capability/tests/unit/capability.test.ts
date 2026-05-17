import { describe, expect, test } from 'vitest'
import type { Effect, IO as IOEffect, Requires, Throws } from '../../src/index.ts'
import { defineCapability, requires } from '../../src/index.ts'

interface IOCap {
  read(path: string): string
  write(path: string, data: string): void
}

describe('defineCapability', () => {
  test('use throws when no provider is installed', () => {
    const IO = defineCapability<IOCap>('IO')
    expect(() => IO.use()).toThrow(/not provided/i)
  })

  test('use returns the provided implementation', () => {
    const IO = defineCapability<IOCap>('IO')
    const reads: string[] = []
    const result = IO.provide(
      {
        read: (path) => {
          reads.push(path)
          return `content of ${path}`
        },
        write: () => {},
      },
      () => {
        return IO.use().read('foo.txt')
      },
    )
    expect(result).toBe('content of foo.txt')
    expect(reads).toEqual(['foo.txt'])
  })

  test('provide returns the body return value', () => {
    const Counter = defineCapability<{ value: number }>('Counter')
    const result = Counter.provide({ value: 42 }, () => Counter.use().value * 2)
    expect(result).toBe(84)
  })

  test('use throws after provide returns', () => {
    const IO = defineCapability<IOCap>('IO')
    IO.provide({ read: () => 'x', write: () => {} }, () => {
      expect(IO.use().read('p')).toBe('x')
    })
    expect(() => IO.use()).toThrow(/not provided/i)
  })

  test('nested provides shadow outer; restore on exit', () => {
    const Tag = defineCapability<string>('Tag')
    const log: string[] = []
    Tag.provide('outer', () => {
      log.push(Tag.use())
      Tag.provide('inner', () => {
        log.push(Tag.use())
      })
      log.push(Tag.use())
    })
    expect(log).toEqual(['outer', 'inner', 'outer'])
  })

  test('provide restores even when body throws', () => {
    const Tag = defineCapability<string>('Tag')
    Tag.provide('a', () => {
      try {
        Tag.provide('b', () => {
          throw new Error('boom')
        })
      } catch {
        // expected
      }
      // After the inner provide unwinds, Tag should be 'a' again, not 'b'.
      expect(Tag.use()).toBe('a')
    })
  })

  test('tryUse returns null when not provided', () => {
    const IO = defineCapability<IOCap>('IO')
    expect(IO.tryUse()).toBeNull()
  })

  test('tryUse returns the impl when provided', () => {
    const Tag = defineCapability<string>('Tag')
    Tag.provide('hello', () => {
      expect(Tag.tryUse()).toBe('hello')
    })
  })

  test('multiple capabilities are independent', () => {
    const A = defineCapability<number>('A')
    const B = defineCapability<string>('B')
    A.provide(1, () => {
      B.provide('two', () => {
        expect(A.use()).toBe(1)
        expect(B.use()).toBe('two')
      })
      // B unwound, A still set
      expect(A.use()).toBe(1)
      expect(B.tryUse()).toBeNull()
    })
  })

  test('the same capability can be re-provided with a different impl', () => {
    const Logger = defineCapability<{ log(s: string): void }>('Logger')
    const captured: string[] = []
    Logger.provide({ log: (s) => captured.push(`A:${s}`) }, () => {
      Logger.use().log('one')
      Logger.provide({ log: (s) => captured.push(`B:${s}`) }, () => {
        Logger.use().log('two')
      })
      Logger.use().log('three')
    })
    expect(captured).toEqual(['A:one', 'B:two', 'A:three'])
  })

  test('handlers can throw', () => {
    const Net = defineCapability<{ fetch(url: string): string }>('Net')
    Net.provide(
      {
        fetch: () => {
          throw new Error('network error')
        },
      },
      () => {
        expect(() => Net.use().fetch('https://x')).toThrow(/network error/)
      },
    )
  })

  test('error message names the capability', () => {
    const Foo = defineCapability<unknown>('FooCap')
    expect(() => Foo.use()).toThrow(/FooCap/)
  })
})

describe('requires — Phase 4 v0.1 typed-effects helper', () => {
  test('wrapped function passes through arguments and return value', () => {
    const Log = defineCapability<{ msg: string }>('Log')
    const wrapped = requires(Log)((n: number, s: string) => `${s}-${n}`)
    Log.provide({ msg: 'x' }, () => {
      expect(wrapped(7, 'foo')).toBe('foo-7')
    })
  })

  test('throws a clear error when a required cap is not installed', () => {
    const A = defineCapability<unknown>('AlphaCap')
    const fn = requires(A)(() => 'should not run')
    expect(() => fn()).toThrow(/AlphaCap/)
    expect(() => fn()).toThrow(/withCapability|install/)
  })

  test('throws BEFORE the inner body runs (early-error)', () => {
    const A = defineCapability<unknown>('AlphaCap')
    let bodyRan = false
    const fn = requires(A)(() => {
      bodyRan = true
    })
    expect(() => fn()).toThrow()
    expect(bodyRan).toBe(false)
  })

  test('checks every cap in the list, not just the first', () => {
    const A = defineCapability<unknown>('A')
    const B = defineCapability<unknown>('B')
    const fn = requires(A, B)(() => 'ok')
    // Provide A but not B — error should name B.
    A.provide({}, () => {
      expect(() => fn()).toThrow(/B/)
    })
  })

  test('passes when every cap is installed', () => {
    const A = defineCapability<{ a: number }>('A')
    const B = defineCapability<{ b: number }>('B')
    const fn = requires(A, B)(() => A.use().a + B.use().b)
    A.provide({ a: 1 }, () => {
      B.provide({ b: 2 }, () => {
        expect(fn()).toBe(3)
      })
    })
  })

  test('composes — nested requires fire both checks', () => {
    const A = defineCapability<unknown>('A')
    const B = defineCapability<unknown>('B')
    const inner = requires(A)(() => 'inner')
    const outer = requires(B)(() => inner())
    // Neither installed.
    expect(() => outer()).toThrow(/B/)
    // Only B installed — inner's A check fires.
    B.provide({}, () => {
      expect(() => outer()).toThrow(/A/)
    })
    // Both installed — clean call.
    A.provide({}, () => {
      B.provide({}, () => {
        expect(outer()).toBe('inner')
      })
    })
  })

  test('type brand: wrapped fn is assignable to Requires<C>', () => {
    const A = defineCapability<unknown>('A')
    const fn = requires(A)(() => 42)
    // Compile-time check: the brand is preserved.
    const branded: typeof fn & Requires<readonly [typeof A]> = fn
    expect(typeof branded).toBe('function')
  })

  test('Effect / IO / Throws type aliases are usable in signatures', () => {
    // No runtime semantics yet — these are vocabulary placeholders.
    // The test exists to lock the names in: future renames break it.
    const value: Effect<IOEffect, number> = 42
    const errored: Effect<Throws<Error>, string> = 'ok'
    expect(value).toBe(42)
    expect(errored).toBe('ok')
  })
})
