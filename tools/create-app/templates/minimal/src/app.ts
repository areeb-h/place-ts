// Isomorphic entry. `app({...}).run()` starts the server on the
// server side and mounts each island on the browser side — one entry,
// no server/client mirror file.
//
// `PLACE_BUILD=<dir>` pre-renders the whole site to a static export
// and exits instead of starting a server — that is what
// `bun run build` does.

import { app } from '@place-ts/component/server'
import { homePage } from './pages/home.page.tsx'

const myApp = app({
  name: '__APP_NAME__',
  pages: [homePage],
  // Add interactive islands under `src/islands/` and uncomment:
  // islandsDir: './src/islands',
})

const buildOutDir = typeof process !== 'undefined' ? process.env['PLACE_BUILD'] : undefined

export default buildOutDir ? await myApp.build({ outDir: buildOutDir }) : myApp.run()
