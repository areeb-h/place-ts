// Effect-kind brands (T8-A; foundation for ADR 0028, 0029, 0030).
//
// Every primitive that can change a `view()`'s hydration model carries
// an opaque `__effect: <Kind>` brand on its return type. The classifier
// (T8-D, see `systems/component/src/build/view-classifier.ts`) reads
// these tags off the typed AST and picks the smallest viable hydration
// runtime (L0 static / L1 thaw / L2 island / L3 island+stream).
//
// The brand is **phantom**: never read at runtime, never written by
// users, never visible at the call site. Authors keep writing
// `state(0)` and `onMount(...)` exactly as before; only the inferred
// return type carries the effect annotation. T8-A is therefore a
// non-breaking type-only addition — apps pinned to today's surface
// keep working unchanged.
//
// **Why types, not regex / AST visit:** charter clause 4 ("effects
// are typed") + clause 7 ("magic with clarity"). The classifier reads
// `tsc`'s already-computed types rather than re-parsing source. A
// promotion from L1 → L2 is explainable as "this body calls a
// `'lifecycle'`-effect function" — discoverable in source, traceable
// to the specific identifier.

/**
 * Closed enum of effect kinds the framework recognizes. Ordered from
 * cheapest hydration model to most expensive — the classifier's
 * level decision is `lub(effects)` over the body's effect set.
 *
 *   `'pure'`       — no effect; reads constants
 *   `'state'`      — reads/writes signal cells (`state`, `derived`)
 *   `'lifecycle'`  — runs at mount/unmount (`onMount`, `globalKey`)
 *   `'timer'`      — schedules callbacks (`setInterval`, `setTimeout`)
 *   `'io'`         — networks / disk / fetch
 *   `'dom'`        — direct DOM mutation outside reactive props
 *   `'suspense'`   — reads from an unresolved `Suspense` resource
 *
 * The lub is computed by `lubEffect` below; `'pure'` is bottom.
 */
export type Effect = 'pure' | 'state' | 'lifecycle' | 'timer' | 'io' | 'dom' | 'suspense'

/**
 * Level the classifier picks from an effect set. Tier 8 ships these
 * as labels in the build report only; Tier 9's `view()` primitive
 * makes them load-bearing for emission.
 *
 *   `'static'`         (L0) — no effects beyond `'pure'` → 0 B JS
 *   `'thaw'`           (L1) — `'pure' | 'state'` only → inline action AST
 *   `'island'`         (L2) — any of `'lifecycle' | 'timer' | 'io' | 'dom'`
 *   `'island+stream'`  (L3) — L2 conditions + `'suspense'` present
 */
export type ViewLevel = 'static' | 'thaw' | 'island' | 'island+stream'

/**
 * Ordering used to pick the level — index in this array IS the
 * precedence (later kinds dominate earlier). `'suspense'` promotes
 * a view to L3 only when at least one L2-forcing effect is also
 * present; that combination is handled in `levelOf` below.
 */
const EFFECT_ORDER: readonly Effect[] = [
  'pure',
  'state',
  'lifecycle',
  'timer',
  'io',
  'dom',
  'suspense',
]

/**
 * Least-upper-bound of two effect kinds. `lubEffect('state',
 * 'lifecycle')` is `'lifecycle'` — the more-expensive of the two.
 * Reducing over a body's effect tag bag gives the body's overall
 * effect class, which `levelOf` then maps to a `ViewLevel`.
 */
export function lubEffect(a: Effect, b: Effect): Effect {
  const ai = EFFECT_ORDER.indexOf(a)
  const bi = EFFECT_ORDER.indexOf(b)
  return ai >= bi ? a : b
}

/**
 * Map an effect set (the lub of every primitive a view body touches)
 * to the runtime level the classifier picks.
 *
 * The decision is structural:
 *
 *   - `'pure'` alone        → static (L0): nothing reactive, no JS
 *   - `'state'` alone       → thaw   (L1): inline action AST handles writes
 *   - any L2-forcing effect → island (L2): full reactive runtime per island
 *   - L2-forcing + `'suspense'` → island+stream (L3): per-suspense streaming
 *
 * The `'suspense'` tag alone (without L2) does NOT promote past `'state'`
 * — a thaw-eligible component that doesn't itself read a suspended
 * resource stays L1 even if rendered inside a streaming boundary; the
 * streaming wraps it from the outside.
 */
export function levelOf(effects: Iterable<Effect>): ViewLevel {
  let lub: Effect = 'pure'
  let hasSuspense = false
  for (const e of effects) {
    if (e === 'suspense') {
      hasSuspense = true
      continue
    }
    lub = lubEffect(lub, e)
  }
  if (lub === 'pure') return 'static'
  if (lub === 'state') return 'thaw'
  // From here, we're at L2 minimum (lifecycle / timer / io / dom).
  return hasSuspense ? 'island+stream' : 'island'
}

/**
 * Type-level brand used on every effect-producing primitive's return
 * type. Phantom — the field is never present at runtime. The
 * classifier reads it via TypeScript's inferred return type, not by
 * looking at the actual JS value.
 *
 * Usage at the primitive definition site:
 *
 * ```ts
 * export function onMount(fn: () => void | (() => void)): EffectBrand<'lifecycle'> {
 *   // ...
 * }
 * ```
 *
 * The user's call site:
 *
 * ```ts
 * onMount(() => setInterval(...))  // return type carries `'lifecycle'`
 * ```
 *
 * The classifier collects the effect tag off the returned type for
 * every identifier reference inside a `view()` body.
 */
export type EffectBrand<E extends Effect> = {
  readonly __effect?: E
}

/**
 * Convenience: intersect an existing return type with an effect
 * brand. Use at primitive declaration sites that already return a
 * concrete type — e.g. `state()` returns `State<T>`; branding it
 * gives `State<T> & EffectBranded<'state'>`. The runtime value is
 * unchanged; only inferred types carry the tag.
 */
export type EffectBranded<E extends Effect> = EffectBrand<E>
