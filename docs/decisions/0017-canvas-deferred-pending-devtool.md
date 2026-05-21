# ADR 0017: Canvas / scene-graph system deferred until devtool trigger

**Status:** accepted
**Date:** 2026-05-13
**Affects:** new directory `systems/canvas/docs/` (charter only, no
implementation this session); implementation gated on the reactive
graph devtool work landing.

## Context

The platform charter clause 3 says "the graph is observable" — a
non-negotiable. The devtool that surfaces the reactive graph is one of
the planned Tier 4 deliverables and a real candidate for needing a
2D canvas/scene-graph runtime to render node-edge graphs at scale.

A research pass this session surfaced the dominant prior art's failure
modes:

- **React Three Fiber cannot SSR.** The documented integration is
  `dynamic(import('R3F'), { ssr: false })`; R3F v8 is also incompatible
  with React 19. The canvas runtime is forced into a parallel
  client-only universe ([r3f docs](https://r3f.docs.pmnd.rs/getting-started/installation),
  [vercel/next.js #71836](https://github.com/vercel/next.js/issues/71836)).
- **R3F bundles Three.js into a >500KB chunk by default.** The "fix" is
  manual `manualChunks` configuration — the canvas system leaks
  bundler concerns upward ([R3F project guide](https://medium.com/@heyulei/create-a-react-three-fiber-project-beb0696391cb)).
- **Pixi-React, react-konva treat canvas state as separate from app
  state.** The canonical pattern is "render Pixi outside React, mount
  in `componentDidMount`, hold a ref" — two state spaces bridged by
  user discipline ([Pixi React patterns](https://medium.com/@mikkanthrope/react-with-pixijs-c8fc4c50facd),
  [konvajs.org React](https://konvajs.org/docs/react/index.html)).
- **DOM-to-canvas event routing requires parallel trees** ([pmndrs/react-three-next](https://github.com/pmndrs/react-three-next)).
  Picking, focus, and hit-testing don't compose with the host's event
  model.

The platform's "one graph" commitment makes all four of those failure
modes structural — we can't ship a canvas system that repeats them.
At the same time, no real consumer needs a canvas surface today:

- The docs site uses DOM-rendered SVG for the reactivity demo's edges
  (which works fine, since the scene is tiny).
- The commonplace example uses DOM throughout.
- The roadmap uses DOM + Tailwind.
- The reactive graph devtool (the genuine candidate) hasn't started.

Per anti-bloat, we don't ship infrastructure without a triggering
workload. But we DO want the design settled before the trigger fires —
the canvas system would be the 10th system on the map, a charter-level
change. Doing the design upfront means we know it's coherent before we
commit; it also means the devtool work doesn't have to do its own
exploration.

## Decision

Defer canvas implementation. Land the canvas system's charter doc
this session (at `systems/canvas/docs/00-charter.md`). The charter
declares the system's thesis, scope, non-goals, and the anti-pattern
list. Implementation starts ONLY when:

- The reactive graph devtool work begins, OR
- A real workload demands canvas rendering that DOM can't serve (and
  the workload is documented as the trigger in this ADR's "consequences"
  section update).

### Charter outline (full doc at `systems/canvas/docs/00-charter.md`)

**Thesis:** a canvas surface is a render target for a reactive scene
graph. The same `state()` that drives DOM drives canvas nodes. SSR
emits an SVG fallback. DOM and canvas surfaces compose; hit-testing
and event routing are unified across both.

**Public surface (sketched):**

```tsx
import { Canvas, Rect, Circle, Path, Text, Group } from '@place-ts/canvas'

<Canvas width={400} height={300}>
  <Rect
    x={state(10)}
    y={state(20)}
    width={50}
    height={50}
    fill={tokens.colors.accent}
  />
  <Path d="M 10 10 L 100 100" stroke={tokens.colors.muted} />
</Canvas>
```

**Render contract:**

- The reconciler routes `<Canvas>` children through a CanvasRenderer
  instead of the DOM. Each primitive's reactive props
  (`x={state(...)}`) subscribe a single per-canvas watch that redraws
  on each frame.
- SSR emits an SVG of the same scene graph with `aria-*` attributes
  per primitive. First paint is real content; the canvas upgrade
  happens at hydrate.
- Promotes to WebGL when a complexity threshold is exceeded (>1000
  primitives, OR explicit `<Canvas mode="webgl">`).
- Event routing: a hit-tester registered on the canvas element walks
  the scene graph in z-order; events emit through the same per-element
  `onClick` etc. contract DOM uses.

### Anti-patterns explicitly avoided

| Mistake | Prior art | How we avoid |
|---|---|---|
| No SSR (`dynamic(…, { ssr: false })`) | R3F | SVG fallback at SSR; canvas upgrade at hydrate |
| >500KB bundle | R3F + Three.js | No Three.js dep; 2D only; primitives ~5-10KB |
| Two-state-space model | Pixi-React, react-konva | One reactive graph; `state()` drives canvas nodes |
| Parallel DOM + canvas trees | react-three-next | DOM and canvas compose; hit-tester unified |

## Consequences

### Now

- One charter doc lands at `systems/canvas/docs/00-charter.md`.
- This ADR locks in the deferral and the design intent.
- Future devtool work has a settled design to implement against.

### When the trigger fires

- New top-level system `@place-ts/canvas` joins the platform map (the
  10th system).
- The platform map gets an ADR-driven update (referencing this ADR's
  trigger condition).
- Implementation follows the design above; deviations require a new
  ADR.

### Trade-offs

- We commit to a design we won't validate with running code for some
  time. Risk: when implementation starts, the design might prove
  flawed and need revision. Mitigation: the design is anchored to
  documented prior-art failure modes, not speculation; the API surface
  is small enough that revision cost is bounded.
- Charter system count drift. If we later decide canvas IS part of
  another system (component? reactivity?), we revise this ADR rather
  than promote it.

## Out of scope (canvas system)

- **3D rendering.** Different system. Future tier, future ADR.
- **Pixi parity / Konva parity.** We do what the devtool needs; we
  expand by trigger.
- **Imperative APIs.** No `useRef + componentDidMount` ritual; the
  reactive scene graph IS the API.
- **Plugin systems for custom primitives.** Add primitives directly
  when a real workload demands them; no plugin contract until
  triggered.

## Notes

- This ADR shape (charter-now, code-later, triggered-on-X) is
  intentional. It lets us bank the design work without shipping
  unused infrastructure, while preserving the charter-level integrity
  ("we don't add infrastructure speculatively, but we don't get caught
  flat-footed when the trigger fires either").
- The charter system map currently has 9 systems. This ADR pre-commits
  to making canvas the 10th when implementation begins. The map update
  is a single-row edit at that point, not a structural revisit.
