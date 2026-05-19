# `@place/devtools`

> See the running app from inside it — the reactive graph, the islands,
> the route, the JS weight.

A dev-only island. The package exports the devtools **view**; the
`island()` call has to live in a file under your own project tree (the
island bundler requires it). Wrap it in a one-line island file:

```tsx
// src/islands/devtools.tsx
import { island } from '@place/component'
import { devtoolsView } from '@place/devtools'

export default island(import.meta.url, devtoolsView)
```

`islandsDir` discovery picks that file up automatically. Then render it
once in your root layout:

```tsx
import Devtools from './islands/devtools.tsx'

// …in the layout view, near the end of <body>:
<Devtools client="idle" />
```

A floating launcher appears in the corner; click it for the panel.

| Panel | Shows |
|---|---|
| **Graph** | Every `state` / `derived` / `watch` node — value, status, dependency edges. Live, via `@place/reactivity`'s `inspectGraph()`. |
| **Islands** | Every island on the page — load strategy, hydration state. |
| **Routes** | The active route — path, params, query. |
| **Console** | Captured `console` output — errors, warnings, info, log — plus uncaught errors and unhandled rejections. |
| **Perf** | Page load timing + the JavaScript the page shipped. |

The devtool runs as a place island — it dogfoods the framework. It
ships its own self-contained stylesheet (CSP-safe, adopted via a
constructable `CSSStyleSheet`) and never touches your app's theme or
layout.

See [`docs/00-charter.md`](./docs/00-charter.md) for scope + non-goals.
