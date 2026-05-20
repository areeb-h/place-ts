// place devtools — the island wrapper.
//
// `@place/devtools` exports the devtools VIEW; the `island()` call has
// to happen in a file under this app's project tree (the island
// bundler requires it). This one-line wrapper is that file —
// `islandsDir` discovery picks it up, and the docs site doubles as a
// live demo of `@place/devtools`.
import { island } from '@place/component'
import { devtoolsView } from '@place/devtools'

export default island(import.meta.url, devtoolsView)
