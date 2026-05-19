// Barrel: `routes('/concepts', […])` composes each page's local path
// with the `/concepts` prefix. Pages in this folder declare paths
// relative to the prefix (`/reactivity`, `/capabilities`, etc.) —
// reorganizing the URL hierarchy is a one-line change here, not 3+
// page-file edits.

import { routes } from '@place/component/server'
import capabilities from './capabilities.page.tsx'
import reactivity from './reactivity.page.tsx'
import routesAsValues from './routes-as-values.page.tsx'
import security from './security.page.tsx'
import ssr from './ssr.page.tsx'

export default routes('/concepts', [reactivity, capabilities, routesAsValues, ssr, security])
