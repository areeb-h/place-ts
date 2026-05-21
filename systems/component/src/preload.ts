// Bun preload entry — registers the framework's auto-import plugin
// globally so every file Bun loads (server-side renderer + the user's
// app entry's imports) gets the transform.
//
// Usage in the app's bunfig.toml:
//
//   preload = ["@place-ts/component/preload"]
//
// At that point a docs/page/component file like:
//
//   // src/components/some-widget.tsx
//   export const SomeWidget = () => {
//     const open = state(false)
//     return <Activity when={open}>…</Activity>
//   }
//
// works with NO `import` statements at the top. The plugin scans the
// file at load time and prepends `import { state, Activity } from
// '@place-ts/component'` only for the identifiers actually referenced.
//
// Side-effect module — importing it triggers `Bun.plugin(...)`. We
// guard against running outside of a Bun runtime so non-Bun environments
// (tests, adapters) don't crash on import.

import { placeAutoImport } from './auto-import-plugin.ts'

if (typeof Bun !== 'undefined' && typeof Bun.plugin === 'function') {
  Bun.plugin(placeAutoImport())
}
