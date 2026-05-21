---
description: Render layer + SSR/hydration/server primitives. Sits on top of @place-ts/reactivity. JSX runtime, page() declarative pages, serve() Bun server wrapper, boot() client entry, typed CSP/HSTS, first-class Tailwind v4.
---

# Component System

The render layer **and** the SSR layer. Sits on top of `@place-ts/reactivity`. Defines components, mount lifecycle, prop reactivity, list reconciliation, error boundaries, the bridge to capabilities, and a complete server-side-rendering + client-hydration pipeline that ships as one cohesive `serve() / page() / boot()` API.

**Status:** v0.3 shipping. JSX runtime per [ADR 0002](../../docs/decisions/0002-jsx-shape-via-ts-automatic-runtime.md). Page-as-data SSR per [ADR 0003](../../docs/decisions/0003-page-as-data-and-the-server-framework.md). 232 tests across 20 files.

- [docs/00-charter.md](docs/00-charter.md) — scope and dependencies
- [docs/01-rendering-anti-patterns.md](docs/01-rendering-anti-patterns.md) — what other frameworks got wrong; what we will not repeat
- [docs/02-design.md](docs/02-design.md) — direction document: principles, leading proposals, open questions
- [src/index.ts](src/index.ts) — runtime
- [src/jsx-runtime.ts](src/jsx-runtime.ts) — JSX automatic runtime entry point
- [src/tailwind.ts](src/tailwind.ts) — Tailwind v4 helper, sub-exported as `@place-ts/component/tailwind`

## Mental model

Components are **functions from props to a `View`, run once at mount.** No re-render on prop change. Reactivity flows through bindings (function-as-attribute, function-as-child); when a binding's source changes, only that binding updates, not the surrounding subtree. The same model Solid landed on, with three departures:

- `keyed(items, key, render)` instead of `<For>`. Children are values; lists are explicit.
- `{() => condition ? a() : b()}` instead of `<Show>`. Function-as-child is the conditional.
- JSX is opt-in via TypeScript's automatic runtime — no Babel plugin, no tooling pipeline. The runtime works without JSX too.

For SSR, the same `View` knows how to render itself to a string via an optional `toHtml()` method on every built-in factory. Server emits HTML; client adopts the existing DOM via `hydrate()`. One JSX, one mental model, no separate server-component layer.

## SSR + hydration in 4 calls

```ts
// pages/home.page.tsx — shared between server and client.
import { page } from '@place-ts/component'
export const home = page({
  url:  (u)         => ({ name: u.searchParams.get('name') ?? 'visitor' }),
  load: async (ctx) => ({ now: new Date().toISOString() }),
  view: ({ name, now }) => <div>hello, {name} — {now}</div>,
  meta: ({ name }) => ({ title: `hello, ${name}` }),
})

// server.tsx
import { serve } from '@place-ts/component'
import { home } from './pages/home.page.tsx'
await serve({
  port: 5180,
  clientEntry: './client.tsx',
  tailwind: true,
  security: 'strict',
  routes: { '/': home },
})

// client.tsx
import { boot } from '@place-ts/component'
import { home } from './pages/home.page.tsx'
boot({ '/': home })
```

That's the whole SSR-with-hydration story. No file-system routing, no `'use client'` markers, no codegen. The page object is the single source of truth both sides import.

## Shipping API

### Render core

- **`mount(view, parent)`** — top-level entry. Returns a disposer.
- **`el(tag, props?, ...children)`** — generic element factory. JSX compiles to this.
- **`component(fn)`** — HOC that defers `fn` to mount time so `onCleanup`, `RouterCap.use()`, etc. run inside a proper scope. JSX auto-wraps via the runtime.
- **`onCleanup(fn)`** — register a cleanup tied to the enclosing mount.
- **`Fragment`** — group siblings without a wrapping element.
- **`keyed(items, getKey, render)`** — reactive list reconciliation by key. Reorders preserve per-item state via comment markers and reverse-walk insertion.
- **`withCapability(cap, impl, view)`** / **`withCapabilities(provisions, view)`** — install capability impl(s) for `view`'s lifetime. Uses `Capability.install` (not `provide`), so deferred component bodies see the impl correctly.
- **`errorBoundary({ fallback, children })`** — catch throws from the wrapped subtree (component body throws, reactive child getter throws, keyed render throws). Renders `fallback(error, retry)` instead. `retry()` re-mounts the original children. Bubbling channel is an internal capability so nesting works (innermost boundary wins). Doesn't catch async errors (use `resource()`'s error channel) or event-handler throws (those run outside the reactive context).

