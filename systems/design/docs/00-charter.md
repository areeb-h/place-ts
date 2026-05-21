# @place-ts/design — charter

## Thesis

`@place-ts/design` is a **curated component library**, NOT a platform
system. It ships opinionated primitives (Button, Field, Dialog, Toast,
Tooltip, Menu, Avatar, Badge, Card, …) built on top of the existing
nine platform systems. The platform map keeps 9 systems; the
`systems/design/` directory location is org-level only — see
[ADR 0016](../../../docs/decisions/0016-design-library-as-package.md).

The library answers one question: "how do real apps build UI on this
platform without re-inventing every primitive?" The answer is a
package you import from:

```tsx
import { Button, Field, Dialog } from '@place-ts/design'
```

No CLI. No codegen. No copy-paste-then-fork-and-pray. No
"`'use client'` boundary" headaches. No runtime CSS-in-JS. No
theme-provider re-render cascades.

## Non-goals

- **Not a kitchen sink.** Date pickers, data grids, rich-text editors
  are not in scope. Each is a primitive batch of its own; add by
  trigger.
- **Not a Tailwind override surface.** `className` overrides are
  allowed at the call site but the **typed override channel is
  recipe variants**. `recipe()` ([systems/component/src/recipe.ts](../../component/src/recipe.ts))
  + `cls()` are how the library composes; no `tailwind-merge`
  runtime patch.
- **Not a skin marketplace.** Every primitive ships with ONE default
  skin. Splitting into multi-skin packages happens only when a real
  consumer demands it.
- **Not React-flavored.** No `asChild` / Slot polymorphism. No
  `cloneElement`. The library uses the framework's own composition
  primitives (children, typed slot props, named children via
  `Dialog.Header`-style sub-components).

## Native-first composition

Every primitive starts from the most-specific native element / web
platform API that fits the use case. The framework adds reactivity,
typed props, recipe variants, and motion ON TOP. It does NOT replace
what the browser ships.

Specifically:

