// API reference for `page()`. Signature + every option + concrete
// examples. The level of detail one expects from a real docs site —
// what each field does, when to use it, what the failure mode is when
// you forget it.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'

const SIG = `page<U, L, S>(
  path: string,
  def: PageDef<U, L, S>,
): Page<U, L, S>`

const VIEW = `view: (props) => <article>{props.title}</article>`

const META = `// Three accepted shapes:
meta: 'My page'                                  // string shorthand → { title }
meta: { title: 'My page', og: { ... } }          // full object
meta: (props) => \`\${props.title} — My site\`    // function returning either

// Or drop \`meta:\` entirely — the framework auto-promotes the first
// <h1> in the body. With a layout that declares
// \`titleTemplate: '%s · my site'\`, this is all you need:
view: () => <article><h1>My page</h1>…</article>`

const LOAD = `load: async ({ params }) => ({
  post: await db.posts.findOne(params.id),
})`

const SEARCH = `search: shape({ page: 'number', tag: 'string?' })`

const URL_FN = `url: (url, params) => ({ id: params.id })`

const ON = `on: {
  save: async (input: { title: string }, { params }) => {
    await db.posts.update(params.id, input)
    return { ok: true }
  },
}`

export default page('/page', {
  // No `meta:` — auto-title from `<h1><code>page()</code></h1>`.
  // The framework reads heading text (childToText) so `<code>` is unwrapped:
  // the title resolves to `page() · place docs` via the layout's template.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>
        <code>page()</code>
      </h1>
      <p>
        Declares a route. Each <code>page()</code> call produces a value (a Page object) that{' '}
        <code>app()</code>'s pages array registers; the framework derives the routes table from each
        page's <code>path</code> field.
      </p>

      <h2>Signature</h2>
      <CodeBlock code={SIG} />
      <p>
        <code>U</code> is URL-derived props (from <code>url()</code>), <code>L</code> is load-data
        shape, <code>S</code> is the typed <code>search</code> schema return. All three default to
        sensible empty shapes when omitted.
      </p>

      <h2>Options</h2>

      <h3>
        <code>view</code> (required)
      </h3>
      <p>
        The render function. Receives the merged{' '}
        <code>{`{ ...urlProps, ...loadData, search }`}</code> object. Return a View — JSX or any{' '}
        <code>el()</code>/factory call.
      </p>
      <CodeBlock code={VIEW} />

      <h3>
        <code>meta</code>
      </h3>
      <p>
        Document metadata. Static value or a function of the merged props for dynamic titles.
        Server-side only — the framework emits the head tags in the SSR'd HTML.
      </p>
      <CodeBlock code={META} />

      <h3>
        <code>load</code>
      </h3>
      <p>
        Server-only data loader. Result is serialized into the SSR'd HTML and read back by the
        client at boot. Sync or async. Receives a <code>LoadCtx</code> with{' '}
        <code>{`{ req, url, params }`}</code>.
      </p>
      <CodeBlock code={LOAD} />

      <h3>
        <code>search</code>
      </h3>
      <p>
        Validates URL query params before <code>view()</code>. Pair with{' '}
        <Link to="/getting-started">
          <code>useSearch&lt;T&gt;(props)</code>
        </Link>{' '}
        in the view to get a typed accessor at the call site.
      </p>
      <CodeBlock code={SEARCH} />

      <h3>
        <code>url</code>
      </h3>
      <p>
        Pure URL-derived props. Runs on both server and client. Use for params extraction or
        transforms.
      </p>
      <CodeBlock code={URL_FN} />

      <h3>
        <code>on</code>
      </h3>
      <p>
        Co-located actions. Each entry becomes a typed caller <code>pageRef.{`{key}`}(input)</code>{' '}
        + an auto-registered <code>POST {`{path}/_action/{key}`}</code> endpoint with the full
        security pipeline (auto-CSRF, same-origin, body-limit, proto-pollution).
      </p>
      <CodeBlock code={ON} />

      <h3>
        <code>onError</code> + <code>onNotFound</code>
      </h3>
      <p>
        Per-page error views. <code>onError</code> renders when <code>load()</code> or{' '}
        <code>view()</code> throws; <code>onNotFound</code> renders on a thrown{' '}
        <code>notFound()</code> signal. Falls back to the global serve-level handlers when absent.
      </p>

      <h3>
        <code>layout</code>
      </h3>
      <p>
        Layout chain wrapping this page. Layouts compose outside-in:{' '}
        <code>{`layout: [rootLayout, sectionLayout]`}</code>. Each layout's <code>load()</code> runs
        in chain order; merged load-data flows into all layouts' <code>view</code>/<code>meta</code>{' '}
        plus the page's.
      </p>

      <h3>
        <code>styles</code> · <code>headers</code> · <code>revalidate</code> ·{' '}
        <code>streaming</code>
      </h3>
      <p>
        Stylesheets (inline or external), extra response headers, ISR config (lazy SWR), and
        streaming-SSR opt-in. See the source for full type definitions; defaults are chosen so the
        simple case requires nothing.
      </p>

      <hr />

      <h2>Failure modes</h2>
      <ul>
        <li>
          <code>page('/x')</code> without a <code>def</code> throws at runtime with
          <em> "the second argument (definition) is required."</em>
        </li>
        <li>
          <code>page('foo', def)</code> (path doesn't start with <code>/</code>) throws at runtime.
        </li>
        <li>
          <code>page(def)</code> with an <code>on:</code> dict throws — the <code>on:</code>
          handlers need a path to compose with.
        </li>
        <li>
          Two pages with the same path → <code>app()</code> throws on registration with{' '}
          <em>"duplicate path"</em>.
        </li>
      </ul>

      <hr />

      <h2>See also</h2>
      <ul>
        <li>
          <Link to="/getting-started">Getting started</Link> — five-minute walkthrough
        </li>
        <li>
          <code>app()</code> — registers pages, dispatches to server or client
        </li>
        <li>
          <code>layout()</code> — composable layout primitive
        </li>
        <li>
          <code>action()</code> — standalone action factory (when <code>on:</code> is the wrong
          shape)
        </li>
      </ul>
    </article>
  ),
})
