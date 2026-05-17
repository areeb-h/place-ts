// Browser-side hydration entry. Bundled by serve() at startup, served
// at /client.js. The route table here MUST mirror the server's so the
// hydrated tree matches the SSR'd HTML.

import { boot } from '@place/component'
import { homePage } from './pages/home.tsx'

boot({
  '/': homePage,
})
