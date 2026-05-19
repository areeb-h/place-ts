// @place/reactivity — synchronous core + derivable state + scheduler
//
// Phases 1-3 of the reactivity system, shipping incrementally:
//   Phase 1 — synchronous core (state + watch + two-color graph coloring)
//   Phase 2 — derivable state (state(() => …) is writable; revert policy)
//   Phase 3 — scheduler (batch, flush, defer)

// Effect-kind brands (T8-A foundation; ADR 0030). Phantom types only;
// the build-time view classifier reads them off inferred return types
// to pick the hydration runtime. Zero runtime cost.
import type { EffectBranded } from './effects.ts'

//
// Three primitives total:
//   - state(value | () => value, options?)
//   - watch(fn, options?)
//   - peek(state)                 — untracked read (Phase 1 ergonomic)
//   plus: batch(fn), flush()      — Phase 3 scheduler controls
//
// Algebraic invariants enumerated in tests/property/. See also
// docs/05-test-plan.md for the per-phase invariant ledger.
//
// Provisional decisions (see docs/00-charter.md §"Provisional decisions"):
// - watch runs synchronously by default; defer is opt-in. The default-
//   stability of `defer: false` is committed: existing call sites stay
//   synchronous forever.
// - Global tracking pointer (Phase 5 introduces scopes)
// - Effects are not yet typed (Phase 4)
// - Rebase / permanent policies on derivable state are deferred; only
//   `revert` ships at Phase 2.

// ===== Internal node representation =====

const CLEAN = 0
const CHECK = 1
const DIRTY = 2
const COMPUTING = 3

type NodeState = typeof CLEAN | typeof CHECK | typeof DIRTY | typeof COMPUTING

type Equals<T> = (a: T, b: T) => boolean

type NodeKind = 'state' | 'watch'

interface BaseNode {
  kind: NodeKind
  state: NodeState
  /**
   * Dev-only stable id, assigned by `devRegister` when graph
   * introspection is live (see the "Dev-only reactive-graph
   * introspection" section). Never set in a production build — the
   * registration call sites are DCE'd. `@place/devtools` reads it.
   */
  devId?: number
  // **`Set<BaseNode>`, not `BaseNode[]`** — `track()` had been doing
  // `sources.includes(source)` (O(N)) and `clearSources` was doing
  // `dependents.indexOf(node)` (also O(N)), both inside the per-write
  // mark-propagation hot path. At ~100 watches per page the quadratic
  // setup time started showing; at ~1000 it dominates. Sets give O(1)
  // dedup + O(1) detach. Iteration via `for…of` is unchanged, and Sets
  // preserve insertion order so any code that depended on deterministic
  // dependent-fire order keeps working.
  sources: Set<BaseNode> | null
  dependents: Set<BaseNode> | null
}

interface StateNode<T> extends BaseNode {
  readonly kind: 'state'
  value: T
  hasValue: boolean
  readonly fn: (() => T) | null
  hasLocalWrite: boolean
  readonly equals: Equals<T>
}

interface WatchNode extends BaseNode {
  readonly kind: 'watch'
  readonly fn: () => void
  active: boolean
  readonly deferred: boolean
  /**
   * Set by propagateMark when a write fires during this watch's run
   * (state === COMPUTING). The finally-block in runWatch checks this and
   * re-queues the watch so the propagation isn't lost. Without this,
   * `state.write` inside a watch that observes the written state was
   * silently dropped — a real footgun for any consumer that wants to
   * react to errors / side effects from inside a render loop
   * (errorBoundary's catch path, for example).
   */
  needsRerun: boolean
}

// ===== Module-level state =====

let currentObserver: BaseNode | null = null

// Two scheduler queues. Sync watches drain immediately after a write (when
// not inside a batch). Deferred watches drain at the next microtask.
const syncQueue: Set<WatchNode> = new Set()
const deferredQueue: Set<WatchNode> = new Set()

let batchDepth = 0
let microtaskScheduled = false
let isFlushing = false

const SCHEDULER_ROUND_LIMIT = 1000

function defaultEquals<T>(a: T, b: T): boolean {
  return Object.is(a, b)
}

// ===== Dependency tracking =====

function track(source: BaseNode): void {
  if (currentObserver === null) return
  const observer = currentObserver
  if (observer.sources?.has(source)) return
  if (observer.sources === null) observer.sources = new Set()
  if (source.dependents === null) source.dependents = new Set()
  observer.sources.add(source)
  source.dependents.add(observer)
}

function clearSources(node: BaseNode): void {
  if (node.sources === null) return
  for (const src of node.sources) {
    src.dependents?.delete(node)
  }
  node.sources.clear()
}

// ===== Mark propagation =====

function scheduleWatch(w: WatchNode): void {
  if (!w.active) return
  if (w.deferred) {
    deferredQueue.add(w)
    requestMicrotaskFlush()
  } else {
    syncQueue.add(w)
  }
}

