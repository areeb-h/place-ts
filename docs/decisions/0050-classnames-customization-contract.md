# ADR 0050: Tier 17-D — typed `class` + `classNames` customization contract

**Status:** accepted (2026-05-17)
**Date:** 2026-05-17
**Affects:** all 14 `@place-ts/design` components, their tests, their docs examples.

## Context

The design library accumulated ad-hoc per-subpart override props during
Tier 13–16: `<CodeBlock>` shipped `headerClass` + `preClass` +
`lineClass`; `<Combobox>` shipped `popoverClass` + `optionClass`;
`<Dialog>` shipped just `class`. Three different shapes for the same
conceptual problem — "how does an app override styling on a sub-part
of a component without forking the source?"

The Tier 17 audit + a parallel research pass on Mantine v7-v9, MUI
slots, Chakra v3 slot recipes, PrimeVue PassThrough, Tailwind
Variants, Panda CSS, Headless UI, React Aria Components, Kobalte,
Bits UI, and Park UI converged on the same answer: **a root channel
plus a typed sub-part map** is what every multi-part library has
ended up at. The shape varies (`classNames`, `slotProps`, `pt`)
but the structure is identical.

The decision was *which* shape, with three constraints:

1. **place-ts uses `class="…"` as the JSX attribute.** Not React's
   `className`. The framework deliberately rejected `className` to be
   HTML-native. Component prop names must follow the same convention
   — a prop called `className` would force consumers to translate
   between the prop name and the underlying DOM attribute.
2. **Two prop names risks "which do I use here?" confusion.** Even
   with TypeScript, if both props can accept the same thing, you've
   shipped a footgun.
3. **The library is pre-publish.** Breaking 14 component APIs in one
   sweep is OK if the new shape is the long-term answer.

The user's exact question — "people won't get confused right?" — is
the load-bearing constraint. The contract must be *unambiguous by
construction*, not by documentation.

## Decision

**`class` (root) + `classNames` (typed sub-parts, no `root` key).**

```ts
// Single-part components (Button, Input, Avatar, Badge, Card, Copy,
// Textarea, Tooltip) — only `class`. No `classNames` prop at all.
interface ButtonProps { class?: string }

// Multi-part components — `class` for the root + `classNames` for
// every other named part. `root` is NOT a key in `classNames`.
type ComboboxPart =
  | 'input' | 'leftIcon' | 'rightAffordance' | 'chevron' | 'clear'
  | 'popover' | 'option' | 'optionLabel' | 'optionHint'

interface ComboboxProps<T> {
  class?: string
  classNames?: Partial<{
    [K in ComboboxPart]:
      K extends 'option'
        ? string | ((state: ComboboxItemState<T>) => string)
        : string
  }>
}
```

### The three rules that make confusion structurally impossible

1. **`classNames` only exists on components that have >1 part.**
   `<Button>` has no `classNames` prop. TypeScript rejects
   `<Button classNames={…}>` at the type level. The "should I use
   `class` or `classNames`?" question never arises on single-part
   components because the IDE only offers `class`.
2. **`classNames` has no `root` key.** TypeScript rejects
   `<Combobox classNames={{ root: '…' }}>` — `root` is not in the
   `ComboboxPart` union. The two channels (`class` for root,
   `classNames` for sub-parts) cannot be used to express the same
   thing.
