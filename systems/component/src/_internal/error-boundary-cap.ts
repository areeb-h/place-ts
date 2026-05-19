// The error-boundary capability.
//
// Extracted from index.ts (Tier 20 decomposition, cut 7b). `errorBoundary()`
// installs a handler under this capability; the runtime render paths
// (`element.ts`'s `makeView` error path, `mount.ts`'s reactive-child
// + Fragment mounters) read it via `.tryUse()` to route a caught throw
// to the nearest boundary.
//
// It lives in `_internal/` — importing only `@place/capability` — so
// every render module can share the one capability token without a
// cycle through the index barrel. `defineCapability` runs at module
// load; a leaf module keeps that evaluation order unambiguous.

import { defineCapability } from '@place/capability'

/** The capability `errorBoundary()` installs and the render paths read. */
export const ErrorBoundaryCap = defineCapability<(error: unknown) => void>('ErrorBoundary')