function propagateMark(node: BaseNode, mark: typeof CHECK | typeof DIRTY): void {
  // A COMPUTING node is currently running its body. State writes that
  // would cascade to it can't queue a fresh run mid-flight (would cycle),
  // and can't be silently dropped (caller intent is "this state changed,
  // observe it"). For watches, set `needsRerun` so the runWatch finally
  // re-schedules after the current run drains. For state derivations,
  // COMPUTING + a write is a real cycle (writes during derivations are
  // forbidden by `assertNotInDerivation`), so falling through to the
  // standard skip is fine.
  //
  // **Auto-untrack-self-write** — if the watch being marked IS the
  // currently-executing observer (i.e. it just wrote to a state it
  // reads), suppress the self-trigger. The watch already observed the
  // new value via its own write; re-firing would loop. Other watches
  // that depend on the same state still get queued normally — only the
  // originator is suppressed. This eliminates the most common watch
  // footgun (writing to a tracked state from inside a watch body).
  // Use `untrack(() => state.set(x))` when you specifically want the
  // current watch to re-fire on its own write.
  if (node.state === COMPUTING) {
    if (node.kind === 'watch') {
      if (currentObserver === node) {
        // Self-write — suppress.
        return
      }
      ;(node as WatchNode).needsRerun = true
    }
    return
  }
  if (node.state >= mark) return
  const wasClean = node.state === CLEAN
  node.state = mark
  if (node.kind === 'watch') scheduleWatch(node as WatchNode)
  if (wasClean && node.dependents !== null) {
    for (const dep of node.dependents) propagateMark(dep, CHECK)
  }
}

function propagateChange(root: BaseNode): void {
  if (root.dependents === null) return
  for (const dep of root.dependents) propagateMark(dep, DIRTY)
}

// ===== State read/recompute =====

function readState<T>(node: StateNode<T>): T {
  track(node)

  if (node.fn === null) return node.value

  if (node.state === COMPUTING) {
    throw new Error('reactivity: cycle detected — a derived state transitively depends on itself')
  }

  if (node.hasLocalWrite) {
    if (node.state === CHECK) refreshFromSources(node)
    if (node.state === CLEAN) return node.value
    node.hasLocalWrite = false
    return recomputeState(node)
  }

  if (node.state === CHECK) refreshFromSources(node)
  if (node.state === DIRTY || !node.hasValue) return recomputeState(node)
  return node.value
}

function refreshFromSources(node: BaseNode): void {
  if (node.sources !== null) {
    for (const src of node.sources) {
      if (src.kind === 'state' && (src as StateNode<unknown>).fn !== null) {
        readState(src as StateNode<unknown>)
      }
      if ((node.state as NodeState) >= DIRTY) break
    }
  }
  if (node.state === CHECK) node.state = CLEAN
}

function recomputeState<T>(node: StateNode<T>): T {
  const fn = node.fn as () => T
  const prevObserver = currentObserver
  node.state = COMPUTING
  clearSources(node)
  currentObserver = node
  try {
    const next = fn()
    const changed = !node.hasValue || !node.equals(node.value, next)
    node.value = next
    node.hasValue = true
    node.state = CLEAN
    if (changed) propagateChange(node)
    return next
  } catch (e) {
    // A throwing derivation must remain re-readable. Without resetting
    // state here, the node would be stuck in COMPUTING and every
    // future read would falsely trip the cycle-detected guard. Setting
    // DIRTY (not CLEAN) ensures the next read recomputes — fn might
    // succeed this time, or throw again, but we don't poison the node.
    node.state = DIRTY
    throw e
  } finally {
    currentObserver = prevObserver
  }
}

// ===== State write =====

function assertNotInDerivation(): void {
  if (currentObserver === null || currentObserver.kind !== 'state') return
  const obs = currentObserver as StateNode<unknown>
  if (obs.fn === null) return
  throw new Error(
    'reactivity: write during a derived computation is not allowed — ' +
      'derivations must be pure. Use watch for state changes in response to other state.',
  )
}

function writeState<T>(node: StateNode<T>, next: T | ((prev: T) => T)): void {
  assertNotInDerivation()

  if (node.fn !== null && !node.hasValue) readState(node)

  const value = typeof next === 'function' ? (next as (prev: T) => T)(node.value) : next

  if (node.hasValue && node.equals(node.value, value)) return

  if (node.fn !== null) node.hasLocalWrite = true
  node.value = value
  node.hasValue = true
  node.state = CLEAN
  propagateChange(node)
  maybeFlushSync()
  if (GRAPH_DEV) devNotifyTick()
}

// ===== Watch + Scheduler =====

function runWatch(node: WatchNode): void {
  if (!node.active) return
  const prevObserver = currentObserver
  clearSources(node)
  currentObserver = node
  node.state = COMPUTING
  node.needsRerun = false
  try {
    node.fn()
  } finally {
    currentObserver = prevObserver
    if (node.active) {
      if (node.needsRerun) {
        // A write during this run targeted this watch's sources.
        // propagateMark deferred the marking via needsRerun (since the
        // watch was COMPUTING); we mirror what propagateMark would
        // have done — DIRTY + schedule — so the next drain runs the
        // watch again. The settle-loop's round limit catches genuine
        // infinite loops.
        node.needsRerun = false
        node.state = DIRTY
        scheduleWatch(node)
      } else {
        node.state = CLEAN
      }
    }
    if (GRAPH_DEV) devNotifyTick()
  }
}

function drainQueue(queue: Set<WatchNode>): void {
  if (queue.size === 0) return
  const batch = [...queue]
  queue.clear()
  for (const w of batch) {
    if (!w.active) continue
    if (w.state === CHECK) refreshFromSources(w)
    if (w.state === DIRTY) runWatch(w)
  }
}

function throwUnsettled(): never {
  syncQueue.clear()
  deferredQueue.clear()
  throw new Error(
    `reactivity: scheduler did not settle in ${SCHEDULER_ROUND_LIMIT} rounds. ` +
      'This usually means a watch writes to a state it reads transitively — each ' +
      'write triggers the watch, which writes again. Inspect the chain of writes ' +
      'inside any active watch.',
  )
}

