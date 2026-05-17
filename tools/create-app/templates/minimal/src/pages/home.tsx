// Landing page. Defines view + meta. `serve()` wraps this in the SSR
// pipeline; client `boot()` adopts the SSR'd DOM via hydrate().

import { page } from '@place/component'

export const homePage = page({
  meta: {
    title: '__APP_NAME__',
    description: 'A place-ts project.',
  },
  view: () => (
    <main style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 720px; margin: 4rem auto; padding: 0 1rem; line-height: 1.6">
      <h1 style="font-size: 2rem; margin: 0 0 1rem 0">welcome to __APP_NAME__</h1>
      <p>
        Edit{' '}
        <code style="background: #f3f3f3; padding: 0.1rem 0.4rem; border-radius: 0.25rem">
          src/pages/home.tsx
        </code>{' '}
        and the page hot-reloads via <code>bun --watch</code>.
      </p>
      <p>
        Read the docs at <a href="https://github.com/place-ts">github.com/place-ts</a> (placeholder
        URL — replace with the real one once published).
      </p>
    </main>
  ),
})
