// @place/component — the component system: HOC + error boundary +
// keyed lists + capability wrappers + ISR.
//
// Extracted from index.ts (Tier 20 decomposition, cut 8) — the
// component-composition layer that sits on top of the element / mount
// / SSR primitives:
//   - component()    — the HOC that wraps a (props) => View author fn
//   - errorBoundary() — catches throws from a wrapped subtree
//   - For            — JSX-idiomatic keyed list
//   - keyed          — re-exported from ./keyed.ts
//   - withCapability  — installs a capability for a view's lifetime
//   - revalidate      — the ISR cache-invalidation trigger
//   - clientOnly      — marks a component browser-only
//
// `index.ts` re-exports the public surface. This module touches
// `index.ts`-resident symbols only inside runtime functions, so the
// component ⇄ index cycle stays benign — same shape as element.ts /
// mount.ts / ssr.ts / page.ts.

import { ClientOnlyAbort } from '@place/capability'
import { type Disposer, type State, state, untrack, watch } from '@place/reactivity'
import { disposeAll, withCleanups } from './_internal/cleanup.ts'
import { nextHydrationId } from './_internal/hydrationSeq.ts'
import { _invalidateCachesByTag, type CacheStore } from './cache.ts'
import { el } from './element.ts'
// ===== keyed — keyed list reconciliation =====
// Extracted to `./keyed.ts` (Tier 1-A continuation, 2026-05-14). Re-
// exported from this barrel so existing public API + per-system gating
// keeps working. The local import lets other code in this barrel
// (e.g. `boot()`'s reactive list rendering) reference `keyed` directly.
// See the extracted module for the implementation + design notes.
import { keyed } from './keyed.ts'
import { ClientOnly } from './mount.ts'
import type { Child, View } from './types.ts'

export { keyed }

// ===== Component HOC =====
//
// Wraps a component function so that its body runs inside a cleanup scope at
// *mount time*, not at construction time. This is what makes `onCleanup`
// work for hand-authored callers:
//
//   const Counter = component(() => {
//     onCleanup(() => clearInterval(id))
//     return div({}, [() => count.read()])
//   })
//
//   mount(Counter(), root)
//
// JSX consumers do not need to call `component()` explicitly — the JSX
// runtime auto-wraps every component invocation. See jsx-runtime.ts.

// ===== errorBoundary — catch throws from the wrapped subtree =====
//
// Errors that escape (a) component HOC bodies, (b) reactive children's
// watches, (c) keyed render functions are routed through an internal
// capability to the nearest enclosing `errorBoundary`. The boundary
// renders `fallback(error, retry)` instead of the failing subtree.
// `retry()` clears the captured error and re-mounts `children`.
//
// If no boundary is installed in the ancestor chain, throws propagate
// up to the page (preserving the existing behavior — failures surface
// loudly rather than getting silently swallowed).
//
// What this catches:
//   - Throws inside a component's body (`fn(props)`)
//   - Throws when a component's view tries to mount
//   - Throws inside a reactive child's getter
//   - Throws inside a keyed render callback (via the same component HOC)
//
// What this does NOT catch:
//   - Async errors (Promises rejecting after the synchronous body returns).
//     `resource(loader)` already exposes errors via its `error()` /
//     `status({ state: 'error' })` channel — that's the right shape for
//     async errors; an exception thrown across an `await` boundary is
//     out of scope until reactive scopes propagate (Phase 5).
//   - Throws inside event handlers (onClick, etc.). The browser's
//     event-loop runs those outside any reactive context. If you want
//     a handler-throw to flow into a boundary, wrap manually:
//     `onClick={() => { try { ... } catch (e) { throw e } }}` — though
//     since handlers run after mount, you'd typically want to surface
//     the error via state instead.

