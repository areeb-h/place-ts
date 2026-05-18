// @place/component/client — the browser-runtime entry.
//
// `mount` renders a view into a DOM node; `hydrate` adopts SSR'd
// markup. Both live in the `./_client-mount.ts` leaf — deliberately
// kept free of any `./index.ts` import, so a client / island bundle
// that reaches for them does NOT drag in the SSR pipeline, the build
// tools, or `node:*` / `Bun.*`. This subpath is the public face of
// that leaf.
//
// Tier 20 entrypoint split: client / island code imports
// `@place/component/client`. It must never reach
// `@place/component/server` or `@place/component/build` — the
// boundary is an impossible import graph, not DCE.
export { hydrate, mount } from './_client-mount.ts'