### SSR layer

- **`page({ url, load, view, meta, styles, headers })`** — declarative page object both server and client import. `url(url, params)` runs on both sides (pure, derives props from URL). `load(ctx)` runs server-only (result serialized into `<script type="application/json" id="__place_load__">` for the client to read at boot). `view(props)` is the JSX, `meta` is typed page metadata (static value or `(props) => Meta`), `styles` is the per-page stylesheet sources, `headers` is per-page response headers.
- **`renderPage(p, req, params?, options?)`** — render a Page to an HTTP `Response`. Used by `serve()` per request; exported so consumers can hand-wire pages into their own dispatch.
- **`renderToString(view)`** — render a View to an HTML string. Fast path uses `view.toHtml()` (no DOM needed, runs in pure Bun); falls back to happy-dom mount-and-serialize for custom Views.
- **`renderToStream(view, options?)`** — `ReadableStream<Uint8Array>` of the rendered HTML. V0 emits one chunk; per-element streaming + `resource()` suspension are deferred.
- **`hydrate(view, root)`** — client-side adoption of SSR'd DOM. Walks the View tree alongside the existing DOM (matched by `data-h` markers from SSR), attaches event listeners + reactive watches without recreating elements. Strips markers post-hydration.
- **`<Static>{ children }</Static>`** — opt subtrees out of hydration. Default-hydrate, mark-static — Astro's "islands of interactivity" inverted.

### Server primitives

- **`serve({ port, routes, clientEntry?, tailwind?, security?, headers?, fetch?, websocket?, static?, notFound? })`** — Bun.serve wrapper. Bundles `clientEntry` once at startup (browser-safe externals applied), serves at `/client.js`, dispatches each request via the routes table. Pages render via `renderPage`; raw `(req, params) => Response` handlers run as-is. WebSocket upgrade lives in the `fetch` pre-router hook.
- **`boot({ '/path': page })`** — client entry. Matches `location.pathname` against the routes, derives URL props the same way the server did, reads load data from the SSR'd `<script>` tag, hydrates against `document.body`.
- **`serverRouter({ 'METHOD /path': handler })`** — METHOD + path-pattern dispatch for non-page routes. Returns `Promise<Response | null>`; null = no match.
- **`handler(routeFn, options?)`** — wraps `(req, params) => View` into `(req, params) => Promise<Response>` with default doctype shell. Lower-level than `page()`; for routes that don't fit the page model.

### Metadata & styles

- **`PageMeta`** — typed `<head>` config. Every field maps to one HTML element, no inferred magic. Covers `title`, `description`, `lang`, `charset`, `viewport`, `canonical`, `robots`, `keywords`, `author`, `themeColor`, `colorScheme`, `icon` (string or `{href,type,sizes}`), `og.*` (Open Graph), `twitter.*` (cards), and `extra: HeadEntry[]` for raw structured tag descriptors.
- **`StyleSrc`** — `string` (URL → `<link rel="stylesheet">`), `{ inline: '...' }` (→ `<style>`), or array. The `tailwind()` helper returns `{ inline }` directly.

### Tailwind (v4)

Sub-exported as `@place-ts/component/tailwind` so apps that don't use it pay zero dependency cost.

- **Standalone:** `await tailwind({ content: ['src/**/*.tsx'] })` returns `{ inline: css }` you drop into `page.styles`.
- **First-class on `serve()`:** `serve({ tailwind: true })` auto-compiles, auto-injects the CSS into every page's `<head>`, and computes the SHA-256 of the inlined CSS — the hash is auto-added to the security CSP `style-src` so strict CSP keeps working without `'unsafe-inline'`.
- **File mode:** `serve({ tailwind: { inline: false } })` serves at `/_place/tw.css`, injects `<link>` instead.

### Security headers

- **`security: 'strict' | 'standard' | 'none'`** preset on `serve()`, or a typed object for full control.
- **`SecurityOptions`** — typed CSP (camelCase directives auto-kebab-cased, keywords auto-quoted), HSTS, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, COOP/COEP/CORP, Permissions-Policy.
- **Preset + override merge** — `security: { preset: 'strict', csp: { connectSrc: ['self', 'wss:'] } }` keeps the strict baseline and only overrides the named directive.
- **`renderSecurityHeaders(security, extra?)`** — pure function; exported for introspection / custom dispatchers.

