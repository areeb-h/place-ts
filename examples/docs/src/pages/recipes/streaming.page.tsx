// /recipes/streaming — streaming SSR with <Suspense>. Comment-marker
// swap, no React baggage.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const STREAM = `// Mark the page streaming and wrap the slow part in <Suspense>.
page('/feed', {
  streaming: true,
  view: () => (
    <article>
      <h1>Feed</h1>
      <Sidebar />                                {/* renders in initial chunk */}
      <Suspense fallback={<FeedSkeleton />}>
        {() => <FeedItems />}                     {/* streams when ready */}
      </Suspense>
    </article>
  ),
})`

const HOW = `// What ships:
//
// 1. Initial HTML chunk:
//
//      <!--$s:1-->
//      <div class="feed-skeleton">...</div>
//      <!--/$s:1-->
//
// 2. Once FeedItems() resolves, a second chunk:
//
//      <template id="$t:1"><div class="feed-real">...</div></template>
//      <script>
//        const t = document.getElementById('$t:1').content
//        const start = document.querySelector('[data-marker="$s:1"]')
//        // ... swap into the marker comment range ...
//      </script>
//
// 3. Streaming continues until every suspense boundary resolves; the
//    framework signals "all done" with a final flush chunk.`

export default page('/streaming', {
  // String shorthand. Note: streaming pages don't yet auto-title from
  // <h1> (heading collection isn't wired through `renderToStream`),
  // so streaming pages still declare a title explicitly.
  meta: 'Streaming SSR',
  view: () => (
    <article class="prose max-w-2xl">
      <h1>Streaming SSR</h1>
      <p>
        Pages marked <code>{`streaming: true`}</code> render synchronously up to the first{' '}
        <code>{`<Suspense>`}</code> boundary, then flush. Slow children inside the boundary continue
        rendering off the critical path; each one ships a swap chunk as it resolves.
      </p>

      <h2 id="setup">Setup</h2>
      <CodeBlock code={STREAM} />
      <p>
        The above renders the sidebar and a feed skeleton in the initial chunk. The feed itself
        streams in once the data is ready — no extra fetch round-trip, no client JS to coordinate.
      </p>

      <h2 id="how">How the swap works</h2>
      <CodeBlock code={HOW} />
      <Callout kind="tip" title="Why comment markers">
        The boundaries use HTML comment pairs as the swap range — they survive JS-disabled clients
        (the fallback simply stays), they don't perturb the layout, and they let the framework
        identify boundaries without parsing the full DOM tree.
      </Callout>

      <h2 id="error-handling">Errors mid-stream</h2>
      <p>
        Errors thrown inside a streaming boundary surface to the nearest{' '}
        <code>errorBoundary()</code>; if none, the boundary's fallback stays in place. Synchronous
        errors before the first flush route to the page's <code>onError</code>.
      </p>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/components">API: Suspense + errorBoundary</Link>
        </li>
        <li>
          <Link to="/recipes/data-fetching">Data fetching</Link>
        </li>
      </ul>
    </article>
  ),
})
