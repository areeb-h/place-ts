// @place-ts/component/build — build-time pipeline entry.
//
// The bundler, the route splitter, the island bundler, the view
// classifier, the static-export pre-renderer, the directory scanners.
// Everything here either calls `Bun.build` or reads/writes the
// filesystem, so it ONLY runs server-side at build time.
//
// Tier 20 entrypoint split — full isolation. None of these symbols
// are reachable from the root `@place-ts/component` barrel: a client /
// island bundle that imports `@place-ts/component` cannot transitively
// reach `Bun.build`, `node:fs/promises`, or any of the other
// build-only dependencies even in its module graph. The boundary is
// an impossible import graph, not a `__PLACE_BROWSER__` dead-branch.
// The forbidden-import probe
// (`examples/docs/probes/forbidden-imports.ts`) is the runtime proof.
//
// Authoring entry points (pages, islands, client code) must never
// import from here. Server-time code (`serve()`'s orchestrator,
// `buildStatic()`'s caller, tooling like `tools/place`) is the
// expected consumer.

export { discoverIslands } from './build/discover-islands.ts'
// ----- Page + island discovery -----
export { discoverPages } from './build/discover-pages.ts'

// ----- Island bundler — per-island ESM bundles with the auto-mount
// wrapper. Used by `serve()` and probes that need to measure the
// real shipped bytes. -----
export {
  buildIslandBundles,
  type ClientCapInstall,
  type IslandBundlerOptions,
  type IslandBundlerResult,
  renderViewManifestReport,
} from './build/island-bundler.ts'

// ----- Route splitter — per-route page bundles with the shared
// chunk extracted. Used by `serve()` for production splitting. -----
export {
  buildRouteSplitBundles,
  type RouteSplitterOptions,
  type RouteSplitterResult,
} from './build/route-splitter.ts'

// ----- View classifier — reads `EffectBranded<E>` brands off the
// inferred types in an island body to pick the right hydration
// level. Drives the build report + `serve()`'s startup banner. -----
export {
  type ClassifierFinding,
  type ClassifierResult,
  classifyIslandSource,
  KNOWN_EFFECTS,
  predictBytesAtLevel,
  renderReport,
  type ViewManifest,
  type ViewManifestEntry,
} from './build/view-classifier.ts'
export {
  classifyIslandWithTypes,
  createTypedClassifierContext,
  type TypedClassifierContext,
} from './build/view-classifier-types.ts'

// ----- Static export — pre-renders pages to HTML for CDN deploys.
// Re-exported here in addition to `/server` (its historical home)
// so consumers can think of it as a build-step rather than a
// server-runtime thing. Either subpath works. -----
export { type BuildStaticOptions, type BuildStaticResult, buildStatic } from './build-static.ts'
