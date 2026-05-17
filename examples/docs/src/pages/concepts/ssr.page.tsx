// /concepts/ssr — Server-side rendering + islands hydration in place.
//
// How `serve()` produces the initial HTML, how islands take over
// individual subtrees on the client without re-running the whole page,
// what the unified `data-view-*` wire format looks like, why the
// framework has no `'use client'` directive, and what the build-time
// classifier picks for each view.

import { Link, page } from '@place/component'
import { Callout } from '../../components/callout.tsx'
import { CodeBlock } from '@place/design'

const FLOW = `// Server (Bun.serve)
// ───────────────────
// 1. request hits serve()
// 2. router matches a Page
// 3. load() runs (if any) — returns serializable data
// 4. view() renders → HTML string
//    └── encountered island markers tracked into a per-page set
// 5. response: HTML
//    + one shared client runtime <script> (per-route splitting)
//    + one tiny <script src="/islands/<name>-<sig>.js"> per island

// Client
// ──────
// 1. browser parses HTML — links, forms, CSP, theme already live
// 2. island bundles fetch in parallel (deferred), each carries its own
//    auto-mount wrapper; SRI integrity guards each bundle
// 3. each wrapper scans for [data-view="island"][data-view-id="<name>"]
//    markers, reads data-view-props, hydrates the impl into the marker
// 4. _setHydrated(true) flips once any island mounts — onMount()
//    callbacks fire on schedule, signals attach to existing DOM nodes
//
// Pages with NO islands ship ZERO framework JS.`

const ISLAND_AUTHORING = `// An island is just a function. \`island\` and \`state\` are auto-
// imported by the framework's Bun plugin; you write zero ceremony.

const Counter = island(() => {
  const n = state(0)
  return (
    <button onClick={() => n.set(n() + 1)}>
      count: {n}
    </button>
  )
})

// Used like any other component anywhere in the tree:
<Counter />                      // hydrates on load (default)
<Counter client="visible" />     // hydrates on IntersectionObserver
<Counter client="idle" />        // hydrates on requestIdleCallback
<Counter client="interaction" /> // hydrates on first hover/focus

// At build time the plugin rewrites \`island(fn)\` to
// \`island(import.meta.url, fn)\` so the bundler knows which module
// the impl lives in. The user never types the URL boilerplate.`

const WIRE = `<!-- Server emits a typed marker, NOT a virtual-DOM hash. -->
<div
  data-view="island"
  data-view-id="counter"
  data-view-props='{"start":0}'
  data-view-strategy="visible"
>
  <!-- SSR'd content (the same view() output) lives inside. -->
  <button>count: 0</button>
</div>

<!-- One auto-mount script per island name, per page: -->
<script
  src="/islands/counter-aB3xK9pQrS_e.js"
  integrity="sha384-..."
  type="module"
  defer
></script>`

const SUSPENSE = `// suspense() takes ONE options object: { fallback, children, on }.
// It emits a comment-marker pair around its content — the fallback
// ships in the initial HTML; once every resource in \`on\` resolves,
// the framework streams a swap chunk that replaces the placeholder
// anchors. Works pre-hydration; no client JS required for the swap.
import { suspense } from '@place/component'
import { resource } from '@place/reactivity'

const article = resource(
  (signal) => fetch(\`/api/articles/\${id}\`, { signal }).then((r) => r.json()),
  { hydrationKey: \`article:\${id}\` },
)

view: () => (
  <section>
    <h1>Article</h1>
    {suspense({
      fallback: <Skeleton />,
      on: [article],
      children: () => {
        const s = article.status()
        return s.state === 'ready' ? <ArticleBody data={s.value} /> : null
      },
    })}
  </section>
)`

const NO_DIRECTIVES = `// place has no 'use client', no 'use server', no string directives.
// The split is structural — typed at the call site:
//
//   • island(fn)                    — typed wrapper, JSX-callable
//   • action({ ... handler })       — server-only fn with typed body
//   • load: ({ params }) => { ... } — typed page field
//
// The Bun plugin strips server-only branches via the
// __PLACE_BROWSER__ build define; load + on: + cap providers never
// reach the client. The classifier (build-time) reads effect brands
// off the inferred types and picks the smallest possible runtime
// per view — static / thaw / island / island+stream.

export default page('/post/:id', {
  load: async ({ params }) => ({ post: await db.find(params.id) }),
  view: ({ post }) => <Article post={post} />,
  on: {
    delete: async (_, { params }) => db.delete(params.id),  // server-only
  },
})`

