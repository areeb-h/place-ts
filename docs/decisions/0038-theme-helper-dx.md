# ADR 0038: `theme()` helper + framework defaults — leaner theming + leaner app.ts

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/component/src/theme.ts` (new `theme()` helper); `systems/component/src/index.ts` (exports); `systems/component/src/app.ts` (default `security: 'standard'`); `systems/component/tests/unit/theme.test.ts` (8 new tests); `examples/docs/src/theme.ts` + `examples/docs/src/app.ts` (migrated); `systems/component/src/__copy-runtime.ts` (new — runtime moved out of design lib for CSP-nonce handling); `examples/docs/src/styles.ts` + `systems/design/src/styles.ts` (CodeBlock visual fixes).

## Context

Three separate user-flagged issues converged into one structural refactor:

1. **"`app.ts` feels like the beginning of a framework"** — verbose config object with 8+ keys, half of which had a single canonical value most apps would pick. `security: 'standard'`, `router: pathRouter`, `viewTransitions: false`, `styles: ${designStyles}\n${appStyles}` all looked like rote ceremony.
2. **Theming DX too low-level** — every color required `'--color-bg': '...'` style with the `--color-` prefix repeated on every line. Sibling tokens (`card`, `border`, `muted`, `accent-fg`, `destructive`, `destructive-fg`) had to be written by hand for every theme.
3. **CodeBlock visual nesting bugs** — `.prose pre` rule leaked a border onto the CodeBlock's inner `<pre>`; CodeBlock inside Tabs nested two card-shaped borders. Plus the copy button had a silent-failure CSP regression (inline `<script>` blocked by strict-CSP nonce policy).

The fixes are different sizes but share a theme: lift framework-level concerns out of per-app code; make defaults right.

## Decision

### 1. `theme()` — leaner theme helper

New helper in `@place-ts/component`. Wraps `themeTokens()` with two DX wins:

```ts
import { theme } from '@place-ts/component'

export const tokens = theme({
  default: 'dark',
  modes: {
    dark: {
      bg: 'oklch(0.13 0.006 286)',
      fg: 'oklch(0.97 0.001 286)',
      accent: 'oklch(0.78 0.16 65)',
      // siblings (card, border, muted, accent-fg, destructive,
      // destructive-fg) auto-derived — list any of them to override
    },
    light: {
      bg: 'oklch(0.985 0.002 286)',
      fg: 'oklch(0.18 0.008 286)',
      accent: 'oklch(0.62 0.16 65)',
    },
  },
  typography: { scale: 'major-third' },
})
```

**Win 1: bare color keys.** Write `bg: '…'` instead of `'--color-bg': '…'`. The helper adds the `--color-` prefix that Tailwind v4 expects to auto-generate `bg-bg`, `text-fg`, `border-border` utilities. Keys with special characters (`accent-fg`) work too.

**Win 2: auto-derived siblings via `color-mix()`.** When the user provides only the anchors (`bg`, `fg`, `accent`), the helper emits CSS expressions for the rest:

| Sibling | Default expression |
|---|---|
| `card` | `color-mix(in oklab, var(--color-bg) 92%, var(--color-fg))` |
| `card-fg` | `var(--color-fg)` |
| `border` | `color-mix(in oklab, var(--color-bg) 78%, var(--color-fg))` |
| `muted` | `color-mix(in oklab, var(--color-fg) 60%, var(--color-bg))` |
| `accent-fg` | `var(--color-bg)` |
| `destructive` | `oklch(0.62 0.20 25)` (tuned red) |
| `destructive-fg` | `oklch(0.98 0 0)` (near-white) |

Siblings reference the anchors via `var(--color-…)` and `color-mix()`, so a theme tweak to `bg`/`fg` recolors all derived tokens at CSS-recalculation time — no rebuild required.

Any sibling listed explicitly on the mode wins over the default; consumers tune what they want, defaults fill in.

Returns the same `ThemeTokens` shape `themeTokens()` returns — fully back-compat with `app({ theme })` and `meta.htmlClass(theme)`.

### 2. App defaults: `security: 'standard'`

`app()` now fills in `security: 'standard'` when the option is unset. Apps that need the bare server (security proxy in front) opt out with `security: false`. The framework's principle is "secure by default" — auto-CSRF + strict-CSP + same-origin + body-limit + proto-pollution guards are all on without ceremony.

Other defaultable options (`viewTransitions: false`, `router: pathRouter`, etc.) already have framework-level defaults; `app.ts` files can omit them.

### 3. Copy runtime moved to framework, emitted with CSP nonce

Previously each `<Copy>` / `<CodeBlock>` instance rendered an inline `<script>` containing the click-to-copy runtime. Strict CSP requires every inline `<script>` to carry a per-request nonce — and components don't have access to that nonce. The scripts were silently blocked.

**Fix:** moved the runtime to `systems/component/src/__copy-runtime.ts`. Components call `markCopyUsedOnThisRequest()` instead of rendering a script; `renderPage` consumes the flag and emits the runtime alongside `placeViewport` / `placeHmr` / `placeTabs` with the response's CSP nonce. Same pattern as the other framework-level inline runtimes.

The runtime also gained a **textarea + execCommand fallback**: when Clipboard API fails (older browsers, blocked permission, insecure context), it falls through to `document.execCommand('copy')` via a hidden textarea. Visible feedback fires on either path's success; a `data-state="failed"` flips the label to a destructive-colored "✗ copy" if both paths fail (so users see the issue instead of thinking copy worked).

CSS for the visible state added a leading tick character via `::before`:
- `data-state="copied"`: `✓ copied` in accent color, accent border
- `data-state="failed"`: `✗ copied` in destructive color
- `data-state="idle"`: just the idle label

### 4. CodeBlock visual fixes

- **`.prose pre` border leak**: docs site's `.prose pre` selector targets every `<pre>` inside `<article class="prose">`. The CodeBlock's inner `<pre>` matched it and got a stray border + padding. Fixed by updating the override to match the new class name: `.prose .code-block-pre, .prose .place-code-pre { border: 0; background: transparent; padding: 1rem 1.25rem; margin: 0; }`. The legacy class name is kept for TypingCode + any external consumers.
- **CodeBlock-inside-Tabs double border**: Tabs `card` variant adds an outer border; CodeBlock's default `theme="surface"` adds another. Two cards nested. Fix: `[data-tabs-group] .place-code { border: 0; border-radius: 0; margin: 0; background: transparent; }`. The Tabs wrapper owns the visible card; CodeBlock sits flush inside.

### 5. Slimmer `app.ts`

Before (docs site, 47 lines):

```ts
import { app } from '@place-ts/component'
import { styles as designStyles } from '@place-ts/design'
import { pathRouter } from '@place-ts/routing'
// ... 10 page imports ...
import { tokens } from './theme.ts'

