// Tests for the Phase 2 (ADR 0030) build-time validator that
// catches misclassified `view({ level: 'static' })` assertions.
//
// The validator's job: when an island file asserts `level: 'static'`,
// the classifier must agree the body has no effects. A mismatch
// becomes a hard build error with the offending primitive named.
// Other levels (`'island'`, `'island+stream'`, unset) are not
// validated — they're the default emit shape and a misclassification
// there doesn't promote the emitter incorrectly.

import { describe, expect, test } from 'vitest'
import {
  classifyIslandSource,
  extractAssertedLevel,
  validateAssertedLevel,
} from '../../src/build/view-classifier.ts'

// ─── extractAssertedLevel ─────────────────────────────────────────────

describe('extractAssertedLevel — parsing `view()` options', () => {
  test("recognises view(fn, { level: 'static' })", () => {
    const src = `
      import { view } from '@place/component'
      const fn = () => null
      export default view(fn, { level: 'static' })
    `
    expect(extractAssertedLevel(src)).toBe('static')
  })

  test("recognises view(src, fn, { level: 'static' }) — three-arg form", () => {
    const src = `
      import { view } from '@place/component'
      export default view(import.meta.url, () => null, { level: 'static' })
    `
    expect(extractAssertedLevel(src)).toBe('static')
  })

  test('recognises double-quoted level value', () => {
    const src = `view(fn, { level: "island" })`
    expect(extractAssertedLevel(src)).toBe('island')
  })

  test('recognises backtick-quoted level value', () => {
    const src = 'view(fn, { level: `static` })'
    expect(extractAssertedLevel(src)).toBe('static')
  })

  test('returns null when no view() call is present', () => {
    const src = `export default function MyComponent() { return null }`
    expect(extractAssertedLevel(src)).toBeNull()
  })

  test('returns null when view() has no options object', () => {
    const src = `view(fn)`
    expect(extractAssertedLevel(src)).toBeNull()
  })

  test('returns null when options object has no level field', () => {
    const src = `view(fn, { ssrProps: () => null })`
    expect(extractAssertedLevel(src)).toBeNull()
  })

  test('returns null when level is a non-literal expression', () => {
    // The framework only validates literal asserts; dynamic values
    // can't be statically checked. The runtime view() factory still
    // accepts them.
    const src = `
      const dynamicLevel = 'static'
      view(fn, { level: dynamicLevel })
    `
    expect(extractAssertedLevel(src)).toBeNull()
  })

  test('returns null when level is in a string literal or comment', () => {
    const src = `
      // Some doc mentions level: 'static' for illustration.
      const note = "level: 'static'"
      view(fn)
    `
    expect(extractAssertedLevel(src)).toBeNull()
  })

  test('handles view<Generic>(fn, opts) syntax', () => {
    const src = `view<{ x: number }>(fn, { level: 'static' })`
    expect(extractAssertedLevel(src)).toBe('static')
  })

  test("recognises 'island+stream' literal", () => {
    const src = `view(fn, { level: 'island+stream' })`
    expect(extractAssertedLevel(src)).toBe('island+stream')
  })

  test('returns null for unknown level value (typo guard)', () => {
    const src = `view(fn, { level: 'staticc' })`
    expect(extractAssertedLevel(src)).toBeNull()
  })
})

// ─── validateAssertedLevel ────────────────────────────────────────────

describe("validateAssertedLevel — 'static' assertion + classifier mismatch", () => {
  test('passes when assertion + classifier both say static', () => {
    const src = `
      // Pure component — no effects.
      import { view } from '@place/component'
      const fn = (props) => null
      export default view(fn, { level: 'static' })
    `
    const result = classifyIslandSource(src)
    expect(result.level).toBe('static')
    expect(() => validateAssertedLevel('pure-test', src, result)).not.toThrow()
  })

  test("throws when 'static' asserted but body uses state()", () => {
    const src = `
      import { state, view } from '@place/component'
      const fn = () => {
        const n = state(0)
        return null
      }
      export default view(fn, { level: 'static' })
    `
    const result = classifyIslandSource(src)
    expect(result.level).toBe('thaw') // state → L1
    expect(() => validateAssertedLevel('with-state', src, result)).toThrow(
      /asserts `level: 'static'` but the body has effects/,
    )
  })

  test("throws when 'static' asserted but body uses onMount()", () => {
    const src = `
      import { onMount, view } from '@place/component'
      const fn = () => {
        onMount(() => {})
        return null
      }
      export default view(fn, { level: 'static' })
    `
    const result = classifyIslandSource(src)
    expect(result.level).toBe('island') // onMount → L2
    expect(() => validateAssertedLevel('with-onmount', src, result)).toThrow(
      /asserts `level: 'static'`/,
    )
  })

  test('error message names the offending primitive', () => {
    const src = `
      import { state, view } from '@place/component'
      const fn = () => {
        const n = state(0)
        return null
      }
      export default view(fn, { level: 'static' })
    `
    const result = classifyIslandSource(src)
    try {
      validateAssertedLevel('with-state', src, result)
      expect.fail('should have thrown')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      expect(msg).toContain("'state'") // identifier
      expect(msg).toContain("'state'") // effect kind also contains the word
      expect(msg).toContain("Classifier prediction: 'thaw'")
      expect(msg).toContain('Fix:')
    }
  })

  test("does NOT throw when 'island' is asserted but body is L1-eligible (less strict than default)", () => {
    // Asserting 'island' (the default) on a body that would also
    // classify as L1 is fine — the dev opted for the safer emit
    // explicitly. Validation only catches OVER-aggressive asserts.
    const src = `
      import { state, view } from '@place/component'
      const fn = () => {
        const n = state(0)
        return null
      }
      export default view(fn, { level: 'island' })
    `
    const result = classifyIslandSource(src)
    expect(() => validateAssertedLevel('with-state-as-island', src, result)).not.toThrow()
  })

  test('does NOT throw when no assertion is present', () => {
    const src = `
      import { state, view } from '@place/component'
      const fn = () => {
        const n = state(0)
        return null
      }
      export default view(fn)
    `
    const result = classifyIslandSource(src)
    expect(() => validateAssertedLevel('no-assert', src, result)).not.toThrow()
  })

  test('does NOT throw on dynamic level expression (un-statically-analysable)', () => {
    const src = `
      import { state, view } from '@place/component'
      const dynamicLevel = 'static'
      const fn = () => {
        const n = state(0)
        return null
      }
      export default view(fn, { level: dynamicLevel })
    `
    const result = classifyIslandSource(src)
    // Validation skipped — extractAssertedLevel returns null for
    // non-literal expressions. (Runtime errors still possible if the
    // dynamic value resolves to a wrong level; that's the cost of
    // not being a literal.)
    expect(() => validateAssertedLevel('dynamic', src, result)).not.toThrow()
  })
})
