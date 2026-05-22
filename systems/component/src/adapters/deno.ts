// @place-ts/component/adapters/deno — Deno / Deno Deploy adapter.
//
// Deno's runtime exposes `Deno.serve(handler)` for HTTP servers with a
// Web fetch signature — almost a 1:1 match with the framework's
// dispatcher shape.
//
//   // entry.ts (Deno Deploy entry):
//   import { denoServe } from '@place-ts/component/adapters/deno'
//   import home from './pages/home.page.tsx'
//
//   await denoServe({
//     routes: { '/': home },
//   }, { port: 8000 })
//
// **Runtime constraint**: same as Cloudflare/Vercel Edge — the
// framework's build-time work (Tailwind compile, island bundling)
// uses Bun.build and node:fs / node:fs/promises, which aren't available
// in standard Deno. The practical model:
//   1. Run the build under Bun first (`PLACE_BUILD=dist bun src/app.ts`).
//   2. Deploy the static `dist/` directory + a Deno entry that serves
//      additional dynamic routes (if any).
//
// For purely static apps, Deno's `Deno.serve` isn't even needed —
// host the `dist/` directory on Deno Deploy's static-asset support.
// This adapter is the dynamic-handler escape hatch.

import type { ServeOptions } from '../serve.ts'
import { createFetchHandler } from '../serve.ts'

export interface DenoServeOptions {
  /** Port to listen on. Default: 8000. */
  port?: number
  /** Hostname to bind. Default: `0.0.0.0`. */
  hostname?: string
}

/**
 * Build the framework's request dispatcher and pass it to
 * `Deno.serve(handler)`. Awaits `Deno.serve`'s returned listener so
 * the calling script stays alive — same semantics as `Bun.serve` in
 * Bun-native dev.
 *
 * Throws a clear error if the Deno runtime isn't detected (e.g. the
 * user accidentally imported this from a Node entry).
 */
export async function denoServe(
  options: ServeOptions,
  denoOpts: DenoServeOptions = {},
): Promise<void> {
  const handler = await createFetchHandler(options)
  // biome-ignore lint/suspicious/noExplicitAny: Deno is a runtime global; no @types/deno here
  const denoGlobal = (globalThis as any).Deno as
    | { serve?: (config: object, handler: (req: Request) => Promise<Response>) => unknown }
    | undefined
  if (!denoGlobal || typeof denoGlobal.serve !== 'function') {
    throw new Error(
      'denoServe: Deno runtime not detected. This adapter only runs under Deno / Deno Deploy. ' +
        'For Bun, use `serve()` directly; for Node, use `nodeAdapter()`.',
    )
  }
  denoGlobal.serve(
    {
      port: denoOpts.port ?? 8000,
      hostname: denoOpts.hostname ?? '0.0.0.0',
    },
    handler,
  )
}
