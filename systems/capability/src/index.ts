// @place/capability — scoped capability handlers
//
// A `Capability<T>` is a typed slot. `provide(impl, body)` installs an
// implementation for the duration of body; `install(impl)` installs until
// the returned disposer is called; `use()` retrieves the current
// implementation. Outside any installation, `use()` throws.
//
// This replaces React-style implicit context globals (per
// docs/platform/07-prior-art-failures.md §"Implicit globals for component
// context"). Two installation modes:
//
//   - **provide(impl, body)** — synchronous, lexically scoped. The impl is
//     installed for body's execution and popped on return.
//   - **install(impl)** — long-lived. The impl stays until the returned
//     disposer fires. This is what `@place/component`'s `withCapability`
//     uses, because component bodies and watch callbacks fire AFTER their
//     surrounding mount call has returned.
//
// The runtime enforcement here is the half that doesn't need a compiler.
// Type-level effect tracking (Phase 4) is a separate ADR.
//
// What's deferred:
//   - Type-level effect tracking (Phase 4)
//   - Reactive integration with @place/reactivity scopes (Phase 5)
//
// Phase 4.1 (v0.3) — async-safe per-request capability scopes:
//
//   `runWithCapabilityScope(fn)` enters an AsyncLocalStorage scope so
//   each concurrent request sees its own copy of the cap stacks. Inside
//   the scope, `provide()`/`install()` modify a per-scope Map (lazily
//   snapshotted from the closure baseline on first cap access).
//   Disposers are token-keyed and search both the closure stack and the
//   currently-visible ALS stack, so out-of-scope dispose calls are
//   no-ops if the scope already unwound.
//
//   On platforms without AsyncLocalStorage (browsers; very old Node),
//   `runWithCapabilityScope` is a transparent passthrough — caps fall
//   through to the closure stack as before. The capability module never
//   pulls in `node:async_hooks` statically; detection is via
//   `globalThis.AsyncLocalStorage` (Bun and Node ≥18 expose it there).

export interface Capability<T> {
  /** The capability's name — used in error messages. */
  readonly name: string

  /**
   * When `true`, this capability is intended to be installed only in
   * the browser runtime (e.g. a router that drives `window.history`, a
   * note store backed by `localStorage`). Touching it during SSR
   * produces a tailored error pointing at the page-level fix
   * (`page({ clientOnly: true, ... })`) instead of the generic
   * "not provided" message.
   *
   * Set via the second arg to `defineCapability(name, { clientOnly: true })`.
   */
  readonly clientOnly: boolean

  /**
   * Install `impl` as the current implementation for the duration of
   * `body`. Returns whatever `body` returned.
   *
   * Nests cleanly: inner `provide` shadows the outer until inner returns.
   *
   * **Synchronous only** — `provide` does not survive across deferred
   * component bodies, watch callbacks, async boundaries, or event handlers.
   * For long-lived installation, use `install(impl)`.
   */
  provide<R>(impl: T, body: () => R): R

  /**
   * Install `impl` until the returned disposer is called. Use this when a
   * capability needs to remain available across asynchronous boundaries,
   * including:
   *   - deferred component bodies (component HOC mounts)
   *   - watch callbacks that fire after the wrapping mount has returned
   *   - keyed-list reconciliation that mounts new rows later
   *
   * Each call is tracked by a unique token, so calling the disposer
   * removes that specific installation regardless of stack order.
   * Disposing twice is a no-op.
   */
  install(impl: T): () => void

  /**
   * Retrieve the current implementation. Throws if not installed.
   *
   * Overload: pass a `fallback` value to return it instead of throwing
   * when the capability isn't provisioned. This is the canonical form
   * for optional capabilities — replaces the older `tryUse()` pattern.
   *
   *   const router = Router.use()              // throws if missing
   *   const router = Router.use(null)          // returns null if missing
   *   const cache = Cache.use(defaultCache)    // returns default if missing
   */
  use(): T
  use<F>(fallback: F): T | F

