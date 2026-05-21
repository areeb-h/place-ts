# ADR 0015: Motion lives in `@place-ts/reactivity/motion`, not a separate system

**Status:** accepted
**Date:** 2026-05-13
**Affects:** new directory `systems/reactivity/src/motion/`; tests at
`systems/reactivity/tests/unit/motion.test.ts` + `tests/conformance/motion.charter.test.ts`;
ADR follow-up implementations in `systems/design/`.

## Context

The platform now wants an animation surface. The system map already
takes a position on it
([docs/platform/00-system-map.md](../platform/00-system-map.md)):

> **Standalone animation library** — composes from time + reactivity
> primitives. (May get a DSL later in component-system.)

That line was a hedge between two homes: reactivity, or component. The
hedge has to be resolved now that we're shipping the surface.

A research pass this session ([research note](../../research-tanstack-comparison.md)
plus an external prior-art critique) catalogued the failure modes of
the leading animation libraries. The ones that change the design
choice:

- **Framer Motion's `motion.*` props API has a 34KB tree-shake floor.**
  Admitted by the maintainers; `LazyMotion` + `m` is the documented
  workaround ([motion.dev/docs/react-reduce-bundle-size](https://motion.dev/docs/react-reduce-bundle-size)).
- **Framer Motion is React-only.** The team's own answer is Motion
  One — a *second* library that's framework-agnostic. The existence
  of Motion One is the proof that the React-coupled API didn't port
  ([motion.dev — Framer Motion or Motion One](https://motion.dev/blog/should-i-use-framer-motion-or-motion-one)).
- **`layoutId` / FLIP measures every render** unless the consumer
  manually plumbs a `layoutDependency` prop ([framer/motion docs](https://www.framer.com/motion/component/)).
- **GSAP is now Webflow-licensed**, not OSS — and it's structurally
  hostile to signals (strict-mode double-mount produces duplicate
  tweens) ([gsap.com/pricing](https://gsap.com/pricing/)).
- **Two parallel APIs for the same job** — Framer's imperative
  `useAnimationControls` exists alongside the declarative `animate`
  prop because neither covers the full surface ([danielberndt.net](https://www.danielberndt.net/2022/framer-motion-vs-react-spring/)).

The pattern across these is the same: animation libraries reinvent
"a value that changes over time, with observers" — which the
framework's reactivity system already is. Building motion as a separate
runtime on top of reactivity (motion has its own controllers, its own
scheduler, its own concept of "current value") doubles the cost we
already paid in `systems/reactivity/`.

## Options considered

1. **Top-level `@place-ts/motion` package.** Most isolated; biggest
   surface for future expansion (gesture, drag, scroll-linked). Cost:
   a 10th system on the platform map, ADR justifying separation, extra
   coordination boundary. Risk: drift between motion's clock and
   reactivity's tick semantics — the exact failure mode the charter's
   "one graph" commitment forbids.

2. **`@place-ts/component/motion` sub-module.** The map's parenthetical
   ("may get a DSL later in component-system"). Couples motion to the
   render lifecycle. Wrong layer: motion isn't about rendering, it's
   about interpolating values over time. Components consume the
   result; they don't own it.

3. **`@place-ts/reactivity/motion` sub-module** *(chosen).* Motion IS
   derived state over a time signal. Reactivity already owns time
   (the scheduler's tick), derivation (the dependency graph), and
   subscription (`watch` / `derived`). A motion primitive is one
   function returning a `Derived<T>` whose value tracks a target via
   a solver. The framework reads it through the same `() => value`
   reactive-prop contract every other signal uses. Tree-shake floor:
   only the primitives you import.

## Decision

Option 3. Motion lives at `systems/reactivity/src/motion/`, sub-exported
as `@place-ts/reactivity/motion`. It does not become a 10th system on the
platform map.

### Public surface

```ts
import { animate, tween, sequence, curve, clock } from '@place-ts/reactivity/motion'

// Spring-driven derived state. `target` is a signal; the result tracks
// it through a spring solver.
animate(
  target: () => number,
  opts?: { spring?: SpringPreset | SpringParams; clock?: () => number }
): Derived<number>

// Tween: explicit duration + easing.
tween(
  target: () => number,
  opts?: { duration: number; easing?: EasingFn | EasingPreset }
): Derived<number>

// Sequence: chained keyframes over time.
sequence(
  keyframes: Array<{ at: number; value: number; easing?: EasingFn }>,
  opts?: { clock?: () => number }
): Derived<number>

// Curve: arbitrary signal→signal smoothing (no time axis).
curve(
  source: () => number,
  curve: (raw: number) => number
): Derived<number>

// The default clock signal — driven by requestAnimationFrame on the
// client; frozen at 0 on the server (animations resolve to their rest
// position for SSR — zero animation frames consumed at render time).
const clock: Derived<number>
```

Spring presets: `'gentle' | 'wobbly' | 'stiff' | 'molasses' | 'snap'`.
Raw spring params: `{ mass, tension, friction, precision? }`.
Easing presets: standard CSS easings + `cubic-bezier(...)` literals.

### Implementation invariants

- **One clock per app.** The default `clock` derivation drives every
  animation. Test contexts can pass an explicit `opts.clock` for
  deterministic property tests.
- **Build-time DCE on the server.** The `requestAnimationFrame` driver
  is gated on `__PLACE_BROWSER__`; on the server, every motion
  primitive returns the rest value (the target) synchronously.
- **No `<Motion>` component runtime.** Any element that accepts a
  reactive prop (`style:transform={() => …}`, `width={() => …}`) can
  consume an animated signal. No parallel component tree.
- **No internal scheduler.** Animations are `derived()` subscribers
  to the clock signal — they run inside the framework's existing
  reactive scheduler. No second tick loop.

## Consequences

### User-visible

- Importing `animate` and reading its result is the entire API.
  ```tsx
  const x = animate(() => target(), { spring: 'gentle' })
  <div style:transform={() => `translateX(${x()}px)`} />
  ```
- Tree-shake floor: a few hundred bytes for the spring solver +
  whatever primitives are imported. No `LazyMotion` workaround.
- Works in any context that runs `@place-ts/reactivity` — Bun runtime,
  browser, web worker (theoretically). No React lock-in because there's
  no React at all.
- Server-side renders produce the rest (target) value with zero
  animation frames consumed.

### Architectural

- The system map keeps 9 top-level systems; the line about animation
  composing from time + reactivity becomes literal.
- The component system stays unchanged. It already reads `() => value`
  reactive props; it doesn't know whether the function is an animation
  or a plain state.
- The design library (ADR 0016) consumes motion the same way an app
  does — `import { animate } from '@place-ts/reactivity/motion'`.

### Trade-offs

- The motion sub-module is sub-exported, so the reactivity package's
  surface gains a new public export path. Apps that don't use motion
  don't pay for it (tree-shaken). Documented in the reactivity
  charter.
- Future expansion (gesture, drag, scroll-linked) might warrant a
  separate package if the surface grows past what fits naturally in
  reactivity. Trigger: when the motion sub-module exceeds ~1500 LOC
  or grows non-time-axis primitives (drag, hit-testing). Until then,
  the sub-module shape wins on coupling.

## Out of scope

- Layout animations (FLIP). For cross-document navigation we use the
  View Transitions API (ADR 0006). For in-DOM moves, the `keyed()`
  helper (already shipped) reorders nodes; a future "layout-aware"
  primitive can subscribe to the same key change to drive a FLIP
  measure, but only when triggered.
- Gesture / drag. Composes from `state` + pointer event subscribers;
  not in the initial sub-module.
- 3D animations. Different problem space (Three.js wrap or hand-rolled
  WebGL). See ADR 0017 for the canvas system that would precede it.

## Notes

- The named spring presets borrow tuning from Motion One
  (`@motionone/spring`), the battle-tested 4KB animation library that
  the same Framer team built specifically because their Framer Motion
  API couldn't ship without 34KB of weight. Their tuning is settled
  prior art we can adopt without re-deriving the constants.
- The choice to put motion under reactivity rather than component
  matches Solid's approach (signals are the unit of reactivity AND
  animation), explicitly differs from React's (where animation is a
  separate runtime).
