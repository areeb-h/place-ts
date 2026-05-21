// Property-based tests for @place-ts/routing.
//
// The `route()` primitive has subtle URL-encoding behavior + an
// inverse-pair (build / match) contract. Property tests verify the
// pair is structurally sound across the entire input space, not just
// the handful of values exercised in the unit tests.

import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import { route } from '../../systems/routing/src/index.ts'

// Safe param values: anything that won't crash encodeURIComponent +
// has non-empty content (the build() guard requires non-empty per
// the audit fix). Filter out characters fc generates that aren't
// realistic URL fragments — explicitly include common URL-tricky
// values to exercise the encoder.
const paramValueArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.length > 0 && !s.includes('/') && !s.includes('\0'))

// Pattern segments: alphanumerics so the pattern's own segments
// (which aren't encoded) don't collide with encoded param bytes.
const literalSegArb = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter((s) => /^[a-z0-9_-]+$/.test(s))

const paramNameArb = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s))

// ─── Build / match round-trip ────────────────────────────────────────

describe('routing — property: build / match are inverse over the param domain', () => {
  test('route(pattern)(params) → match(...) → equals params (single :id pattern)', () => {
    fc.assert(
      fc.property(literalSegArb, paramNameArb, paramValueArb, (prefix, paramName, value) => {
        const r = route(`/${prefix}/:${paramName}`)
        const built = r({ [paramName]: value } as unknown as never)
        const matched = r.match(built)
        expect(matched).not.toBeNull()
        expect((matched as Record<string, string>)[paramName]).toBe(value)
      }),
      { numRuns: 80 },
    )
  })

  test('multi-param patterns round-trip (two :params)', () => {
    fc.assert(
      fc.property(
        literalSegArb,
        paramNameArb,
        paramNameArb,
        paramValueArb,
        paramValueArb,
        (prefix, p1, p2, v1, v2) => {
          if (p1 === p2) return // pattern would collide on duplicate keys
          const r = route(`/${prefix}/:${p1}/:${p2}`)
          const built = r({ [p1]: v1, [p2]: v2 } as unknown as never)
          const matched = r.match(built)
          expect(matched).not.toBeNull()
          const m = matched as Record<string, string>
          expect(m[p1]).toBe(v1)
          expect(m[p2]).toBe(v2)
        },
      ),
      { numRuns: 60 },
    )
  })

  test('build URL-encodes special characters and match decodes them back', () => {
    // Targeted regression: spaces, slashes-in-values (encoded), unicode.
    // (slashes in raw values are filtered out of the value arb above;
    // here we explicitly construct values that need encoding.)
    fc.assert(
      fc.property(
        fc.constantFrom('hello world', 'a&b=c', 'café', 'a+b', '100%', '#frag', '?q=1'),
        (raw) => {
          const r = route('/x/:k')
          const built = r({ k: raw } as never)
          expect(built).not.toContain(' ') // must be encoded
          const matched = r.match(built)
          expect(matched).not.toBeNull()
          expect((matched as Record<string, string>)['k']).toBe(raw)
        },
      ),
      { numRuns: 30 },
    )
  })

  test('missing required param throws at build time', () => {
    fc.assert(
      fc.property(paramNameArb, (name) => {
        const r = route(`/x/:${name}`)
        expect(() => r({} as never)).toThrow(/missing required param/)
      }),
      { numRuns: 20 },
    )
  })
})

// ─── Match rejects malformed paths ───────────────────────────────────

describe('routing — property: match rejects malformed paths', () => {
  test('match returns null for any path with consecutive slashes', () => {
    fc.assert(
      fc.property(literalSegArb, literalSegArb, (a, b) => {
        const r = route(`/${a}/${b}`)
        // Inject a `//` anywhere in the path.
        const badPath = `/${a}//${b}`
        expect(r.match(badPath)).toBeNull()
      }),
      { numRuns: 30 },
    )
  })

  test('match returns null when path segment count differs from pattern', () => {
    fc.assert(
      fc.property(
        literalSegArb,
        fc.array(literalSegArb, { minLength: 0, maxLength: 6 }),
        (patternSeg, extra) => {
          const r = route(`/${patternSeg}`)
          // Path with too many segments.
          const path = ['', patternSeg, ...extra].join('/')
          if (extra.length === 0) return // would actually match
          expect(r.match(path)).toBeNull()
        },
      ),
      { numRuns: 40 },
    )
  })

  test('query string is stripped before segment compare', () => {
    fc.assert(
      fc.property(
        literalSegArb,
        paramValueArb,
        fc.string({ minLength: 1, maxLength: 12 }),
        (prefix, value, query) => {
          const r = route(`/${prefix}/:k`)
          const built = r({ k: value } as never)
          // Adding a query string must not change the match result.
          const withQuery = `${built}?${query}=1`
          const matched = r.match(withQuery)
          expect(matched).not.toBeNull()
          expect((matched as Record<string, string>)['k']).toBe(value)
        },
      ),
      { numRuns: 40 },
    )
  })
})

// ─── Pattern stability ───────────────────────────────────────────────

describe('routing — property: pattern stable across build/match', () => {
  test('r.pattern equals the construction argument verbatim', () => {
    fc.assert(
      fc.property(literalSegArb, paramNameArb, (seg, name) => {
        const pattern = `/${seg}/:${name}`
        const r = route(pattern)
        expect(r.pattern).toBe(pattern)
      }),
      { numRuns: 30 },
    )
  })
})
