// Pre-wrapped devtools island.
//
// Lives here, not in the consuming app's `islandsDir`, so apps don't
// need a one-line wrapper file just to register the island. The
// framework picks it up via `serve({ devtools: true })` — see
// `serve.ts`'s devtools wiring. `import.meta.url` resolves to this
// file under `@place/devtools`'s installed location; the framework's
// island bundler builds it like any other entrypoint.
//
// Mount happens via the standard `<div data-view-id="place-devtools">`
// marker the framework emits at the end of `<body>` when devtools is
// enabled. The view function throws on SSR (touches `document`); the
// island runtime catches the throw and emits an empty marker, then
// hydrates fresh on the client.

import { island } from '@place/component'
import { devtoolsView } from './devtools.tsx'

export default island(import.meta.url, devtoolsView)
