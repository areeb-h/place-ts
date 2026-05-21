// @place/component view() — unified hydration factory (ADR 0030).
//
// `view()` is the public successor to `island()`. The author shape is
// identical — `view((props) => <…/>)` with the auto-import plugin, or
// `view(import.meta.url, fn)` explicitly. The TYPE-LEVEL effect brands
// on the primitives the body uses (`state`, `derived`, `watch`,
// `onMount`, `fetch`, …) determine the level the classifier predicts;
// the optional `level` option lets the author ASSERT that prediction
// and unlock per-level emit strategies that change the shipped JS.
//
// Today's emission map (Tier 9, this commit):
//
//   level: 'static'         → L0. No per-island bundle. No `<script>`
//                             tag. No `data-view-id` marker. SSR HTML
//                             ships verbatim; hydration is a no-op.
//                             Real shipping savings (≈4–7 KB per
//                             would-be island bundle, gzipped).
//
//   level: 'island'         → L2. Identical to `island()`'s emit shape:
//   level: 'island+stream'   per-island bundle, marker, full hydration.
//                             `island+stream` aliases to `'island'` —
//                             streaming is wrapped from outside via
//                             `<Suspense>` + `renderToStream`, not a
//                             separate emit shape per island (ADR 0029).
//
//   level: 'thaw'           → THROWS. The L1 thaw runtime hasn't shipped
//                             (ADR 0027 deferred). The classifier may
//                             label a component thaw-eligible, but
//                             setting `level: 'thaw'` on `view()` errors
//                             until the runtime lands. Drop the option to
//                             fall back to L2 island.
//
//   level: undefined        → defaults to `'island'` (today's behavior).
//                             The view-classifier's prediction is
//                             advisory; the author opts into the L0
//                             emit by setting `level: 'static'`
//                             explicitly. Future tiers may flag-flip
//                             this default once L1 ships and the
//                             classifier's prediction is authoritative.
//
// **`island()` is now a deprecated alias.** It still works — the
// migration is a rename (`island` → `view`) with no behavior change.
// New code should use `view()`; the deprecation lives in the JSDoc
// and the migration tooling will flag remaining `island()` call sites.
//
// **Why `level` is opt-in rather than auto-picked.** The classifier
// produces a PREDICTION; the author owns the CONTRACT. A misclassified
// component (rare with type-based detection but possible — e.g. a `fn`
// branch the classifier can't statically prove unreachable) silently
// promoting to a wrong emit level would be a hard-to-debug regression.
// Today the author sets the level deliberately; the framework
// validates against the classifier and rejects mismatches at build
// time. The win curve is preserved without the footgun.

import type { View } from './index.ts'
import { type IslandComponent, type IslandOptions, island } from './islands.ts'

/** Public hydration levels the framework recognises (per ADR 0030 +
 *  `@place/reactivity/effects` `ViewLevel`). */
export type ViewLevel = 'static' | 'thaw' | 'island' | 'island+stream'

/** Per-view options. Extends `IslandOptions` with a `level` hint
 *  that asserts the emit strategy. Omit to get the default
 *  (`'island'`); set `'static'` to ship zero JS for a pure component. */
export interface ViewOptions<P extends Record<string, unknown>> extends IslandOptions<P> {
  /**
   * Assert the emit level. The framework validates against the
   * view-classifier's prediction at build time; a mismatch is a
   * hard error.
   *
   *   - `'static'` (L0) — pure component, no effects. Ships ZERO
   *     per-island JS. SSR HTML is the final state.
   *   - `'thaw'` (L1) — NOT IMPLEMENTED. The L1 runtime is deferred
   *     (ADR 0027); `view({ level: 'thaw' })` throws at definition
   *     time with a migration hint. Drop the option to fall back
   *     to `'island'`.
   *   - `'island'` (L2) — current default. Per-island bundle, full
   *     hydration. Identical to today's `island()` behavior.
   *   - `'island+stream'` (L3) — alias for `'island'`. Streaming is
   *     wrapped from outside via `<Suspense>` + `renderToStream`
   *     (ADR 0029); per-island bundle is the same as L2.
   *
   * Unset (the common case): defaults to `'island'`. The classifier's
   * prediction is informational only.
   */
  readonly level?: ViewLevel
}

// ===== `view()` factory =====

/**
 * The platform's unified hydration factory. Same author shape as
 * `island()`; identical default behavior. Set `level: 'static'` on
 * options to ship zero per-island JS for a pure-render component.
 *
 * @see ADR 0030 — Unified hydration via effect-typed classification
 */
