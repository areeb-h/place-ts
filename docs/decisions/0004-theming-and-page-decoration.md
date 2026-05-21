# ADR 0004: Theming + page-decoration pattern

**Status:** accepted
**Date:** 2026-05-05
**Affects:** component system (v0.5+), commonplace + sandbox examples

## Context

After [ADR 0003](0003-page-as-data-and-the-server-framework.md) landed the page/serve framework, the next pain emerged: dark/light themes. Every shadcn/Next/SvelteKit app does this, none of them do it well.

Concretely the problems:

1. **Flash of wrong theme on first paint.** Apps that read `localStorage` to pick a theme can't run JS before the browser paints. The standard workaround is a blocking `<script>` in `<head>` that reads localStorage and toggles `<html class="dark">` synchronously. This script must be inline (it has to run before module loading), which fights strict CSP (`script-src 'self'` blocks it; `script-src 'unsafe-inline'` defeats the security baseline).

2. **`@apply` ceremony for utility-on-body.** Tailwind's pattern for "make body dark by default" is `@layer base { body { @apply bg-zinc-950 text-zinc-100 ... } }` — a CSS-side incantation when the JSX-side is just a class on `<body>`. Worse, it runs through Tailwind's compiler which means it lives in a separate `globals.css`, not next to the page that needs it.

3. **Shadcn's design** of "tokens as CSS variables, theme as a class on `<html>`" works structurally — and we adopt it. But shadcn ships components as files copied into the app via a CLI, with no compile-time guarantee that components reference tokens that exist. A partial theme (missing `--card-fg`) silently falls back to inherited values, and you find out by visual diffing.

4. **Per-page boilerplate.** A naive implementation needs every page to write `load: ({ req }) => ({ theme: readThemeFromRequest(req, tokens) })`, type the prop, and pass `htmlClass: tokens.htmlClass(theme)` from `meta(props)`. This puts theme wiring in every page declaration — exactly the kind of boilerplate the page-as-data abstraction was supposed to eliminate.

## Decisions

### 1. Tokens live in `@theme {}`, registered with Tailwind v4

`themeTokens()` emits CSS that goes into `serve()`'s `tailwind.base`:

```css
@import "tailwindcss";
@theme {
  --color-bg: oklch(0.14 0.005 286);   /* default theme */
  --color-fg: oklch(0.97 0.001 286);
  ...
}
.theme-light {                          /* override class */
  --color-bg: oklch(1 0 0);
  --color-fg: oklch(0.21 0.006 286);
  ...
}
@media (prefers-color-scheme: light) {  /* system pref auto-binding */
  :root:not(.theme-light):not(.theme-dark) { ... }
}
```

This unlocks `bg-bg`, `text-fg`, `border-border`, `bg-accent/10` etc. as Tailwind utilities. Switching theme = re-binding the variables; classes don't change.

**Rejected:** runtime token bag (Stitches/Emotion-style) — adds bundle weight, breaks `bg-${name}` code-splitting, no static class-name extraction for the Tailwind scanner.

### 2. Theme persistence via cookie, not localStorage

`themeCookieHeader(theme)` writes a long-lived `Set-Cookie`; `readThemeFromRequest(req, tokens)` parses it server-side. The server picks the theme **before** rendering, emits `<html class="theme-…">` in the SSR'd HTML, and the right theme wins on first paint.

**No flash, no inline pre-paint script, strict-CSP-clean.**

System preference (`prefers-color-scheme: dark`) is also handled — purely via CSS `@media`, no JS at all. An explicit user choice (cookie set) wins over system pref because the explicit class beats the `:not()` selector in the media block.

**Rejected:**
- localStorage-only — requires inline script for FOUC prevention, fights strict CSP.
- Inline pre-paint script (the shadcn/Next/SvelteKit default) — same CSP issue.
- HTTP `Sec-CH-Prefers-Color-Scheme` client hint — not universally supported, and the explicit-user-choice case still needs a cookie.

### 3. `htmlClass` / `bodyClass` as top-level layout/page fields

`Layout` and `Page` configs carry explicit class slots — peers of `meta:`, not nested inside it, because they emit `class=` attributes on `<html>` / `<body>`, not metadata tags. (Pre-0.2.0 they lived under `meta.htmlClass` / `meta.bodyClass`; moved to the top level so the meta type stays focused on actual `<meta>` / `<link>` content.)

