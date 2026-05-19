# `@place/devtools`

> See the running app from inside it — the reactive graph, the islands,
> the route, the JS weight.

A dev-only island. Drop it into your root layout behind a dev check:

```tsx
import { Devtools } from '@place/devtools'

export const rootLayout = layout((page) => (
  <body>
    {page}
    {import.meta.env?.DEV ? <Devtools /> : null}
  </body>
))
```

Register it with the island bundler the same way as any island — add it
to `app({ islands: [...] })`, or re-export it from your `islandsDir`.

A floating launcher appears in the corner; click it for the panel.

| Panel | Shows |
|---|---|
| **Graph** | Every `state` / `derived` / `watch` node — value, status, dependency edges. Live, via `@place/reactivity`'s `inspectGraph()`. |
| **Islands** | Every island on the page — load strategy, hydration state. |
| **Routes** | The active route — path, params, query. |
| **Perf** | Page load timing + the JavaScript the page shipped. |

The devtool is itself a place island — it dogfoods the framework. It
ships its own self-contained stylesheet (CSP-safe, adopted via a
constructable `CSSStyleSheet`) and never touches your app's theme or
layout.

See [`docs/00-charter.md`](./docs/00-charter.md) for scope + non-goals.