// ===== <For each key> — JSX-idiomatic keyed list =====
//
// Thin wrapper over `keyed()`. Accepts either a getter `() => T[]`, a
// `State<T[]>` (callable), or a plain array. Renders each item via the
// children render-prop. Falls through to `fallback` (optional) when the
// list is empty.
//
//   <For each={items} key={(i) => i.id} fallback={<Empty />}>
//     {(item, index) => <Row label={item.label} />}
//   </For>

export interface ForProps<T> {
  each: (() => readonly T[]) | readonly T[] | State<readonly T[]>
  key: (item: T, index: number) => string | number
  children: (item: T, index: number) => View
  fallback?: View
}

export function For<T>(props: ForProps<T>): View {
  const getList: () => readonly T[] =
    typeof props.each === 'function'
      ? (props.each as () => readonly T[])
      : () => props.each as readonly T[]
  // If there's a fallback, render it when the list is empty; otherwise
  // delegate to keyed(). The fallback case wraps in a reactive child so
  // it switches on length changes.
  if (props.fallback === undefined) {
    return keyed(getList, props.key, props.children)
  }
  return el('span', { 'data-place-contents': '' }, (): Child => {
    const list = getList()
    if (list.length === 0) return props.fallback as Child
    return keyed(getList, props.key, props.children) as Child
  })
}

// `ErrorBoundaryCap` — extracted to `./_internal/error-boundary-cap.ts`
// (cut 7b), a leaf the render modules import without a barrel cycle.
// `errorBoundary()` (below) installs under it; re-exported for public
// + test consumers.
import { ErrorBoundaryCap } from './_internal/error-boundary-cap.ts'

export { ErrorBoundaryCap }

export interface ErrorBoundaryProps {
  /** What to render in place of `children` when a throw is caught. */
  fallback: (error: unknown, retry: () => void) => View
  /**
   * The protected subtree. On `retry`, re-mounted from the same View —
   * if you need fresh local state on retry, wrap with a thunk yourself
   * by re-creating the JSX inside the parent.
   */
  children: View
}

export function errorBoundary(props: ErrorBoundaryProps): View {
  return {
    // SSR: render children's HTML; if rendering throws, render fallback's
    // HTML instead. The retry function is a no-op on the server (there's
    // nothing to re-mount). Same shape as `mount` semantically — boundary
    // catches throws from the wrapped subtree.
    toHtml: () => {
      try {
        return props.children.toHtml ? props.children.toHtml() : ''
      } catch (e) {
        const view = props.fallback(e, () => {})
        return view.toHtml ? view.toHtml() : ''
      }
    },
    // Hydration: try children's hydrate; if it throws, try fallback's
    // hydrate instead. The DOM came from the SSR path which already
    // resolved which branch (children vs fallback) is rendered, so on
    // the client we mirror by trying children first and falling back
    // on throw — same divergence point as mount.
    hydrate(slot) {
      try {
        return props.children.hydrate ? props.children.hydrate(slot) : () => {}
      } catch (e) {
        const view = props.fallback(e, () => {})
        return view.hydrate ? view.hydrate(slot) : () => {}
      }
    },
    mount(parent, anchor) {
      const slot = document.createComment('error-boundary')
      parent.insertBefore(slot, anchor ?? null)

      // Reactive state holding the captured error. `null` is the "no
      // error" sentinel — anything else (including `undefined`) is
      // treated as a captured error. The watch below re-runs on
      // transitions, swapping between mounting `children` and
      // mounting `fallback(error, retry)`.
      //
      // The watch + state shape works because of reactivity's
      // `needsRerun` guarantee: a write to `errorState` from inside a
      // children-mount that's running under this watch (because the
      // watch IS the one mounting them) is correctly re-queued after
      // the current run finishes, instead of being silently dropped
      // by the COMPUTING short-circuit.
      const errorState = state<unknown>(null)
      const handleError = (e: unknown): void => errorState.write(e)
      const retry = (): void => errorState.write(null)

      // Install the boundary cap BEFORE the watch starts so any throw
      // during the initial mount is caught.
      const stopCap = ErrorBoundaryCap.install(handleError)

      let currentDispose: Disposer = () => {}
      const watchStop = watch(() => {
        currentDispose()
        const e = errorState.read()
        const view = e === null ? props.children : props.fallback(e, retry)
        currentDispose = untrack(() => view.mount(parent, slot))
      })

      return () => {
        watchStop()
        currentDispose()
        slot.remove()
        stopCap()
      }
    },
  }
}