export default page('/ssr', {
  // No `meta:` — auto-title from `<h1>SSR & islands hydration</h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>SSR &amp; islands hydration</h1>
      <p>
        place renders pages on the server and hydrates only the parts that need to be interactive.
        The protocol is built around three guarantees: first paint is real content, pages without
        interactivity ship zero framework JS, and each island's bundle is integrity-pinned and
        scoped to the marker the server emitted for it.
      </p>

      <h2>The lifecycle</h2>
      <CodeBlock code={FLOW} />
      <p>
        The whole-page tree runs once on the server. On the client, only{' '}
        <strong>islands</strong> rehydrate — each island's auto-mount wrapper scans for its marker,
        reads the serialized props, and mounts the impl into the existing DOM nodes. There is no
        virtual DOM, no reconciler walk over the document, and no whole-page boot step.
      </p>

      <h2>Authoring an island</h2>
      <p>
        Islands are typed JSX components, not string directives. Author shape is one line:{' '}
        <code>island(fn)</code>. The framework's Bun plugin rewrites every <code>island(fn)</code>{' '}
        to <code>island(import.meta.url, fn)</code> at load so the bundler can locate the source;
        you never type the URL boilerplate.
      </p>
      <CodeBlock code={ISLAND_AUTHORING} />
      <Callout kind="note" title="No 'use client', no magic strings">
        The island boundary is a typed function call discovered statically through{' '}
        <code>import.meta.url</code> at build time — no compiler scan for special string
        directives. See ADR 0019 for the rationale behind typed markers over string directives.
      </Callout>

      <h2>The wire format</h2>
      <p>
        SSR emits a unified <code>data-view-*</code> marker around each island's output. The
        marker is the contract between SSR and the auto-mount wrapper — the wrapper queries for
        its name, reads the props, and attaches.
      </p>
      <CodeBlock code={WIRE} lang="html" />
      <p>
        The bundle URL includes a <strong>signature suffix</strong> (a 12-char prefix of the
        SHA-384 content hash) so prod deploys cache-bust cleanly and dev HMR can tell whether a
        swap is shape-compatible. The <code>integrity="sha384-..."</code> attribute pins the exact
        bytes — encoded once, hashed, and served as the same <code>Uint8Array</code>, so
        sourcemap-bearing dev builds cannot drift from their declared hash.
      </p>

      <h2>Streaming with suspense()</h2>
      <p>
        Long-running renders ship a fallback first, then stream the resolved content in. The swap
        uses an HTML comment-marker pair as anchors; a tiny inline script replaces the placeholder
        when each chunk arrives. This works before any island bundle has loaded.
      </p>
      <CodeBlock code={SUSPENSE} />
      <p>
        ISR (incremental static regeneration) is built on the same primitive plus a typed cache
        store. See <Link to="/recipes/data-fetching">Recipes: Data fetching</Link> for the{' '}
        <code>load()</code> + <code>revalidate</code> revalidation pattern.
      </p>

      <h2>No client/server directives</h2>
      <p>
        Server-only code lives in named fields with server-only types. The framework's Bun plugin
        strips them from the client bundle alongside the build-time <code>__PLACE_BROWSER__</code>{' '}
        define.
      </p>
      <CodeBlock code={NO_DIRECTIVES} />

      <h2>The build-time classifier</h2>
      <p>
        Every <code>island(...)</code> call is classified at build time. The classifier reads
        effect brands off the inferred types — <code>state()</code> is{' '}
        <code>'state'</code>, <code>watch()</code>/<code>onMount()</code> are{' '}
        <code>'lifecycle'</code>, <code>Suspense</code> is <code>'suspense'</code> — and picks
        the smallest runtime that satisfies the body:
      </p>
      <ul>
        <li>
          <strong>static</strong> — no effects beyond pure; ships 0 bytes of JS for this view
        </li>
        <li>
          <strong>thaw</strong> — state-only; ships ~300 B of inline action AST + a shared ~1.5 KB
          runtime (Tier 9 emits this; today it falls through to <em>island</em>)
        </li>
        <li>
          <strong>island</strong> — lifecycle or DOM effects; per-island chunk + auto-mount wrapper
        </li>
        <li>
          <strong>island+stream</strong> — reads from an unresolved Suspense's resource; the chunk
          subscribes to the Channel B state envelope
        </li>
      </ul>
      <p>
        The picks are surfaced as a compact report at <code>serve()</code> startup, persisted to{' '}
        <code>dist/.place/island-entries/view-manifest.json</code>, and (in dev) clickable in the
        error overlay. The classifier is observable, not opaque.
      </p>

      <h2>Why no hydration-mismatch warnings</h2>
      <p>
        Frameworks that use a virtual-DOM reconciler at hydration compare server HTML to a fresh
        client render and warn (or worse, blow up) on differences. place doesn't do that — the
        SSR'd HTML <em>is</em> the post-hydration DOM. Signal subscriptions attach to existing
        nodes; event handlers attach to existing elements. If the server-rendered output is wrong,
        the client output is equally wrong; there's no second source of truth to diff against.
      </p>
      <p>
        For accidental divergence (e.g., <code>Date.now()</code> at the top of an island's view
        that renders differently per request), the dev hydration auditor logs attribute-level
        diffs scoped to each marker.
      </p>

      <h2>What about whole-page interactivity?</h2>
      <p>
        Reach for an island. Anything that needs a click handler, a watch, a cookie-bound signal,
        or a third-party widget that touches <code>document</code> in its constructor goes inside
        an <code>island(...)</code> call. The framework will discover it, chunk it, mount it
        without you wiring anything else. Pages that contain none ship none.
      </p>

      <h2>Related</h2>
      <ul>
        <li>
          <Link to="/api/components">
            <code>island</code>, <code>Show</code>, <code>Suspense</code>, <code>Form</code> API
          </Link>
        </li>
        <li>
          <Link to="/api/app">
            <code>app()</code> server entry
          </Link>
        </li>
        <li>
          <Link to="/recipes/streaming">Streaming SSR recipe</Link>
        </li>
      </ul>
    </article>
  ),
})