export default app({
  name: '@place-ts/docs',
  pages: [landing, gettingStarted, why, ...concepts, ...api, ...recipes, examples, roadmap],
  layout: docsLayout,
  theme: tokens,
  styles: `${designStyles}\n${appStyles}`,
  security: 'standard',
  viewTransitions: false,
  router: pathRouter,
  islandsDir: './src/islands',
}).run()
```

After (31 lines, drops `security` + `viewTransitions`):

```ts
export default app({
  name: '@place-ts/docs',
  pages: [landing, gettingStarted, why, ...concepts, ...api, ...recipes, examples, roadmap],
  layout: docsLayout,
  theme: tokens,
  styles: `${designStyles}\n${appStyles}`,
  router: pathRouter,
  islandsDir: './src/islands',
}).run()
```

Two fewer keys, both because the framework now defaults right. `islandsDir` and `router` are kept explicit because their values depend on app-specific decisions (where you keep islands; which router to use).

## Verification

- 1234 tests pass + 8 new `theme()` tests = **1242 total**, all 14 typecheck projects clean
- Live browser smoke at `/`, `/why`, `/concepts/reactivity`:
  - Theme tokens load correctly (`bg`, `fg`, `accent` explicit values; `card`, `muted` from auto-derived `color-mix()`)
  - Copy button shows ✓/✗ tick with accent/destructive color
  - CodeBlock inside Tabs has single border (no nested cards)
  - CodeBlock standalone: no inner `<pre>` border leak

## Migration

For existing apps:

1. **Theme**: swap `themeTokens({ themes: { dark: { '--color-bg': ... } } })` → `theme({ modes: { dark: { bg: ... } } })`. Both APIs continue to work; `theme()` is the recommended shape.
2. **`app.ts`**: remove `security: 'standard'` if you had it explicitly — that's now the default.
3. **CodeBlock CSS**: no migration; the bug fixes are framework-level. Apps that hand-rolled the `.prose .code-block-pre` override should rename to `.place-code-pre` or use both selectors.

Pre-publish: no compatibility shims needed; both old and new APIs work.

## Why this passes "magic with clarity"

- **`theme()` shorthand**: every emitted token still appears in the resolved CSS at the right `--color-…` key. Hover the theme value in your editor and TypeScript tells you what fields the helper accepts.
- **Default `security: 'standard'`**: discoverable via the `app()` JSDoc; explicit `security: false` opts out. The default isn't hidden — it's the framework's secure-by-default contract restated as a defaulted value.
- **Copy-runtime move**: same `placeXxx()` pattern every other framework-level runtime uses (viewport, HMR, tabs, deferred islands). One inline `<script>` per response, with the nonce. No magic.
- **CodeBlock CSS scoping**: standard CSS specificity, no `!important`, no JavaScript. The rules are visible in `styles.ts`.

## Out of scope

- **Palette presets** (`palette: 'zinc'` / `'slate'` etc.) — could ship as `@place-ts/design/palettes` later
- **Live theme editor / devtools panel** — the reactive devtool ADR is open; theme editing is a natural feature there
- **Auto-detect `islandsDir`** — needs `node:fs` access inside `app()`'s synchronous code path; investigated and deferred (the lazy fs import added more complexity than the line of config it would save)
- **Auto-merge `@place-ts/design` styles** — same issue (server-only dep detection from a universal entry); deferred
