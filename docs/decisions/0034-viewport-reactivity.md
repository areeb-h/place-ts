# ADR 0034: `viewport` — framework-level reactive screen-size primitive

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/component/src/viewport.ts` (new); `systems/component/src/__viewport-runtime.ts` (new); `systems/component/src/index.ts` (export + emission in `renderPage`); `examples/docs/src/islands/viewport-demo.tsx` (new); `examples/docs/src/pages/concepts/reactivity.page.tsx` (demo wiring).

## Context

The framework previously had no first-class viewport primitive. Components that needed "is this mobile?" wrote their own `matchMedia` / `ResizeObserver` wiring per-component. Survey of the codebase (2026-05-16):

- `systems/component/src/virtual-list.ts:244–249` — one `ResizeObserver` per virtual-list instance
- `systems/component/src/__early.ts:49` — one-shot `matchMedia('(prefers-reduced-motion)')` on initial paint
- No other viewport-tracking code anywhere

Apps wanting a "render the mobile drawer below md, sidebar above" pattern had two choices:
1. Pure CSS via Tailwind responsive utilities — works for visual differences but can't pivot rendering
2. Roll their own — duplicate matchMedia listeners, lifecycle wiring, reactive state cells across every component that cared

## Decision

Ship one framework-level primitive: a reactive `viewport` namespace exported from `@place-ts/component`. Components subscribe; the framework owns the listener.

### Public API

```ts
import { viewport, configureViewport } from '@place-ts/component'

viewport.width()                  // Derived<number>
viewport.height()                 // Derived<number>
viewport.breakpoint()             // Derived<'sm'|'md'|'lg'|'xl'|'2xl'>
viewport.prefersReducedMotion()   // Derived<boolean>
viewport.prefersDark()            // Derived<boolean>
viewport.matches(query)           // (query: string) => Derived<boolean>

configureViewport({ breakpoints: { sm: 640, ... }, defaultBreakpoint: 'sm' })
```

### Architecture

- **Module-level state cells** (`_vw`, `_vh`, `_rm`, `_dark`) hold the latest values.
- **Derived accessors** on the public `viewport` object subscribe to those cells, so any reactive context that calls `viewport.breakpoint()` re-runs when the cell changes.
- **One inline runtime** (`placeViewport()` in `__viewport-runtime.ts`) is emitted once per page (alongside `placeHmr`, `placeSpaNav`, `placeTabs`, etc.). The runtime:
  - Reads initial `window.innerWidth/innerHeight` + `(prefers-*)` media-query state into a global bucket `window.__placeViewportState`
  - Listens to `resize` (rAF-throttled) + `(prefers-*)` matchMedia change events
  - Dispatches `place:viewport` CustomEvent with the fresh values
- **The `viewport` module** listens for that event at module scope and writes into the state cells.

### SSR contract (mobile-first)

Per user decision (AskUserQuestion, 2026-05-16): SSR resolves `viewport.breakpoint()` to the configured `defaultBreakpoint` (default: `'sm'`). After hydration the client runtime fires the first `place:viewport` event with real values; subscribed components re-evaluate.

**Trade-off**: a component that pivots rendering on breakpoint (e.g. `viewport.breakpoint() === 'sm' ? <Drawer /> : <Sidebar />`) may briefly flash from mobile shape to desktop shape on first hydrate. This is intentional and documented — Tailwind `sm:/md:/lg:` utilities remain the right tool for **stylistic** responsiveness (zero flash; CSS-media-query-based).

### What's NOT done

- **Client hints** (`Sec-CH-Viewport-Width`): rejected. Adds round-trip latency, browser support varies, header surface area increases. Tailwind covers the no-flash stylistic case; the mobile-first default covers the behavioural case.
- **Container queries**: separate primitive (an element's size affects its own layout). Less universal than viewport; future work.

## Verification

- 7 unit tests in `systems/component/tests/unit/viewport.test.ts` cover: initial/SSR values; breakpoint cascade across the Tailwind ladder; `matches()` SSR-safety; `configureViewport` reshaping; `prefersReducedMotion` + `prefersDark` propagation through dispatched events.
- Live docs site demo at `/concepts/reactivity` — readout reactively updates on resize.
- Live curl confirms `__placeViewport` runtime is emitted on every islands-mode page.

## Why this passes the "magic with clarity" (ADR 0026) bar

- **Discoverable in source**: every consumer writes a literal `viewport.breakpoint()` call; type system tells them what comes back. The runtime is a named `placeViewport()` function, not invisible glue.
- **Traceable in tooling**: `window.__placeViewportState` bucket is observable in devtools. The `place:viewport` CustomEvent shows up in event listeners panels.
- **Faithful to performance**: ~350 bytes raw inline runtime; rAF-throttled resize handler coalesces drag events; no per-component matchMedia duplication.
