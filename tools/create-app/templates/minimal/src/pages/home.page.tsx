// The home page. A `page()` is a value — its route is the first
// argument, so the route survives a rename and TypeScript catches
// every stale reference. This page has no interactive island, so it
// ships zero framework JavaScript to the browser.

import { page } from '@place/component'

export const homePage = page('/', {
  meta: {
    title: '__APP_NAME__',
    description: 'A place app.',
  },
  view: () => (
    <main style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 720px; margin: 4rem auto; padding: 0 1rem; line-height: 1.6">
      <h1 style="font-size: 2rem; margin: 0 0 1rem 0">welcome to __APP_NAME__</h1>
      <p>
        Edit{' '}
        <code style="background: #f3f3f3; padding: 0.1rem 0.4rem; border-radius: 0.25rem">
          src/pages/home.page.tsx
        </code>{' '}
        and reload — the dev server rebuilds automatically.
      </p>
      <p>
        Need interactivity? Add an island under{' '}
        <code style="background: #f3f3f3; padding: 0.1rem 0.4rem; border-radius: 0.25rem">
          src/islands/
        </code>
        , point <code>islandsDir</code> at it in <code>src/app.ts</code>, and drop it into a page.
        Only pages that use an island ship any JavaScript at all.
      </p>
    </main>
  ),
})
