# ADR 0049: Tier 17-C — `light-dark()` theme migration

**Status:** accepted (2026-05-17)
**Date:** 2026-05-17
**Affects:** `systems/component/src/theme.ts`, `systems/component/tests/unit/theme.test.ts`. Consumers using `theme({ modes: { light, dark } })` auto-opt in; their `.dark`-class swap is replaced by `color-scheme` writes.

## Context

The v0.1 theme architecture (`themeTokens()` / `theme()`) emits:

1. `@theme { --color-fg: ...; }` block with the default theme's
   token values.
2. Per-theme classes: `.theme-light { --color-fg: ...; ... }` /
   `.theme-dark { --color-fg: ...; ... }` — each with the full
   `--color-*` token set repeated.
3. `@media (prefers-color-scheme: dark) { :root:not(.theme-light)
   :not(.theme-dark) { --color-fg: ...; } }` — OS preference
   fallback when no class is set.

Theme switching = toggle a `theme-dark` / `theme-light` class on
`<html>`. JS `setTheme(tokens, 'dark')` writes the class.

Three downsides became clear in 2026:

1. **Duplicate token blocks.** A 20-token theme emits the full token
   list 3 times (default `@theme`, `.theme-light`, `.theme-dark`),
   plus a 4th time inside the prefers-color-scheme media block. CSS
   size scales linearly with theme count.
2. **`.dark`-class proliferation.** Every component with theme-
   aware styling (most of `@place-ts/design`) implicitly depends on
   the class being on `<html>`. Apps that wanted "this section in
   dark theme regardless of root" had no scoped escape.
3. **OS-preference fallback requires a `:not()` cascade.** The
   `:root:not(.theme-light):not(.theme-dark)` selector to "only
   apply OS preference if no explicit class" gets weirder as theme
   names grow.

The CSS `light-dark()` function went **Baseline Widely Available
2026-11-13** (already universal in Chrome 123+, Safari 17.4+,
Firefox 120+ as of late 2024; the Baseline date is the formal
"safe everywhere" stamp). One CSS variable per token, value =
`light-dark(<lightVal>, <darkVal>)`, theme switching = set
`color-scheme: light | dark` on `<html>`.

Two-mode (light + dark) themes are the common case. Multi-mode
apps (sepia, hi-contrast) need the classic per-class output because
`light-dark()` is binary.

## Decision

Add a `mode: 'classes' | 'light-dark'` option to `themeTokens()`.
Default: `'classes'` (back-compat). `theme()` auto-opts into
`'light-dark'` when both conditions hold:

- Exactly 2 modes named `light` and `dark`.
- `systemPreference` is not explicitly disabled.

### What `'light-dark'` emits

```css
@import "tailwindcss";

@theme {
  --color-bg: light-dark(<lightVal>, <darkVal>);
  --color-fg: light-dark(<lightVal>, <darkVal>);
  --color-accent: light-dark(<lightVal>, <darkVal>);
  /* ... one entry per token ... */
}

:root {
  color-scheme: light dark;
}

.theme-light {
  color-scheme: light;
}
.theme-dark {
  color-scheme: dark;
}
```

### Switching mechanics

- **Default** (no class on `<html>`) → browser uses OS
  `prefers-color-scheme`. `light-dark()` resolves to the matching
  value.
- **`<html class="theme-dark">`** → the class declares
  `color-scheme: dark` on the root → `light-dark()` resolves to
  dark.
- **`<html class="theme-light">`** → declares `color-scheme: light`
  → `light-dark()` resolves to light.

The existing `setTheme(tokens, 'dark')` API continues to work via
the class — no app-side migration needed.

### Why both `.theme-*` classes AND `:root` declarations

`:root { color-scheme: light dark }` declares the page supports
both modes (required for `light-dark()` to honor OS preference).
The per-mode classes override the OS pick when set. Same selector
shape consumers already use; no API churn.

### Edge case: identical values

If `lightVal === darkVal` for a token (e.g. a brand-color that
doesn't vary by mode), drop the `light-dark()` wrapper and emit the
plain value. Cleaner output; no behavioral difference.

## Consequences

### What gets simpler

- **One CSS variable per token** (was: one per token per theme).
- **Zero JS theme propagation** — browser resolves at the layout
  layer.
- **OS preference flows automatically** when no override.
- **`color-scheme` ALSO tells the browser** to render scrollbars,
  form controls, and `accent-color` in dark mode — free side
  effect.
- **No FOUC on theme switch** — the class change is one CSS rule;
  the cascade is instant. Old approach had a measurable per-token
  recomputation that flashed on slower devices.
- **Smaller CSS** for multi-token themes (~30-40% reduction
  observed on the docs site's 9-token theme; one block instead of
  three).

### What's the migration

- Apps using `theme({ modes: { light, dark } })`: **auto-opted in.**
  No code change. CSS shape is different but `setTheme()` /
  `htmlClass()` continue to work.
- Multi-mode apps (`{ light, dark, sepia, ... }`): **fall back to
  `'classes'` mode** automatically. No change in behavior.
- Apps that explicitly want the old classic behavior on light+dark:
  `theme({ ..., systemPreference: false })` keeps the classic path
  (since `light-dark()` is meaningless without OS-pref fallback).
- Apps using `themeTokens()` directly: opt in via
  `themeTokens({ mode: 'light-dark', ... })`. Validates that the
  themes are exactly `{ light, dark }`.

### Validation

`themeTokens({ mode: 'light-dark', ... })` throws if the themes
aren't exactly `light` + `dark`. Catches misconfiguration at
startup, not at runtime when the user clicks a button.

## What's NOT in this cut

- **Multi-mode `light-dark()` extensions** (e.g. `light-dark()`
  with 4 modes via cascaded `color-scheme`). The CSS function is
  intentionally binary; multi-mode stays on the classic path.
- **Per-component-scope `color-scheme` overrides** (the "this card
  is light even in a dark page" pattern). Possible today by setting
  `color-scheme: light` on the card; we don't ship a `<ColorScheme
  mode="light">` wrapper because it'd add API surface for a one-CSS-
  property concern.
- **Theme-toggle island migration** to write `color-scheme`
  directly instead of toggling a class. The class flow works today
  via the `.theme-*` rules; the direct-`color-scheme` path is a
  follow-up if a use case shows up.

## Verification

- **48 theme tests pass** (was 43; +5 new tests for the light-dark
  mode: emit shape, identical-values collapse, validation throws,
  typography flows alongside, multi-mode falls back).
- Live CSS on the docs site `/` confirms:
  - 9 `--color-*` tokens use `light-dark()` in `@theme`.
  - `:root { color-scheme: light dark; }` is emitted.
  - `.theme-light { color-scheme: light; }` + `.theme-dark {
    color-scheme: dark; }` are emitted.
  - No per-class `--color-*` override blocks (the duplication is
    gone).
- Theme toggle works unchanged from user-facing UX (the toggle
  writes the class; class sets `color-scheme`; `light-dark()` flips).

## References

- [Can I Use — light-dark()](https://caniuse.com/mdn-css_types_color_light-dark)
- [Stefan Judis — light-dark() requires color-scheme](https://www.stefanjudis.com/today-i-learned/light-dark-isnt-the-same-as-prefers-color-scheme/)
- [MDN — light-dark()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark)
- [MDN — color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme)
- ADR 0038 — `theme()` helper + framework defaults (the v0.1 API
  this extends).
- ADR 0026 — "magic with clarity" (lean on browser primitives).
