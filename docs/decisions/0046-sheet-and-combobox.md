# ADR 0046: Tier 16-D — `<Sheet>` + `<Combobox>` primitives

**Status:** accepted (2026-05-17)
**Date:** 2026-05-17
**Affects:** `systems/design/src/Sheet.tsx` (new), `systems/design/src/Combobox.tsx` (new), `systems/design/src/index.ts` (re-exports), `systems/design/src/styles.ts` (`.place-sheet` transition rules), `systems/design/tests/unit/Sheet.test.ts` (new), `systems/design/tests/unit/Combobox.test.ts` (new), `systems/design/docs/00-charter.md` (status update).

## Context

Tier 16-D in the plan calls for two design-library primitives that
the audit identified as missing from `@place-ts/design`:

- **`<Sheet>`** — a drawer pattern (filter sidebar, mobile nav,
  quick-edit panel, notification stream). Today apps roll their own
  edge-anchored modals using inline CSS + manual focus traps. Same
  failure modes the audit catalogued under "every consumer rebuilds
  the same primitive" (cf. Dialog → Sheet migration in Tier 13).
- **`<Combobox>`** — typeahead select with filter + keyboard nav.
  The current alternative is `<select>` (no typeahead) or a hand-
  rolled popover (per-app reinvention, frequent a11y bugs).

