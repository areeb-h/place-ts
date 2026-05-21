# ADR 0016: `@place-ts/design` is a package, not a 10th system

**Status:** accepted
**Date:** 2026-05-13
**Affects:** new directory `systems/design/`; charter at
`systems/design/docs/00-charter.md`; first primitive `Button.tsx`;
follow-up primitives in subsequent sessions. Migration of
`examples/docs/src/design-system.ts` recipes to the new package.

## Context

The platform needs a curated component library so apps don't have to
hand-roll Button, Dialog, Field, etc. every time. The dominant prior
art has documented failure modes that we want to NOT carry over.

A research pass this session catalogued the specifics:

- **shadcn's "copy = you own it" creates an unfixable update gap.**
  The CLI's `diff` / `migrate` commands explicitly don't handle the
  case where users have edited copied components; upstream fixes must
  be hand-merged. The Radix team left after the Modulz→WorkOS
  acquisition; the shadcn author now recommends Base UI for new
  projects ([shadcn-ui/ui #7170](https://github.com/shadcn-ui/ui/discussions/7170),
  [Mashuk Tamim — Radix's future](https://mashuktamim.medium.com/is-your-shadcn-ui-project-at-risk-a-deep-dive-into-radixs-future-91af267c4bec)).
- **Radix's `asChild` (Slot) is structurally untypeable and breaks
  under RSC.** `cloneElement` is "soft-deprecated"; Slot + `useId` is
  the dominant source of Next.js hydration errors. The maintainers
  closed the "alternatives to asChild" issue as "Not planned"
  ([radix-ui/primitives #3700](https://github.com/radix-ui/primitives/issues/3700),
  [zenn.dev composition critique](https://zenn.dev/tsuboi/articles/8abddb1ae3038f?locale=en)).
- **Runtime CSS-in-JS is now an admitted architectural error.** Mantine
  v7 ripped Emotion out for CSS Modules; Chakra v3 is publicly
  criticized for blocking RSC; MUI is migrating to zero-runtime
  extraction ([Chakra v3 future post](https://www.adebayosegun.com/blog/the-future-of-chakra-ui)).
- **`className` as the override channel is unsound; `tailwind-merge` is
  a 15KB patch over it** ([shadcn-ui/ui #2288](https://github.com/shadcn-ui/ui/discussions/2288)).
- **Style Dictionary / Tokens Studio require every consumer to install
  the build pipeline; transforms are bespoke** — the codegen friction
  the platform charter forbids ([style-dictionary](https://github.com/style-dictionary/style-dictionary)).
- **Tailwind v4 arbitrary-value escape hatch (`w-[102px]`) defeats
  tokenization;** the v4 compiler bypasses its CSS-variable layer for
  these ([tailwindlabs #18748](https://github.com/tailwindlabs/tailwindcss/discussions/18748)).

The platform map already takes a position
([docs/platform/00-system-map.md](../platform/00-system-map.md)):

> **CSS / styling system** — we don't ship a styling solution; the
> component system pipes Tailwind v4 through as a first-class option
> (`serve({ tailwind: true })`) and `page.styles` accepts arbitrary
> stylesheet sources.

So the design system is NOT one of the 9 systems. The 9 systems own
foundations (reactivity, build, capability, component, routing, data,
cache, persistence, search). A component library is curated content
ON TOP of those — opinionated choices, not a new contract.

## Options considered

1. **Promote design to a 10th system on the platform map.** Requires
   an ADR justifying that the design surface is a primitive contract
   rather than a curated library. Adds a charter clause. Cost: the
   map's coherence story ("nine systems") gets diluted; future
   "curated content" packages (animation, motion presets, etc.) would
   each want the same promotion.

2. **Keep design as `examples/docs/src/design-system.ts`** — recipes
   inside the docs example. This is the current state. Works for the
   docs site but doesn't ship a reusable library; every app
   re-implements Button, Dialog, etc.

3. **`/systems/design/` as a package** *(chosen).* Lives next to other
   system packages for directory consistency, but the charter
   declares it as a *curated library built on the existing systems*.
   It has a `package.json`, its own version, its own ADRs, its own
   tests. The platform map keeps 9 systems; the directory name is
   organizational, not a charter claim.

4. **`/packages/design/`** — outside `/systems/`. Cleaner separation
   ("packages are not systems"); but the project's existing convention
   is "everything in `/systems/`" and creating a new top-level
   directory adds cognitive load.

## Decision

Option 3. Build `@place-ts/design` as a package at `systems/design/`,
documented in its charter as NOT a top-level system on the platform map.

### Charter clauses (excerpt — full doc at `systems/design/docs/00-charter.md`)

**The library ships components as values.** No CLI, no codegen, no
"copy this file into your repo." Apps import:

```tsx
import { Button, Dialog, Field } from '@place-ts/design'
```

If an app wants to OWN the source of a primitive, they can fork the
file into their codebase — but that's an explicit choice, not the
default path.

**Composition via children + typed slots.** No `asChild` polymorphism;
no `cloneElement`. A primitive that needs to render INSIDE a parent
accepts the parent as a typed slot prop:

```tsx
<Field label="Name" input={<Input name="x" />} />
```

Multi-child primitives use named slots (`<Dialog.Header>`,
`<Dialog.Body>`, `<Dialog.Footer>` — exported as object properties on
the parent, type-narrowed at the boundary).

**Tokens flow through CSS variables.** Theme tokens live in
`themeTokens()` (already shipped) — they emit a `@theme` block + a
typed JS object via the `.tokens` field (added in this work). Library
components reference tokens through Tailwind utility classes that
read the `@theme` variables (`bg-accent`, `text-muted`, `rounded-lg`).
Apps can override either layer:
- Change a token: re-call `themeTokens({...})` with different values.
- Change a component's recipe: pass a `skin` prop OR override via the
  `SkinCap` capability (global). No `className` override channel.

**No runtime CSS-in-JS.** All styling is Tailwind classes generated
into the static stylesheet via the existing `tailwind: { base }` path.
No Emotion, no `styled()`, no theme provider.

**Arbitrary Tailwind values forbidden inside library components.**
Components only use **token-bound utilities**. The lint rule documents
this; a primitive that needs a one-off measurement (`w-[102px]`) means
the design system is missing a token — add the token instead. Apps
can still use arbitrary values at their own call sites.

**Recipe is the typed override surface.** `recipe()` (already shipped)
generates variant-driven class strings. The library re-exports it; new
primitives are built on it; consumers extend via variant choices, not
className overrides.

### Anti-pattern checklist (each new primitive scrutinized against this)

| Mistake | Prior art | How we avoid |
|---|---|---|
| Copy-paste model | shadcn/ui | Ship as importable package; fork is optional |
| `asChild` polymorphism | Radix Slot | Typed slot props + named children |
| Runtime CSS-in-JS | MUI/Chakra/Mantine v6 | Tailwind + CSS variables only |
| `className` as override channel | shadcn | Recipe variants are the typed surface |
| Codegen pipeline for tokens | Style Dictionary | Tokens are typed TS values |
| Arbitrary value escape hatch | Tailwind v4 default | Forbidden inside library components |

### Public surface (initial)

```ts
// Re-exports from @place-ts/component (the library is the design system)
export { recipe, cls, themeTokens } from '@place-ts/component'

// Component primitives (added in subsequent sessions)
export { Button } from './Button.tsx'      // session 2
export { Field, Input, Select } from './Field.tsx'  // session 3
export { Dialog } from './Dialog.tsx'      // session 3
export { Toast } from './Toast.tsx'        // session 4
export { Tooltip } from './Tooltip.tsx'    // session 4
export { Menu } from './Menu.tsx'          // session 4
export { Avatar, Badge, Card } from './primitives.tsx'  // session 5
```

## Consequences

### User-visible

- Single `import { Button } from '@place-ts/design'`. No CLI step.
- Refactors are TypeScript renames. No "re-run codegen."
- Themes propagate through CSS variables. Switching theme is one class
  on `<html>`. Zero JS theme-provider re-render cost.
- Primitives ship with one default skin. Apps customize via recipe
  variants. Skin swapping at scale is a future feature gated by a
  real consumer's need.

### Architectural

- The platform map keeps 9 systems. The directory `systems/design/` is
  org-level only; its charter says "library, not system."
- The component system stays unchanged. The design library composes
  on top of it.
- The framework's existing `recipe()` + `themeTokens()` + `tailwind:
  { base }` + the new `styles` option are the design system's runtime.
  Nothing new at the framework level.

### Trade-offs

- New package means a new `tsconfig.json`, new build target, new test
  surface. Mitigated by reusing the existing systems' tooling
  (vitest, biome, typecheck across projects).
- Library components evolve faster than framework primitives. The
  design library has its own version, its own ADRs, separate from
  framework's stability covenant. Pre-v1.0 freedom applies separately.

## Out of scope

- "Headless package + skin packages" split (`@place-ts/design-headless`
  + `@place-ts/design-classic`). One package, one default skin until a
  consumer demands the split.
- Data grid, date picker, rich-text editor. Each is a primitive batch
  of its own; not in the initial scope.
- Skin marketplace, theme switcher UI. Apps build these on top of the
  primitives; not framework-provided.
- 3D / canvas primitives. Different system (ADR 0017).

## Notes

- The "primitive batch" sequencing (Button → Field → Dialog → Toast →
  Tooltip → Menu → presentational) is intentional: each primitive
  proves a different aspect of the design system (variants, forms,
  focus management, queues, positioning, keyboard nav, presentational
  layout) before the next is added. Stops the library from becoming a
  "ship everything at once" mess.