### DX helpers

These exist because the same boilerplate kept appearing in user code. Each has a concrete trigger and earns its keep at 2+ call sites.

- **`cls(...args)`** — standard clsx-shape class composition. Strings, conditional objects, nested arrays.
- **`wire(state)`** / **`wire(get, set)`** — collapses two-way input binding from 2 lines to `<input {...wire(state)} />`. **Polymorphic on the state's value type:** `State<string>` → text input/textarea; `State<number>` → number input (parses `.value`, ignores NaN so a spinner past empty doesn't clobber state); `State<boolean>` → checkbox/radio (uses `.checked` + `onChange`). The `(get, set)` overload binds a derived string field whose setter routes through some other mutator (e.g., `store.update`).
- **`onKey(key, handler, options?)`** — collapses the `if (e.key === 'Enter') { e.preventDefault(); … }` dance. Returns a JSX-shaped handler.
- **`globalKey(chord, handler, options?)`** — document-level shortcut. Chord syntax `[mod+][shift+][alt+]<Key>`; modifiers match strictly. `skipInInput` for bare-letter shortcuts that shouldn't interfere with typing. Auto-disposes via `onCleanup`.
- **`urlState(key, default, options?)`** — `State<T>` whose value lives in a single URL query param. Bidirectional: writes update the URL (via the current `RouterCap`); external URL changes (browser back/forward, deep links) flow back into the state reactively. Default omits the key when value === default for clean shareable URLs. Uses `replace` by default; pass `push: true` for navigation-like changes.

## Reactive bindings

Three forms, distinguished by the prop type at runtime:

| Prop value | Behavior |
|---|---|
| `string`, `number`, `boolean` | Set once. |
| `() => T` | Wrapped in a `watch`; re-runs when sources change. Only this binding updates, not the surrounding tree. |
| `(event: Event) => void` (when prop name is `onX`) | Added as event listener; auto-removed on dispose. |

Children follow the same rule: `() => Child` is reactive, anything else mounts once.

Form-input attributes (`value`, `checked`, `selected`, `disabled`) are set via the DOM property, not `setAttribute` — `setAttribute('value', x)` only changes `defaultValue` and won't move a caret correctly. `setAttr` compares-then-sets to avoid clobbering caret position on every reactive update.

## Mount-boundary `untrack`

Component HOC bodies, `keyed` render functions, and reactive children all run inside `untrack(...)`. Without this, descendant state reads would subscribe outer watches and a single keystroke would cause the whole subtree to re-mount. Lost focus, dropped characters. Present-day frameworks usually have this implicit; in our model it's explicit and tested.

## Anti-Next mistakes deliberately avoided

The SSR layer was designed against a list of failures from prior frameworks:

| Their failure | Our deliberate choice |
|---|---|
| File-system routing (move file → broken URL) | Routes are values: `routes: { '/': home }` |
| Multiple magic exports per route file (`metadata`, `loader`, `action`, `meta`, `useHead`) | One `page({ url, load, view, meta })` object |
| `'use client'` / `'use server'` boundary markers (magic strings the bundler scans for) | Server-only adornments live in server.tsx and spread onto pages |
| Implicit nested layouts via folder structure | Compose with regular function calls — `view: (p) => <Layout><Inner {...p} /></Layout>` |
| Built-in caches that span auth contexts (`fetch` auto-cache, `unstable_cache`) | No built-in cache. You scope it with your auth context in the key. |
| Hydration data scattered across magic globals (`__NEXT_DATA__`, `self.__next_f.push`) | Single inspectable `<script type="application/json" id="__place_load__">` |
| Default config requires `'unsafe-inline'` for inline styles (RSC payload, Tailwind) | Auto-hash: SHA-256 of Tailwind output → CSP `style-src`, strict CSP holds |
| Codegen step for typed routes (`react-router typegen` etc.) | Generics flow natively: `page<U, L>()` infers from `url` + `load` returns |

## What's deferred

- Resumability (Qwik-style serialized state, no hydration walk)
- Per-element streaming SSR + `resource()` suspension mid-stream
- AsyncLocalStorage-backed per-request capability scopes (current cap stack is module-global; safe pattern documented in `handler()` doc)
- HMR-aware component identity (state survives source edits)
- Web component interop
- Image / font optimization built-ins
- Production deploy adapters (Vercel/Cloudflare/Deno/etc.)

Each will land when a workload demands it, not before.
