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

import { app, discoverPages } from '@place/component'
import { styles as designStyles } from '@place/design'
import { pathRouter } from '@place/routing'

import { docsLayout } from './layouts/docs.layout.tsx'
import { styles as appStyles } from './styles.ts'
import { tokens } from './theme.ts'

// Theme-persistence early-paint script. Runs in `<head>` BEFORE
// `<body>` parses, so the saved theme is applied with no flash.
//
// **Why an early script and not SSR.** On the live server SSR reads
// the cookie and ships the right `theme-*` class. But the docs site
// is also deployed as a STATIC export (Cloudflare Pages) — there is
// no server to read a cookie per request, so every page ships the
// default theme baked in. This script re-reads the `place-theme-choice`
// cookie on the client before first paint and corrects the class.
//
// The theme-toggle island writes `place-theme-choice` (light | dark |
// system). `system` resolves against `prefers-color-scheme` here so
// the OS preference is honored on first paint. In `theme()`'s
// `light-dark()` mode the `theme-*` class drives `color-scheme`, so
// setting the class is sufficient — no inline `color-scheme` write.
const themePersistEarly =
  "(function(){try{" +
  "var m=document.cookie.match(/(?:^|; )place-theme-choice=([^;]+)/);" +
  "var c=m?decodeURIComponent(m[1]):'system';" +
  "var eff=(c==='light'||c==='dark')?c:" +
  "((window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark');" +
  "var r=document.documentElement;" +
  "r.classList.remove('theme-light','theme-dark');" +
  "r.classList.add('theme-'+eff);" +
  "}catch(e){}})()"

const docsApp = app({
  name: '@place/docs',
  pages: await discoverPages('./src/pages'),
  layout: docsLayout,
  theme: tokens,
  styles: [designStyles, appStyles],
  router: pathRouter,
  islandsDir: './src/islands',
  earlyHead: [themePersistEarly],
})

// One entry, two modes. `PLACE_BUILD=<outDir>` pre-renders the whole
// site to a static `outDir` (T19-A / ADR 0051) and exits — used by
// `bun run build` for the Cloudflare Pages deploy. Unset → normal
// dev/prod server (or client-side hydrate, which `run()` dispatches
// to via the `__PLACE_BROWSER__` build define).
const buildOutDir =
  typeof process !== 'undefined' ? process.env['PLACE_BUILD'] : undefined

export default buildOutDir
  ? await docsApp.build({ outDir: buildOutDir })
  : docsApp.run()