function settleAll(): void {
  if (isFlushing) return
  isFlushing = true
  try {
    let round = 0
    while (syncQueue.size > 0 || deferredQueue.size > 0) {
      if (++round > SCHEDULER_ROUND_LIMIT) throwUnsettled()
      drainQueue(syncQueue)
      drainQueue(deferredQueue)
    }
  } finally {
    isFlushing = false
  }
}

function maybeFlushSync(): void {
  if (batchDepth > 0 || isFlushing) return
  if (syncQueue.size === 0) return
  isFlushing = true
  try {
    let round = 0
    while (syncQueue.size > 0) {
      if (++round > SCHEDULER_ROUND_LIMIT) throwUnsettled()
      drainQueue(syncQueue)
    }
  } finally {
    isFlushing = false
  }
}

function requestMicrotaskFlush(): void {
  if (microtaskScheduled || batchDepth > 0) return
  microtaskScheduled = true
  queueMicrotask(() => {
    microtaskScheduled = false
    if (batchDepth > 0) return
    settleAll()
  })
}

// ===== Public API =====

/**
 * Base callable-state surface. Always present regardless of `T`.
 */
export interface BaseState<T> {
  /** Read the current value. Subscribes the active observer (watch / derived). */
  (): T
  /** Direct write — replaces the value. */
  set(next: T): void
  /** Functional updater — receives the previous value, returns the next. */
  update(fn: (prev: T) => T): void
  /** Read without subscribing the active observer. */
  peek(): T
  /** Memoized derived signal — recomputes only when sources change. */
  map<U>(transform: (value: T) => U): () => U
  /**
   * Alias for the callable form. Both `count.read()` and `count()` return
   * the value and subscribe the observer. Prefer the callable form in
   * new code; this exists for symmetric pairing with `.write()`.
   */
  read(): T
  /**
   * Alias for `.set(value)` / `.update(fn)`. Both signatures supported:
   * pass a value or a (prev → next) updater. Prefer `.set()` / `.update()`
   * in new code for clarity at the call site.
   */
  write(next: T | ((prev: T) => T)): void
}

/**
 * Type-narrowed methods that only appear when `T` is compatible.
 * - `T = boolean` adds `.toggle()`
 * - `T = readonly U[]` adds `.push` / `.remove` / `.clear` / `.replace`
 */
export type NarrowedMethods<T> = (T extends boolean ? { toggle(): void } : unknown) &
  (T extends readonly (infer U)[]
    ? {
        push(...items: U[]): void
        remove(predicate: (item: U, index: number) => boolean): void
        clear(): void
        replace(index: number, value: U): void
      }
    : unknown)

/**
 * A reactive cell. The function call form is the canonical read:
 *
 *   const count = state(0)
 *   count()           // read, tracking
 *   count.set(5)
 *   count.update((c) => c + 1)
 *
 * Type narrowing per `T`: `state(true)` gets `.toggle()`; `state<T[]>([])`
 * gets `.push` / `.remove` / `.clear` / `.replace` with `T` as element type.
 *
 * Carries the `'state'` effect brand (T8-A / ADR 0030). Phantom — the
 * `__effect` field is never present at runtime; the build-time
 * classifier reads it off the inferred return type to pick the
 * smallest viable hydration runtime for the surrounding `view()`.
 */
export type State<T> = BaseState<T> & NarrowedMethods<T> & EffectBranded<'state'>

/** Boolean-typed state — preserved alias for explicit annotation. */
export type BooleanState = State<boolean>

/** Array-typed state — preserved alias for explicit annotation. */
export type ArrayState<T> = State<readonly T[]>

/**
 * Read-only reactive accessor. Returned by `derived(fn)`. Same callable
 * shape as `State`, minus the writes.
 *
 * Carries the `'state'` effect brand — derived values read state and
 * produce state (a memoized projection); the classifier treats them
 * the same as a `State<T>` for level purposes.
 */
export interface Derived<T> extends EffectBranded<'state'> {
  (): T
  peek(): T
  map<U>(transform: (value: T) => U): () => U
}

/**
 * Cleanup function returned by `watch` (and a few other primitives
 * that install reactive subscriptions or DOM listeners). Branded
 * `'lifecycle'` because a `watch()` body fires synchronously on
 * registration AND on dep change — both are mount/unmount-coupled
 * effects from the classifier's perspective (a view that registers a
 * watch can't be a static-state-graph component).
 */
export type Disposer = (() => void) & EffectBranded<'lifecycle'>

// ----- Effect-kind brands (T8-A; ADR 0030 foundation) -----
// **Types only** at this level — the `levelOf` / `lubEffect`
// functions live exclusively in `./effects.ts` and are imported
// directly by the build-time classifier. Re-exporting the values
// here previously caused Bun's chunk-splitter to bundle them into
// every island bundle (via the framework barrel → reactivity index
// → effects.ts) as a separate ~540 B shared chunk, even though no
// runtime code calls them. Types are erased at compile time → no
// chunk impact.
export type { Effect, EffectBrand, EffectBranded, ViewLevel } from './effects.ts'

export interface StateOptions<T> {
  equals?: Equals<T>
}

export interface WatchOptions {
  /**
   * Defer this watch to the next microtask boundary instead of running it
   * synchronously when its sources change. The default is `false` and that
   * default is **committed**: existing call sites without this option stay
   * synchronous forever, regardless of future scheduler changes.
   */
  defer?: boolean
}

