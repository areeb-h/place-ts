// @vitest-environment node
//
// Bake-time assertions on the IIFE emitted by `placeSpaNav()`. We
// don't evaluate it here — that's covered by an integration test in
// the publish smoke (`smoke-test-publish.sh` curls the dev server
// with a place-theme cookie and inspects the SSR'd toggle). These
// unit tests pin down the source string so the regressions we
// just fixed can't sneak back in via a refactor:
//
//   - LRU eviction at cap (not a permanent shutoff after N hovers).
//   - Hover-intent delay (no firehose on pointerover sweeps).
//   - `pointerdown` prefetch (immediate commitment signal).
//   - Connection-quality gate (`saveData` + `effectiveType` + `deviceMemory`).
//   - Opportunistic TTL sweep (stale entries leak otherwise).
//   - AbortController on the prefetch fetch (so eviction cancels in-flight).
//   - Configurable tunables bake in from the call site.

import { describe, expect, test } from 'vitest'
import { placeSpaNav } from '../../src/__spa_nav.ts'

describe('placeSpaNav — prefetch runtime baking', () => {
  test('defaults bake into the IIFE (65ms hover, 24 cap, 30s TTL)', () => {
    const js = placeSpaNav()
    // The minifier preserves variable assignments; the numeric
    // literals show up verbatim.
    expect(js).toMatch(/HOVER_DELAY_MS=65\b/)
    expect(js).toMatch(/PREFETCH_MAX=24\b/)
    expect(js).toMatch(/PREFETCH_TTL_MS=30000\b/)
  })

  test('caller-supplied tunables override defaults', () => {
    const js = placeSpaNav({
      prefetchHoverDelayMs: 120,
      prefetchMax: 48,
      prefetchTtlMs: 60_000,
    })
    expect(js).toMatch(/HOVER_DELAY_MS=120\b/)
    expect(js).toMatch(/PREFETCH_MAX=48\b/)
    expect(js).toMatch(/PREFETCH_TTL_MS=60000\b/)
  })

  test('negative / NaN tunables coerce to safe positives (no permanent shutoff)', () => {
    // Cap=0 would block every prefetch; clamp to 1.
    // Hover-delay must be ≥0; TTL must be ≥1000 (any shorter is useless).
    const js = placeSpaNav({
      prefetchHoverDelayMs: -50,
      prefetchMax: 0,
      prefetchTtlMs: 10,
    })
    expect(js).toMatch(/HOVER_DELAY_MS=0\b/)
    expect(js).toMatch(/PREFETCH_MAX=1\b/)
    expect(js).toMatch(/PREFETCH_TTL_MS=1000\b/)
  })

  test('LRU eviction path is wired (evictKey + prefetchOrder)', () => {
    // The pre-0.10.5 bug: `prefetchN` counter never decremented,
    // shutting prefetch off forever after the 24th hover. The fix
    // tracks size via the prefetchOrder array + evictKey() helper.
    // If a refactor removes either, this test catches it.
    const js = placeSpaNav()
    expect(js).toContain('prefetchOrder')
    expect(js).toContain('evictKey')
    // The cap check now reads the array length (the actual size),
    // not a monotonic counter.
    expect(js).toMatch(/prefetchOrder\.length>=PREFETCH_MAX/)
    // And eviction must remove the OLDEST entry — i.e. read
    // prefetchOrder[0] (the head of the insertion-ordered array).
    expect(js).toMatch(/evictKey\(prefetchOrder\[0\]\)/)
  })

  test('hover-intent delay path is wired (setTimeout + clear on out)', () => {
    const js = placeSpaNav()
    // Hover-intent: pointerover schedules a setTimeout, pointerout
    // clears it. Without this, mouse-sweep over a dense link grid
    // burns dozens of prefetches on links the user never meant to
    // consider.
    expect(js).toContain('hoverTimers')
    expect(js).toContain('clearHoverTimer')
    expect(js).toMatch(/setTimeout\(function\(\)\{.*prefetch\(href\)/)
    // pointerout listener attached.
    expect(js).toMatch(/addEventListener\(['"]pointerout['"]/)
  })

  test('pointerdown is wired as an immediate prefetch trigger', () => {
    const js = placeSpaNav()
    // The strongest "about to navigate" signal short of click —
    // mouse-button down. Pre-0.10.5 we only listened on pointerover
    // and focusin, missing fast clickers + touch devices.
    expect(js).toMatch(/addEventListener\(['"]pointerdown['"]/)
  })

  test('connection-quality gates are wired (saveData + effectiveType + deviceMemory)', () => {
    const js = placeSpaNav()
    // saveData — explicit user opt-out (Data Saver in Chrome).
    expect(js).toMatch(/c\.saveData/)
    // effectiveType — slow connections still cost the user real money.
    expect(js).toMatch(/effectiveType/)
    expect(js).toMatch(/['"]slow-2g['"]/)
    expect(js).toMatch(/['"]2g['"]/)
    // deviceMemory — Chromium-only hint; <1GB devices skip prefetch.
    expect(js).toMatch(/navigator\.deviceMemory/)
  })

  test('opportunistic TTL sweep runs at prefetch entry', () => {
    const js = placeSpaNav()
    // Without a sweep at prefetch entry, stale entries accumulate
    // until a navigate() happens to target that exact URL. For a
    // user who hovers but never clicks (sidebar drift), they leak.
    expect(js).toContain('sweepStale')
    // Sweep is called at the TOP of prefetch() — pin the location
    // so a future refactor doesn't accidentally move it after the
    // cap check. The minifier may leave a newline after the `{`.
    expect(js).toMatch(/function prefetch\(url\)\{\s*sweepStale\(\)/)
  })

  test('AbortController wraps the prefetch fetch (so eviction cancels in-flight)', () => {
    const js = placeSpaNav()
    // Pre-0.10.5 an evicted prefetch let its fetch run to completion,
    // wasting bandwidth on a result no one would consume. Now every
    // prefetch entry stores its AbortController and evictKey aborts it.
    expect(js).toContain('AbortController')
    // The eviction path aborts the controller.
    expect(js).toMatch(/e\.ctl.*abort/)
  })

  test('disabling prefetch removes the listeners (no wasted hover work)', () => {
    const js = placeSpaNav({ prefetch: false })
    expect(js).toMatch(/ENABLE_PREFETCH=false/)
    // The handlers themselves are still defined (single-IIFE has them
    // unconditionally), but the addEventListener call is guarded.
    // We assert the guarded shape so disabling actually skips work.
    expect(js).toMatch(/if\(ENABLE_PREFETCH\)\{/)
  })

  test('X-Place-Prefetch header is on every prefetch request (speculation contract)', () => {
    const js = placeSpaNav()
    expect(js).toMatch(/X-Place-Prefetch/)
    expect(js).toMatch(/priority:['"]low['"]/)
  })

  test('navigate() uses evictKey on stale TTL miss (not bare delete)', () => {
    // The pre-0.10.5 stale-drop in navigate() did `delete
    // prefetchCache[k]` without touching prefetchN — that's how the
    // counter desynced from the cache. Now navigate() goes through
    // evictKey() so the order array + cache map + abort signal all
    // stay coherent. Catch a regression by asserting the bare delete
    // in that spot is gone.
    const js = placeSpaNav()
    // The eviction path inside navigate() should call evictKey, not
    // `delete prefetchCache[k]` directly. We can spot the pattern by
    // checking that the stale-drop comment area uses evictKey.
    expect(js).toContain('entry)evictKey(k)')
  })
})
