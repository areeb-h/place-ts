// @place/devtools — public surface.
//
// **Recommended usage** — let the framework register + mount the
// devtools for you:
//
//   import { app } from '@place/component/server'
//   app({ devtools: 'auto', ... })  // 'auto' = on when NODE_ENV !== 'production'
//
// No island wrapper, no layout JSX, no manual dev-gate. The framework
// imports `@place/devtools/island` lazily when enabled, registers it
// into the island registry, and emits the `<div data-view-id="place-devtools">`
// marker at the end of `<body>` on every page.
//
// **Lower-level access** — for the rare case where the default
// placement isn't right (e.g. you want to render the panel inside a
// specific layout slot), the raw view function is still exported:
//
//   import { devtoolsView } from '@place/devtools'
//   import { island } from '@place/component'
//   export default island(import.meta.url, devtoolsView)

export { devtoolsView } from './devtools.tsx'
export { default as devtoolsIsland } from './place-devtools.tsx'