/**
 * Create reactive state.
 *
 * - `state(value)` — raw state. Reads return the stored value; writes update it.
 * - `state(() => expression)` — derived state. Reads return the result of the
 *   derivation; writes set a local override (revert policy: the override is
 *   discarded the next time an upstream source actually changes value).
 *
 * Returned object IS callable — `count()` reads (and tracks); the methods
 * `.set` / `.update` / `.peek` / `.map` cover writes and derivations.
 *
 * Type narrowing per `T`:
 *   - `state(true)` → `BooleanState` (has `.toggle()`)
 *   - `state<T[]>([])` → `ArrayState<T>` (has `.push` / `.remove` / `.clear` / `.replace`)
 *   - other → `State<T>`
 *
 * Equality defaults to `Object.is`. Pass `equals` to short-circuit propagation
 * for structural comparisons.
 *
 * **Footgun:** the function-form is detected by `typeof initial === 'function'`.
 * If you actually want a *function value* as state (e.g. an event handler),
 * wrap it: `state<Handler>(() => myHandler)` — the outer function is the
 * derivation; the returned handler is the value.
 *
 * **Named-binding convention** (HMR / view classifier — T8-A / ADR 0028).
 * When `state()` appears inside a `view()` body, prefer a named binding
 * (`const count = state(0)`) over inline use (`return el('div', null,
 * state(0)())`). The framework's HMR uses the binding name as a stable
 * key for state preservation across hot swaps: a body edit that
 * preserves the binding name keeps the cell across the swap; an
 * anonymous in-body state instance gets a fresh cell on every swap
 * because there's no identifier to key by. Anonymous state inside
 * loops/conditionals is a build warning (ADR 0028 §"State preservation").
 *
 * **Effect kind: `'state'`** — branded on the returned `State<T>`. The
 * view classifier reads this off the inferred type; views that touch
 * only `state` (and other state-tagged primitives) compile to L1 thaw
 * (~300 B inline AST), not full L2 island.
 */
export function state<T>(initial: T | (() => T), options?: StateOptions<T>): State<T> {
  const isFn = typeof initial === 'function'
  const node: StateNode<T> = {
    kind: 'state',
    state: isFn ? DIRTY : CLEAN,
    sources: null,
    dependents: null,
    value: isFn ? (undefined as T) : (initial as T),
    hasValue: !isFn,
    fn: isFn ? (initial as () => T) : null,
    hasLocalWrite: false,
    equals: options?.equals ?? defaultEquals,
  }
  if (GRAPH_DEV) devRegister(node)
  const read = (): T => readState(node)
  // Build the function-with-methods. The function IS the read; methods
  // are attached as own properties. At runtime ALL methods are present;
  // public type `State<T>` narrows visibility via `NarrowedMethods<T>` so
  // `.toggle()` shows up for booleans, `.push` for arrays, etc. The cast
  // to `Record<string, unknown>` here just bypasses the strict-write check
  // so we can attach the runtime methods uniformly.
  // biome-ignore lint/suspicious/noExplicitAny: runtime attachment bypasses the conditional-type narrowing of State<T>; methods are installed unconditionally and the public type narrows them.
  const s = read as any
  s.set = (next: T) => {
    writeState(node, next)
  }
  s.update = (fn: (prev: T) => T) => {
    writeState(node, fn)
  }
  s.peek = () => untrack(() => readState(node))
  s.read = read
  s.write = (next: T | ((prev: T) => T)) => {
    writeState(node, next)
  }
  s.map = <U>(transform: (value: T) => U): (() => U) => {
    // Memoize via a derived state — multi-read in the same pass hits cache.
    const dNode: StateNode<U> = {
      kind: 'state',
      state: DIRTY,
      sources: null,
      dependents: null,
      value: undefined as U,
      hasValue: false,
      fn: () => transform(readState(node)),
      hasLocalWrite: false,
      equals: defaultEquals,
    }
    if (GRAPH_DEV) devRegister(dNode)
    return () => readState(dNode)
  }
  // BooleanState.toggle
  s.toggle = () => {
    writeState(node, ((v: unknown) => !v) as never)
  }
  // ArrayState helpers
  s.push = (...items: unknown[]) => {
    writeState(node, ((arr: unknown) => (Array.isArray(arr) ? [...arr, ...items] : arr)) as never)
  }
  s.remove = (predicate: (item: unknown, index: number) => boolean) => {
    writeState(node, ((arr: unknown) =>
      Array.isArray(arr) ? arr.filter((it, idx) => !predicate(it, idx)) : arr) as never)
  }
  s.clear = () => {
    writeState(node, [] as never)
  }
  s.replace = (index: number, value: unknown) => {
    writeState(node, ((arr: unknown) => {
      if (!Array.isArray(arr)) return arr
      const next = arr.slice()
      next[index] = value
      return next
    }) as never)
  }
  return s as State<T>
}

/**
 * Run `fn` once, tracking its reactive reads. Re-run it whenever any tracked
 * source actually changes value. Returns a disposer that tears down the
 * subscription chain.
 *
 * Pass `{ defer: true }` to make the watch run at the next microtask instead
 * of synchronously. Useful for batching DOM updates or coalescing rapid writes.
 */
export function watch(fn: () => void, options?: WatchOptions): Disposer {
  const node: WatchNode = {
    kind: 'watch',
    state: CLEAN,
    sources: null,
    dependents: null,
    fn,
    active: true,
    deferred: options?.defer === true,
    needsRerun: false,
  }
  if (GRAPH_DEV) devRegister(node)
  runWatch(node)
  // If the initial run wrote to a state the watch observes, runWatch's
  // finally re-queued the watch via needsRerun. Drain so the re-runs
  // settle synchronously before `watch()` returns. Inside a batch or
  // an active flush the outer settle handles it; maybeFlushSync's own
  // guards turn this into a no-op in those cases.
  maybeFlushSync()
  return () => {
    if (!node.active) return
    node.active = false
    clearSources(node)
    syncQueue.delete(node)
    deferredQueue.delete(node)
    if (GRAPH_DEV) devNodes.delete(node)
  }
}

