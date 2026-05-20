// Ambient declarations for the framework's auto-imported identifiers.
//
// The Bun plugin (`placeAutoImport()`, registered via the project's
// `preload = ["@place/component/preload"]` entry in `bunfig.toml`)
// prepends actual `import { … }` lines at build/load time. TypeScript
// reads THIS file to keep type-checking happy in editor and `tsc`.
//
// Include it via tsconfig:
//
//   {
//     "compilerOptions": {
//       "types": ["@place/component/auto-imports"]
//     }
//   }
//
// or by adding this file to the project's `include` array.
//
// Keep the global names list in sync with `PLACE_AUTO_IMPORTS` in
// `auto-import-plugin.ts` — same registry, two consumers (one for
// the runtime build, one for the type-checker).

import type {
  Activity as _Activity,
  cookie as _cookie,
  cookieState as _cookieState,
  derived as _derived,
  Fragment as _Fragment,
  island as _island,
  onCleanup as _onCleanup,
  onMount as _onMount,
  setTheme as _setTheme,
  Show as _Show,
  state as _state,
  Tab as _Tab,
  Tabs as _Tabs,
  tabsState as _tabsState,
  themeTokens as _themeTokens,
  untrack as _untrack,
  watch as _watch,
} from './index.ts'

declare global {
  // ----- Build-time defines (set by Bun.build via `define:`) -----
  // `true` in the framework's client bundle, `undefined` on the server
  // runtime. Use to gate server-only code so the bundler can drop it
  // from the browser bundle (see `serve()`'s ternary in component
  // index for the canonical usage).
  const __PLACE_BROWSER__: boolean | undefined
  // ----- Reactivity -----
  const state: typeof _state
  const watch: typeof _watch
  const derived: typeof _derived
  const untrack: typeof _untrack
  // ----- Lifecycle -----
  const onMount: typeof _onMount
  const onCleanup: typeof _onCleanup
  // ----- Cookies + persistence -----
  const cookie: typeof _cookie
  const cookieState: typeof _cookieState
  // ----- Components -----
  const island: typeof _island
  const Tab: typeof _Tab
  const Tabs: typeof _Tabs
  const tabsState: typeof _tabsState
  const Activity: typeof _Activity
  const Show: typeof _Show
  const Fragment: typeof _Fragment
  // ----- Theme -----
  const setTheme: typeof _setTheme
  const themeTokens: typeof _themeTokens
}