  /**
   * Retrieve the current implementation, returning null if not installed.
   * The readable form of `use(null)`; both are equivalent and supported.
   */
  tryUse(): T | null
}

// ===== Phase 4 v0.1 — typed effects (manual annotation form) =====
//
// See docs/01-phase4-typed-effects.md for the full design rationale.
// In short: TypeScript can't enforce lexical capability scoping without
// compiler help, so v0.1 ships *manual annotation* — a `requires` helper
// that brands a function with its required capabilities at the type
// level AND validates them at call time.
//
// This is small on purpose. The runtime check catches misconfigured
// deployments + tests with missing fakes (the practical pain). The type
// brand is documentation today; a future build step (Phase 6+) reads it
// for compile-time scope enforcement.

/**
 * Effect kinds — placeholder type aliases that ship now so future work
 * has a stable vocabulary. None of these are enforced at the type level
 * yet; they exist so that `Effect<IO, T>`, `Effect<Mutate, T>`, etc.
 * compose without requiring later renames.
 */
export type IO = { readonly __io?: never }
export type Mutate = { readonly __mutate?: never }
export type Async = { readonly __async?: never }
export type Throws<E> = { readonly __throws?: E }
// Read<scope> from a capability scope — Phase 5+ when scopes carry
// across async boundaries.
export type Read<S> = { readonly __read?: S }

/**
 * A value of type `T` with a phantom-type tag declaring effects `E`.
 * Used as a return-type convention for functions that produce
 * effectful values. The tag is structural (TS allows assignment as
 * long as `E` is present) and erased at runtime.
 */
export type Effect<E, T> = T & { readonly __effects?: E }

/**
 * Function brand: this function requires the listed capabilities to be
 * installed when it is called. Read by `requires(...)` and (in a future
 * build step) by compile-time scope enforcement.
 */
export interface Requires<C extends readonly Capability<unknown>[]> {
  readonly __requires?: C
}

/**
 * Wrap `fn` with a runtime capability check + a type-level requirement
 * brand. Calling the wrapped function validates that every cap in
 * `caps` has been installed (via `provide` or `install` / `withCapability`)
 * BEFORE the body runs — throws a clear error naming the missing cap if
 * not. The wrapped function's type carries `Requires<typeof caps>`.
 *
 * ```ts
 * const fetchUser = requires(Logger, NetworkCap)((id: string) => {
 *   Logger.use().log('fetching')
 *   return NetworkCap.use().fetch(`/users/${id}`)
 * })
 * ```
 *
 * Curried form so the cap list reads first: `requires(A, B)(fn)`. See
 * docs/01-phase4-typed-effects.md for the design rationale and what's
 * deferred to later phases.
 */
export function requires<C extends readonly Capability<unknown>[]>(
  ...caps: C
): <F extends (...args: never[]) => unknown>(fn: F) => F & Requires<C> {
  return <F extends (...args: never[]) => unknown>(fn: F): F & Requires<C> => {
    const checked = ((...args: Parameters<F>): ReturnType<F> => {
      for (const cap of caps) {
        if (cap.tryUse() === null) {
          throw new Error(
            `capability '${cap.name}' required but not installed at call site. ` +
              `Wrap your code in withCapability(${cap.name}, impl, view) ` +
              `or call ${cap.name}.install(impl) (keeping the disposer alive) ` +
              `before invoking this function.`,
          )
        }
      }
      return fn(...args) as ReturnType<F>
    }) as F
    return checked as F & Requires<C>
  }
}

/**
 * A bound `(capability, impl)` pair, ready to be installed for a subtree
 * via `withCapabilities([...], view)` or `mount(view, container, { provide: [...] })`.
 *
 * Use `provide(cap, impl)` to construct one. Library-built handles
 * (e.g. `hashRouter()`) may *also* satisfy this shape directly so they
 * can be passed without an explicit wrapper:
 *
 *   const router = hashRouter()
 *   mount(view, '#app', { provide: [router] })
 */
