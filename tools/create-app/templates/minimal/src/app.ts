// Isomorphic entry. `app({...}).run()` starts the server on Bun and
// mounts each island on the browser — one file, no server/client
// mirror.
//
// **Zero-config defaults (0.3.0):**
// - `islandsDir` auto-defaults to `'./src/islands'` if the dir exists.
// - `styles` auto-defaults to `'./src/styles.css'` if the file exists.
// Both are explicit here for readability — drop them when the
// convention path is enough.
//
// `PLACE_BUILD=<dir>` pre-renders the whole site to a static export
// and exits instead of starting a server — that's what
// `bun run build` does (see scripts.build in package.json).

import { app, discoverPages } from '@place-ts/component/server'
import { pathRouter } from '@place-ts/routing'

import { mainLayout } from './layouts/main.layout.tsx'
import { tokens } from './theme.ts'

const myApp = app({
  name: '__APP_NAME__',
  // `discoverPages` walks `src/pages` and imports every `*.page.tsx` —
  // no manual import + spread. Top-level await is native in Bun.
  pages: await discoverPages('./src/pages'),
  layout: mainLayout,
  theme: tokens,
  // Path to your real `.css` file. Tailwind compiles it at startup,
  // ships the result inline. `@import "@place-ts/design/base.css"`
  // inside it brings in the design library's cascade + .prose.
  styles: './src/styles.css',
  router: pathRouter,
  // Auto-discovers every `src/islands/*.tsx` default export.
  islandsDir: './src/islands',
})

const buildOutDir = typeof process !== 'undefined' ? process.env['PLACE_BUILD'] : undefined

export default buildOutDir ? await myApp.build({ outDir: buildOutDir }) : myApp.run()
