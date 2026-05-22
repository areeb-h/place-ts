// @place-ts/component/adapters/vercel — Vercel Edge / Node Functions
// adapter.
//
// Vercel's serverless runtime expects a default-export handler with a
// Web fetch signature for Edge Functions, or a Node `(req, res)` pair
// for Node Functions. Edge is the closer match to the framework's
// native shape; this module exposes the Edge entry shape.
//
//   // api/[...all].ts (Vercel Edge Function entry):
//   import { vercelHandler } from '@place-ts/component/adapters/vercel'
//   import home from '../src/pages/home.page.tsx'
//
//   export const config = { runtime: 'edge' }
//   export default await vercelHandler({
//     routes: { '/': home },
//   })
//
// **Deployment model**:
// - Static pages: deploy `dist/` (from `PLACE_BUILD=dist bun src/app.ts`)
//   to Vercel as a static site. No adapter required.
// - Dynamic SSR via Edge: use this adapter. Vercel's Edge Runtime is a
//   V8 isolate similar to Cloudflare Workers — the framework's build-
//   time work must complete before deploy (Vercel runs the build under
//   Node/Bun, then deploys the static output + the Edge Function
//   bundle).
// - Dynamic SSR via Node Functions: use the `nodeAdapter` from
//   `./node.ts` and wire it into a Node-runtime Vercel function. Heavier
//   cold start than Edge but full Node compatibility.
//
// **Build Output API**: Vercel also exposes a low-level Build Output
// API (`.vercel/output/config.json` + `functions/`). A future
// `place build --target=vercel` CLI subcommand would generate this
// manifest automatically; today, users wire the handler manually in a
// route file (as shown above). The manual wiring is one file + one
// import — small enough not to block ship.

import type { ServeOptions } from '../serve.ts'
import { createFetchHandler } from '../serve.ts'

/** Vercel Edge Function handler signature. */
export type VercelEdgeHandler = (req: Request) => Promise<Response>

/**
 * Build a Vercel Edge Function handler. Default-export the return
 * value from a route file under `api/` (or wherever your routing
 * config points). Pair with `export const config = { runtime: 'edge' }`
 * so Vercel uses the Edge runtime instead of the default Node runtime.
 *
 * Async because the underlying `createFetchHandler` is async (Tailwind
 * compile, island bundling).
 */
export async function vercelHandler(options: ServeOptions): Promise<VercelEdgeHandler> {
  return createFetchHandler(options)
}
