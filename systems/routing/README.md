# Routing System

URL ↔ state mapping for `place`. Reactive `path / segments / query`, navigate / replace / link / url, **typed `route(pattern)` paths and typed `searchParams` schemas (no codegen)**, three implementations (hash, history-API, in-memory), and a `RouterCap` capability so apps swap implementations without touching call sites.

**Status:** v0.4 shipping. 86 tests across hash, path, memory, link, url, typed routes, typed search params, normalization, capability behaviour. Full audit comparison against Next / Nuxt / React Router / TanStack — see [docs/journal](../../docs/journal/).

## Why this is different

What every other router does:

- React Router: `<NavLink>` component, `useNavigate()` hook, `useLocation()` hook — three concepts for what's logically one navigation thing
- Next: global router singleton; `<Link>` is a component you import; modifier-click handling implicit
- TanStack: typed routes (real win), but everything is still a component or a hook
- Nuxt: file-based routing baked into the build tool

What we do:

| Concern | Conventional approach | This system |
|---|---|---|
| Navigate programmatically | `useNavigate()` hook | `router.navigate('/x')` — capability, no hook |
| Render an anchor | `<NavLink>` / `<Link>` component | `<a {...router.link('/x')}>` — spread props |
| Active styling | callback className / NavLink magic | `aria-current="page"` + CSS variants |
| Modifier-click → new tab | manual or implicit in component | automatic, native `<a href>` flow |
| Active flag in app code | `useLocation()` + compare | `link.active()` reactive, on the link itself |
| Boot ceremony | `<RouterProvider>` wrapper | `mount(view, '#app', { provide: [router] })` |
| Test routing | mock the singleton | `memoryRouter()` cap, fully isolated |
| Embed two apps | impossible w/ globals | each app passes its own router cap |

## Quick start

```ts
import { mount } from '@place/component'
import { hashRouter } from '@place/routing'

mount(<App />, '#app', { provide: [hashRouter()] })
```

`hashRouter()` returns a `RouterHandle` that's *also* a `Provision` — pass it straight into `provide:[…]`, no `provide(RouterCap, router)` wrapper.

In components, pull the cap:

```tsx
import { RouterCap } from '@place/routing'

const Sidebar = component(() => {
  const router = RouterCap.use()
  return (
    <nav>
      <a {...router.link('/')}>Home</a>
      <a {...router.link('/about')}>About</a>
    </nav>
  )
})
```

CSS handles the active state — no JS class composition needed:

```css
nav a[aria-current="page"] { font-weight: 600; }
```

## API surface

### Implementations

- **`hashRouter()`** — `location.hash`-based. Works on any static host (`file://`, S3, GitHub Pages). Subscribes to `hashchange`. Use this when you don't control the server.
- **`pathRouter()`** — History API mode. Clean URLs (`/about`, not `/#/about`). Subscribes to `popstate`. Requires the server to serve `index.html` for unknown routes (Vite dev does this; configure your prod host).
- **`memoryRouter(initial = '/')`** — no global side effects. `back/forward` are no-ops. For tests, SSR, embedded contexts.

All three return the same `RouterHandle`:

```ts
interface RouterHandle extends Router, Provision {
  dispose(): void  // tests call; apps ignore
}
```

### `Router`

```ts
interface Router {
  // Reactive reads — re-run watchers / reactive children on change
  path(): string                                  // current path, normalized ('/' for empty)
  segments(): readonly string[]                   // URL-decoded, cached parse
  segment(i: number): string | null               // single-segment shortcut
  query(): URLSearchParams                        // defensive clone per call
  param(key: string): string | null               // single-param shortcut

  // Navigation
  navigate(path: string, options?: { replace?: boolean; preserveQuery?: boolean }): void
  replace(path: string): void
  updateQuery(changes: Record<string, string | null>, options?: { replace?: boolean }): void
  back(): void
  forward(): void

  // Composition
  link(to: string, options?: { replace?: boolean; preserveQuery?: boolean }): Link
  url(to?: string): string                         // shareable absolute URL
}
```

### `Link`

A reactive value that doubles as JSX props, programmatic navigator, and active-state accessor. Spread on any `<a>`; the spread only enumerates the DOM-safe properties (`href`, `onClick`, `aria-current`).

