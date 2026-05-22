// Home page. `Link` is auto-imported via the @place-ts/component
// preload plugin (bunfig.toml); `page` stays explicit (common variable
// name, prone to local shadowing).
//
// `discoverPages('./src/pages')` in `app.ts` picks this file up
// automatically — no manual registration. Adding a new page is the
// same shape: drop a `*.page.tsx` file with a default export of
// `page('/path', { view })`.

import { page } from '@place-ts/component'

export default page('/', {
  meta: { title: 'Home' },
  view: () => (
    <div class="space-y-6">
      <h1 class="text-4xl font-semibold tracking-tight">welcome to __APP_NAME__</h1>
      <p class="text-muted">
        Edit <code class="font-mono text-fg">src/pages/home.page.tsx</code> and reload — the dev
        server rebuilds automatically.
      </p>
      <p class="text-muted">
        See{' '}
        <Link to="/about" class="text-accent">
          about
        </Link>{' '}
        for a second page.
      </p>
    </div>
  ),
})