export interface Provision {
  readonly capability: Capability<unknown>
  readonly impl: unknown
}

/**
 * Bind a capability to its implementation, returning an opaque `Provision`
 * for use in `withCapabilities` / `mount(..., { provide: […] })`.
 *
 * Why not raw `[Capability<T>, T]` tuples: heterogeneous tuples can't
 * sit in a single typed array without losing `T` at the array level.
 * `provide()` is the single point where the cap+impl types are
 * checked per-pair; the resulting `Provision` is opaque so consumers
 * can pass whatever sequence they want.
 */
export function provide<T>(capability: Capability<T>, impl: T): Provision {
  return { capability: capability as Capability<unknown>, impl }
}

// ===== AsyncLocalStorage detection =====
//
// Three runtimes, three detection paths:
//   - Bun: `AsyncLocalStorage` is on `globalThis` via the node-compat
//     layer. Sync detection at module load.
//   - Node: only available via `import('node:async_hooks')`. Lazy +
//     async — the first call to `runWithCapabilityScope` waits on it.
//   - Browser: neither path resolves. Stays null; the function becomes
//     a transparent pass-through, which is correct for single-threaded
//     JS environments.
//
// The ALS stores a Map keyed by per-cap symbols (each `defineCapability`
// gets its own symbol) → that cap's per-scope stack. Snapshotting from
// the closure stack happens lazily on first access in a given scope —
// so module-level `cap.install()` baselines remain visible to requests
// without leaking request-scoped installs across concurrent requests.

type Entry<T> = { token: object; impl: T }
type ScopeMap = Map<symbol, Entry<unknown>[]>

interface ALSLike<T> {
  getStore(): T | undefined
  run<R>(store: T, fn: () => R): R
}

let als: ALSLike<ScopeMap> | null = null

// Sync probe: Bun exposes AsyncLocalStorage globally. Node doesn't —
// we'll fall through to the top-level await below.
{
  const ALS = (globalThis as { AsyncLocalStorage?: new () => ALSLike<ScopeMap> }).AsyncLocalStorage
  if (typeof ALS === 'function') {
    try {
      als = new ALS()
    } catch {
      // Constructor stub — leave als null and fall through.
    }
  }
}

// Top-level await: Node-only path. Loads `node:async_hooks` once at
// module init so every importer (including cache(fn)) sees `als` set
// before any of their code runs. Without this, the first
// `runWithCapabilityScope` call would have to do an async hop, which
// breaks synchronous-fn-invocation contracts in consumers (the
// inflight-dedupe in cache(fn) relies on fn being called synchronously
// when the wrapped function is invoked — see cache.ts).
//
// Gated on the `__PLACE_BROWSER__` build-time define. On browser
// builds Bun.build constant-folds `__PLACE_BROWSER__` to `true`, so
// the entire branch (including the `import('node:async_hooks')`
// expression) is DCE'd. On the server runtime the define is absent
// (`typeof` returns `'undefined'`), so the import runs. Without this
// guard, browser bundles statically retain the `node:async_hooks`
// specifier — strict CSP (`script-src 'self'`) then blocks the
// dynamic-import network request even though the branch never
// executes, because the URL still appears as a fetched module.
declare const __PLACE_BROWSER__: boolean | undefined
if (typeof __PLACE_BROWSER__ === 'undefined' || __PLACE_BROWSER__ === false) {
  if (als === null) {
    try {
      const mod = (await import('node:async_hooks')) as {
        AsyncLocalStorage: new () => ALSLike<ScopeMap>
      }
      als = new mod.AsyncLocalStorage()
    } catch {
      // Browser / stripped runtime — als stays null.
    }
  }
}