/**
 * Wrap a function with memoization driven by the reactive graph. The returned
 * accessor recomputes only when the dependencies (state cells read inside
 * `fn`) actually change value; intermediate reads return the cached result.
 *
 * Plain functions that read state — `const c = () => a() + b()` — already
 * track correctly and re-run on every call. `derived()` adds caching:
 * `const c = derived(() => a() + b())` computes once per change.
 *
 * Use `derived` when the computation is non-trivial, when many call sites
 * read the same value in one render pass, or when you want a single name for
 * a reactive expression. Use a plain function otherwise.
 *
 * The returned accessor is read-only; nothing to write to. For a writable
 * cell, reach for `state(initial)` directly.
 */
export function derived<T>(fn: () => T, options?: StateOptions<T>): Derived<T> {
  const node: StateNode<T> = {
    kind: 'state',
    state: DIRTY,
    sources: null,
    dependents: null,
    value: undefined as T,
    hasValue: false,
    fn,
    hasLocalWrite: false,
    equals: options?.equals ?? defaultEquals,
  }
  if (GRAPH_DEV) devRegister(node)
  const read = (): T => readState(node)
  const d = read as Derived<T>
  d.peek = () => untrack(() => readState(node))
  d.map = <U>(transform: (value: T) => U): (() => U) => {
    const dNode: StateNode<U> = {
      kind: 'state',
      state: DIRTY,
      sources: null,
      dependents: null,
      value: undefined as U,
      hasValue: false,
      fn: () => transform(readState(node)),
      hasLocalWrite: false,
      equals: defaultEquals,
    }
    if (GRAPH_DEV) devRegister(dNode)
    return () => readState(dNode)
  }
  return d
}

/**
 * Run `fn` with no current observer — any state reads inside do not subscribe
 * the surrounding watch. Used by `@place/component`'s mount machinery so that
 * descendant component bodies' reads don't accidentally subscribe their
 * ancestors' watches (which would cause the ancestor to re-fire — and the
 * descendant subtree to unmount + remount — on every reactive update inside).
 */
export function untrack<T>(fn: () => T): T {
  const prev = currentObserver
  currentObserver = null
  try {
    return fn()
  } finally {
    currentObserver = prev
  }
}

/**
 * Group writes so that watches see the final state, not the intermediate ones.
 * Inside `batch(fn)`, no watches run until `fn` returns; at that point, all
 * pending watches run in dependency order.
 *
 * Nests safely: only the outermost batch flushes.
 *
 * Returns whatever `fn` returned.
 */
export function batch<T>(fn: () => T): T {
  batchDepth++
  try {
    return fn()
  } finally {
    batchDepth--
    if (batchDepth === 0) settleAll()
  }
}

/**
 * Synchronously drain all pending watches now — both sync and deferred queues.
 * Useful in tests and for code paths that need to know the graph is settled
 * before proceeding.
 */
export function flush(): void {
  if (batchDepth > 0) return
  settleAll()
}

// ===== resource — async-as-pending (Phase 5 v0.1) =====
//
// Turns a `() => Promise<T>` into reactive state with three discriminated
// statuses: 'loading' | 'error' | 'ready'. Reads inside a watch / derived
// re-fire whenever the status transitions.
//
// Auto-refetch: the loader is invoked inside a watch, so any reactive
// reads it makes synchronously (before the first await) become tracked
// dependencies. When those dependencies change, the loader re-runs and a
// fresh fetch starts. The previous in-flight fetch is invalidated by an
// internal token, so its eventual resolution does not clobber newer
// data.
//
// Why not Suspense / promise-throwing: those models couple async to a
// rendering boundary and require a compiler step or specific runtime
// integration. A discriminated status is plain reactive state — no
// boundary, no compiler — and consumers handle the transitions
// explicitly with `status()`. No magic.
//
// What's deferred:
//   - AbortController integration (cancellation on dispose / refetch).
//     Add when a real workload demonstrates a need.
//   - Optimistic / mutation primitives (`mutation(fn)`).
//   - Stale-while-revalidate flag on refresh (keep `value`, only flip
//     `loading`).

export type ResourceStatus<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly error: unknown }
  | { readonly state: 'ready'; readonly value: T }

export interface Resource<T> {
  /**
   * Reactive value — `undefined` while loading or on error. Callable
   * form: `r()` reads (tracking). Use `r.status()` for the discriminated
   * shape when you need the loading/error states.
   */
  (): T | undefined
  /** Alias for the callable form. Prefer `r()` in new code. */
  read(): T | undefined
  /** Reactive: true between fetch start and resolution. */
  loading(): boolean
  /** Reactive: the rejection reason, or `undefined` otherwise. */
  error(): unknown | undefined
  /**
   * Discriminated status — the cleanest shape to consume in a component.
   * Switch on `status().state` to render the three cases.
   */
  status(): ResourceStatus<T>
  /**
   * Re-run the loader. Stale in-flight fetches are dropped via an
   * internal token so they cannot clobber the new result. Returns a
   * promise that resolves once the new fetch settles.
   */
  refresh(): Promise<void>
  /** Stop the auto-refetch watch. After this, `refresh()` still works. */
  dispose(): void
  /**
   * The `hydrationKey` passed to `resource()`, or `undefined` if none.
   * The SSR streaming layer reads this to decide whether to serialize
   * the resolved value into `__place.r` for the client to pick up.
   */
  hydrationKey(): string | undefined
}