// ===== withCapability — install a capability for the wrapped view's lifetime =====
//
// `cap.provide(impl, body)` is synchronous — it pushes, runs body, pops.
// That's not enough for component-system mounting because:
//
//   1. Component HOC bodies run at mount time (deferred from JSX-creation).
//   2. Watches (e.g. inside `keyed`) fire LATER — after the initial mount
//      tree has settled — and may instantiate new component bodies.
//      For example: clicking "+ new" writes to state, which fires the
//      keyed watch, which mounts a new row. That row's component body
//      calls `cap.use()` and would throw if the cap had been popped.
//
// `cap.install(impl)` keeps the impl on the capability stack until the
// returned disposer is called. We hold the disposer across the wrapped
// view's lifetime — installed at mount, uninstalled after innerDispose.
//
// This means new component bodies created at any time during the wrapped
// view's life (keyed-mounted rows, swapped reactive children, etc.) see
// the capability via `cap.use()`.

// `provide(cap, impl)` + `withCapabilities([…], view)` — the multi-cap
// form. The single-cap `withCapability(cap, impl, child)` stays for
// the simple case; the list form is what apps reach for once they're
// installing 3+ capabilities (router + store + auth + csrf etc.).
//
// ===== ISR — `revalidate(path | tag)` global trigger =====
//
// Apps call `revalidate('/posts/42')` from a server action after a
// mutation, or `revalidate.tag('posts')` to invalidate every page tagged
// with 'posts'. Multiple `serve()` instances in one process share a
// global registry; each instance's cache is invalidated. (In practice
// you have one `serve()` per process — but the registry shape supports
// the rare embedded case.)

export const _registeredCaches = new Set<CacheStore>()

interface RevalidateFn {
  /** Invalidate cache entries by full URL path (with optional search). */
  (...keys: string[]): Promise<void>
  /** Invalidate every entry tagged with one of the listed tags. */
  tag(...tags: string[]): Promise<void>
}

export const revalidate: RevalidateFn = Object.assign(
  async (...keys: string[]): Promise<void> => {
    if (keys.length === 0) return
    await Promise.all(Array.from(_registeredCaches, (store) => store.delete({ keys })))
  },
  {
    async tag(...tags: string[]): Promise<void> {
      if (tags.length === 0) return
      // Clear ISR-style page-cache stores first, then any in-process
      // `cache(fn)` memoizers that share the same tags.
      await Promise.all(Array.from(_registeredCaches, (store) => store.delete({ tags })))
      _invalidateCachesByTag(tags)
    },
  },
)

// `withCapability` + `withCapabilities` live in `./_client-mount.ts`
// (re-exported via the block above next to `mount` / `hydrate`).

/**
 * Auto-`<ClientOnly>` marker. When a component's `toHtml` catches
 * `ClientOnlyAbort`, it emits a span with this marker so the client's
 * `hydrate` knows to route mounting through the `ClientOnly` machinery
 * (waiting for the hydrate flag to flip) rather than trying to adopt
 * the placeholder structure directly.
 */
const PLACE_AUTO_ATTR = 'data-place-auto'

/**
 * Options for `component()`.
 */
