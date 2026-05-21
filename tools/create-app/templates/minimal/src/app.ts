// Isomorphic entry. `app({...}).run()` starts the server on Bun and
// mounts each island on the browser — one file, no server/client
// mirror.
//
// `PLACE_BUILD=<dir>` pre-renders the whole site to a static export
// and exits instead of starting a server — that's what `bun run build`
// does (see scripts.build).

import { app, discoverPages } from '@place-ts/component/server'
import { styles as designStyles } from '@place-ts/design'
import { pathRouter } from '@place-ts/routing'

import { mainLayout } from './layouts/main.layout.tsx'
import { styles as appStyles } from './styles.ts'
import { tokens } from './theme.ts'

const myApp = app({
  name: '__APP_NAME__',
  // `discoverPages` walks `src/pages` and imports every `*.page.tsx` —
  // no manual import + spread. Top-level await is native in Bun.
  pages: await discoverPages('./src/pages'),
  layout: mainLayout,
  theme: tokens,
  // Tailwind base + app overrides, concatenated and processed at build.
  styles: [designStyles, appStyles],
  router: pathRouter,
  // Auto-discovers every `src/islands/*.tsx` default export.
  islandsDir: './src/islands',
})

const buildOutDir = typeof process !== 'undefined' ? process.env['PLACE_BUILD'] : undefined

export default buildOutDir ? await myApp.build({ outDir: buildOutDir }) : myApp.run()
