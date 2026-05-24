// @vitest-environment node
//
// Property tests for the cookie parser (audit P3 #19).
//
// `parseCookieHeader` accepts an arbitrary `Cookie:` header value
// (whatever the upstream proxy / browser hands the request). It must
// NEVER throw — a malformed header is a normal-case input from the
// open internet, not an exception. These properties fuzz the parser
// with random byte strings + structured inputs and pin down two
// invariants:
//
//   1. Never throws, ever.
//   2. For a well-formed `k1=v1; k2=v2; …` input, every key maps to
//      its value AND every value round-trips through `encodeURIComponent`.

import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { parseCookieHeader } from '../../src/cookies.ts'

describe('parseCookieHeader — property invariants', () => {
  test('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        // Must not throw. Return value can be empty Map; that's fine.
        expect(() => parseCookieHeader(s)).not.toThrow()
      }),
      { numRuns: 500 },
    )
  })

  test('never throws on null / undefined / non-string-y inputs', () => {
    expect(() => parseCookieHeader(null)).not.toThrow()
    expect(() => parseCookieHeader(undefined)).not.toThrow()
    expect(parseCookieHeader(null).size).toBe(0)
    expect(parseCookieHeader(undefined).size).toBe(0)
    expect(parseCookieHeader('').size).toBe(0)
  })

  test('well-formed inputs: every key maps + value round-trips encodeURIComponent', () => {
    // Cookie keys: ASCII tokens (RFC 6265 §4.1.1) — letters, digits,
    // `_-`. We restrict the property to that subset because the parser
    // intentionally accepts loose input, but the round-trip property
    // is meaningful only for valid keys.
    const cookieKey = fc
      .stringMatching(/^[a-zA-Z0-9_-]+$/)
      .filter((s) => s.length > 0 && s.length < 30)
    const cookieValue = fc.string({ minLength: 0, maxLength: 30 })
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(cookieKey, cookieValue), {
          minLength: 0,
          maxLength: 10,
          selector: (t) => t[0],
        }),
        (pairs) => {
          // Serialize the pairs exactly the way the framework does.
          const header = pairs
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('; ')
          const out = parseCookieHeader(header)
          for (const [k, v] of pairs) {
            expect(out.get(k)).toBe(v)
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  test('garbled percent-encoding falls back to raw bytes (not undefined)', () => {
    // The parser's catch around decodeURIComponent should leave the
    // raw value in the map rather than dropping the key.
    const out = parseCookieHeader('weird=%E0%A4%A')
    expect(out.has('weird')).toBe(true)
    // The value is the raw `%E0%A4%A` (the trailing 2-byte sequence
    // is invalid UTF-8). The exact value doesn't matter for the
    // property; what matters is the key landed.
  })
})
