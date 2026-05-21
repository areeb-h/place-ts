# 02 — Component System Design

**Status:** direction document. Strong leans, named open questions, what *will* and *won't* land in v0.2. Companion to [01-rendering-anti-patterns.md](01-rendering-anti-patterns.md) — that doc says what we won't do; this one says what we will.

The component system is the rendering layer. It sits on top of the reactivity system, owns nothing about state, and produces DOM nodes that re-render at the leaves when sources change.

---

## Principles

1. **Components are functions from props to views.** A component runs *once*. It does not re-render on prop change — instead, prop reads inside the component body create reactive dependencies that update the leaves. This matches Solid's "component as constructor" model, and is the opposite of React's "component as render function."

2. **No virtual DOM.** Reactivity already knows what changed; rendering follows the reactive graph. No tree diffing, no allocations per render.

3. **JSX-shape via TypeScript's automatic runtime, pointed at our factories.** Per [ADR 0002](../../../docs/decisions/0002-jsx-shape-via-ts-automatic-runtime.md). Authors write `<div>{count.read}</div>`; TypeScript emits `jsx(div, { children: count.read })` where `div` is our factory. No Babel plugin, no third-party rewriter — TypeScript's native emission keeps the transform visible. The factories work standalone for non-JSX users.

4. **No template DSL.** No `v-bind`, no `{#if}`, no special filename extensions. Components live in regular `.ts` files; templates compose via TypeScript expressions.

5. **No hydration phase.** The reactive graph is serialized server-side (Phase 6 of reactivity); the client restores the graph, attaches to existing DOM, and the leaves wire themselves through the same `watch`-driven binding the client-rendered case uses. No mismatch detection needed because there's no second render pass.

6. **Children are values, not children-as-prop magic.** If a component takes children, it takes them as a regular prop typed `View | View[]`. Slots are properties.

7. **No implicit context globals.** Anything ambient (current locale, current user, theme) is delivered via the capability system's scopes, not via a `useContext` reaching into a hidden global.

---

## The shape

```ts
// Public API (provisional)

export type View = {
  readonly mount: (parent: ParentNode, anchor?: Node | null) => Disposer
}

export type Component<P = {}> = (props: P) => View

export function component<P>(fn: Component<P>): Component<P>

export function mount(view: View, parent: ParentNode): Disposer
```

A component is just a function. `component(fn)` is an optional wrapper that adds dev-time invariant checking; the bare function works too.

A `View` is the smallest possible interface: "I know how to attach myself to a DOM node and return a disposer that tears me down." Everything else (DOM identity, child management, prop reactivity) is internal.

---

## Markup: element factories

The leading proposal. Element factories return `View`s. Reactive bindings are first-class.

```ts
import { div, span, button } from '@place-ts/component/dom'
import { state } from '@place-ts/reactivity'

function Counter(props: { initial: number }) {
  const count = state(props.initial)
  return div({ class: 'counter' },
    span({}, () => `count: ${count.read()}`),
    button({ onClick: () => count.write(c => c + 1) }, '+1'),
  )
}

mount(Counter({ initial: 0 }), document.body)
```

The function form `() => count.read()` is the bind hook — the runtime wraps it in a `watch` that updates the DOM text/attribute when sources change. Static values (strings, numbers, plain objects) bind once and never re-bind.

### Why factories are the *runtime*, JSX is the *facade*

Both work. Per ADR 0002, factories are the runtime; JSX is a thin facade emitting factory calls via TypeScript's automatic runtime.

- **Type inference is direct in both.** `div(...)` and `<div>` resolve to the same factory; props typed against the element's attribute set.
- **The factories work without JSX.** Non-JSX consumers import factories directly. JSX consumers add `jsxImportSource` to `tsconfig.json`.
- **No third-party rewriter.** TypeScript itself emits the `jsx(...)` calls. Source maps stock. No Babel plugin. Author intent is preserved.
- **Composability is trivial.** Components are functions returning `View`. Whether you call them via `<MyComp prop={x} />` or `MyComp({ prop: x })` is taste.

### Tagged-template Plan B (deferred)

If JSX-via-TS-runtime turns out to fight our factory return type in some way we don't currently see (the only realistic risk per the Researcher's findings), the fallback is HTM-style tagged templates as a *facade* over the same factories. The factories always work standalone; the tagged-template layer would be decorative. We would *not* fall back to a custom Babel/SWC plugin.

---

## Reactive bindings

Inside a factory, three kinds of values bind differently:

```ts
div({
  // Static: bound once at construction
  class: 'static-class',
  // Reactive: rebound when sources change
  'data-status': () => status.read(),
  // Event: regular DOM event handler
  onClick: (e) => handleClick(e),
})
```

Children follow the same pattern:

```ts
div({},
  // Static text
  'hello',
  // Reactive text — rebound to a string on source change
  () => `count: ${count.read()}`,
  // Static view
  Counter({ initial: 0 }),
  // Reactive view — swaps subtree on source change
  () => loggedIn.read() ? UserMenu({}) : LoginButton({}),
)
```

The function-as-child form is how conditionals work. There is no `<Show>` primitive; the ternary is the primitive. The runtime detects the function form, mounts the returned view, watches the function for changes, swaps on update.

### Lists

Naive `items.map(item => Row(item))` re-mounts the entire list on any change. We need a keyed primitive.

```ts
import { keyed } from '@place-ts/component'

div({},
  keyed(
    () => notes.read(),       // reactive source of items
    note => note.id,          // key extractor
    note => Row({ note }),    // per-item render
  ),
)
```