```ts
layout({
  htmlClass: 'h-full',
  bodyClass: 'h-full bg-bg text-fg font-sans antialiased',
  view: ({ children }) => …,
})
```

These are rendered into `<html class="…">` and `<body class="…">` in `renderDocument`. The Tailwind content scanner picks them up alongside everything else (they're string literals in source). When a layout AND a page both set `htmlClass`/`bodyClass`, the values concatenate (root layout's classes first, page's last).

**Rejected:** the `@layer base { body { @apply ... } }` pattern. Less type-safety, more compiler ceremony, lives in a different file than the page declaration that wants it.

### 4. `serve({ theme: tokens })` — request-time decoration without per-page boilerplate

The framework reads the theme cookie per request and prefixes the active theme class onto every page's `htmlClass`. Pages declare zero theme code:

```ts
serve({
  tailwind: true,
  theme: tokens,           // THIS is the entire theme wiring
  routes: { '/': page({ view, meta }) },
})

// page.tsx
page({
  view: () => <div id="app" />,
  htmlClass: 'h-full',
  bodyClass: 'bg-bg text-fg font-sans antialiased',
})
```

The mechanism is `RenderPageOptions.htmlClassPrefix` — a generic hook the serve()'s dispatch threads through. Pages don't see it; the framework computes it per request.

**Side effects:** ISR cache key includes the theme name so light + dark visitors don't share entries (`{pathname}{search}|theme=dark`).

### 5. `serve({ theme: tokens })` also auto-fills `tailwind.base`

Same `tokens` object drives both Tailwind compilation AND per-request theme injection. Auto-fill saves the duplicate line. **Guard**: never turns Tailwind on for users who opted out — only fills when Tailwind is already enabled (`tailwind: true | { … }`) and no explicit `base` was provided.

## Consequences

- **Positive:** zero theme code in pages. One line on serve(). No flash. No inline scripts. Strict CSP compatible. ISR-safe.
- **Positive:** typed at the call site — TS rejects partial themes (missing tokens) and invalid class fragments at `themeTokens(...)`.
- **Positive:** the design vocabulary (`bg-card`, `text-muted`, `text-accent`) is consistent across commonplace + sandbox.
- **Future commitment:** the `htmlClassPrefix` field is one-off. If a SECOND request-time decoration concern emerges (locale class, A/B cohort, per-route CSP override), promote to a generic `decorateMeta(req)` hook. See [roadmap](../roadmap.md) open architectural question #6.
- **Future commitment:** if a workload needs the broader "cache entries as State + invalidation graph" originally sketched in the [cache charter](../../systems/cache/README.md), revisit. Theming did not change that calculus.

## Alternatives rejected (summary)

| Alternative | Why rejected |
|---|---|
| shadcn-style copy-into-app via CLI | No CLI to maintain; workspace deps + direct imports cover the same ground without a separate tool |
| Inline pre-paint script for FOUC prevention | Fights strict CSP — would force `'unsafe-inline'` in `script-src` |
| localStorage-only theme | Same FOUC problem; requires the inline script we just rejected |
| Per-page `load()` + typed `theme` prop | Boilerplate in every page; defeats page-as-data |
| `@layer base { body { @apply ... } }` for body styling | Indirect; runs through Tailwind compiler; lives in separate CSS file |
| Runtime token bag (CSS-in-JS shape) | Bundle weight; breaks Tailwind's static class extraction; no `bg-${name}` codegen |

## How to adopt

For a new app:

```ts
// theme.ts
export const tokens = themeTokens({
  default: 'dark',
  themes: { dark: { '--color-bg': '...', ... }, light: { ... } },
})

// server.tsx
serve({
  tailwind: true,
  theme: tokens,
  routes: { '/': page({ view, bodyClass: 'bg-bg text-fg' }) },
})

// any client component
import { setTheme } from '@place-ts/component'
import { tokens } from './theme.ts'

<button onClick={() => setTheme(tokens, 'light')}>Light</button>
```

That's the entire surface. The theming pattern in [examples/commonplace](../../examples/commonplace) is the reference.
