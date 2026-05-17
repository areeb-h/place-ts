# ADR 0008: Port the insight, not the shape

**Status:** accepted
**Date:** 2026-05-12
**Affects:** `@place/component`'s primitives (`virtualList`, future `useDialog`, `table`, `form`, `three`)

## Context

The React ecosystem has solved many real problems — list virtualization (TanStack Virtual), accessible primitives (Radix, React Aria), forms (TanStack Form), 3D scene graphs (R3F), tables (TanStack Table). The temptation when one of those capabilities is missing in place-ts is to "port" the library.

But porting a React-shaped library drags React's design constraints along with the actual insight:

- **Hook idioms** (`useVirtualizer`, `useForm`) assume a render-cycle that doesn't exist here.
- **Tuple returns** (`[state, setState]`, `[v, ...rest] = useField`) are closure-positional ceremony that solves React's "this returns from a hook called during render" problem we don't have.
- **`useEffect` lifecycle bindings** assume effects-after-commit semantics that don't map to our `watch` / `onCleanup` model.
- **Render-prop patterns** (TanStack Table's `flexRender`, Radix's `asChild`) work around React's component-vs-element distinction we never created.
- **Portal abstractions** (React's `createPortal`) work around React's render-tree assumption; we mount directly to the DOM.
- **Context providers** (`createContext`/`Provider`) are workarounds for React's prop-drilling; we have capability scopes.

Carrying any of these into place-ts means importing React-shaped failure modes we deliberately avoided.

## Decision

When we adopt a capability from a React-shaped library, we **identify the insight and ship it in our primitives**. We do not carry the API surface, the lifecycle model, or the render-prop ceremony.

For each candidate port, we document:

1. **The insight** — the algorithm, the API mental model, the edge cases the library has already learned (years of bug reports + a11y refinement + cross-browser nuance).
2. **The baggage to drop** — the React-shape API surface that exists because React works the way it does, not because the capability requires it.
3. **The native shape** — the API that uses our reactive primitives idiomatically.

This is not "rewrite from scratch ignoring prior art." The prior art is the *insight*. Reading the source, understanding the math + edge cases + a11y considerations is the work. The output is a place-ts-shaped API.

## Worked example: `virtualList`

[systems/component/src/virtual-list.ts](../../systems/component/src/virtual-list.ts) — the first worked application of this doctrine.

### Insight kept

- Measure + overscan + visibility-window math (decades of bug reports on `react-window` and `@tanstack/virtual` informed this).
- The trade-off between estimated and measured sizes — estimate for initial render, measure dynamically for accuracy.
- `scrollToIndex` with `align: 'start' | 'center' | 'end' | 'auto'` covers the 95% case learned across implementations.
- `overscan` as the tunable knob between "smooth fast scrolls" and "fewer off-screen nodes" — same default of 5.
- `initialViewport` for SSR — the windowing has to render *something* server-side.

### Baggage dropped

| React-shape (TanStack Virtual) | Why we don't carry it | Our shape |
|---|---|---|
| `const v = useVirtualizer({...})` hook | Hook idiom requires render cycle | `const list = virtualList({...})` plain function returns reactive primitive |
| `v.getVirtualItems()` method returning the snapshot | Snapshot-on-call is React's "render returned a value" assumption | `list.visible()` reactive getter — tracks for re-derivation under `derived`/`watch`/`keyed` |
| `useVirtualizer` inside a function-component body | Lifecycle binding | Constructed once per view; `onCleanup` registers tear-down |
| `measureElement: (el) => void` ref-shaped callback | React refs | Plain `(index, el) => void`; pair with our `ref` prop |
| `getTotalSize()` named to differentiate from React's `useState`-shaped `total` | React's "is this a hook?" distinction | `totalSize()` — same as `visible()`, no naming ceremony |
| `useEffect(() => { observer.observe(el); return () => observer.disconnect() }, [el])` | Effect cycle | Plain `ResizeObserver` attached on `containerRef`; cleanup in `onCleanup` |

### Net result

`virtualList` is ~250 LOC. The TanStack Virtual core is ~1500 LOC (the React adapter on top is more). The shrinkage isn't because we did less work — it's because we didn't carry the React-shaped scaffolding (hooks, effects, snapshot machinery, ref forwarding).

## Per-future-port: insight kept + baggage dropped

The doctrine applies as we adopt more capabilities. Pre-record the analysis here so the temptation to "just port it" is bounded:

### `useDialog` (Radix / Aria primitives)

**Insight kept:**
- Focus trap implementation (years of edge-case work: nested traps, dynamic focusable lists, iframes).
- Keyboard wiring (Tab cycle, Escape to close, arrow keys for menus).
- ARIA attribute application (`aria-labelledby`, `aria-describedby`, `role="dialog"`).
- Click-outside detection.
- Composable parts (a dialog has trigger + content + title + description).

**Baggage to drop:**
- `Portal` abstraction (we render to DOM directly).
- `useContext` for prop sharing between parts (we use closure + capability scopes).
- `forwardRef` boilerplate.
- `asChild` slot pattern (a React-ism workaround for component-vs-element; we don't have the distinction).
- `Root` / `Trigger` / `Content` component split (a React-context pattern; we use one factory function returning an object of helpers).

**Native shape (sketch):**

```ts
const dialog = useDialog({ defaultOpen: false })
view: () => (
  <>
    <button onClick={dialog.open}>Open</button>
    {() => dialog.isOpen() && (
      <div role="dialog" {...dialog.contentProps()}>
        <h2 {...dialog.titleProps()}>Confirm</h2>
        <button onClick={dialog.close}>Cancel</button>
      </div>
    )}
  </>
)
```

One hook. No Root/Trigger/Content split.

### `table` (TanStack Table)

**Insight kept:**
- Headless: separates "what" (columns, data) from "how" (markup, CSS).
- State for sort/filter/group/pagination is one serializable object — URL-friendly.
- Column definitions as data (composable, mergeable).
- Years of edge-case handling for grouped rows, expanded subrows, virtualization integration.

**Baggage to drop:**
- `useReactTable` hook idiom.
- `flexRender` (a React render-prop workaround for component-vs-element).
- Model imports as opt-in dependency injection (`getCoreRowModel`, `getSortedRowModel`, etc. — a React-era DI pattern).

**Native shape (sketch):**

```ts
const t = table({
  columns: [column('title', { header: 'Title', sort: true })],
  data: () => posts,         // reactive
  state: search,             // bound to URL via search: shape()
})
view: () => (
  <table>
    <thead>{t.headers(h => <th onClick={h.toggleSort}>{h.label}</th>)}</thead>
    <tbody>{t.rows(r => <tr>{r.cells(c => <td>{c.value}</td>)}</tr>)}</tbody>
  </table>
)
```

Sort/filter state lives in the same `search: shape()` from Round 5.

### `form` (TanStack Form)

**Insight kept:**
- Field-level validation with async refinement support.
- Standard Schema integration (Zod, Valibot, ArkType).
- Independent field state — touching one field doesn't re-render others.

**Baggage to drop:**
- `useForm` / `useField` hook idioms.
- `<Field>` component with render-prop child (works around React's re-render model).

**Native shape (sketch):**

```ts
const f = form({
  defaultValues: { email: '', age: 0 },
  validate: shape({ email: 'string', age: 'number' }),
  onSubmit: async ({ values }) => postPage.create(values),
})
view: () => (
  <form onSubmit={f.submit}>
    <input {...f.field('email')} />
    {() => f.errors().email && <p>{f.errors().email}</p>}
    <button disabled={() => f.submitting()}>Save</button>
  </form>
)
```

### `three` (R3F-inspired)

**Insight kept:**
- JSX as scene-graph description (declarative reads better than imperative `scene.add(mesh)`).
- Auto-disposal of geometries/materials when removed.
- Inheritance of transform contexts via JSX parent-child.

**Baggage to drop:**
- The reconciler. R3F's VDOM-to-scene-graph diffing exists because React re-renders. We never re-render.
- `useFrame` hook for animation (we have `watch()` + scheduler).
- `useThree` for root-state access (we have capabilities).
- Suspense-coupling to React's specific Suspense semantics.

**Native shape (sketch):**

```ts
view: () => (
  <three.canvas>
    <three.perspectiveCamera position={[0, 0, 5]} />
    <three.mesh position={() => [Math.sin(time()), 0, 0]}>
      <three.boxGeometry args={[1, 1, 1]} />
    </three.mesh>
  </three.canvas>
)
```

`time()` is a reactive signal driven by `requestAnimationFrame`. The `position` watch updates `mesh.position.set()` directly. No diff, no reconciler. Smaller than R3F (~1200 LOC vs ~5000) because we skip the diff layer entirely.

## Consequences

### Positive

- **Smaller LOC per capability** — we ship the math, not the scaffolding.
- **No hook-shape leakage** — apps using place-ts never write `useX` calls; the framework's mental model stays consistent.
- **The reactivity primitive does the diffing** — virtualList's `visible()` is a derived state; `keyed()` reconciles the list. The user wires them together; the framework doesn't need a separate "make this list virtualizable" abstraction.
- **Test surface is smaller** — math is testable directly without DOM mocking; only the lifecycle wiring needs DOM fakes.

### Negative

- **More implementation work per capability** than `npm install @tanstack/virtual + paste the example`. Each port is a focused engineering project (~hours, not minutes).
- **No shared maintenance with the upstream library** — when TanStack Virtual fixes a bug, we have to read the fix and decide if our shape has the same issue. Mitigated by having well-tested native code; the relationship is "reference, not dependency."
- **Onboarding cost** — developers familiar with React-shape libraries have to relearn the API. The reactive shape is simpler in absolute terms but unfamiliar.

### Required infrastructure

- The reactivity primitives must be expressive enough to model the capability without escape hatches. So far they have been; `virtualList` is built entirely from `state`, `derived`, `onCleanup`, plus a couple of imperative methods (`scrollToOffset`, `measureElement`).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Build a React-shim layer (`useState` → signal pair, `useEffect` → watch, etc.) | Lifecycle semantics don't map; React API stability tax; SolidJS tried `solid-react` with limited success |
| Use TanStack Virtual via its `*-core` package + write a thin adapter | The core still encodes React-shaped assumptions in its lifecycle (e.g. when measurement happens relative to render). Cleaner to read the math + write our own. |
| Skip these capabilities entirely | Some capabilities (virtualization, modals, dialogs) are genuinely needed in real apps. Skipping them blocks workloads. |
| Port the library and live with the React-shape API in place-ts | Imports the failure modes we deliberately rejected (hook idioms, render-cycle assumptions); inconsistent with the rest of the framework's API surface. |

## How to apply this in future work

When a future workload triggers another port:

1. **Read the upstream source.** Understand the algorithm + edge cases + a11y nuance. Bookmark the issue tracker for bugs that informed the design.
2. **List the insight vs baggage.** Write the entry in this ADR (or a sibling) before writing code.
3. **Sketch the native shape.** What does the API look like with our primitives?
4. **Write tests for the insight.** Math tests first, lifecycle tests second.
5. **Implement.** Stay reactive-first; if a method-on-a-tuple feels right, you've imported the hook shape.

The bar is "would a developer reading this code think it's a React library wrapped or a place-ts primitive?" If the former, refactor until the latter.
