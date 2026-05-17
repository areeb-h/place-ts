# ADR 0035: Typography lives in `themeTokens()`

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/component/src/theme.ts` (extend `ThemeTokensOptions` + new `TypographyOptions`/`TypographyRole`/`TypographyScaleRatio` types; new `buildTypographySections` helper; wire into the `@theme` block and emit role classes); `systems/component/src/index.ts` (export the new types); `systems/component/tests/unit/theme.test.ts` (9 new tests).

## Context

The design library hardcoded text sizes / line-heights / families in every component. Survey of the codebase (2026-05-16):

- 7 of 7 audited components in `systems/design/src/*.tsx` hardcode Tailwind `text-xs` / `text-sm` / `text-base` / `text-lg` / arbitrary `text-[Npx]` utilities
- Only `CodeBlock`'s `density` recipe bundles size+line-height into a variant, and it does so with literal `text-[13px]` / `leading-[1.65]` strings
- The docs site's `.prose` selector in `examples/docs/src/styles.ts` has 10+ inline `font-size:`, `font-weight:`, `letter-spacing:`, `line-height:` declarations
- `themeTokens()` accepted arbitrary `--*` keys but didn't generate them — the consumer had to write `--font-sans: …` themselves

No shared scale, no semantic role names, no theme switching of typography. Apps wanting custom fonts had to wire CSS by hand at multiple sites.

## Decision

Extend `themeTokens()` with an optional `typography` field. One config produces:

1. Standard `--font-*`, `--font-weight-*`, `--leading-*`, `--tracking-*` tokens emitted into the same `@theme` block as color tokens (Tailwind v4 generates `font-sans`, `font-bold`, etc. utilities automatically)
2. A modular type scale (`major-third`, `perfect-fourth`, etc. — or a raw number) that computes `rem`-based sizes for semantic roles
3. Semantic role utility classes (`.text-display`, `.text-h1`, `.text-body`, `.text-meta`, `.text-mono`, etc.) emitted after the `@theme` block

```ts
themeTokens({
  default: 'dark',
  themes: { dark: { … }, light: { … } },
  typography: {
    base: 16,
    scale: 'major-third',  // 1.25
    family: { sans: '"Inter", system-ui', mono: '"JetBrains Mono", ui-monospace' },
    // weight, leading, tracking, roles all optional; defaults provided
  },
})
```

### Defaults (when `typography: {}` is set with no fields)

| Axis | Defaults |
|---|---|
| `base` | 16 (px) |
| `scale` | `'major-third'` (1.25) |
| `family` | `{ sans: 'ui-sans-serif, system-ui, …', mono: 'ui-monospace, …' }` |
| `weight` | `{ regular: 400, medium: 500, semibold: 600, bold: 700 }` |
| `leading` | `{ tight: 1.2, snug: 1.4, normal: 1.55, relaxed: 1.7, loose: 2 }` |
| `tracking` | `{ tight: '-0.02em', normal: '0', wide: '0.05em' }` |
| `roles` | `display, h1, h2, h3, h4, body, meta, mono` (composed from above) |

### Role syntax

Each role's `size` is either:
- A signed integer step on the scale: `'+3'` (base × ratio³), `'-1'` (base ÷ ratio), `0` (base) — most expressive form
- A literal CSS length: `'1.125rem'`, `'18px'` — for one-off cases

`leading` / `tracking` / `weight` / `family` accept either a key from the corresponding scale or a literal value, with the key looked up first.

### Why extend `themeTokens()` rather than ship a separate `typography()` helper

User decision (AskUserQuestion, 2026-05-16): single config = one wire-up point. Apps that already call `themeTokens()` get typography for free; apps that don't want managed typography simply omit the `typography` field (back-compat preserved). Color tokens + font tokens land in the same `@theme` block so theme switching re-binds both atomically.

## Verification

- 9 new tests in `theme.test.ts`:
  - Back-compat: no `typography` field → no typography in `base`
  - Defaults: `typography: {}` → all default scales + role classes emitted
  - Scale math: `body` at step 0 = 1rem; `h1` at step +4 with ratio 1.25 ≈ 2.44rem; `meta` at step -1 = 0.8rem
  - Custom ratios reshape sizes proportionally
  - Numeric ratio (`scale: 1.5`) accepted directly
  - Custom family/weight/leading/tracking override defaults
  - Custom roles override defaults; literal sizes (`'4rem'`) pass through verbatim
  - Roles accept leading-scale key OR literal number
  - Color + typography land in ONE `@theme` block (atomic switch)
- 14 typecheck projects clean
- Existing `themeTokens()` consumers (docs site, commonplace) unchanged — back-compat is the omit-the-field default

## Migration

No breaking changes. Apps adopt typography by adding `typography: {}` to their existing `themeTokens()` call. The 8 default roles cover most needs; customization is per-field.

## Why this passes "magic with clarity"

- **Discoverable**: every field is on the typed `TypographyOptions` interface; hover the `typography` key in `themeTokens()`'s argument to see the full surface
- **Traceable**: the emitted CSS appears in `themeTokens().base`; consumers can `console.log` it or inspect the response's `<style>` block
- **Faithful to performance**: the role classes are CSS rules that don't require runtime, theme switching is one class change on `<html>`, Tailwind v4 generates utilities at compile time
