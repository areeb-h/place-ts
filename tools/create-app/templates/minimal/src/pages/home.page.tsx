// Home page.
//
// `page` and `Link` are auto-imported via the @place-ts/component
// preload plugin (bunfig.toml) — no explicit import needed. `<Prose>`
// from @place-ts/design wraps content in opinionated reading typography.
//
// The `<Counter />` below is an island: it ships its own tiny JS
// bundle for the click handler + reactive label swap. Static parts of
// this page (the prose, the headings) ship ZERO JS — only the island
// gets hydrated.

import { Prose } from '@place-ts/design'

import Counter from '../islands/counter.tsx'

export default page('/', {
  meta: { title: 'Home' },
  view: () => (
    <Prose>
      <h1>welcome to __APP_NAME__</h1>
      <p>
        Edit <code>src/pages/home.page.tsx</code> and reload — the dev server rebuilds
        automatically.
      </p>

      <h2>Try the island below</h2>
      <p>
        It's an interactive client component. The button increments reactive state — the only
        JavaScript shipped on this page is the counter's tiny bundle.
      </p>
      <div class="my-6 not-prose">
        <Counter />
      </div>

      <h2>Next steps</h2>
      <p>
        Add another page under <code>src/pages/</code> — see <Link to="/about">about</Link> for the
        shape. Add an interactive component under <code>src/islands/</code> and import it from any
        page; only pages that actually use an island ship its bundle.
      </p>
    </Prose>
  ),
})