`keyed` is the explicit list primitive. It uses the keys to reuse mounted views across array updates. Items added → mount; removed → dispose; reordered → reorder DOM. No `<For>`-as-component magic; just a function returning a `View`.

Open question: do we need a non-keyed `each` for cases where identity doesn't matter? Probably not — keys are cheap to provide and the alternative is "all items remount on every list change," which is the wrong default.

---

## Mount and disposal

```ts
const view = Counter({ initial: 0 })
const dispose = mount(view, document.getElementById('app')!)

// Later
dispose()  // tears down all watches, removes DOM, releases captures
```

A view's `mount` returns a disposer. Mounting is O(n) in the size of the rendered tree; disposal walks the watch dependency tree and tears down subscriptions in reverse order.

A component that needs custom cleanup (timers, subscriptions, IO) registers it via:

```ts
import { onCleanup } from '@place-ts/component'

function StreamingCounter() {
  const count = state(0)
  const id = setInterval(() => count.write(c => c + 1), 1000)
  onCleanup(() => clearInterval(id))
  // ...
}
```

`onCleanup` is component-scoped; it registers a callback to run when the enclosing view is disposed.

---

## Children as a typed prop

```ts
type CardProps = {
  title: string
  children: View | View[]
}

function Card(props: CardProps) {
  return div({ class: 'card' },
    h2({}, props.title),
    div({ class: 'card-body' }, props.children),
  )
}

Card({
  title: 'Hello',
  children: [
    p({}, 'paragraph one'),
    p({}, 'paragraph two'),
  ],
})
```

No special-cased `<slot>` syntax. Children are values passed as a prop. Multiple slots are multiple props.

---

## What's reactive, what isn't

- **Component bodies run once.** Reading a state in the body creates a one-time dependency for the LEAF that uses it, not for the body itself.
- **Props are values.** If a parent wants the child to re-react to a prop, the parent passes a getter: `child({ value: () => state.read() })` — the getter creates the reactive binding.
- **Effects in components run via `watch`.** No separate component-lifecycle hooks for "after mount" — a `watch` inside a component body runs at mount time and disposes at unmount time. The runtime handles that mapping.

---

## Hydration: graph serialization, not rerender

The platform position: we will not have a separate "hydration" code path. Instead:

1. **Server side:** render the component, capture the resulting reactive graph + DOM as serialized output.
2. **Client side:** deserialize the graph (Phase 6 of reactivity), attach watch bindings to the existing DOM, never re-render the leaves that already match.

This is Qwik-style resumability without Qwik's specific architecture. It depends on Phase 6 of reactivity (graph serialization) and Phase 7+ of the build system (closure-hash identity for `watch` callbacks).

Until those land, the component system is client-only at v0.2. SSR is a v0.4+ concern.

---

## Open questions

These are the design holes in this doc. Each gets answered before its corresponding phase ships.

1. **Refs.** How does a component expose an imperative handle to its DOM? Lean: a regular prop that takes a callback `ref?: (el: HTMLElement) => void`, called once at mount. No `useRef`-shaped thing.
2. **Animations and transitions.** Reactivity Phase 5's time-forking is the substrate, but the component-level API (FLIP, enter/exit) is open.
3. **Error boundaries.** A component throws during construction or during a watch run — what catches it? Lean: typed effects (`Throws<E>`) plus a `boundary` component, but the design follows Phase 4 of reactivity.
4. **Streaming SSR.** Suspense-style progressive rendering. Probably falls out of time-forking + graph serialization, but the API surface is open.
5. **Component-level keying for HMR.** Without a stable component identity, HMR has to guess what to preserve. The build system needs to assign component identity, similar to closure hashing.
6. **Web component interop.** Mount a place view inside a custom element; mount a custom element inside a place view. Doable both ways; the contract is open.

---

## What ships in v0.2

- `View` type and `mount()` function.
- Element factories for the standard HTML element set.
- Function-form bindings for attributes, children, and text.
- `jsx-runtime.ts` and `jsx-dev-runtime.ts` — TS automatic JSX runtime support, mapping JSX to the factories. Per ADR 0002.
- `keyed(...)` list primitive.
- `onCleanup(...)` for component-scoped cleanup.
- A migration of the sandbox to use this surface (replacing `dom.ts`).

What does NOT ship at v0.2:

- Babel/SWC JSX plugin (rejected by ADR 0002 — TS automatic runtime is sufficient).
- Template-cloning optimization (Solid's perf trick — deferred to a future ADR after Phase 6 reactivity).
- Tagged-template facade (Plan B; only built if Plan A fights the type system).
- SSR / hydration (depends on reactivity Phase 6 + build).
- Animations / transitions.
- Error boundaries (depends on reactivity Phase 4).
- Web component interop (later).

---

## Why this is enough

A component system that owns rendering, lifecycle, and binding is enough for the commonplace book reference design. Notes are components. Lists are `keyed`. Forms are factories. Search results are reactive children. Routing (v0.3) sits on top.

The shape is honest about its dependencies: reactivity Phase 1-3 ships, component v0.2 ships on top, the rest follows. We don't need a six-system co-design effort to draft this. The component system is *additive*.

The next artefact for this system, when v0.2 begins, is the first implementation file: `systems/component/src/index.ts` exporting `View`, `mount`, and `component`. Plus a corresponding test file. The sandbox migration follows.