/**
 * Wrap an async loader as reactive state. The loader runs inside a
 * `watch`, so any synchronous reactive reads it makes (before its first
 * `await`) are tracked — when they change, the resource re-fetches.
 *
 * The loader receives an `AbortSignal`. Forward it to `fetch` (or any
 * abort-aware async API) so stale requests are actually cancelled at
 * the network layer when a fresher fetch supersedes them or when the
 * resource is disposed. The signal is aborted both on `refresh()`
 * (just before the next loader runs) and on `dispose()`.
 *
 * ```ts
 * const noteId = state('a')
 * const note = resource((signal) =>
 *   fetch(`/notes/${noteId()}`, { signal }).then((r) => r.json()),
 * )
 *
 * // In a component:
 * const s = note.status()
 * if (s.state === 'loading') return 'Loading…'
 * if (s.state === 'error') return `Error: ${String(s.error)}`
 * return <NoteView note={s.value} />
 * ```
 */
export interface ResourceOptions {
  /**
   * Stable identifier for SSR ↔ client value transfer. When set:
   *   - Server: after the loader resolves, the streaming SSR layer
   *     (`@place/component`'s `renderToStream`) serializes the resolved
   *     value into `<script>__place.r['<key>']=…</script>` so the
   *     client can read it back without re-fetching.
   *   - Client: at construction, `resource()` checks `globalThis.__place?.r?.[key]`
   *     and seeds the initial status from the cached value when present,
   *     skipping the initial loader run.
   *
   * The key must be stable for a given (page, resource) pair across
   * server and client — typically encode the URL params or other
   * stable inputs, e.g. `\`note:\${id}\`` or `\`feed:\${page}\``.
   * Different keys per render cause cache misses (the client re-fetches);
   * duplicate keys across resources cause one to overwrite the other.
   *
   * Without this option, `resource()` always runs its loader on the
   * client even if the server already resolved it. Set this for any
   * resource you want to participate in streaming SSR.
   */
  hydrationKey?: string
}

export function resource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  options?: ResourceOptions,
): Resource<T> {
  // Hydration cache lookup: only on the client (where __place was
  // installed by the SSR shell). On the server this is always undefined.
  const hydratedValue: { value: T } | null = (() => {
    const key = options?.hydrationKey
    if (key === undefined) return null
    const place = (globalThis as { __place?: { r?: Record<string, unknown> } }).__place
    if (!place?.r) return null
    if (!Object.hasOwn(place.r, key)) return null
    return { value: place.r[key] as T }
  })()

  const status = state<ResourceStatus<T>>(
    hydratedValue !== null ? { state: 'ready', value: hydratedValue.value } : { state: 'loading' },
  )
  let token = 0
  let currentController: AbortController | null = null

  const refresh = (): Promise<void> => {
    const myToken = ++token
    // Abort the previous in-flight fetch BEFORE starting a new one.
    // The token-based dedupe still protects against stale status
    // writes; the abort fixes the actual network-layer waste.
    currentController?.abort()
    const controller = new AbortController()
    currentController = controller
    status.set({ state: 'loading' })
    let promise: Promise<T>
    try {
      promise = loader(controller.signal)
    } catch (e) {
      if (myToken === token) status.set({ state: 'error', error: e })
      return Promise.resolve()
    }
    return promise.then(
      (value) => {
        if (myToken === token) status.set({ state: 'ready', value })
      },
      (e) => {
        // Skip writing AbortError if the abort was ours (refresh /
        // dispose superseded this fetch). Anything else is a real
        // error — surface it.
        if (myToken !== token) return
        if (controller.signal.aborted) return
        status.set({ state: 'error', error: e })
      },
    )
  }

  // Auto-refetch on tracked dep changes. The watch's reactive scope ends
  // at the first await inside `loader`; anything after that resolves
  // outside reactivity, which is correct — we only want to react to the
  // INPUTS of the fetch, not the resolved promise itself.
  //
  // When seeded from `__place.r` via `hydrationKey`, skip the FIRST
  // refresh — we already have the value the server resolved. The watch
  // still needs to run once to register tracked deps for future changes,
  // so we use a one-shot flag instead of skipping the watch entirely.
  let skipFirstRefresh = hydratedValue !== null
  const stop = watch(() => {
    if (skipFirstRefresh) {
      // Read the loader's tracked deps so future changes trigger a real
      // refresh. Wrap in untrack so we don't actually invoke the loader;
      // the deps the user reads are tracked by the loader itself when
      // it's later called.
      skipFirstRefresh = false
      return
    }
    void refresh()
  })

  const read = (): T | undefined => {
    const s = status()
    return s.state === 'ready' ? s.value : undefined
  }
  // biome-ignore lint/suspicious/noExplicitAny: runtime method attachment on a callable; type narrowing happens at the public Resource<T> interface.
  const r = read as any
  r.read = read
  r.loading = (): boolean => status().state === 'loading'
  r.error = (): unknown => {
    const s = status()
    return s.state === 'error' ? s.error : undefined
  }
  r.status = (): ResourceStatus<T> => status()
  r.refresh = refresh
  r.dispose = (): void => {
    // Stop auto-refetch, invalidate any in-flight fetch's status
    // write, AND abort the underlying request so we don't keep a
    // socket / CPU busy on a result we'll discard.
    stop()
    token++
    currentController?.abort()
    currentController = null
  }
  r.hydrationKey = (): string | undefined => options?.hydrationKey
  return r as Resource<T>
}

