// place docs site — isomorphic entry. The framework's
// `app({...}).run()` dispatches: server-side starts Bun.serve;
// browser-side runs each island's auto-mount script.
//
// **DX features used here**:
//
//   - `discoverPages('./src/pages')` — async helper that imports
//     every `*.page.tsx` + subdir `index.ts` under the directory
//     and returns a flat list. Routes still live on the page values
//     (`page('/path', def)`); discovery just removes the import +
//     spread boilerplate. Top-level await is native in Bun.
//
//   - `styles: [...]` — array form replaces the brittle
//     `${designStyles}\n${appStyles}` template literal. Array
//     entries are concatenated with newlines in declaration order.
//
//   - Framework defaults — `security: 'standard'` (default),
//     `viewTransitions: false` (default), so they don't need to be
//     listed.

import { app, discoverPages } from '@place/component/server'
import { styles as designStyles } from '@place/design'
import { pathRouter } from '@place/routing'

import { docsLayout } from './layouts/docs.layout.tsx'
import { styles as appStyles } from './styles.ts'
import { tokens } from './theme.ts'

// Devtools wiring is framework-owned now: `app({ devtools: 'auto' })`
// (the default) auto-imports `@place/devtools/island`, registers it,
// and emits the marker. `bun run build` (`NODE_ENV=production`)
// resolves `'auto'` to false → the devtools dep is never imported,
// never bundled, never shipped.

// Theme persistence is framework-owned: passing `theme` makes
// `serve()` / `app().build()` auto-inject `themeEarlyScript()` into
// every page's `<head>` — it reads the theme cookie and applies the
// class before first paint, on a live server AND a static export.
// No `earlyHead` boilerplate here.
const docsApp = app({
  name: '@place/docs',
  pages: await discoverPages('./src/pages'),
  layout: docsLayout,
  theme: tokens,
  styles: [designStyles, appStyles],
  router: pathRouter,
  islandsDir: './src/islands',
  // Cloudflare Pages serves `/path/index.html` and 301-redirects bare
  // `/path` to `/path/`. Emitting canonical trailing-slash hrefs from
  // `<Link>` avoids that redirect entirely — a +37 ms-per-nav penalty
  // Lighthouse flags as a real LCP cost. The runtime router matches
  // both forms (segments are slash-stripped on parse) so registered
  // routes like `page('/getting-started', …)` keep working unchanged.
  trailingSlash: 'always',
})

// One entry, two modes. `PLACE_BUILD=<outDir>` pre-renders the whole
// site to a static `outDir` (T19-A / ADR 0051) and exits — used by
// `bun run build` for the Cloudflare Pages deploy. Unset → normal
// dev/prod server (or client-side hydrate, which `run()` dispatches
// to via the `__PLACE_BROWSER__` build define).
const buildOutDir = typeof process !== 'undefined' ? process.env['PLACE_BUILD'] : undefined

export default buildOutDir ? await docsApp.build({ outDir: buildOutDir }) : docsApp.run()
