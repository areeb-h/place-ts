// @place/component/server — server-only entry.
//
// Everything here runs on the server or at build time: the renderers,
// the Bun.serve orchestrator, `action()` handlers, the page/app
// builders, cookies, security headers, the static exporter, the SSR
// post-render helpers. None of it belongs in a client or island
// bundle.
//
// Tier 20 entrypoint split: a server entry imports this; a
// client/island entry must not. The forbidden-import probe
// (`examples/docs/probes/forbidden-imports.ts`) enforces that nothing
// reachable from here lands in an emitted client bundle.
//
// Curated re-export of `./index.ts` — additive: `@place/component`
// (the root) still exposes every name for back-compat while the
// physical decomposition (Tier 20 cuts 3-5) moves the code behind
// this entry.
export {
  // rendering
  renderToString,
  renderToStream,
  type RenderToStreamOptions,
  renderToHtml,
  type RenderToHtmlOptions,
  renderPage,
  type RenderPageOptions,
  // serving
  serve,
  type ServeOptions,
  type ServeRoutes,
  type ServeTailwindOptions,
  resolveTailwindFromTheme,
  type Builder,
  type Adapter,
  // app
  app,
  type App,
  type AppConfig,
  type AppOptions,
  type CapInstall,
  type RoutesOptions,
  routes,
  // request handling
  handler,
  type Handler,
  type HandlerOptions,
  serverRouter,
  type RouteHandler,
  type ServerRouter,
  notFound,
  type LoadCtx,
  parseCookieHeader,
  // actions
  action,
  type Action,
  type ActionDef,
  ActionError,
  type ActionSchema,
  fromStandard,
  isValidationFailure,
  resolveActionUrl,
  type ShapeField,
  type ShapeOf,
  shape,
  type StandardSchemaV1,
  type ValidationFailure,
  // caching / ISR
  cache,
  memoryStore,
  type CacheEntry,
  type CacheOptions,
  type CacheStore,
  revalidate,
  // static export
  buildStatic,
  type BuildStaticOptions,
  type BuildStaticResult,
  discoverPages,
  // security headers
  generateScriptNonce,
  renderSecurityHeaders,
  type CSPConfig,
  type CSPDirective,
  type CSPSource,
  type CrossOriginEmbedderPolicy,
  type CrossOriginOpenerPolicy,
  type CrossOriginResourcePolicy,
  type HSTSConfig,
  type PermissionsPolicyConfig,
  type ReferrerPolicy,
  type RenderSecurityOptions,
  type Security,
  type SecurityOptions,
  type SecurityPreset,
  // SSR post-render helpers
  extractMainHeadings,
  patchIslandMarker,
  rerenderIsland,
  slugifyHeading,
} from './index.ts'
