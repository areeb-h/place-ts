// @place/devtools — public surface.
//
// Exports the devtools VIEW, not a pre-wrapped island: the island
// bundler requires an island's source to live under the consuming
// app's project tree, so the `island()` call belongs in the app. Wrap
// it in a one-line island file (see the README), then render
// `<Devtools />` once in a root layout behind a dev gate.

export { devtoolsView } from './devtools.tsx'
