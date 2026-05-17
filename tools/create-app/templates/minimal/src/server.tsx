// HTTP entry. `bun --watch src/server.tsx` for dev; `bun start` for prod.
//
// `serve()` bundles the client entry via Bun.build, applies strict CSP
// + auto-Tailwind (when configured) + the security defaults, and
// dispatches the routes table.

import { serve } from '@place/component'
import { homePage } from './pages/home.tsx'

const PORT = Number.parseInt(process.env.PORT ?? '5179', 10)

await serve({
  name: '__APP_NAME__',
  port: PORT,
  clientEntry: `${import.meta.dir}/client.tsx`,
  security: 'standard',
  routes: {
    '/': homePage,
  },
})
