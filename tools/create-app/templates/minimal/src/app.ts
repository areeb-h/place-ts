// Isomorphic entry. `app({...}).start()` starts the server on Bun, OR
// pre-renders to a static export when `PLACE_BUILD=<dir>` is set
// (that's what `bun run build` does). One file, both modes.
//
// **Convention defaults (no boilerplate needed):**
// - `./src/islands/*.tsx` is auto-discovered.
// - `./src/styles.css` is auto-loaded into Tailwind.
// Drop in the explicit `islandsDir:` / `styles:` fields only if you
// need to point elsewhere.

import { app, discoverPages } from '@place-ts/component/server'
import { pathRouter } from '@place-ts/routing'

import { mainLayout } from './layouts/main.layout.tsx'
import { tokens } from './theme.ts'

export default await app({
  name: '__APP_NAME__',
  pages: await discoverPages('./src/pages'),
  layout: mainLayout,
  theme: tokens,
  router: pathRouter,
}).start()
