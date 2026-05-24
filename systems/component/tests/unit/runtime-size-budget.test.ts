// @vitest-environment node
//
// Byte-budget tests for the inline runtimes that ship on every page
// using SPA-nav / theming. Each one is `<script>`-inlined into the
// `<head>`, so its size directly impacts TTFB on every nav of every
// islands-mode app. Without an enforced ceiling, harmless-looking
// adds (a new feature branch in the prefetch path, a new theme
// helper) compound into hundreds of extra bytes shipped on every
// request before anyone notices.
//
// Budgets are RAW byte counts of the emitted IIFE string (the
// minifier in production buys roughly another 25-40% but we measure
// pre-minify since `minifyInline` is the framework's own helper —
// regressions in IT would mask regressions in the runtime source).
//
// Tune the budgets up only with a written reason in the test. Don't
// tune them up to silence a failure.

import { describe, expect, test } from 'vitest'
import { placeSpaNav } from '../../src/__spa_nav.ts'
import { themeEarlyScript } from '../../src/theme.ts'

// Budgets reflect the current emit size + ~10% headroom for small
// future additions. Bump ONLY with a written justification (e.g.
// "added X feature; before/after = N/M bytes; minified delta = K").
// Don't bump to silence a failure.
//
// Snapshot at 0.10.10:
//   placeSpaNav default          = 9396 bytes (raw, pre-minify)
//   placeSpaNav no-prefetch       = 9397 bytes (1 byte = `false` vs `true`)
//   themeEarlyScript 2 modes     = 430 bytes
//   themeEarlyScript 5 modes     = 716 bytes
const SPA_NAV_BUDGET_BYTES = 10500
const THEME_EARLY_BUDGET_2_MODES_BYTES = 500
const THEME_EARLY_BUDGET_5_MODES_BYTES = 850

describe('runtime size budget — placeSpaNav', () => {
  test('default config (all features on) fits the budget', () => {
    const out = placeSpaNav()
    expect(out.length).toBeLessThanOrEqual(SPA_NAV_BUDGET_BYTES)
  })

  test('themeClassMap omitted does not bloat the IIFE significantly', () => {
    const empty = placeSpaNav()
    const withMap = placeSpaNav({ themeClassMap: { dark: 'theme-dark', light: 'theme-light' } })
    // The map serializes to a tiny inline JSON; the diff should be
    // ~the bytes of the serialized map plus syntactic overhead.
    expect(withMap.length - empty.length).toBeLessThanOrEqual(80)
  })

  // Note: `prefetch: false` currently produces a runtime of roughly
  // the same size as the default (the listener attach is gated but
  // the function bodies stay). A future optimisation could strip the
  // prefetch closure entirely when disabled; until then we don't
  // assert a size delta here.
})

describe('runtime size budget — themeEarlyScript', () => {
  test('2 modes (light + dark) fits the 2-mode budget', () => {
    const out = themeEarlyScript(
      { names: ['light', 'dark'] as const, htmlClass: (n: string) => `theme-${n}` },
      'place-theme',
    )
    expect(out.length).toBeLessThanOrEqual(THEME_EARLY_BUDGET_2_MODES_BYTES)
  })

  test('5 modes fits the 5-mode budget', () => {
    const out = themeEarlyScript(
      {
        names: ['light', 'dark', 'sepia', 'highcontrast', 'system'] as const,
        htmlClass: (n: string) => `theme-${n}`,
      },
      'place-theme',
    )
    expect(out.length).toBeLessThanOrEqual(THEME_EARLY_BUDGET_5_MODES_BYTES)
  })

  test('cookieName length scales linearly', () => {
    const short = themeEarlyScript(
      { names: ['a', 'b'] as const, htmlClass: (n) => `t-${n}` },
      'x',
    )
    const long = themeEarlyScript(
      { names: ['a', 'b'] as const, htmlClass: (n) => `t-${n}` },
      'really-long-cookie-name-for-the-test',
    )
    // The cookie name appears in the regex literal + the stash; the
    // diff should be ~2x the name-length difference.
    const nameDelta = 'really-long-cookie-name-for-the-test'.length - 'x'.length
    expect(long.length - short.length).toBeGreaterThanOrEqual(nameDelta)
    expect(long.length - short.length).toBeLessThanOrEqual(nameDelta * 3)
  })
})
