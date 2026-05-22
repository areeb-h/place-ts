// Isomorphic entry. `app({...}).run()` starts the server on Bun and
// mounts each island on the browser — one file, no server/client mirror.
//
// **Convention defaults (no boilerplate needed):**
// - `./src/islands/*.tsx` is auto-discovered.
// - `./src/styles.css` is auto-loaded into Tailwind.
// Drop in the explicit `islandsDir:` / `styles:` fields only if you
// need to point elsewhere.
//
// `PLACE_BUILD=<dir>` pre-renders the whole site to a static export
// and exits instead of starting a server — that's `bun run build`.

import { app, discoverPages } from '@place-ts/component/server'
import { pathRouter } from '@place-ts/routing'

import { mainLayout } from './layouts/main.layout.tsx'
import { tokens } from './theme.ts'

const myApp = app({
  name: '__APP_NAME__',
  pages: await discoverPages('./src/pages'),
  layout: mainLayout,
  theme: tokens,
  router: pathRouter,
})

const buildOutDir = typeof process !== 'undefined' ? process.env['PLACE_BUILD'] : undefined

export default buildOutDir ? await myApp.build({ outDir: buildOutDir }) : myApp.run()