export interface ComponentOptions {
  /**
   * Skip server-side rendering entirely for this component. SSR emits a
   * placeholder span; the body runs on the client after hydration. Use
   * for components whose initial render genuinely cannot match between
   * server and client — e.g. ones that read `localStorage`, branch on
   * `prefers-color-scheme`, or use other browser-only state that isn't
   * available at SSR time.
   *
   * The framework already auto-detects this when a component touches a
   * `clientOnly: true` capability during its body — the cap's `.use()`
   * throws `ClientOnlyAbort`, which the factory catches. This flag is
   * the opt-in for components that DON'T touch such a cap but still
   * want the same behavior.
   *
   * Equivalent to wrapping every call site in `<ClientOnly>`, but
   * declared once at the component definition.
   */
  clientOnly?: boolean
}

const emitAutoPlaceholder = (): string => {
  const id = nextHydrationId()
  return `<span data-h="${id}" data-place-client-only="" ${PLACE_AUTO_ATTR}="" data-place-contents=""></span>`
}

// Browser globals that are undefined on the server. When a component body
// references one of these during SSR without a `typeof` guard, the
// runtime throws `ReferenceError: <name> is not defined`. The framework
// catches that specific shape and converts it to a `ClientOnlyAbort` —
// the same path the explicit `clientOnly(fn)` HOF takes. Net effect:
// components that read browser-only APIs need ZERO opt-in; SSR emits a
// placeholder and the body mounts on hydration.
//
// We only catch `ReferenceError` matching this exact pattern. Any other
// throw (TypeError, custom Error, framework error) propagates normally.
// Stability: the boundary is narrow enough to avoid masking real bugs.
const BROWSER_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'location',
  'history',
  'self',
])

export function isBrowserGlobalRef(e: unknown): boolean {
  if (!(e instanceof ReferenceError)) return false
  const match = /^([A-Za-z_$][\w$]*) is not defined/.exec(e.message)
  if (!match) return false
  return BROWSER_GLOBALS.has(match[1] as string)
}

/**
 * Mark a component as client-only at the definition site. Equivalent to
 * `component(fn, { clientOnly: true })` — shorter to read at call sites
 * and pairs with `deferred()` as the canonical opt-in trio.
 *
 * Use this when a component's body reads browser-only APIs (localStorage,
 * matchMedia, navigator) and can't be evaluated on the server. SSR emits
 * an empty placeholder; the body mounts on hydration.
 *
 *   const Toggle = clientOnly((props: P) => {
 *     const choice = state(readLocalStorage())
 *     return <button onClick={...}>{...}</button>
 *   })
 *
 * For components that touch a `clientOnly: true` capability, no opt-in
 * is needed — the framework auto-detects via `ClientOnlyAbort`. This
 * HOF is for the cases auto-detect can't catch.
 */
export function clientOnly<P>(fn: (props: P) => View): (props: P) => View {
  return component(fn, { clientOnly: true })
}

