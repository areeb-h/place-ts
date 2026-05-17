# Sandbox

A live in-browser playground for the reactivity system. Hot-reloads as the source evolves.

## Run

```sh
bun run dev          # from project root → http://localhost:5173
```

## What this is

A demonstration harness. Each example mounts a reactive graph and binds it to imperative DOM. The bindings live in [src/lib/dom.ts](src/lib/dom.ts) and earn no architectural commitment — see [systems/component/docs/01-rendering-anti-patterns.md](../../systems/component/docs/01-rendering-anti-patterns.md) for what the real rendering model will need to address (no virtual DOM, no JSX magic, no separate hydration phase).

## What this is not

- Not the component system. The component system is Phase 2+.
- Not a recommendation for how to structure place applications. v0.1 has no opinion on application structure beyond "the reactivity primitives compose."
- Not a replacement for the property tests. Demos show reactivity working visibly; correctness claims live in `systems/reactivity/tests/`.

## Layout

```
src/
├── main.tsx              entry point — mounts the App
├── styles.css            Tailwind v4 imports + theme overrides
├── components/           layout primitives (used by the sandbox itself)
│   ├── Layout.tsx        page shell, header, footer
│   ├── ExampleCard.tsx   per-example card with phase tag, title, description
│   ├── PhaseTag.tsx      coloured pill for Phase 1/2/3
│   └── Button.tsx        consistent button styling (variant: default | accent | subtle)
└── examples/             one demo per file
    ├── 01-counter.tsx        — sync core
    ├── 02-temperature.tsx    — derived chain
    ├── 03-diamond.tsx        — diamond convergence (glitch-freedom visible)
    ├── 04-dynamic.tsx        — dynamic dependency tracking
    ├── 05-derivable.tsx      — Phase 2: derivable state with revert policy
    └── 06-batching.tsx       — Phase 3: batch + flush + defer
```

## Stack

- **Tailwind v4** via `@tailwindcss/vite` — utility-first styling, CSS-native theme via `@theme {}`.
- **JSX** via TypeScript's automatic runtime, pointed at `@place/component` (per [ADR 0002](../../docs/decisions/0002-jsx-shape-via-ts-automatic-runtime.md)). No Babel plugin.
- **Vite** for dev + build.

## Adding an example

1. Create `src/examples/NN-name.tsx` exporting a function that returns a `View` wrapped in `<ExampleCard>`.
2. Import it in [src/main.tsx](src/main.tsx) and add it to the JSX tree inside `<Layout>`.
3. Vite hot-reloads. The new demo appears.