// ===== history — bounded undo/redo over a writable state =====
//
// Wraps a `State<T>` with an undo/redo stack. Each meaningful change to
// `s` is snapshotted onto an undo stack; `undo()` writes the previous
// snapshot back; `redo()` re-applies the last undone snapshot. New
// edits clear the redo stack — standard editor semantics.
//
// The "applying" flag in `undo()` / `redo()` keeps the auto-snapshot
// watch from re-recording the restoration as a fresh edit (the same
// cycle-break pattern persistedState uses for cross-tab observe).
//
// What this is NOT:
//   - Multi-state grouping (undo across several states atomically).
//     Wrap the states in a single struct-shaped state and pass that.
//   - Time-indexed reactivity (Phase 5). That'll come with first-class
//     temporal-tuple state; `history` is the practical pragmatic shape
//     until then.
//   - Persistence-aware. The history lives in memory; reload clears it.

export interface HistoryOptions<T> {
  /** Maximum number of past snapshots retained. Defaults to 100. */
  limit?: number
  /** Equality used to skip no-op snapshots. Defaults to `Object.is`. */
  equals?: Equals<T>
  /**
   * Deep-clone (via `structuredClone`) before pushing to the undo
   * stack and after popping for restore. Use this when the source
   * state holds objects that get mutated in place after a write —
   * without cloning, the snapshot retains a live reference and
   * reflects the later mutation, defeating the undo. Off by default
   * because most apps push fresh objects per write (immutable
   * style); turn on if you mutate.
   */
  deep?: boolean
  /**
   * Auto-snapshot every state change via an internal watch. Defaults
   * to `true`. Set to `false` for explicit-commit semantics — the
   * consumer calls `commit()` only on user-driven changes, and
   * remote-applied / programmatic writes are excluded from the undo
   * stack. Useful when the underlying state is also written by
   * cross-tab sync, server push, etc., and you don't want undo to
   * roll back another tab's edit.
   */
  auto?: boolean
}

export interface History {
  undo(): void
  redo(): void
  /** Reactive: true if there is at least one prior snapshot to restore. */
  canUndo(): boolean
  /** Reactive: true if there is a snapshot to re-apply. */
  canRedo(): boolean
  /**
   * Snapshot the current value into the undo stack. Only meaningful
   * when `auto: false` was passed — auto mode does this via an
   * internal watch on every state change. In manual mode, the consumer
   * calls this on user-driven mutations to record an undoable point.
   */
  commit(): void
  /** Stop tracking. Future writes to the source state are not snapshotted. */
  dispose(): void
}

export function history<T>(s: State<T>, options?: HistoryOptions<T>): History {
  const limit = options?.limit ?? 100
  const eq = options?.equals ?? defaultEquals
  const auto = options?.auto !== false
  const clone = options?.deep === true ? (v: T): T => structuredClone(v) : (v: T): T => v
  const past: T[] = [clone(s())]
  const future: T[] = []
  let applying = false

  // Reactive flags so consumers can disable undo/redo buttons.
  const canUndoCell = state(false)
  const canRedoCell = state(false)

  const updateFlags = (): void => {
    canUndoCell.set(past.length > 1)
    canRedoCell.set(future.length > 0)
  }

  const snapshot = (v: T): void => {
    // Skip snapshotting if the value didn't actually change vs the top
    // of past — protects against equal writes that slipped past the
    // state's own equals.
    const top = past[past.length - 1]
    if (past.length > 0 && eq(top as T, v)) return
    past.push(clone(v))
    if (past.length > limit + 1) past.shift()
    if (future.length > 0) future.length = 0
    updateFlags()
  }

  const watchStop = auto
    ? watch(() => {
        const v = s()
        if (applying) return
        snapshot(v)
      })
    : ((() => {}) as Disposer)

  return {
    undo(): void {
      if (past.length <= 1) return
      const current = past.pop() as T
      future.push(current)
      const prev = past[past.length - 1] as T
      applying = true
      try {
        // Clone prev too — if the user mutates the restored value,
        // we don't want that to retroactively change the snapshot.
        s.set(clone(prev))
      } finally {
        applying = false
      }
      updateFlags()
    },
    redo(): void {
      const next = future.pop()
      if (next === undefined) return
      past.push(next)
      applying = true
      try {
        s.set(clone(next))
      } finally {
        applying = false
      }
      updateFlags()
    },
    canUndo: () => canUndoCell(),
    canRedo: () => canRedoCell(),
    commit(): void {
      // Read untracked — commit() shouldn't subscribe a caller's watch
      // to the underlying state. Reading via peek matches the manual-
      // commit semantics: take a snapshot of "the value right now".
      snapshot(s.peek())
    },
    dispose: watchStop,
  }
}

// ===== Dev-only reactive-graph introspection =====
//
// Powers `@place/devtools`' graph panel — a live view of every
// `state` / `derived` / `watch` node, its current value, and the
// dependency edges between them. The charter's clause 3 ("the graph
// is observable") made literal.
//
// **Cost discipline.** Registration (the hot path — one call per
// primitive creation) is gated on `GRAPH_DEV`:
//   - Production browser build (`__PLACE_DEV__` defined `false`):
//     `GRAPH_DEV` folds to `false`, every `if (GRAPH_DEV)` registration
//     branch is dropped by Bun's dead-code elimination, and the
//     registry below tree-shakes out.
//   - Server / SSR (no `window`): `GRAPH_DEV` is `false`, so a
//     long-running server never accumulates nodes in `devNodes`.
//   - Dev browser build + the test runtime (happy-dom): `GRAPH_DEV`
//     is `true` — the graph is observable.
// The read side (`inspectGraph` / `onGraphTick`) is exported; an app
// that never imports `@place/devtools` leaves them unreferenced and
// the bundler shakes them away.

