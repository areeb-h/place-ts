// @place/component/internal — internal, test-accessible exports.
//
// Underscore-prefixed helpers the framework's own tests reach for:
// the hydration auditor + flag, the SSR collection scopes, the island
// registry setters. NOT a public API — no stability guarantee. The
// root `@place/component` still re-exports these for now; this entry
// is where they belong, and where the test suite should import them
// from once migrated.
//
// Curated re-export of `./index.ts` — additive (see ./server.ts).
export {
  _auditHydrationFrame,
  _drainHydrationDeltas,
  _flushHydrationDeltas,
  _readHydrated,
  _readHydrationDeltas,
  _setHydrated,
  type HydrationDelta,
  _beginHeadingCollection,
  _endHeadingCollection,
  _getFirstH1Text,
  _consumeTabsUsedFlag,
  _beginIslandCollection,
  _endIslandCollection,
  _beginInlineStyleCollection,
  _endInlineStyleCollection,
  _setIslandRegistry,
  _getIslandRegistry,
  _setIslandBundleUrls,
  _getIslandBundleUrl,
  _setSharedChunkUrls,
  _getSharedChunkUrls,
  _drainPendingIslands,
} from './index.ts'
