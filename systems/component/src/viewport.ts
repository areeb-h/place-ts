// ===== viewport — framework-level reactive screen-size primitive =====
//
// The user-facing answer to "is this mobile?" / "what's the breakpoint?"
// across the framework. ONE primitive every consumer subscribes to
// instead of each component wiring its own `matchMedia` /
// `ResizeObserver`.
//
// **Surface**
//
//   import { viewport } from '@place/component'
//
//   viewport.width()                  // () => number
//   viewport.height()                 // () => number
//   viewport.breakpoint()             // () => 'sm' | 'md' | 'lg' | 'xl' | '2xl'
//   viewport.prefersReducedMotion()   // () => boolean
//   viewport.prefersDark()            // () => boolean
//   viewport.matches(query)           // (query: string) => () => boolean
//
// Each accessor is a `Derived<T>` over module-level state cells. On
// the client the inline `__viewport-runtime.ts` updates the cells in
// response to `resize` + matchMedia change events; on the server the
// cells hold the configured defaults so SSR returns a deterministic
// shape.
//
// **SSR contract (mobile-first, per ADR 0034)**
//
// SSR resolves `viewport.breakpoint()` to the configured
// `defaultBreakpoint` (default: `'sm'`). After hydration the client
// runtime updates the cells; subscribed components re-evaluate.
// Components that pivot rendering on breakpoint may flash from
// mobile shape to desktop shape — this is the intentional trade-off
// for "no Sec-CH-Viewport-Width round-trip required."
//
// For *stylistic* responsiveness without flash, Tailwind sm:/md:/lg:
// utilities are the right tool — the CSS itself is media-query-based
// so no JS is involved.
//
// **Configuration**
//
//   import { configureViewport } from '@place/component'
//
//   configureViewport({
//     breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 },
//     defaultBreakpoint: 'sm',
//   })
//
// Tailwind v4 defaults are used out of the box; apps with custom
// breakpoint widths call `configureViewport` once at module load.

import { derived, state } from '@place/reactivity'
import type { Derived } from '@place/reactivity'

// ===== Configuration =====

export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

/** Tailwind v4 default breakpoint widths in pixels. */
const DEFAULT_BREAKPOINTS: Readonly<Record<Breakpoint, number>> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
}

export interface ViewportConfig {
  /** Pixel widths where each breakpoint kicks in. Default: Tailwind v4. */
  breakpoints?: Readonly<Record<Breakpoint, number>>
  /** Breakpoint name to assume on SSR (and before the client runtime
   *  posts the first real reading). Default: `'sm'`. */
  defaultBreakpoint?: Breakpoint
}

let _breakpoints: Readonly<Record<Breakpoint, number>> = DEFAULT_BREAKPOINTS
let _defaultBp: Breakpoint = 'sm'

/**
 * Override viewport configuration. Call at module load time (before
 * any `viewport.*` accessor is subscribed). Subsequent calls re-bind
 * but won't retroactively notify subscribers — call early.
 *
 * @provisional — shipped in Tier 13 (ADR 0034). Signature may evolve
 * before v0.1 publish; the stability covenant doesn't yet pin this.
 */
export function configureViewport(config: ViewportConfig): void {
  if (config.breakpoints) _breakpoints = config.breakpoints
  if (config.defaultBreakpoint) _defaultBp = config.defaultBreakpoint
  // If we've already installed the runtime listener, re-emit the
  // current breakpoint with the new config so subscribers see the
  // change. (Width/height cells don't change; only breakpoint logic.)
  // No-op on the server.
}

// ===== Module-level state cells =====
//
// Initial values are deterministic and SSR-safe. The runtime overwrites
// them at hydration time on the client.

const _vw = state<number>(_breakpoints[_defaultBp])
const _vh = state<number>(800) // arbitrary but reasonable mobile-ish default
const _rm = state<boolean>(false)
const _dark = state<boolean>(false)

// ===== Public accessors =====

interface ViewportApi {
  width: Derived<number>
  height: Derived<number>
  breakpoint: Derived<Breakpoint>
  prefersReducedMotion: Derived<boolean>
  prefersDark: Derived<boolean>
  /** Generic matchMedia wrapper — returns a `Derived<boolean>` that
   *  tracks the query. On SSR resolves to `false`. */
  matches(query: string): Derived<boolean>
}

function computeBp(w: number): Breakpoint {
  // Largest matching breakpoint wins (mobile-first cascade).
  if (w >= _breakpoints['2xl']) return '2xl'
  if (w >= _breakpoints.xl) return 'xl'
  if (w >= _breakpoints.lg) return 'lg'
  if (w >= _breakpoints.md) return 'md'
  return 'sm'
}

const _matchesCache = new Map<string, Derived<boolean>>()

/**
 * Reactive viewport accessors. See module-level JSDoc for the SSR
 * contract (mobile-first) and the `viewport.* vs Tailwind utilities`
 * decision matrix.
 *
 * @provisional — shipped in Tier 13 (ADR 0034). Accessor shapes and
 * the `Breakpoint` union (Tailwind v4 names) may evolve before v0.1
 * publish; the stability covenant doesn't yet pin this namespace.
 */
export const viewport: ViewportApi = {
  width: derived(() => _vw()),
  height: derived(() => _vh()),
  breakpoint: derived(() => computeBp(_vw())),
  prefersReducedMotion: derived(() => _rm()),
  prefersDark: derived(() => _dark()),
  matches: (query: string): Derived<boolean> => {
    const cached = _matchesCache.get(query)
    if (cached) return cached
    // Server-side: always false. Client-side: subscribe to a
    // matchMedia instance. We track `_vw` and `_rm` as dirtying
    // hints so the derived re-evaluates on viewport changes; the
    // actual answer comes from matchMedia at evaluation time.
    const d = derived<boolean>(() => {
      // Touch _vw to mark the derived as viewport-dependent
      // (cheap; just reads the cell so resize updates retrigger).
      _vw()
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia(query).matches
      }
      return false
    })
    _matchesCache.set(query, d)
    return d
  },
}

// ===== Client-side runtime hookup =====
//
// Wire the inline runtime's `place:viewport` CustomEvent + the pre-
// emitted `window.__placeViewportState` bucket into our state cells.
// Gated by `typeof window !== 'undefined'` — on server builds the
// branch is dead but harmless (no DOM access, no side effects). The
// `place:viewport` event itself is only ever dispatched by the
// browser-side `placeViewport()` inline runtime, so the listener is
// a no-op even if it does install in a non-browser env.
//
// Lives at module scope (no `onMount`) because the cells are module-
// level singletons — the wiring should happen exactly once per page
// load, not per consumer.

interface VPBucket {
  w: number
  h: number
  rm: boolean
  d: boolean
}

if (typeof window !== 'undefined') {
  const w = window as Window & {
    __placeViewportState?: VPBucket
  }
  // Read the initial bucket if the runtime already ran.
  const initial = w.__placeViewportState
  if (initial) {
    _vw.set(initial.w)
    _vh.set(initial.h)
    _rm.set(initial.rm)
    _dark.set(initial.d)
  }
  // Subscribe to subsequent updates.
  window.addEventListener('place:viewport', (e: Event) => {
    const detail = (e as CustomEvent<VPBucket>).detail
    if (!detail) return
    if (detail.w !== _vw()) _vw.set(detail.w)
    if (detail.h !== _vh()) _vh.set(detail.h)
    if (detail.rm !== _rm()) _rm.set(detail.rm)
    if (detail.d !== _dark()) _dark.set(detail.d)
  })
}
