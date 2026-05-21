// ===== serverRouter — METHOD + path pattern → handler dispatch =====
//
// Collapses the if/else chain that every Bun.serve fetch handler grows
// into when an app has more than 2 routes. Map of `'METHOD /pattern'`
// strings to `(req, params) => Response` handlers. Patterns leverage
// the same typed `route()` from @place-ts/routing — `:name` segments are
// captured into `params`. Use `*` for the method when matching any
// (rarely needed; method-specific is safer).
//
// Returns `(req) => Promise<Response | null>`. Null means "no route
// matched"; the caller decides the fallback (404, 405, pass-through to
// other middleware). This explicit-no-fallback shape keeps the router
// composable — nothing forced about defaults.
//
// Order matters: the FIRST matching route wins. Static paths usually
// come before parameterized ones for clarity (`/kv` before `/kv/:key`).
//
// What this router does NOT do:
//   - method-not-allowed 405 (the caller handles)
//   - automatic OPTIONS / CORS (they vary too much across apps)
//   - WebSocket upgrade detection (Bun-specific; do it in fetch directly)
//   - middleware chains (compose handlers explicitly)
//
// All of those would force conventions; this just dispatches.

import { route } from '@place-ts/routing'

export type RouteHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>

/** Match req against the routes. Returns the handler's response, or
 *  null if no route matched. */
export type ServerRouter = (req: Request) => Promise<Response | null>

export function serverRouter(routes: Record<string, RouteHandler>): ServerRouter {
  // Pre-compile patterns once at construction so the per-request hot
  // path is a single linear scan with O(routes) regex matches.
  const compiled = Object.entries(routes).map(([key, handler]) => {
    const space = key.indexOf(' ')
    if (space < 0) {
      throw new Error(
        `serverRouter: route key '${key}' must be 'METHOD /pattern' (e.g. 'GET /users/:id')`,
      )
    }
    const method = key.slice(0, space).toUpperCase()
    const pattern = key.slice(space + 1).trim()
    if (!pattern.startsWith('/')) {
      throw new Error(`serverRouter: pattern '${pattern}' must start with '/'`)
    }
    return { method, matcher: route(pattern), handler }
  })
  return async (req: Request) => {
    const url = new URL(req.url)
    for (const r of compiled) {
      if (r.method !== '*' && r.method !== req.method) continue
      const params = r.matcher.match(url.pathname)
      if (params === null) continue
      return await r.handler(req, params)
    }
    return null
  }
}