| Primitive | Native foundation | Why |
|---|---|---|
| `Dialog` | `<dialog>` + `showModal()` | Top-layer rendering (escapes `overflow:hidden`/`transform` parents — the bane of every framework's modal). Native focus trap. `::backdrop` pseudo for the overlay. `Esc` to close. |
| `Tooltip` / `Menu` / `Popover` | `popover` attribute | Top-layer + light-dismiss + auto-focus management. Universal browser support since Chrome 114 / Safari 17 / FF 125 (mid-2024). |
| `Field` / `Input` / validation message | native `<input>` + `:user-invalid` / `:user-valid` pseudos + `ValidityState` | Native HTML5 validation; framework wires the reactive error message + skin, not the validation engine. |
| `Select` | native `<select>` | Until `<selectlist>` ships universally, native is the right baseline. |
| `Form` | native `<form>` + `FormData` + `submitter` | Already done in `@place-ts/component`'s `<Form>`; design library reuses it. |
| Enter/exit transitions | CSS `@starting-style` + `transition-behavior: allow-discrete` | Universal since FF 129 (Aug 2024). Replaces "mount/unmount with portal + JS animation" of older frameworks. |
| Focus management | `inert` attribute + `:focus-visible` | Universal. Replaces hand-rolled focus traps. |

**Where motion sits on top of native:** native CSS transitions handle
discrete-property animations (display ↔ none, popover open/close).
`@place-ts/reactivity/motion` handles signal-driven continuous interpolation
(spring drag, animated counters, scroll-coupled effects) where CSS
can't go.

**What we don't ship because the browser does it:**

- Portals — `showModal()` / `popover` puts content in the top layer natively.
- Focus traps — `<dialog>.showModal()` and `popover="manual"` both do this.
- Click-outside / light-dismiss — `popover` attribute auto-handles it.
- Escape-to-close — native dialog handles it.
- Form validation — `<input required>`, `pattern`, `:user-invalid` are native.
- Anchored positioning — CSS `anchor-name` + `position-anchor` (universal-ish; we fall back to a small JS positioner for FF until anchor positioning lands there).

## Non-negotiables (anti-patterns)

Each new primitive is scrutinized against this list. If a primitive
needs to repeat one of these to function, the design is wrong.

1. **No copy-paste model.** shadcn's "you own the source" creates an
   unfixable update gap; the Radix abandonment risk amplifies, not
   insulates. Primitives ship as importable values. Apps can fork
   into their own repo if they want to OWN the source — that's a
   deliberate choice, not the default path.

2. **No `asChild` polymorphism / `cloneElement`.** Structurally
   untypeable; `cloneElement` is soft-deprecated under RSC; Slot +
   `useId` is the #1 source of Next.js hydration errors. We compose
   via typed slot props or named children. ([radix-ui #3700](https://github.com/radix-ui/primitives/issues/3700))

3. **No runtime CSS-in-JS / theme providers.** Mantine v7 ripped
   Emotion out for CSS Modules; Chakra v3 is publicly criticized for
   blocking RSC. Tokens are CSS variables emitted by `@theme`; theme
   switching is one class on `<html>`; zero JS propagation cost.
   ([Chakra v3 future post](https://www.adebayosegun.com/blog/the-future-of-chakra-ui))

4. **`className` is not the *appearance* override channel; typed
   per-subpart `classNames` IS the *additive* one** (Tier 17-D /
   ADR 0050). Two channels, distinct roles:
   - **Recipe variants** (`intent`, `size`, `side`, ...) are the
     typed *appearance* surface. The variants ARE the API; selecting
     a variant is how consumers pick a shipped visual treatment.
     We don't ship `tailwind-merge` as a runtime patch over an
     unsound override surface ([shadcn-ui/ui #2288](https://github.com/shadcn-ui/ui/discussions/2288)).
   - **`classNames={{ ...parts }}`** is the typed *additive* surface
     for one-off tweaks. Each component declares its part anatomy
     (e.g. `Combobox`: `'root' | 'input' | 'leftIcon' | 'popover' |
     'option' | ...`; `Dialog`: `'root' | 'backdrop'`); the prop is
     `Partial<Record<Part, string>>` so the type system pins which
     parts exist. Replaces the previous drift where each component
     grew its own ad-hoc `class` / `popoverClass` / `optionClass`
     prop set. Older components are migrating progressively;
     pre-migration components still accept a bare `class` prop as a
     deprecated alias for `classNames.root`.

5. **No Style Dictionary / Tokens Studio codegen.** Every consumer
   forced to install a build pipeline; transforms are bespoke;
   exactly the codegen friction the platform charter forbids. Tokens
   are typed TS values exported from the theme module
   (`themeTokens().themes`). Tailwind reads them via `@theme`.
   ([style-dictionary](https://github.com/style-dictionary/style-dictionary))

6. **Arbitrary Tailwind values inside library components: typography
   tokenized, layout pragmatic.** The v4 compiler bypasses its
   CSS-variable layer for `w-[102px]`-style escapes, ballooning
   generated CSS. The original rule was a blanket ban; reality
   forced a narrower contract:
   - **Typography (font-size, line-height, letter-spacing) MUST be
     token-bound.** Use Tailwind's default scale (`text-xs/sm/base/
     lg/xl`) or the typography roles emitted by `themeTokens({
     typography })` (`.text-display/h1/h2/h3/body/meta/mono`). Library
     components cleaning up `text-[10px]`, `text-[11px]`, `text-[13px]`
     in T15-D restored this — arbitrary FONT sizes are the visible-bloat
     case the original rule targeted.
   - **Color tokens (bg, fg, border, accent, etc.) MUST be token-bound.**
     `bg-accent`, `text-muted`, `border-border/60`. Library components
     never write `bg-[oklch(...)]` or `text-[#hex]` literals.
   - **Layout constraints specific to a primitive's contract (a
     dialog's `max-w-[min(560px,92vw)]`, a toast's `max-w-[440px]`)
     are ALLOWED.** These are component-design decisions the
     consumer would otherwise have to re-specify on every call
     site. We document them in the per-primitive note so they're
     not anonymous. ([tailwindlabs #18748](https://github.com/tailwindlabs/tailwindcss/discussions/18748))

## What we build on

The library is composed entirely from existing platform pieces:

- **Tokens** from `themeTokens()` in `@place-ts/component` — typed,
  SSR-safe, emits `@theme` block + per-theme classes.
- **Recipes** from `recipe()` — typed variant-driven class strings.
- **Reactivity** via `@place-ts/reactivity` — `state`, `derived`, `watch`.
- **Motion** via `@place-ts/reactivity/motion` — spring/tween/sequence/
  curve, all returning `Derived<number>` that components read like
  any other reactive prop.
- **Component primitives** from `@place-ts/component` — `<Show>`,
  `<Activity>`, `<Fragment>`, `<Tabs>` (the headless one), `<Form>`,
  `<ClientOnly>`, `<Deferred>`.
- **Styling** via the existing Tailwind v4 base — passed through
  `app({ styles: … })` (ADR 0014/0016).

No new framework primitives are required to build the library. The
existing platform IS the runtime.

## What ships, in what order

Initial scope:

1. `Button` — proves the recipe + variants + motion-aware loading state.
2. `Field` + `Input` + `Select` — proves form composition with `<Form>`.
3. `Dialog` — proves portal + focus trap + motion enter/exit (uses
   native `<dialog>` HTML element).
4. `Toast` — proves queue + auto-dismiss + motion.
5. `Tooltip` — proves delay + positioning + motion.
6. `Menu` — proves keyboard nav + popup + motion.
7. `Avatar`, `Badge`, `Card` — presentational primitives, no behavior.

After that batch lands, the docs site migrates from its hand-rolled
`design-system.ts` recipes to `@place-ts/design` imports. That migration
is the integration test: the library has to be useful enough that a
real consumer (the docs site) switches.

## Public surface

```ts
// Re-exports from @place-ts/component (the library is the design system)
export { recipe, cls, themeTokens } from '@place-ts/component'

// Library stylesheet — token-color CSS variables, line-grid layout,
// copy-button state CSS. Wire via `app({ styles })`.
export { styles } from './styles.ts'

// Interactive primitives
export { Button, type ButtonProps, type ButtonIntent, type ButtonSize } from './Button.tsx'
export { Field, Input, Textarea, type FieldProps, type InputProps, type TextareaProps,
         type InputSize } from './Field.tsx'
export { Dialog, type DialogProps, type DialogSize } from './Dialog.tsx'
export { Toaster, toast, type ToasterProps, type ToastKind, type ToastOptions } from './Toast.tsx'
export { Tooltip, type TooltipProps, type TooltipPlacement } from './Tooltip.tsx'
export { Menu, type MenuProps, type MenuItem, type MenuPlacement } from './Menu.tsx'

// Presentational primitives
export { Avatar, Badge, Card, type AvatarProps, type AvatarSize,
         type BadgeProps, type BadgeIntent, type BadgeSize,
         type CardProps, type CardIntent, type CardPadding } from './presentational.tsx'

// Click-to-copy primitive (generic; composes with CodeBlock)
export { Copy, type CopyProps } from './Copy.tsx'

// Syntax-highlighted code (added in Tier 13 — ADR 0033)
export { CodeBlock, type CodeBlockProps, type CodeBlockDensity,
         type CodeBlockRadius, type CodeBlockTheme, type CodeBlockChrome,
         type CodeBlockWrap, type LineRange,
         // Tokenizer subsystem — sanctioned by ADR 0037
         registerLanguage, knownLanguages, getTokenizer,
         tokenizeTs, tokenizeShell, tokenizeJson, tokenizeCss,
         tokenizeHtml, tokenizePython, tokenizePlain,
         type Tok, type TokKind, type Tokenizer } from './CodeBlock.tsx'
```

## Tokenizer subsystem (Tier 13, ADRs 0033 + 0037)

`@place-ts/design` ships a hand-rolled tokenizer family because syntax
highlighting on docs sites is a constant user-visible concern, and
shipping Shiki (~600 KB grammar set) or Prism (10-15 KB runtime per
language) for our use case is wasteful. The design library's
tokenizers are pure functions `(src: string) => readonly Tok[]`,
zero-dependency, SSR-only — no client cost. Languages: TS/JSX,
shell, JSON, CSS, HTML, Python, plaintext.

Apps register their own languages via `registerLanguage(name, fn)`;
the `Tokenizer` type is the contract.

The tokenizer is **part of the design library's curated charter
surface** (not a "we accidentally shipped it" surprise) because
the docs site needs it and CodeBlock is the highest-impact shipped
primitive. A future v0.2 may extract the tokenizer registry into a
sub-export (`@place-ts/design/code`) if it grows; for now it lives on
the main barrel for convenience.

## Per-primitive docs

Each primitive has its own ADR-light note in
`docs/components/<Name>.md` covering:

- Trigger (why this primitive exists)
- Non-goals (what it deliberately doesn't do)
- Failure modes (what to watch out for)
- Anti-patterns from prior art it avoids (with specific links)
- Tests + invariants

## Status

- **Shipped (v0.1, stable):** Button, Field/Input/Textarea, Dialog,
  Sheet, Toast/toast, Tooltip, Menu, Combobox, Avatar, Badge, Card,
  Copy, CodeBlock. Plus the tokenizer subsystem (7 built-in
  languages + `registerLanguage`).
- **Internal/runtime surface (Tier 13):** `markCopyUsedOnThisRequest`
  in `@place-ts/component` is the cross-package signal that triggers
  CSP-noncedinline-runtime emission from `renderPage`. The design
  library's `<Copy>` and `<CodeBlock>` mark the flag; the framework
  emits the runtime. Documented in ADR 0036.
- **`@provisional` (per ADR 0040):** `<Copy>` may evolve into a
  compound-component shape; CodeBlock's tokenizer registry may
  extract to a sub-export. `<Sheet>` and `<Combobox>` (Tier 16-D,
  ADR 0046) are tagged `@provisional` until exercised by real
  consumers — surface may grow (multi-select Combobox, motion-prop
  Sheet, etc.).
- **Future (triggered):** `<Table>` / `<DataGrid>` (Tier 16),
  `<Image>` (Tier 16). `<Can>` for RBAC shipped in `@place-ts/security`
  (T16-E, ADR 0044). `fromStandard()` schema interop shipped in
  `@place-ts/component` (T16-C, ADR 0045).
- **Future (longer-term):** date picker, rich-text editor, skin
  marketplace, headless-only split.
