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

export default app({
  name: '@place/docs',
  pages: await discoverPages('./src/pages'),
  layout: docsLayout,
  theme: tokens,
  styles: [designStyles, appStyles],
  router: pathRouter,
  islandsDir: './src/islands',
}).run()