Both fit the existing pattern: native HTML primitive underneath
(`<dialog>` for Sheet, `popover="auto"` for Combobox's listbox),
reactive open/value props, recipe-driven variants. No new
substrate; only composition.

## Decision

### `<Sheet>`

Same native foundation as `<Dialog>` (the `<dialog>` element +
`showModal()`) with two differences:

- **Side variant** (`'right' | 'left' | 'top' | 'bottom'`,
  default `'right'`) — anchors the dialog to the named edge by
  setting auto-margins (`ml-auto` for right, `mr-auto` for left,
  `mb-auto` for top, `mt-auto` for bottom) instead of the default
  centering. Adds the matching rounded-edge class
  (`rounded-l-xl` for right, etc.) so the inner corners are
  squared.
- **Size variants compound with side** — `sm/md/lg` map to
  `max-w-*` for vertical sheets (left/right) and `max-h-*` for
  horizontal sheets (top/bottom). The recipe's `compound` array
  encodes the per-pair classes.

Slide-in animation lives in `styles.ts` via `@starting-style` +
`transition-behavior: allow-discrete` (same mechanism as Dialog).
Default starting state is a `translateX(100%)` (slide in from the
right). Future cut: per-side starting transforms via a `data-side`
attribute the recipe emits — kept out of this cut to ship the
common case first.

Named children slots (`Sheet.Header`, `Sheet.Body`, `Sheet.Footer`)
mirror Dialog's pattern. No `asChild` polymorphism (per NN#2);
named-children composition only.

Inherits Dialog's wins: top-layer rendering, automatic focus trap +
scroll lock, `::backdrop` overlay, Esc-to-close, backdrop-click-
to-close (opt-out via `closeOnBackdrop={false}`).

### `<Combobox<T>>`

Typeahead select with native `<input role="combobox">` + popover
listbox. Generic `<T>` over the option `value` field — selection
returns the original `T`, not a string ID. No coercion, no
stringification, no `parseInt(value)` ceremony at the call site.

Surface:

```ts
interface ComboboxOption<T> {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean
  readonly hint?: string
}

interface ComboboxProps<T> {
  readonly options: readonly ComboboxOption<T>[] | (() => readonly ComboboxOption<T>[])
  readonly value: T | null | (() => T | null)
  readonly onChange: (value: T | null) => void
  readonly filter?: (query: string, option: ComboboxOption<T>) => boolean
  readonly placeholder?: string
  readonly id?: string
  readonly name?: string
  readonly disabled?: boolean | (() => boolean)
  readonly size?: 'sm' | 'md' | 'lg'
  readonly emptyMessage?: string
  readonly class?: string
  readonly 'aria-label'?: string
}
```

Behavior:

- **Filter**: default case-insensitive substring match on `label`.
  Pass `filter={(q, opt) => …}` for fuzzy, scored, multi-field, or
  upstream-derived matching.
- **Keyboard**: WAI-ARIA Combobox v1.2.
  ArrowDown/Up navigate (and open the popover if closed);
  Home/End jump to first/last enabled option; Enter selects;
  Escape closes (native via `popover="auto"`); Backspace on an
  empty filter with a selection clears the selection.
- **Visible text** state machine: when the user types, their text
  wins. When they don't type, the selected option's label shows.
  No `displayValue` plumbing; one cell.
- **Reactive options** — pass a function for derived/async-loaded
  options. The popover re-renders on signal change without losing
  the user's filter.
- **Accessibility** — `role="combobox"` on the input,
  `role="listbox"` on the popover, `role="option"` + `aria-selected`
  per item, `aria-controls` + `aria-activedescendant` wired
  automatically. Position is anchored via `getBoundingClientRect`
  (same trick as Menu) with viewport-edge avoidance.

## What's NOT in this cut

- **Multi-select Combobox.** Add when triggered; the single-select
  shape doesn't need multi-select baked in.
- **Async loading state UI in Combobox.** Apps render their own
  loading state via the `options` function (returning `[]` while
  loading and the spinner via `emptyMessage`). Sugar for a
  dedicated `loading` prop layers on later.
- **Grouped options / custom item renderers.** Add when triggered.
- **Virtualization of long option lists.** Composes with the
  existing `virtualList` primitive when needed; not a Combobox
  concern.
- **Per-side slide-in transforms for Sheet** (top → `translateY(-100%)`,
  etc.). Defaults to the right-edge slide; left edges fade in.
  Add per-side animation behind a `data-side` attribute when a
  consumer asks.
- **Motion-prop coordination** with `@place-ts/reactivity/motion` —
  same future cut as Dialog's. Today both rely on CSS-only
  transitions.

## Verification

- **1340 tests pass** (14 skipped) across 82 files. Was 1317
  pre-this-cut; +23 (10 Sheet + 13 Combobox).
- Sheet tests cover: renders `<dialog>`, default + per-side anchor
  classes, size compound classes (max-w / max-h per orientation),
  open/close round-trip, `onClose` fires on native close,
  backdrop-click-closes + opt-out, named-children slot chrome.
- Combobox tests cover: render shape + ARIA wiring, option count,
  disabled option rendering, click-to-select, click-on-disabled is
  no-op, `aria-selected` on selected option, default substring
  filter, empty filter shows `emptyMessage`, custom filter
  override, visible text shows selected label, reactive options
  re-evaluate on signal change.
- No regressions in existing 1317 tests.

## Why this passes "magic with clarity" (ADR 0026)

- **Discoverable in source.** Both components are single files;
  the recipe variants are explicit; the props interface is the
  whole authoring surface. No compile-time transforms, no
  `asChild` polymorphism, no hidden context dependencies.
- **Traceable in tooling.** Sheet's `<dialog>` shows up in
  devtools as a `<dialog>`; Combobox's `<input role="combobox">`
  + `<div role="listbox">` show up with proper a11y attributes.
  The slide-in animation lives in one CSS file readers can grep.
- **Faithful to performance budgets.** Sheet adds ~80 B over
  Dialog (one extra recipe + the slot variants); Combobox is a
  self-contained ~5 KB gzipped island. The styles.ts addition for
  Sheet's `@starting-style` is ~600 B.

## Tier 16 status after this cut

| Cut | Status | ADR |
|---|---|---|
| T16-A (Table/DataGrid) | not started | — |
| T16-B (Image + sharp) | not started | — |
| T16-C (Form + schema) | ✓ | 0045 |
| T16-D (Sheet + Combobox) | ✓ | 0046 (this) |
| T16-E (`<Can>` RBAC) | ✓ | 0044 |
| T16-F (Real-time sync-server) | not started | — |

Half of Tier 16 done; three cuts remain (A, B, F). Each independent.

## References

- ADR 0026 — "Magic with clarity" gate.
- ADR 0036 — Generic UI primitives extraction pattern.
- ADR 0044 — `<Can>` (companion T16 cut).
- ADR 0045 — `fromStandard()` (companion T16 cut).
- WAI-ARIA Combobox 1.2 — https://www.w3.org/TR/wai-aria-1.2/#combobox
