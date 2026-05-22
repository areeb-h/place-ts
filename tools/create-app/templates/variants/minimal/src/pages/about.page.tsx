// About page. Demonstrates the same `page('/path', { view })` shape —
// the framework auto-discovers every `*.page.tsx` under `src/pages/`.

import { page } from '@place-ts/component'

export default page('/about', {
  meta: { title: 'About' },
  view: () => (
    <div class="space-y-6">
      <h1 class="text-4xl font-semibold tracking-tight">About __APP_NAME__</h1>
      <p class="text-muted">
        This page lives at <code class="font-mono text-fg">src/pages/about.page.tsx</code>.
      </p>
      <h2 class="text-xl font-semibold pt-4">Layouts persist across navigation</h2>
      <p class="text-muted">
        Click{' '}
        <Link to="/" class="text-accent">
          Home
        </Link>{' '}
        in the header. Only the children of the layout re-render — the header and footer stay alive.
      </p>
    </div>
  ),
})