declare const __PLACE_DEV__: boolean | undefined

/**
 * True when the reactive graph should be observable: a browser
 * context that is not an explicit production build. Evaluated once
 * at module load — folds to a literal under a production define.
 */
const GRAPH_DEV: boolean =
  typeof window !== 'undefined' && (typeof __PLACE_DEV__ === 'undefined' || __PLACE_DEV__ !== false)

let devIdSeq = 0
const devNodes = new Set<BaseNode>()
const devTickListeners = new Set<() => void>()
let devTickQueued = false

/** Tag a node with a stable id and add it to the live registry. */
function devRegister(node: BaseNode): void {
  node.devId = ++devIdSeq
  devNodes.add(node)
}

/**
 * Signal "the graph changed" to subscribers, coalesced to one
 * notification per microtask so a `batch()` of N writes wakes the
 * devtools once, not N times.
 */
function devNotifyTick(): void {
  if (devTickListeners.size === 0 || devTickQueued) return
  devTickQueued = true
  queueMicrotask(() => {
    devTickQueued = false
    for (const l of devTickListeners) l()
  })
}

/** Node-state code → human label, for the snapshot. */
function devStatusLabel(s: NodeState): GraphNodeSnapshot['status'] {
  return s === CLEAN ? 'clean' : s === CHECK ? 'check' : s === DIRTY ? 'dirty' : 'computing'
}

/**
 * Defensive one-line preview of a node's value. Never throws, never
 * recurses into a cycle, always short — the devtools renders this
 * string directly rather than the raw value (which could be circular,
 * huge, or a live DOM node).
 */
function devPreviewValue(v: unknown): string {
  try {
    if (v === undefined) return 'undefined'
    if (v === null) return 'null'
    const t = typeof v
    if (t === 'string') {
      const s = v as string
      return s.length > 64 ? `"${s.slice(0, 61)}…"` : `"${s}"`
    }
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v)
    if (t === 'function') {
      const name = (v as { name?: string }).name
      return name ? `ƒ ${name}()` : 'ƒ ()'
    }
    if (t === 'symbol') return String(v)
    if (Array.isArray(v)) return `Array(${v.length})`
    const ctor = (v as object).constructor?.name
    return ctor && ctor !== 'Object' ? `${ctor} {…}` : '{…}'
  } catch {
    return '<unreadable>'
  }
}

/** One node in a {@link GraphSnapshot}. */
export interface GraphNodeSnapshot {
  /** Stable id — the same node keeps its id for its whole lifetime. */
  readonly id: number
  /** `state` (writable cell), `derived` (memoized fn), or `watch`. */
  readonly kind: 'state' | 'derived' | 'watch'
  /** Defensive one-line preview of the current value. Absent for watches. */
  readonly value?: string
  /** Scheduler state of the node right now. */
  readonly status: 'clean' | 'check' | 'dirty' | 'computing'
  /** ids of the nodes this node reads (its dependencies). */
  readonly sources: readonly number[]
  /** ids of the nodes that read this node (its subscribers). */
  readonly dependents: readonly number[]
}

/** A point-in-time picture of the whole reactive graph. */
export interface GraphSnapshot {
  /** Every live node, in creation order. */
  readonly nodes: readonly GraphNodeSnapshot[]
  /** `Date.now()` when the snapshot was taken. */
  readonly capturedAt: number
}

/**
 * Snapshot the live reactive graph — every `state` / `derived` /
 * `watch` node, its value, and its edges. Dev-only: returns an empty
 * snapshot in a production build (registration is DCE'd there).
 *
 * Reading a node's value here never forces a recompute — a `dirty`
 * derived shows its last-computed value plus the `dirty` status, so
 * inspection has zero effect on the graph it observes.
 */
export function inspectGraph(): GraphSnapshot {
  const nodes: GraphNodeSnapshot[] = []
  for (const node of devNodes) {
    const isWatch = node.kind === 'watch'
    const isDerived = node.kind === 'state' && (node as StateNode<unknown>).fn !== null
    const sources: number[] = []
    if (node.sources) for (const s of node.sources) if (s.devId !== undefined) sources.push(s.devId)
    const dependents: number[] = []
    if (node.dependents)
      for (const d of node.dependents) if (d.devId !== undefined) dependents.push(d.devId)
    nodes.push({
      id: node.devId ?? 0,
      kind: isWatch ? 'watch' : isDerived ? 'derived' : 'state',
      status: devStatusLabel(node.state),
      sources,
      dependents,
      ...(isWatch
        ? {}
        : {
            value: (node as StateNode<unknown>).hasValue
              ? devPreviewValue((node as StateNode<unknown>).value)
              : '<uncomputed>',
          }),
    })
  }
  return { nodes, capturedAt: Date.now() }
}

/**
 * Subscribe to graph-change ticks — fired (coalesced to one per
 * microtask) whenever a write settles or a watch runs. The devtools
 * re-snapshots on each tick. Returns an unsubscribe function.
 * Dev-only; in production the callback is simply never invoked.
 */
export function onGraphTick(cb: () => void): () => void {
  devTickListeners.add(cb)
  return () => {
    devTickListeners.delete(cb)
  }
}

// ===== Test-only =====

export const __internal = {
  hasPendingSync: (): boolean => syncQueue.size > 0,
  hasPendingDeferred: (): boolean => deferredQueue.size > 0,
  isFlushing: (): boolean => isFlushing,
  batchDepth: (): number => batchDepth,
} as const
