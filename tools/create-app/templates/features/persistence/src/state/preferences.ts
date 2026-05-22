// Sample persisted state — survives page reloads + sync across tabs.
//
// `persistedState(adapter)` wraps a reactive `State<T>` with an
// adapter that loads on creation and saves on every write. The
// `localStorageAdapter` is the simplest; swap with `indexedDBAdapter`
// for larger payloads, or `serverAdapter` to round-trip via your API.
//
// To use: import `preferences` in any island and call `preferences.read()`
// for the value, `preferences.write({...})` to update.
//
// Note: client-only. Server-side renders see the initial defaults
// (the adapter no-ops on the server). Hydration reconciles to the
// stored value on first paint.

import { localStorageAdapter, persistedState } from '@place-ts/persistence'

export interface Preferences {
  density: 'compact' | 'comfortable' | 'cozy'
  notifyOn: 'all' | 'mentions' | 'none'
}

const defaults: Preferences = { density: 'comfortable', notifyOn: 'mentions' }

export const { state: preferences } = persistedState(
  localStorageAdapter<Preferences>('__APP_NAME__:preferences', defaults),
)
