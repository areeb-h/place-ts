// Round 7 — collapsed isomorphic entry. One config + `.run()`.
//
// The framework handles:
//   - Server vs client dispatch (no `typeof window` branch)
//   - Port discovery (process.env.PORT or 5174)
//   - Browser-only capability installation
//   - Page bundling + hydration
//
// Pages register themselves via this list; each page's `path` becomes
// its route key. The `caps` array installs browser-only capabilities
// before `.boot()` — no manual `RouterCap.install(pathRouter())` calls.

import { app } from '@place/component'
import { pathRouter, RouterCap } from '@place/routing'
import { rootLayout } from './layouts/root.layout.tsx'
import home from './pages/home.page.tsx'
import note from './pages/note.page.tsx'
import noteEdit from './pages/note-edit.page.tsx'
import tag from './pages/tag.page.tsx'
import tags from './pages/tags.page.tsx'
import { inMemoryNoteStore, NoteStoreCap, SEED_NOTES, seedStore } from './store.ts'
import { tokens } from './theme.ts'

export default app({
  name: '@place/commonplace',
  pages: [home, note, noteEdit, tags, tag],
  layout: rootLayout,
  theme: tokens,
  tailwind: true,
  security: 'standard',
  viewTransitions: true,
  clientEntry: `${import.meta.dir}/app.ts`,
  caps: [
    // RouterCap: browser-only. SSR doesn't need a router — pages that
    // read URL params do so via `params` from LoadCtx (or component-
    // auto-ClientOnly catches the SSR abort and emits a placeholder).
    [RouterCap, pathRouter],
    // NoteStoreCap: per-runtime. SSR uses an in-memory store seeded
    // with `SEED_NOTES` so the home page paints with real notes on
    // first byte (no auto-placeholder blip). The client install
    // replaces it with the localStorage-backed store on `.boot()` so
    // user edits persist.
    [
      NoteStoreCap,
      {
        server: () => inMemoryNoteStore(SEED_NOTES),
        client: seedStore,
      },
    ],
  ],
}).run()
