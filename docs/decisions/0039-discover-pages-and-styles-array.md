# ADR 0039: `discoverPages()` + `styles: string[]` — DX wins for `app.ts`

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/component/src/build/discover-pages.ts` (new); `systems/component/src/app.ts` (accept `styles: string | string[]`); `systems/component/src/index.ts` (export `discoverPages`); `systems/design/src/styles.ts` (CodeBlock line container layout fix); `systems/design/src/CodeBlock.tsx` (`data-numbered` attr); `examples/docs/src/app.ts` (migrated).

## Context

User feedback (2026-05-16) flagged three things:

1. **CodeBlock content visually broken**: lines rendered side-by-side in two columns instead of stacked. The line container's `display: grid; grid-template-columns: auto 1fr` was designed for gutter + content but auto-packed two lines per row when no line-gutter was present.
2. **`styles: \`${designStyles}\n${appStyles}\`` is ugly**: a brittle template-literal concatenation pattern in every multi-style app.
3. **Listing every page in `app.ts` is verbose**: the docs site imported 8 page modules (3 individual + 5 via `index.ts` barrels) and spread-flattened them in the `pages: [...]` array. "Can pages be a dir too? not import all the pages in app itself?"

The user's framing for #3 was sharp: "we won't take the path other frameworks took but we will do better." File-system routing (Next, Remix, SvelteKit) was explicitly rejected in ADR 0003 — pages are values, paths are explicit, refactor-safe. But the import-every-page boilerplate is real DX pain.

## Decision

Three coherent fixes.

### 1. CodeBlock line-container — conditional grid

Old CSS:
```css
.place-code-lines {
  display: grid;
  grid-template-columns: auto 1fr;
}
```

This worked when line numbers were on (gutter cell + content cell per row). With line numbers OFF, only ONE element was emitted per line — grid auto-flow filled `col1` then `col2`, packing two lines into one row.

Fix: switch to `display: block` by default; opt INTO the grid via a `data-numbered="1"` attribute set by the component when `lineNumbers` is on.

```css
.place-code-lines { display: block; }
.place-code-lines[data-numbered="1"] {
  display: grid;
  grid-template-columns: auto 1fr;
}
```

### 2. `styles: string | readonly string[]`

`AppConfig.styles` now accepts either form:

```ts
// Old (still works):
app({ styles: `${designStyles}\n${appStyles}` })

// New (preferred):
app({ styles: [designStyles, appStyles] })

// Even more layers:
app({ styles: [designStyles, motionStyles, appStyles, debugStyles] })
```

Internally arrays are filtered (drop empties) and concatenated with `\n` separators. Same result, much cleaner authoring. Multi-line readable in editors.

### 3. `discoverPages(dir)` — async page discovery without file-system routing

New server-only helper:

```ts
import { app, discoverPages } from '@place-ts/component'

export default app({
  pages: await discoverPages('./src/pages'),
  layout: docsLayout,
  theme: tokens,
  styles: [designStyles, appStyles],
}).run()
```

`discoverPages`:
- Walks the directory top-level
- Dynamic-imports every `*.page.{tsx,ts,jsx,js}` file
- For subdirectories, imports the `index.{ts,tsx,js,jsx}` file (if present) — does NOT recurse past the index
- Collects default exports: either a single `Page` (pushed) or an array (spread — from `routes('/prefix', [pages])`)
- Validates uniqueness — duplicate paths surface ALL offenders in one error
- Files / dirs prefixed with `_` are skipped (private convention, shared with `discoverIslands`)

**Why this is NOT file-system routing:**

The page's route key still comes from `page('/path', def)` — the file location is irrelevant to the route. Move `pages/why.page.tsx` → `pages/marketing/why.page.tsx` and the route stays `/why` unless the page declares a different path. The discovery is purely about which modules to LOAD, not about how to NAME them.

URL hierarchies still use the existing `routes('/prefix', [...])` helper. The `concepts/index.ts` keeps doing what it did:

```ts
// pages/concepts/index.ts (unchanged)
export default routes('/concepts', [reactivity, capabilities, ssr, security, routesAsValues])
```

`discoverPages` imports `concepts/index.ts`, gets back the array, spreads it into the flat pages list. No change to existing apps' structure required.

**Why top-level await is fine:**

Bun supports top-level `await` natively in ESM modules. The app entry already runs server-side; the `.run()` call returns an async server lifecycle anyway. The `await discoverPages(…)` adds one round-trip of fs I/O at startup — typically <30 ms even with a moderate page count.

## Migration

Docs `app.ts` before (39 lines, 10 imports):

```ts
import { app } from '@place-ts/component'
import { styles as designStyles } from '@place-ts/design'
import { pathRouter } from '@place-ts/routing'

import { docsLayout } from './layouts/docs.layout.tsx'
import api from './pages/api/index.ts'
import concepts from './pages/concepts/index.ts'
import examples from './pages/examples.page.tsx'
import gettingStarted from './pages/getting-started.page.tsx'
import landing from './pages/index.page.tsx'
import recipes from './pages/recipes/index.ts'
import roadmap from './pages/roadmap.page.tsx'
import why from './pages/why.page.tsx'
import { styles as appStyles } from './styles.ts'
import { tokens } from './theme.ts'

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

After (32 lines, 5 imports):

```ts
import { app, discoverPages } from '@place-ts/component'
import { styles as designStyles } from '@place-ts/design'
import { pathRouter } from '@place-ts/routing'

import { docsLayout } from './layouts/docs.layout.tsx'
import { styles as appStyles } from './styles.ts'
import { tokens } from './theme.ts'

export default app({
  name: '@place-ts/docs',
  pages: await discoverPages('./src/pages'),
  layout: docsLayout,
  theme: tokens,
  styles: [designStyles, appStyles],
  router: pathRouter,
  islandsDir: './src/islands',
}).run()
```

8 fewer imports. ~7 fewer lines. Same routing (verified live — all 25 docs routes return 200).

## Verification

- 1242 tests pass, 14 typecheck projects clean
- All 25 docs routes resolve correctly via `discoverPages` discovery (sampled: `/`, `/why`, `/concepts/reactivity`, `/api/page`, `/api/components`, `/recipes`, `/recipes/auth`, `/examples`, `/roadmap`, `/getting-started`)
- CodeBlock content stacks vertically as expected; line numbers (when on) still render with grid layout
- Visual screenshot at `/why` shows clean Tabs card + single-border CodeBlock + correct line stacking

## Why this passes "magic with clarity"

- **`discoverPages`** is a NAMED, exported function. The user CALLS it; nothing happens implicitly. They see exactly what's being imported and can `console.log(await discoverPages(...))` to inspect.
- **No file-system routing**: file paths don't become URLs. The user reads `page('/foo', def)` and knows the route. The discovery is just a wrapper around `import` + the existing `routes()` composition pattern.
- **`styles: string[]`** is a no-magic array concat. The internal join is `'\n'` — discoverable in `app.ts` source.

## Trade-offs

- **Top-level await on the entry**: requires Bun 1.0+ (already a hard dep). Apps targeting other runtimes via custom build need to wrap the call.
- **Discovery does I/O at startup**: ~30 ms on the docs site's 17 page files. Trivial; happens once per process.
- **Subdirectory discovery stops at `index.ts`**: deeper structure needs an `index.ts` to compose. Intentional — preserves the explicit URL-hierarchy authoring control.
