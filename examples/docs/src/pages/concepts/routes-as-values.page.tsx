// /concepts/routes-as-values — the routing philosophy. Why file-system
// routing is a leak; what "values" buys you for refactors, linking,
// and action calls.

import { Link, page } from '@place/component'
import { Callout } from '../../components/callout.tsx'
import { CodeBlock } from '@place/design'

const DECLARE = `// src/pages/post.page.tsx
import { page } from '@place/component'

const postPage = page('/posts/:id', {
  view: ({ id }) => <Article id={id} />,
})

export default postPage  // a value`

const REGISTER = `// src/app.ts
import post from './pages/post.page'

app({
  pages: [home, post, archive],  // explicit array, in any order
  /* ... */
}).run()`

const LINK = `import postPage from './pages/post.page'

// Anywhere in your app:
<Link to={postPage} params={{ id: '42' }}>read post</Link>

// Type error if you forget params, pass the wrong name, or move the path:
<Link to={postPage} params={{ slug: '42' }} />  // TS error: slug not in params`

const ACTION = `// post.page.tsx
const postPage = page('/posts/:id', {
  on: {
    save: async (input: { title: string }, { params }) => { /* ... */ },
  },
  view: () => (
    <button onClick={() => postPage.save({ title: 'New' })}>save</button>
  ),
})`

export default page('/routes-as-values', {
  // No `meta:` — auto-title from `<h1>Routes as values</h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>Routes as values</h1>
      <p>
        Every <code>page()</code> call produces a value. That value carries its path, its action
        callers, and its types. Move the file, the value moves; references stay sound because they
        point at the value, not the file path.
      </p>

      <h2 id="declare">Declare</h2>
      <CodeBlock code={DECLARE} />

      <h2 id="register">Register</h2>
      <p>
        Pages register through an explicit array. No file-system convention, no "must live in this
        folder", no <code>page.tsx</code> vs <code>route.tsx</code> guessing.
      </p>
      <CodeBlock code={REGISTER} />

      <h2 id="link">Link with the value</h2>
      <CodeBlock code={LINK} />
      <p>
        <code>{`<Link to={postPage} />`}</code> works because the page value carries its path AND
        its param shape. If you rename the path or change the params, every link, every action
        caller, every <code>navigate()</code> call gets a TypeScript error — the rename catches
        them.
      </p>

      <h2 id="call-actions">Call actions through the value</h2>
      <CodeBlock code={ACTION} />
      <p>
        The page value carries its action methods directly. <code>postPage.save({`{ ... }`})</code>{' '}
        is fully typed; the underlying <code>fetch</code> targets{' '}
        <code>/posts/:id/_action/save</code> with the current URL's <code>:id</code> resolved.
      </p>

      <Callout kind="tip" title="Move a file, nothing breaks">
        Because the route lives in the value, file moves are invisible to consumers. Move{' '}
        <code>post.page.tsx</code> from <code>pages/</code> to <code>features/blog/pages/</code> —
        update the import, every other line still works.
      </Callout>

      <h2 id="failure-mode">What this rules out</h2>
      <p>
        place doesn't do file-system routing. Two pages with the same path throw on register.
        There's no auto-discovery — if a page isn't in the array, it isn't served. Both are
        intentional: the routes table is exactly the array you wrote.
      </p>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/page">API: page()</Link>
        </li>
        <li>
          <Link to="/why">Why place</Link>
        </li>
      </ul>
    </article>
  ),
})
