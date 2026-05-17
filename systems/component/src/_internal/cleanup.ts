// Cleanup registry — the module-level singleton that `onCleanup(fn)`
// pushes to, and that `withCleanups(arr, body)` swaps in/out around a
// mount/hydrate. Extracted from `index.ts` so multiple call sites
// (element mounts, component HOC, error boundary, withCapability,
// each ssr/* module) can share the registry without depending on the
// barrel.
//
// `onMount` is NOT here — it depends on `_isHydratedState` + `watch`
// which create a cycle if cleanup imports them. `onMount` lives at the
// top-level alongside the reactivity primitives it composes.
//
// LIFO disposal order (`disposeAll`) matches the intuition that a
// component's late setup tears down before its early setup. Internal
// helpers stay non-exported; `onCleanup` is the only public surface.

import type { Disposer } from '../../../reactivity/src/index.ts'

let currentCleanups: Disposer[] | null = null

/**
 * Register `fn` to run when the enclosing view is disposed. Pushes
 * onto the disposer stack of whichever mount/hydrate is currently in
 * progress (see `withCleanups`). Outside a mount context this is a
 * silent no-op — the framework chooses leniency over a hard throw so
 * user code can be lifted in/out of components without crashing.
 */
export function onCleanup(fn: () => void): void {
  if (currentCleanups === null) return
  currentCleanups.push(fn)
}

/**
 * Internal — run `fn` with `cleanups` installed as the current
 * disposer stack. Restores the previous stack on exit. Used by every
 * lifecycle path that needs to collect disposers (element mount,
 * component HOC, error boundary, fragment hydrate, …).
 */
export function withCleanups<T>(cleanups: Disposer[], fn: () => T): T {
  const prev = currentCleanups
  currentCleanups = cleanups
  try {
    return fn()
  } finally {
    currentCleanups = prev
  }
}

/**
 * Internal — run disposers in reverse-registration order (LIFO). A
 * component's late setup should tear down before its early setup
 * runs: latest registration is first disposal. Used internally by
 * every mount/hydrate dispose path.
 */
export function disposeAll(disposers: Disposer[]): void {
  for (let i = disposers.length - 1; i >= 0; i--) disposers[i]?.()
}