export function view<P extends Record<string, unknown>>(
  fn: (props: P) => View,
  options?: ViewOptions<P>,
): IslandComponent<P>
export function view<P extends Record<string, unknown>>(
  srcUrl: string,
  fn: (props: P) => View,
  options?: ViewOptions<P>,
): IslandComponent<P>
export function view<P extends Record<string, unknown>>(
  srcUrlOrFn: string | ((props: P) => View),
  maybeFnOrOptions?: ((props: P) => View) | ViewOptions<P>,
  maybeOptions?: ViewOptions<P>,
): IslandComponent<P> {
  // Extract `level` first so we can branch BEFORE the island registry
  // is touched (L0 static views must NOT register, or the bundler
  // would generate a per-island bundle for code that ships no JS).
  let level: ViewLevel = 'island'
  let optionsForIsland: IslandOptions<P> | undefined
  if (typeof srcUrlOrFn === 'function') {
    // view(fn, options?) — one-arg form (plugin-rewritten in apps).
    const opts = maybeFnOrOptions as ViewOptions<P> | undefined
    if (opts?.level !== undefined) level = opts.level
    optionsForIsland = opts ? stripLevel(opts) : undefined
  } else {
    // view(src, fn, options?) — two/three-arg explicit form.
    const opts = maybeOptions
    if (opts?.level !== undefined) level = opts.level
    optionsForIsland = opts ? stripLevel(opts) : undefined
  }
  // Reject unbuilt levels up front with a helpful migration hint.
  if (level === 'thaw') {
    throw new Error(
      "view({ level: 'thaw' }): the L1 thaw runtime is deferred (ADR 0027). " +
        "Drop the `level` option to fall back to `'island'`, or set " +
        "`level: 'static'` if the component has no effects at all.",
    )
  }
  // Static fast-path: no marker, no bundle, no hydration. Just emit
  // the impl's SSR HTML and bind mount/hydrate to render-in-place
  // semantics (used by tests that mount a static view to a fresh DOM
  // node; in production the SSR path is the only one the user hits).
  if (level === 'static') {
    return makeStaticView(srcUrlOrFn, maybeFnOrOptions, optionsForIsland)
  }
  // L2 + L3 path: delegate to `island()`. `'island+stream'` is the
  // same emit shape as `'island'` — streaming is handled by `<Suspense>`
  // from outside, not by a per-island bundle change.
  if (typeof srcUrlOrFn === 'function') {
    return island(srcUrlOrFn, optionsForIsland)
  }
  const fn = maybeFnOrOptions as (props: P) => View
  return island(srcUrlOrFn, fn, optionsForIsland)
}

// ===== Internal: static fast-path =====
//
// `level: 'static'` returns a callable that mimics `IslandComponent<P>`
// structurally — `__islandBrand` present, `__islandName` / `__islandSrc`
// for tooling — but DOESN'T register with the bundler. Its `toHtml`
// renders the impl directly with no marker wrap; its `mount` /
// `hydrate` mount the impl into the target so test scenarios + JSX
// runtime stay symmetric.

import { ISLAND_BRAND } from './islands.ts'

function makeStaticView<P extends Record<string, unknown>>(
  srcUrlOrFn: string | ((props: P) => View),
  maybeFnOrOptions: ((props: P) => View) | ViewOptions<P> | undefined,
  _options: IslandOptions<P> | undefined,
): IslandComponent<P> {
  // Resolve the impl + a name for tooling.
  let fn: (props: P) => View
  let name: string
  let src: string
  if (typeof srcUrlOrFn === 'function') {
    fn = srcUrlOrFn
    // No URL → no bundle → name is informational only. Use the fn
    // name if present, else a stable sentinel.
    name = fn.name && fn.name.length > 0 ? fn.name : 'anonymous-static-view'
    src = ''
  } else {
    fn = maybeFnOrOptions as (props: P) => View
    src = srcUrlOrFn
    // Derive name from basename — same rule as island() so the
    // classifier's path-keyed lookups match.
    const decoded = (() => {
      try {
        const u = new URL(srcUrlOrFn)
        return u.pathname
      } catch {
        return srcUrlOrFn
      }
    })()
    name = decoded
      .replace(/^.*\//, '')
      .replace(/\.[jt]sx?$/, '')
      .replace(/\.island$/, '')
  }

  const callable = (props: P): View => {
    // Strip the framework-reserved `client` prop before invoking the
    // impl — same convention as `island()`. Strategy is meaningless
    // for static views (nothing to hydrate) but the prop may still
    // arrive from JSX consumers used to writing `<X client="…" />`.
    const { client: _strategy, ...userProps } = (props ?? {}) as P & {
      client?: unknown
    }
    const inner = fn(userProps as unknown as P)
    return {
      toHtml: (): string => inner.toHtml?.() ?? '',
      mount(container, before) {
        return inner.mount(container, before)
      },
      hydrate(slot) {
        return inner.hydrate ? inner.hydrate(slot) : inner.mount(slot.parent(), null)
      },
    }
  }

  return Object.assign(callable, {
    __islandName: name,
    __islandSrc: src,
    __islandBrand: ISLAND_BRAND,
  }) as IslandComponent<P>
}

// Strip `level` from options before passing to island() — island()'s
// IslandOptions doesn't know about `level` and the property would
// just sit unused. Returning a new object keeps the caller's options
// reference intact.
function stripLevel<P extends Record<string, unknown>>(
  opts: ViewOptions<P>,
): IslandOptions<P> | undefined {
  const { level: _level, ...rest } = opts
  // If only `level` was set, return undefined so callers can keep the
  // optional-options shape clean.
  return Object.keys(rest).length === 0 ? undefined : (rest as IslandOptions<P>)
}