/**
 * Run `fn` inside a per-request AsyncLocalStorage scope. Capabilities
 * installed via `provide()` or `install()` from inside `fn` are
 * isolated from any other concurrent invocation of `runWithCapabilityScope`.
 *
 * Module-level `cap.install()` calls (made before the request, e.g.
 * during app boot) are visible to the scope as a baseline — request-
 * scoped installs sit on top of them without mutating the baseline.
 *
 * Without ALS available (browser; very old Node) this is a transparent
 * pass-through to `fn()` — the closure stacks act as the only state,
 * which is correct for single-threaded JS environments.
 *
 * Used by `serve()` to wrap each request's dispatch so concurrent SSR
 * doesn't bleed installed caps across requests.
 *
 * `als` is initialized at module load (Bun: sync probe of the global
 * constructor; Node: top-level await on `node:async_hooks`). By the
 * time any caller reaches this function `als` is either set to a
 * working instance or definitively `null` (browser / stripped
 * runtime); no async init is needed here.
 */
export async function runWithCapabilityScope<R>(fn: () => R | Promise<R>): Promise<R> {
  if (als === null) return fn()
  return als.run(new Map(), fn)
}

/**
 * Synchronous variant of `runWithCapabilityScope`. Calls `fn` directly
 * inside a fresh ALS scope (or directly if ALS isn't available — same
 * semantics as the async variant).
 *
 * Use this in hot paths that must invoke `fn` synchronously to preserve
 * upstream contracts. The primary consumer is `cache(fn)` whose
 * inflight-dedupe relies on `fn` being called synchronously when the
 * wrapped function is invoked (so concurrent callers all see the same
 * inflight promise). The async variant inserted a microtask hop on
 * environments where ALS hadn't been pre-loaded — top-level await at
 * module init now ensures `als` is set before any consumer code runs,
 * so the sync form is safe.
 *
 * Returns whatever `fn` returns: a value if sync, a Promise if async.
 * No awaiting at the boundary — preserves caller's control flow.
 */
export function runWithCapabilityScopeSync<R>(fn: () => R): R {
  if (als === null) return fn()
  return als.run(new Map(), fn) as R
}

export interface DefineCapabilityOptions {
  /**
   * Mark this capability as browser-only. When a server-side render
   * touches `use()` with no installation, instead of throwing the
   * generic "not provided" message, the cap throws a typed
   * `ClientOnlyAbort` error. The component framework catches that
   * specific class and auto-substitutes the throwing subtree with a
   * `<span data-place-client-only>` placeholder — so apps no longer
   * need to mark each page `clientOnly: true` or manually wrap views
   * in `<ClientOnly>`. The signaling is structural.
   */
  clientOnly?: boolean
}

/**
 * Thrown by `cap.use()` when a `clientOnly: true` capability is touched
 * outside the browser. Caught by `component()`'s `toHtml` / `hydrate`
 * paths in the component system, which substitute a placeholder span
 * and defer the real body to client-side mount. Carrying its own class
 * (rather than a generic `Error`) keeps the abort distinguishable from
 * actual rendering errors — abort triggers a structural fallback;
 * other errors propagate to the error overlay.
 */
export class ClientOnlyAbort extends Error {
  /** The cap's `name` field. Useful for diagnostic messages. */
  readonly capName: string
  constructor(name: string) {
    super(
      `capability '${name}' is client-only and was touched during SSR. ` +
        'The framework will substitute a placeholder span and mount the ' +
        'real body on hydrate. This is structural — apps do not need to opt in.',
    )
    this.name = 'ClientOnlyAbort'
    this.capName = name
  }
}

/**
 * Create a capability — a typed slot that consumers reach for via
 * `.use()`. The canonical API in v1.0:
 *
 *   const Router = cap<RouterImpl>({ clientOnly: true })
 *   const Db = cap<DbConn>()
 *
 * Or for back-compat, pass a name string first:
 *
 *   const Router = defineCapability<RouterImpl>('Router', { clientOnly: true })
 *
 * The name is only used in error messages. When omitted, errors say
 * "capability (anonymous)" — apps that care about diagnostics name
 * their cap exports descriptively (the export binding IS the cap).
 *
 * @provisional — `cap()` is the anonymous-shorthand alternative.
 * `defineCapability(name, options)` remains the canonical
 * stability-pinned API (per `docs/stability-covenant.md`). Choose
 * `defineCapability` for shipped code; `cap()` is a convenience
 * sketch that may consolidate before v0.1 publish.
 */
