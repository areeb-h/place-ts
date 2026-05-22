// @place-ts/component/adapters/cloudflare — Cloudflare Workers / Pages
// Functions adapter.
//
// Cloudflare's runtime expects an ES module with a default export:
//
//   export default { fetch(req, env, ctx) { ... } }
//
// This module gives apps a one-liner that produces that shape from the
// framework's standard `ServeOptions`.
//
//   // worker.ts (Cloudflare Workers / Pages Functions entry):
//   import { cloudflareFetch } from '@place-ts/component/adapters/cloudflare'
//   import home from './pages/home.page.tsx'
//
//   export default await cloudflareFetch({
//     routes: { '/': home },
//   })
//
// **Deployment model**:
// - Static pages: emit via `PLACE_BUILD=dist bun src/app.ts` first, then
//   deploy `dist/` to Cloudflare Pages directly (Git integration or
//   wrangler deploy). The framework's static export writes `_headers`
//   for strict CSP, plus all islands. No adapter needed for purely
//   static apps — Pages serves the directory.
// - Dynamic SSR: use this adapter from `_worker.js` at the root of the
//   Pages output, OR as a standalone Worker. The Worker runtime calls
//   `fetch(req, env, ctx)` per request; we route to the framework's
//   dispatcher via `createFetchHandler`.
//
// **Runtime constraint**: Workers run on V8 isolates, not Node. The
// framework's build-time work (Tailwind compile, island bundling) must
// happen ahead of time — typically as part of the Pages build, which
// runs the static export under Bun before deploying. This adapter
// assumes the dispatcher can be constructed at module-load time inside
// the Worker (the heavy work is in Bun.build, which Pages runs at
// build time, not at request time).
//
// **Bindings + ctx**: Cloudflare provides per-request `env` (KV /
// D1 / R2 bindings) and `ctx` (waitUntil, passThroughOnException).
// Today the adapter ignores both — the framework doesn't yet have
// capability slots for Cloudflare bindings. Users who need them can
// wrap the returned `{ fetch }` to install caps before calling
// through; a Phase 5.x cut will surface them as first-class caps.

import type { ServeOptions } from '../serve.ts'
import { createFetchHandler } from '../serve.ts'

/** Cloudflare Workers / Pages Functions module shape. */
export interface CloudflareModule {
  /** Per-request handler. Cloudflare invokes this per inbound request. */
  fetch: (
    req: Request,
    // biome-ignore lint/suspicious/noExplicitAny: bindings vary per project; users assert their own env type
    env: any,
    // Cloudflare ExecutionContext — `{ waitUntil, passThroughOnException }`.
    ctx: { waitUntil: (p: Promise<unknown>) => void; passThroughOnException: () => void },
  ) => Promise<Response>
}

/**
 * Build a Cloudflare Workers / Pages Functions entry module. Returns
 * an object with `fetch` matching Cloudflare's expected shape; export
 * it as default from your Worker entry file.
 *
 * Async because `createFetchHandler` is async (Tailwind compile,
 * island bundling, etc. run at module load).
 */
export async function cloudflareFetch(options: ServeOptions): Promise<CloudflareModule> {
  const handler = await createFetchHandler(options)
  return {
    fetch: (req, _env, _ctx) => handler(req),
  }
}
