// Browser-side hydration entry. Bundled by serve() at server startup
// and served at /client.js.
//
// The boot() route table + layout MUST mirror serve()'s on the server.
// Without this mirror, the SSR'd HTML structure (which includes the
// layout's wrapper) wouldn't match the client's reconstructed view
// tree, and hydration would silently fail (event handlers don't
// attach — like the +1 button on /ssr/demo).

import { boot } from '@place/component'
import { actionsPage } from './actions.page.tsx'
import { homePage } from './home.page.tsx'
import { indexPage } from './index.page.tsx'
import { siteLayout } from './siteLayout.tsx'
import { slowPage } from './slow.page.tsx'

boot(
  {
    '/': indexPage,
    '/ssr/demo': homePage,
    '/ssr/slow': slowPage,
    '/actions/demo': actionsPage,
  },
  // Mirror serve({ layout: siteLayout }) — every page's view gets
  // wrapped client-side too, so hydration matches the SSR'd HTML.
  { layout: siteLayout },
)