export function cap<T>(options: DefineCapabilityOptions = {}): Capability<T> {
  return defineCapability<T>('(anonymous)', options)
}

export function defineCapability<T>(
  name: string,
  options: DefineCapabilityOptions = {},
): Capability<T> {
  const clientOnly = options.clientOnly === true
  // Closure stack — the module-level baseline. Always present.
  // - Browser: this is the only state.
  // - Server outside any ALS scope (app boot, tests): same.
  // - Server inside an ALS scope: this acts as the snapshot source on
  //   first cap access in that scope. Module-level installs stay
  //   visible; request-scoped installs go to the ALS scope's stack.
  const closureStack: Entry<T>[] = []

  // Sentinel symbol — used as the Map key inside an ALS scope so each
  // cap's stack is isolated within the per-request Map.
  const capRef = Symbol(name)

  const currentStack = (): Entry<T>[] => {
    if (als === null) return closureStack
    const scope = als.getStore()
    if (scope === undefined) return closureStack
    let s = scope.get(capRef) as Entry<T>[] | undefined
    if (s === undefined) {
      // First access in this scope. Snapshot from the closure baseline
      // so module-level installs remain visible inside the request.
      s = [...closureStack]
      scope.set(capRef, s as Entry<unknown>[])
    }
    return s
  }

  const top = (): T | null => {
    const s = currentStack()
    if (s.length === 0) return null
    return (s[s.length - 1] as { impl: T }).impl
  }

  // Disposers may fire AFTER the originating ALS scope has unwound (e.g.
  // a component mounted during SSR sticks around past the request? — it
  // doesn't, but we're defensive). Token-based search: try the closure
  // stack and the currently-visible ALS scope; a no-op if the scope is
  // gone (the entry was gc'd with its scope's Map).
  const removeByToken = (token: object): void => {
    let idx = closureStack.findIndex((e) => e.token === token)
    if (idx !== -1) {
      closureStack.splice(idx, 1)
      return
    }
    if (als !== null) {
      const scope = als.getStore()
      if (scope !== undefined) {
        const s = scope.get(capRef) as Entry<T>[] | undefined
        if (s) {
          idx = s.findIndex((e) => e.token === token)
          if (idx !== -1) s.splice(idx, 1)
        }
      }
    }
  }

  return {
    name,
    clientOnly,
    provide<R>(impl: T, body: () => R): R {
      const token = {}
      const stack = currentStack()
      stack.push({ token, impl })
      try {
        return body()
      } finally {
        removeByToken(token)
      }
    },
    install(impl: T): () => void {
      const token = {}
      const stack = currentStack()
      stack.push({ token, impl })
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        removeByToken(token)
      }
    },
    use(...args: [] | [unknown]): T {
      const cur = top()
      if (cur === null) {
        if (args.length === 1) {
          // Caller passed a fallback — return it instead of throwing.
          // This is the canonical replacement for tryUse().
          return args[0] as T
        }
        if (clientOnly) {
          // Browser-only caps signal via the typed `ClientOnlyAbort`
          // class so the component framework can catch + substitute a
          // placeholder span automatically. No per-page opt-in needed.
          throw new ClientOnlyAbort(name)
        }
        throw new Error(
          `capability '${name}' not provided. Wrap your code in ` +
            `${name}.provide(impl, () => …) or call ${name}.install(impl) ` +
            `(keeping the disposer alive), or pass a fallback as ` +
            `${name}.use(default) to handle the absence gracefully.`,
        )
      }
      return cur
    },
    tryUse(): T | null {
      return top()
    },
  }
}
