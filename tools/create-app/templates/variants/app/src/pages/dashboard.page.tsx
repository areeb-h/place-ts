// Dashboard page — the interactive heart of the app. Composes the
// `Counter` and `Preferences` islands (the preferences island uses
// the `persistence` feature pack when enabled; otherwise it's an
// in-memory toggle).

import { page } from '@place-ts/component'
import Counter from '../islands/counter.tsx'
import Preferences from '../islands/preferences.tsx'

export default page('/dashboard', {
  meta: { title: 'Dashboard' },
  view: () => (
    <div class="space-y-10">
      <header class="space-y-2">
        <h1 class="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p class="text-muted">interactive islands hydrated after first paint.</p>
      </header>

      <section class="space-y-3">
        <h2 class="text-sm font-mono uppercase tracking-wide text-muted">Counter</h2>
        <Counter />
      </section>

      <section class="space-y-3">
        <h2 class="text-sm font-mono uppercase tracking-wide text-muted">Preferences</h2>
        <Preferences />
      </section>
    </div>
  ),
})
