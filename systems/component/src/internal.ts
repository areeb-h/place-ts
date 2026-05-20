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
  _beginHeadingCollection,
  _beginInlineStyleCollection,
  _beginIslandCollection,
  _consumeTabsUsedFlag,
  _drainHydrationDeltas,
  _drainPendingIslands,
  _endHeadingCollection,
  _endInlineStyleCollection,
  _endIslandCollection,
  _flushHydrationDeltas,
  _getFirstH1Text,
  _getIslandBundleUrl,
  _getIslandRegistry,
  _getSharedChunkUrls,
  _readHydrated,
  _readHydrationDeltas,
  _setHydrated,
  _setIslandBundleUrls,
  _setIslandRegistry,
  _setSharedChunkUrls,
  type HydrationDelta,
} from './index.ts'
