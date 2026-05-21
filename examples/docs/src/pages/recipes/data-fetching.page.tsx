// /recipes/data-fetching — load() for SSR data, ISR for caching,
// useSearch for typed URL params, resource() for client-side fetches.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

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
import { page, shape, useSearch } from '@place-ts/component'

page('/posts', {
  search: shape({ page: 'number', tag: 'string?' }),
  view: (props) => {
    const { page: p, tag } = useSearch<{ page: number; tag?: string }>(props)
    return <PostList page={p} tag={tag} />
  },
})`

const RESOURCE = `// Client-side fetch with reactive status. Auto-disposes on unmount.
// The loader receives an AbortSignal — forward it so stale fetches
// are cancelled at the network layer.
import { resource } from '@place-ts/reactivity'

const data = resource((signal) =>
  fetch('/api/health', { signal }).then((r) => r.json()),
)

// The value read is the callable resource itself — data(), not
// data.value(). It returns the resolved value, or undefined while
// loading / on error. .loading() / .error() / .status() are the
// reactive status accessors.
<div>
  {() => data.loading() && <Spinner />}
  {() => data.error()   && <p>{String(data.error())}</p>}
  {() => data()         && <Status v={data()} />}
</div>

// Or switch on the discriminated status — the cleanest shape:
{() => {
  const s = data.status()
  if (s.state === 'loading') return <Spinner />
  if (s.state === 'error')   return <p>{String(s.error)}</p>
  return <Status v={s.value} />
}}`

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
        The <code>Resource</code> itself is the value accessor — call it (<code>data()</code>) to
        read the resolved value reactively; it returns <code>undefined</code> while loading or on
        error. Status lives on <code>.loading()</code>, <code>.error()</code>, and the discriminated{' '}
        <code>.status()</code>. There is no <code>.value()</code> method. Use for browser-only
        fetches that can't run on SSR.
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
