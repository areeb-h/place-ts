// Client-mount leaf — the **only** module per-island wrappers import
// from the framework. Holds the four functions a wrapper needs:
//
//   - `_setHydrated` (re-exported from `_internal/hydration.ts`)
//   - `hydrate(view, root)` — adopt SSR'd DOM, attach reactive
//     bindings, return a disposer
//   - `mount(view, container, options?)` — create + attach a fresh
//     DOM tree, optionally wrapped in capability provisions, return
//     a disposer
//   - `withCapability` / `withCapabilities` — view-wrapper for
//     capability scope (used internally by `mount`; exported for
//     library-grade composition)
//
// **Why this file exists**: per-island wrappers used to import these
// from `./index.ts` (the framework barrel). The barrel transitively
// reaches `_serveImpl`, which holds the build-time pipeline
// (Bun.build orchestration, view classifier, TypeScript compiler).
// Bun's `splitting: true` analyzer walks every dynamic-import target
// it can statically resolve, before DCE runs — so every island bundle
// got a 1.2 MB shared chunk of TypeScript compiler code, even though
// the code is gated by `__PLACE_BROWSER__` and never executes on the
// client. The variable-indirection trick (`const p = '...'; await
// import(p)`) hid the imports from the static analyzer, but that was
// a workaround, not a structural fix.
//
// This leaf is the structural fix. The wrapper imports `_client-mount.ts`
// directly; the leaf's static import graph stops at `_internal/slot.ts`
// + `_internal/hydration.ts` (both tiny, both side-effect-free, both
// purely DOM-touching). `./index.ts` never enters the wrapper's chunk
// graph — the per-island bundles are bounded by what the wrappers
// genuinely need at hydration time.
//
// **Stay leaf-shaped**: do NOT add imports from `./index.ts` here.
// Do NOT add runtime imports from `./build/*` here. Adding either
// would re-open the leak vector this file exists to close.

import type { Capability, Provision } from '../../capability/src/index.ts'
import type { Disposer } from '../../reactivity/src/index.ts'
import { _setHydrated } from './_internal/hydration.ts'
import { makeSlot } from './_internal/slot.ts'
import type { View } from './types.ts'

export { _setHydrated }

/**
 * Wrap `child` in one capability provision. The capability installs
 * on mount + uninstalls on dispose; if `child.mount` throws the
 * uninstall runs before the throw propagates. This is the building
 * block `withCapabilities` composes for multi-cap views.
 *
 * Used by `mount({ provide: [...] })` and by user code that wants a
 * View that scopes a single cap (e.g. swapping a router impl for a
 * test render).
 */
export function withCapability<T>(
  capability: Capability<T>,
  impl: T,
  child: View,
): View {
  return {
    mount(parent, anchor) {
      const uninstall = capability.install(impl)
      let innerDispose: Disposer
      try {
        innerDispose = child.mount(parent, anchor)
      } catch (e) {
        uninstall()
        throw e
      }
      return () => {
        innerDispose()
        uninstall()
      }
    },
  }
}

/**
 * Wrap `view` in a chain of capability provisions. The FIRST entry
 * in `provisions` is the OUTERMOST wrapper (matches reading order:
 * `[Router, Theme, Session]` reads top-down as "router-outermost
 * then theme then session-innermost").
 */
export function withCapabilities(
  provisions: readonly Provision[],
  view: View,
): View {
  // Wrap from innermost (last in array) to outermost (first) so the
  // FIRST listed capability is the outermost in the install order —
  // matches the natural reading order.
  let result = view
  for (let i = provisions.length - 1; i >= 0; i--) {
    const p = provisions[i]
    if (p === undefined) continue
    result = withCapability(p.capability, p.impl, result)
  }
  return result
}

/**
 * Top-level entry point that mounts a `View` into a DOM container.
 * Returns a disposer that tears down the mount.
 *
 *   mount(view, document.getElementById('app')!)
 *   mount(view, '#app')
 *   mount(<App />, '#app', { provide: [provide(RouterCap, router)] })
 *
 * Pass `provide: [...]` to install capabilities scoped to this mount
 * — this replaces an explicit `withCapabilities([...], view)` wrap.
 * Same semantics, fewer levels of nesting at the entry point.
 */
export function mount(
  view: View,
  container: Element | string,
  options?: { provide?: readonly Provision[] },
): Disposer {
  const target =
    typeof container === 'string'
      ? document.querySelector(container)
      : container
  if (target === null) {
    throw new Error(
      typeof container === 'string'
        ? `mount: no element matches selector '${container}'`
        : 'mount: container is null',
    )
  }
  const provisions = options?.provide
  const wrapped =
    provisions && provisions.length > 0
      ? withCapabilities(provisions, view)
      : view
  return wrapped.mount(target, null)
}

/**
 * Adopt server-rendered DOM rooted at `root` and attach the view's
 * reactive bindings. Returns a disposer that detaches them.
 *
 * `view.hydrate` must be implemented — the framework's built-in
 * factories (`el` / `Fragment` / `component`) all implement it. Custom
 * Views need to as well; without it, hydration is undefined.
 *
 * Mismatch errors (wrong tag, missing element) throw with a diagnostic
 * pointing at the most likely cause: forgotten reactive binding, list
 * key drift, or HTML mutation between SSR and hydrate.
 */
export function hydrate(view: View, root: Element): Disposer {
  if (!view.hydrate) {
    throw new Error(
      'hydrate: this view does not implement `hydrate`. Built-in factories ' +
        '(el / Fragment / component) all do; custom Views must implement it.',
    )
  }
  const slot = makeSlot(root)
  return view.hydrate(slot)
}
