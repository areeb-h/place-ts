// @place-ts/component/client — the browser-runtime entry.
//
// `mount` renders a view into a DOM node; `hydrate` adopts SSR'd
// markup. Both live in the `./_client-mount.ts` leaf — deliberately
// kept free of any `./index.ts` import, so a client / island bundle
// that reaches for them does NOT drag in the SSR pipeline, the build
// tools, or `node:*` / `Bun.*`. This subpath is the public face of
// that leaf.
//
// Tier 20 entrypoint split: client / island code imports
// `@place-ts/component/client`. It must never reach
// `@place-ts/component/server` or `@place-ts/component/build` — the
// boundary is an impossible import graph, not DCE.
export { hydrate, mount } from './_client-mount.ts'

// criticalAction() client-side helpers — install per-session HMAC
// key + sign envelopes. Apps call `installActionKey()` once after
// auth + `clearActionKey()` on logout; the rest happens
// automatically inside `criticalAction().call()`.
//
// `installMacaroon()` / `clearMacaroon()` are the parallel for the
// `requires:` authorisation path (Phase 3 / ADR 0055): the server
// returns a serialised macaroon at auth time, the browser stores
// it, every `.call()` sends it via `X-Place-Macaroon`.
export {
  clearActionKey,
  clearMacaroon,
  installActionKey,
  installMacaroon,
} from './critical-action-client.ts'