export function component<P>(
  fn: (props: P) => View,
  options?: ComponentOptions,
): (props: P) => View {
  const clientOnlyMode = options?.clientOnly === true
  return (props: P): View => ({
    // SSR path — run the body to get the inner View, then delegate. We
    // discard cleanups (no DOM was created, no event listeners or
    // watches to live past this call). If the body throws
    // `ClientOnlyAbort`, or if `clientOnly: true` is set at the
    // definition site, the framework substitutes an auto-placeholder
    // span instead — the client mounts the real body after hydrate.
    // This makes per-page `clientOnly: true` flags unnecessary: the
    // signaling is structural, originating at the cap's `use()` call
    // OR the explicit definition-site opt-in.
    toHtml: () => {
      if (clientOnlyMode) return emitAutoPlaceholder()
      try {
        const inner = withCleanups([], () => untrack(() => fn(props)))
        return inner.toHtml ? inner.toHtml() : ''
      } catch (e) {
        // Three paths to the placeholder:
        //   1. Explicit `ClientOnlyAbort` from a clientOnly cap.
        //   2. Definition-site `clientOnly: true` (handled above).
        //   3. The body referenced a browser global (window, localStorage,
        //      etc.) without a guard. Auto-detect: emit a placeholder and
        //      mount the body on hydration where the globals exist.
        if (e instanceof ClientOnlyAbort || isBrowserGlobalRef(e)) {
          return emitAutoPlaceholder()
        }
        throw e
      }
    },
    // Hydration mirrors mount: run the body to get the inner View, hand
    // the slot to its hydrate. If the SSR emitted the auto-placeholder
    // span (toHtml caught ClientOnlyAbort), route hydration through the
    // `ClientOnly` primitive — it adopts the empty span and mounts the
    // real body after `_setHydrated(true)` flips. Otherwise: normal
    // path. Cleanups from the body (onCleanup registrations, e.g.
    // globalKey shortcuts) live for the hydrated subtree's lifetime.
    hydrate(slot) {
      // Definition-site `clientOnly: true` — same outcome as the auto
      // path. SSR emitted the placeholder; here we route through
      // ClientOnly without even peeking.
      if (clientOnlyMode) {
        return ClientOnly({ children: () => fn(props) }).hydrate?.(slot) ?? (() => {})
      }
      // Peek at the SSR'd next element first. If it's our auto
      // placeholder, defer to ClientOnly's hydrate (which knows how to
      // adopt the empty span + mount the body reactively on flag flip).
      const peek = slot.peekElement()
      if (peek?.hasAttribute(PLACE_AUTO_ATTR)) {
        return ClientOnly({ children: () => fn(props) }).hydrate?.(slot) ?? (() => {})
      }
      const cleanups: Disposer[] = []
      try {
        const inner = withCleanups(cleanups, () => untrack(() => fn(props)))
        if (!inner.hydrate) {
          throw new Error(
            'hydrate: component returned a view without a hydrate method (custom Views must implement hydrate)',
          )
        }
        const dispose = untrack(() => inner.hydrate?.(slot) ?? (() => {}))
        return () => {
          dispose()
          disposeAll(cleanups)
        }
      } catch (e) {
        disposeAll(cleanups)
        if (e instanceof ClientOnlyAbort) {
          // Client-side a clientOnly cap should be installed; if it
          // isn't, that's a config bug — but still defer to ClientOnly
          // so the user sees the placeholder instead of a crash.
          return ClientOnly({ children: () => fn(props) }).hydrate?.(slot) ?? (() => {})
        }
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
        return () => {}
      }
    },
    mount(parent, anchor) {
      // Definition-site `clientOnly: true`: on a pure client mount
      // (no SSR'd shell to hydrate) we still want to defer until the
      // hydrate flag flips, in case the consumer is mid-bootstrap. The
      // typical case for `mount` (not `hydrate`) is a CSR-only app, in
      // which `_setHydrated(true)` was already called by `boot()` — so
      // ClientOnly's reactive child fires immediately.
      if (clientOnlyMode) {
        return ClientOnly({ children: () => fn(props) }).mount(parent, anchor)
      }
      const cleanups: Disposer[] = []
      // Untrack the body so that any state reads inside (initial setup,
      // computed defaults, derived helpers) do not subscribe an enclosing
      // watch. Reactive bindings INSIDE the body still create their own
      // independent watches via applyProp / mountReactiveChild, which track
      // correctly per-leaf.
      try {
        const inner = withCleanups(cleanups, () => untrack(() => fn(props)))
        const dispose = untrack(() => inner.mount(parent, anchor))
        return () => {
          dispose()
          disposeAll(cleanups)
        }
      } catch (e) {
        // Run any cleanups registered before the throw, then bubble.
        disposeAll(cleanups)
        if (e instanceof ClientOnlyAbort) {
          // Same auto-fallback as hydrate: a ClientOnly wrapper that
          // defers the body until the hydrate flag is true. On the
          // client this normally doesn't fire (caps are installed
          // before mount), but the guard keeps the failure mode graceful.
          return ClientOnly({ children: () => fn(props) }).mount(parent, anchor)
        }
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
        return () => {}
      }
    },
  })
}