```ts
interface Link {
  // Spreadable on <a>
  readonly href: string
  readonly onClick: (e: MouseEvent) => void
  readonly 'aria-current': () => 'page' | undefined

  // Direct access (non-enumerable — won't leak via spread)
  readonly active: () => boolean
  go(): void
}
```

The `onClick` defers to the browser for modifier-clicks (Cmd/Ctrl/Shift/Alt) and middle/right-clicks, so "open in new tab" works natively.

### `parsePath(path)`

Free utility for off-router parsing. Returns `{ segments, query }`. URL-decodes; preserves the raw segment on a malformed escape rather than throwing.

### `route(pattern)` — typed paths

```ts
const userPost = route('/users/:id/posts/:postId')
//      ^? Route<{ id: string; postId: string }>

userPost({ id: 'a', postId: '42' })          // '/users/a/posts/42'
userPost({ wrong: 'x' })                      // ❌ TS error
userPost.match('/users/a/posts/42')           // { id: 'a', postId: '42' }
userPost.match('/users/a/posts')              // null

router.navigate(userPost({ id: 'a', postId: '42' }))   // route returns a string
router.link(userPost({ id: 'a', postId: '42' }))       // same
```

**Param shape is inferred at compile time** from the pattern string via TS template-literal types. **No codegen, no plugin, no CLI** — just `tsc`. Compare to TanStack which ships a Vite/Rspack plugin to generate route trees.

URL-encodes param values when building, decodes when matching. The `:name` syntax captures whole segments only.

### `searchParams(schema)` — typed query-param schemas

```ts
const filters = searchParams({
  tag:  (raw) => raw,                              // string | null
  page: (raw) => raw ? Number(raw) : 1,            // number, default 1
  sort: (raw) => raw === 'desc' ? 'desc' : 'asc',  // 'asc' | 'desc'
})

const { tag, page, sort } = filters.read(router)
//                          ^? { tag: string | null; page: number; sort: 'asc' | 'desc' }

filters.update(router, { tag: 'react' })            // typed
filters.update(router, { tag: null })               // remove the key
filters.update(router, { typo: 'x' })               // ❌ TS error
filters.update(router, { sort: 'asc' }, { replace: true })  // don't grow back stack
```

**No Zod or other validator dependency** — the schema is `{ key: parseFn }` and TS infers the result type from each parser's return. Compare to TanStack which integrates with Zod for validation.

`read()` is reactive — call it inside a watch / reactive child and it re-runs on path change. `update()` `String()`-coerces non-null values; `null`/`undefined` deletes the key.

## Patterns

### Derive selection from the URL

```ts
const selectedId = (): string | null => router.segment(0)
```

Deep-linking, refresh-survival, back-button correctness all fall out — no separate state, no separate persistence.

### Filter UI without growing history

```ts
const setTag = (tag: string | null) => router.updateQuery({ tag }, { replace: true })
```

Every filter click would otherwise add to the back stack; `replace` keeps it flat.

### "Selecting an item" preserving filter

```ts
const onSelect = (id: string) => router.navigate(`/${id}`, { preserveQuery: true })
```

Switches the path but keeps `?tag=react` etc. — the user's "I'm browsing this slice" intent doesn't reset.

## Won't ship (anti-bloat)

These are real features in other libraries; we deliberately don't include them:

- **Scroll restoration**. Real UX gap, real implementation cost (history.state coordination, per-route scroll capture). Defer until concrete trigger.
- **Route loaders** (`loader: async () => …`). `@place/reactivity`'s `resource()` already covers async data; framework integration would be glue.
- **File-based routing** (`pages/about.tsx` → `/about`). Build-tool concern; contradicts our minimal-surface charter.
- **Nested route trees** (`<Route>`s with `<Outlet>`). JSX composition + a small `dispatch()` function does this without DSL.
- **Route guards / middleware**. A component that calls `router.replace('/login')` in a `watch` does the job without a guard concept.
- **Codec libraries for search params**. If your parse function needs validation, write the validation in the parse function; if it needs Zod, call Zod from the parse function. The schema doesn't dictate the validator.
