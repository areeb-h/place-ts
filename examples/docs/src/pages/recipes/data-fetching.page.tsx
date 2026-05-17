// /recipes/data-fetching — load() for SSR data, ISR for caching,
// useSearch for typed URL params, resource() for client-side fetches.

import { Link, page } from '@place/component'
import { Callout } from '../../components/callout.tsx'
import { CodeBlock } from '@place/design'

const LOAD = `// Server-only loader. Result is serialized into the SSR'd HTML
// and read back on the client at boot.
page('/posts/:id', {
  load: async ({ params }) => ({
    post: await db.posts.findOne(params.id),
  }),
  view: ({ post }) => <Article post={post} />,
})`

const ISR = `// Lazy stale-while-revalidate. The first request after \`maxAge\`
// returns the stale value and triggers a background regeneration.
page('/blog/:slug', {
  load: async ({ params }) => ({ post: await fetchPost(params.slug) }),
  revalidate: { maxAge: 60 * 1000 },   // 60 seconds
  view: ({ post }) => <Article post={post} />,
})`

const SEARCH = `// Typed search params with shape() validation.
import { page, shape, useSearch } from '@place/component'

page('/posts', {
  search: shape({ page: 'number', tag: 'string?' }),
  view: (props) => {
    const { page: p, tag } = useSearch<{ page: number; tag?: string }>(props)
    return <PostList page={p} tag={tag} />
  },
})`

const RESOURCE = `// Client-side fetch with reactive status. Auto-disposes on unmount.
import { resource } from '@place/reactivity'

const data = resource(() => fetch('/api/health').then((r) => r.json()))

<div>
  {() => data.loading() && <Spinner />}
  {() => data.error()   && <p>{data.error().message}</p>}
  {() => data.value()   && <Status v={data.value()} />}
</div>`

export default page('/data-fetching', {
  // No `meta:` — auto-title from `<h1>Data fetching</h1>`.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>Data fetching</h1>
      <p>
        Three patterns. <code>load()</code> for server-rendered data. <code>revalidate</code> for
        cached data with background refresh. <code>resource()</code> for client-only fetches with
        reactive status.
      </p>

      <h2 id="load">load() — server-rendered</h2>
      <CodeBlock code={LOAD} />
      <Callout kind="note">
        <code>load</code> runs server-side; the return type is serialized to JSON and read back at
        client boot. Don't return classes or functions — they won't survive the round-trip.
      </Callout>

      <h2 id="isr">ISR — lazy stale-while-revalidate</h2>
      <CodeBlock code={ISR} />
      <p>
        After <code>maxAge</code> the cache is stale: the next request gets the stale value
        immediately, and a background revalidation refreshes it. Same shape as Next's ISR; no Vercel
        runtime required.
      </p>

      <h2 id="search">Typed URL params</h2>
      <CodeBlock code={SEARCH} />

      <h2 id="resource">resource() — client-only</h2>
      <CodeBlock code={RESOURCE} />
      <p>
        <code>resource()</code> returns reactive <code>value()</code>, <code>loading()</code>, and{' '}
        <code>error()</code> functions. Use for browser-only fetches that can't run on SSR.
      </p>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/page">API: page() — load + revalidate + search</Link>
        </li>
        <li>
          <Link to="/recipes/streaming">Streaming SSR</Link>
        </li>
      </ul>
    </article>
  ),
})
