# @place/design

A curated component library shipped *with* the platform — **not** a
tenth system. It ships opinionated UI primitives built on top of the
nine platform systems; apps import from it directly.

```tsx
import { Button, Field, Dialog } from '@place/design'
```

**Status:** shipping. 14 primitives + a pluggable code tokenizer.
261 unit tests green. See [docs/00-charter.md](docs/00-charter.md) for
scope, non-goals, and the prior-art mistakes deliberately avoided.

## Why a package, not a system

The platform map keeps nine systems; the `systems/design/` directory
location is org-level only — see
[ADR 0016](../../docs/decisions/0016-design-library-as-package.md).
The library is built entirely on the component system's `recipe()` +
`themeTokens()` + Tailwind v4 base. No CLI, no codegen, no
copy-paste-then-fork. No runtime CSS-in-JS, no theme-provider
re-render cascade, no `'use client'` boundaries.

## Native-first composition

Every primitive sits on a real browser primitive, so the library adds
*behavior*, not infrastructure:

- `<Dialog>` / `<Sheet>` → native `<dialog>` + `showModal()` (top-layer,
  focus trap, `Esc`-to-close, `::backdrop`).
- `<Combobox>` / `<Menu>` / `<Tooltip>` → the Popover API + **CSS
  Anchor Positioning** (no JS positioners — see
  [ADR 0048](../../docs/decisions/0048-popover-substrate.md)).
- `<Disclosure>` → native `<details>` / `<summary>` + `name`-based
  exclusive accordions + `interpolate-size`.
- `<Field>` validation styling → the `:user-invalid` selector.
- Enter/exit transitions → `@starting-style` +
  `transition-behavior: allow-discrete`.

## Public surface

| Primitive | Notes |
|---|---|
| `Button` | Intent / size variants, intent-aware focus ring, motion-driven loading spinner |
| `Field` / `Input` / `Textarea` | `:has()`-driven validation, auto id + `aria-describedby` threading |
| `Dialog` | Native `<dialog>`, `closedby` support, named `Dialog.Header/Body/Footer` slots |
| `Sheet` | Edge-anchored drawer, per-side `@starting-style` transitions |
| `Combobox` | Typeahead select, flex-shell layout, anchor-positioned listbox |
| `Toast` / `Toaster` | Queue + auto-dismiss, motion enter/exit |
| `Tooltip` | Hover/focus delay group, `popover="hint"` stack |
| `Menu` | Keyboard nav, `popovertarget` + `commandfor` triggers, item kinds |
| `Disclosure` / `Disclosure.Group` | Native `<details>`, exclusive accordions |
| `Avatar` / `Badge` / `Card` | Presentational; `Card.Header/Body/Footer` slots |
| `Copy` | Generic click-to-copy, single inline runtime |
| `CodeBlock` | Syntax highlighting, pluggable tokenizer, line numbers / diff |

## Customization contract

Two channels, both typed (see
[ADR 0050](../../docs/decisions/0050-classnames-customization-contract.md)):

- **`class`** — additive classes on the root element.
- **`classNames={{ …parts }}`** — a typed per-sub-part map for
  multi-part components (`Dialog`'s `backdrop`, `Combobox`'s
  `popover` / `option` / …). Unknown keys are compile errors.

Recipe variants remain the typed override channel for *appearance*;
`classNames` is the *additive* channel. Theme tokens
(`themeTokens()` / `theme()`) re-skin every component atomically.
