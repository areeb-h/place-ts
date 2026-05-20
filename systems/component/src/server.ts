// @place/component/server — server-only entry.
//
// Everything here runs on the server or at build time: the renderers,
// the Bun.serve orchestrator, `action()` handlers, the page/app
// builders, cookies, security headers, the static exporter, the SSR
// post-render helpers.
//
// Tier 20 entrypoint split — full isolation. The node/Bun-carrying
// surface (`serve`, `app`, `routes`, `buildStatic`, `discoverPages`,
// the security-header presets) is re-exported HERE and nowhere else:
// the root `@place/component` barrel no longer exposes it, so a
// client/island bundle that imports `@place/component` cannot reach
// `Bun.serve` / `Bun.build` / `node:*` even in its module graph —
// the boundary is an impossible import graph, not a `__PLACE_BROWSER__`
// dead-branch. The forbidden-import probe
// (`examples/docs/probes/forbidden-imports.ts`) is the runtime proof.
//
// The node-free, server-conceptual symbols (`renderToString`,
// `renderPage`, `handler`, `action`, …) still live on the root barrel
// — they are safe anywhere — and are re-exported from there for a
// single server-side import surface.

export {
  type App,
  type AppConfig,
  type AppOptions,
  app,
  type CapInstall,
  type RoutesOptions,
  routes,
} from './app.ts'
export { discoverPages } from './build/discover-pages.ts'
export { type BuildStaticOptions, type BuildStaticResult, buildStatic } from './build-static.ts'
// ----- criticalAction — high-assurance server actions -----
export {
  type CriticalAction,
  type CriticalActionCtx,
  type CriticalActionDef,
  criticalAction,
  deriveMacaroonKey,
  deriveSessionKey,
  perm,
  type PermDeclaration,
  provisionActionKey,
  provisionMacaroon,
} from './critical-action.ts'
// ----- node-free, also on the root `@place/component` barrel -----
export {
  type Action,
  type ActionDef,
  ActionError,
  type ActionSchema,
  // actions
  action,
  type CacheEntry,
  type CacheOptions,
  type CacheStore,
  // caching / ISR
  cache,
  // SSR post-render helpers
  extractMainHeadings,
  fromStandard,
  type Handler,
  type HandlerOptions,
  // request handling
  handler,
  isValidationFailure,
  type LoadCtx,
  memoryStore,
  notFound,
  parseCookieHeader,
  patchIslandMarker,
  type RenderPageOptions,
  type RenderToHtmlOptions,
  type RenderToStreamOptions,
  type RouteHandler,
  renderPage,
  renderToHtml,
  renderToStream,
  // rendering
  renderToString,
  rerenderIsland,
  resolveActionUrl,
  revalidate,
  type ServerRouter,
  type ShapeField,
  type ShapeOf,
  type StandardSchemaV1,
  serverRouter,
  shape,
  slugifyHeading,
  type ValidationFailure,
} from './index.ts'

export {
  type CrossOriginEmbedderPolicy,
  type CrossOriginOpenerPolicy,
  type CrossOriginResourcePolicy,
  type CSPConfig,
  type CSPDirective,
  type CSPSource,
  generateScriptNonce,
  type HSTSConfig,
  type PermissionsPolicyConfig,
  type ReferrerPolicy,
  type RenderSecurityOptions,
  renderSecurityHeaders,
  type Security,
  type SecurityOptions,
  type SecurityPreset,
  sha256Base64,
} from './security-headers.ts'
// ----- node/Bun-carrying — server-only, NOT on the root barrel -----
export {
  type Adapter,
  type Builder,
  resolveTailwindFromTheme,
  type ServeOptions,
  type ServeRoutes,
  type ServeTailwindOptions,
  serve,
} from './serve.ts'