3. **Part-key sets are strictly typed.** `<Combobox classNames={{
   popver: '…' }}>` (typo) is a compile error. Mantine's silent-
   ignore bug for unknown parts ([issue #2467](https://github.com/mantinedev/mantine/issues/2467))
   cannot happen here.

### Resolution semantics

- `class` is concatenated with the recipe's root-class output via
  the framework's `cls()` helper.
- Each `classNames` value is concatenated with the recipe's per-
  subpart default class via `cls()`.
- One key in `classNames` (`option` on Combobox) accepts a function
  for per-row state-driven classes; the rest are static strings.

### Per-component part anatomy

| Component | `class` | `classNames` keys |
|---|---|---|
| Button | ✓ | — |
| Input | ✓ | — |
| Textarea | ✓ | — |
| Avatar | ✓ | — |
| Badge | ✓ | — |
| Card | ✓ | — |
| Copy | ✓ | — |
| Tooltip | ✓ | — |
| Field | ✓ | `label`, `hint` |
| Menu | ✓ | `item` |
| Toaster | ✓ | `item` |
| Combobox | ✓ | `input`, `leftIcon`, `rightAffordance`, `chevron`, `clear`, `popover`, `option`, `optionLabel`, `optionHint` |
| Dialog | ✓ | `backdrop` |
| Sheet | ✓ | `backdrop` |
| CodeBlock | ✓ | `header`, `pre`, `line` |

Backdrop classes auto-prefix with Tailwind's `[&::backdrop]:`
variant so call sites read as plain utilities.

## Rejected alternatives

### Pure `classNames` everywhere (Option B in the planning round)

`<Button classNames={{ root: 'my-btn' }}>` for the common case is
verbose. Zero major library surveyed in the research pass ships
this. It breaks the charter's HTML-native intuition (`class="…"` is
the native JSX attribute; adding a `classNames` prop layer for every
single-part component reintroduces the React `className` indirection
we already rejected).

### Pure `class`, no per-subpart map (Option C)

Works only for compound-parts libraries (shadcn, Radix Primitives,
Base UI 1.0, Kobalte, Bits UI) where each part is its own component
the consumer writes by hand. Our library ships pre-composed
components (`<Combobox>` is one element with internal sub-parts);
consumers can't reach the popover or option chrome without an
override channel.

### `className` (singular) + `classNames` (plural)

The Mantine pattern. Rejected because place-ts uses `class` (not
`className`) as the JSX attribute. Adopting `className` for the
*prop* name would force a translation: "I write `className` on the
component but the DOM has `class`." Same problem the framework
already rejected for JSX. Every non-React component library in 2026
(PrimeVue, Vuetify, Kobalte, Bits UI, Melt UI, Park UI) uses
`class` for the prop because their respective frameworks use `class`
for the attribute. We're in that camp.

### Mantine-style `classNames.root` AND `class`/`className` channels

What we briefly shipped in Tier 17-D's first pass. Two ways to spell
"extra class on the root" is exactly the "which one do I use?"
question we're trying to prevent. Removed `root` from the
`classNames` key set so the question can't arise.

### `slots` + `slotProps` (MUI v6 style)

`slotProps.root.className` is *merged* with the consumer's
`className`, but other props are *overwritten* — a documented but
bug-attracting inconsistency ([MUI #45919](https://github.com/mui/material-ui/issues/45919)).
Allows passing arbitrary attrs / events through, which we don't
need; keeps the override surface to class strings only.

### `pt` (PrimeVue PassThrough)

A god-prop accepting class + style + event handlers + arbitrary
attributes + nested PT per child. Users complain the syntax is
"cumbersome" and "I spent several hours discovering that nested
PassThrough requires `pt:pc-button:root:class`" ([PrimeVue #4125](https://github.com/primefaces/primevue/issues/4125),
[#5990](https://github.com/primefaces/primevue/issues/5990)).
Rejected. `classNames` carries strings only.

## Consequences

### What gets easier

- Predictable customization API across all 14 components — read one
  component's signature, you know how the other 13 work.
- TypeScript catches typos in part names (`popver` ≠ `popover`).
- Single-part components stay simple (`<Button class="my-btn">`).
- Migration to new components is mechanical (define `Part` union,
  add `classNames?: Partial<Record<Part, string>>` prop, resolve in
  the recipe wiring).
- No `tailwind-merge` runtime needed when paired with future
  `@layer place.components` cascade (T17-A.5 follow-up).

### What's now harder

- App code that used `headerClass` / `preClass` / `lineClass` /
  `popoverClass` / `optionClass` props needs migration. Mechanical
  rename (`headerClass="…"` → `classNames={{ header: '…' }}`). Pre-
  publish, so no deprecation cycle needed.
- Component authors must declare a `Part` type union to add a new
  sub-part. Slightly more ceremony than ad-hoc class props. Worth
  it for the typed override surface.

### What we'll watch for

- **State-driven classes for non-`option` parts** — if a sub-part on
  another component needs per-state classes (e.g. Menu's `item` based
  on `active`), the type system already permits switching that one
  key from `string` to `string | ((state) => string)`. Pattern
  scales without churning the prop name.
- **Render-slot props vs `classNames` entries** — Combobox already
  exposes `renderOption` (full content replacement) AND `classNames.
  option` (class additive). The two compose: a custom `renderOption`
  still gets `classNames.option` applied to the wrapping `<button>`.
  Document this composition explicitly per component.
- **`@layer place.components` rollout** — moving library default
  classes into a named cascade layer eliminates `tailwind-merge`
  shenanigans and is the structural answer to "my override didn't
  win." Tracked as a T17-A.5 follow-up.

## Verification

- **1387 tests pass / 14 skipped** across 83 files (no regressions
  from the sweep).
- New tests added per migrated component:
  - `Field.test.ts` — `classNames.label`, `classNames.hint`
  - `Menu.test.ts` — `classNames.item` on every menuitem button
  - `Toast.test.ts` — `classNames.item` on every rendered toast
  - `Combobox.test.ts` — `class` prop adds onto shell (was
    `classNames.root` — confirmed migrated)
  - `Dialog.test.ts` — `class` + `classNames.backdrop` compose
  - `Sheet.test.ts` — same as Dialog
  - `CodeBlock.test.ts` — `classNames.{header, pre, line}` (was
    three separate `*Class` props)
- Docs `/api/design` page rewritten: "Customization" section now
  documents the two-channel contract; Combobox `COMBOBOX_CUSTOM`
  example uses `class` + `classNames` (the previous version used
  the now-deprecated `classNames.root`).

## What's NOT in this cut

- **`@layer place.components` for default styles.** The contract
  works without it; pairing the two unlocks "consumer Tailwind
  utilities always win without `cn()` / `tailwind-merge` /
  `!important`." Tracked as T17-A.5 follow-up; mentioned in the
  Tailwind v4 + cascade-layers research findings.
- **Render-prop classNames** (e.g. `className: (state) => string` for
  state-aware root styling). Not adopted — state belongs on `data-*`
  attributes that consumers target with their own CSS.
- **`asChild` / `Slot` polymorphism.** Permanently rejected per
  charter NN#2 and the audit's failure-mode catalog (Radix has open
  issues #3700, #3776, #3780 about Slot breaking under RSC + React 19;
  zero major library that introduced it has avoided the breakage).
- **Migration of consumer apps** (commonplace, sandbox). Pre-publish
  — apps update at their own cadence. Docs site already done.

## References

- ADR 0026 — "Magic with clarity" gate (the principle that types
  + autocomplete handle disambiguation, not docs).
- ADR 0016 — Design library is a package, not a 10th system (the
  charter that says we don't ship copy-paste or `asChild`).
- [Mantine #2467](https://github.com/mantinedev/mantine/issues/2467) —
  silent-ignore bug on unknown `classNames` keys (the typing-weakness
  we explicitly prevent).
- [Mantine #7842](https://github.com/mantinedev/mantine/issues/7842) —
  autocomplete drops inside `classNames` (our strict `Partial<Record
  <Part, string>>` typing closes this).
- [MUI #45919](https://github.com/mui/material-ui/issues/45919) —
  className/slotProps merging inconsistency (`classNames` only takes
  strings; no merging-precedence surprises).
- [PrimeVue #4125](https://github.com/primefaces/primevue/issues/4125)
  + [#5990](https://github.com/primefaces/primevue/issues/5990) —
  cautionary tale of over-flexible PT god-prop.
- [Tailwind v4 cascade layers](https://tailwindcss.com/docs/functions-and-directives) —
  the structural answer to specificity wars that makes `tailwind-
  merge` obsolete.
- [shadcn discussion #2288](https://github.com/shadcn-ui/ui/discussions/2288) —
  `tailwind-merge` bundle cost + "generates unused styles" critique.
