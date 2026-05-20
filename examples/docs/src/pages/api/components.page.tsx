// /api/components — typed component primitives.
//
// Leads with `island()` because that's the hydration boundary in
// place's islands-only model. Then the boundary helpers that compose
// inside or outside islands: Show, Suspense, errorBoundary, Form,
// keyed, virtualList.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'
import { Callout } from '../../components/callout.tsx'

const ISLAND = `// \`island\`, \`state\`, \`onMount\` auto-imported via the @place/component
// Bun plugin (registered via bunfig.toml \`preload\`).

const Counter = island((props: { start?: number }) => {
  const n = state(props.start ?? 0)
  return (
    <button onClick={() => n.set(n() + 1)}>
      count: {n}
    </button>
  )
})

// Use anywhere — JSX-callable, props flow naturally:
<Counter start={5} />`

const ISLAND_EXPLICIT = `// Equivalent to the sugar form above; the plugin rewrites
// island(fn) → island(import.meta.url, fn) at load time. Reach for the
// explicit form only if you're NOT using the framework's Bun plugin
// (tests importing island directly, custom build pipelines, etc.).

const Counter = island(import.meta.url, (props: { start?: number }) => {
  const n = state(props.start ?? 0)
  return <button onClick={() => n.set(n() + 1)}>count: {n}</button>
})`

const ISLAND_STRATEGIES = `// The framework-reserved 'client' prop picks a hydration strategy.
// Defaults to 'load' (hydrate as soon as the bundle parses).

<Counter />                      // load
<Counter client="visible" />     // hydrate on IntersectionObserver
<Counter client="idle" />        // hydrate on requestIdleCallback
<Counter client="interaction" /> // hydrate on first hover/focus`

const SHOW = `import { Show, state } from '@place/component'

const open = state(false)

<Show when={() => open()} fallback={null}>
  {() => <Modal />}
</Show>`

const TABS = `// \`Tabs\` and \`Tab\` are auto-imported. Pass <Tab> children with a
// label; the framework SSR-renders triggers + panels and inlines a
// tiny delegated click handler for interactivity (no per-instance JS).

<Tabs group="hello">
  <Tab label="place">
    <CodeBlock code={PLACE_HELLO} />
  </Tab>
  <Tab label="Next.js">
    <CodeBlock code={NEXT_HELLO} />
  </Tab>
</Tabs>`

const TABS_VARIANTS = `// Quick visual variants. \`classes\` still overrides everything
// for full control.

<Tabs group="hello" variant="card" />        // default — bordered box
<Tabs group="hello" variant="underline" />   // bottom-rule, no outer border
<Tabs group="hello" variant="pill" />        // rounded pill triggers
<Tabs group="hello" variant="ghost" />       // minimal — no chrome

// Full custom theming:
<Tabs group="hello" classes={{
  root: 'rounded-xl border border-cyan-500/30',
  list: 'flex bg-cyan-950/20 border-b border-cyan-500/30',
  trigger: 'py-2 px-4 text-cyan-200/70 hover:text-cyan-100 cursor-pointer',
  triggerActive: 'text-cyan-300 underline underline-offset-4',
}}>
  ...
</Tabs>`

const TABS_FILTER = `// Tabs as a filter trigger — no panel content.
// \`tabsState(group)\` returns a reactive State<string> bound to the
// active tab: cookie-persisted on the server, auto-updated on clicks
// on the client. One line — no event listeners, no manual binding.

<Tabs group="todo-filter" variant="pill" classes={{ root: 'mb-3' }}>
  <Tab label="all" />
  <Tab label="active" />
  <Tab label="done" />
</Tabs>

// In an island anywhere on the page:
const TodoList = island(() => {
  const filter = tabsState('todo-filter', 'all')
  return (
    <ul>
      {() => items
        .filter(item => filter() === 'all' || item.status === filter())
        .map(item => <li>{item.label}</li>)}
    </ul>
  )
})`

const SUSPENSE = `import { Suspense } from '@place/component'

<Suspense fallback={<Spinner />}>
  {() => <AsyncRenderedChild />}
</Suspense>`

const ERROR = `import { errorBoundary } from '@place/component'

errorBoundary({
  children: () => <Risky />,
  fallback: (err) => <p>Failed: {err.message}</p>,
})`

const FORM = `import { Form, action, shape } from '@place/component'

const subscribe = action({
  path: 'POST /api/subscribe',
  input: shape({ email: 'string' }),
  fn: async ({ email }) => { /* ... */ return { ok: true } },
})

<Form action={subscribe}>
  <input name="email" type="email" required />
  <button>Subscribe</button>
</Form>`

const KEYED = `import { keyed } from '@place/component'

<ul>
  {keyed(() => items, (item) => item.id, (item) => (
    <li>{() => item.label}</li>
  ))}
</ul>`

const VLIST = `import { virtualList } from '@place/component'

const list = virtualList({
  count: () => rows.length,
  estimateSize: () => 32,
})

<div ref={list.scrollEl} style="height: 400px; overflow: auto;">
  <div style={() => \`height: \${list.totalSize()}px; position: relative;\`}>
    {() => list.visible().map((v) => (
      <div style={\`position: absolute; top: \${v.start}px; height: \${v.size}px;\`}>
        {rows[v.index].name}
      </div>
    ))}
  </div>
</div>`

const COMPONENT = `import { component } from '@place/component'

// Plain components compose on both runtimes. No SSR opt-out flag
// needed — anything that requires interactivity goes inside an
// island() instead.
const Heading = component((props: { children: unknown }) => (
  <h2 class="prose-heading">{props.children}</h2>
))`

export default page('/components', {
  // String shorthand — h1 says 'Component primitives' but search-friendly
  // title lists each primitive name. Layout adds ' · place docs'.
  meta: 'island · Tabs · Show · Suspense · Form',
  view: () => (
    <article class="prose max-w-2xl">
      <h1>Component primitives</h1>
      <p>
        The typed components that compose pages: the island boundary, conditional rendering, the
        streaming suspense boundary, the form helper, list keying, and the windowed list. Each runs
        on both the server and the client; islands additionally chunk the client portion.
      </p>

      <h2 id="island">island()</h2>
      <p>
        The hydration boundary. <code>island(fn)</code> wraps a render function as a JSX-callable
        component; pages that render the result emit a typed <code>data-view="island"</code> marker,
        and the framework's bundler produces a per-island chunk that the marker's auto-mount wrapper
        hydrates into the existing DOM.
      </p>
      <CodeBlock code={ISLAND} />
      <p>
        Pages without any island call ship <strong>zero</strong> framework JS. Pages with islands
        ship one chunk per <em>distinct</em> island used on the page, plus a small shared client
        runtime emitted by per-route bundle splitting.
      </p>

      <Callout kind="note" title="What the plugin does for you">
        The framework's Bun plugin (registered via <code>preload</code> in <code>bunfig.toml</code>)
        rewrites <code>island(fn)</code> to <code>island(import.meta.url, fn)</code> at load time so
        the bundler can locate the source. You write the sugar form; the build emits the typed
        shape.
      </Callout>

      <h3 id="island-explicit">Without the plugin</h3>
      <CodeBlock code={ISLAND_EXPLICIT} />

      <h3 id="island-strategies">Hydration strategies</h3>
      <CodeBlock code={ISLAND_STRATEGIES} />
      <p>
        The <code>client</code> prop is reserved by the framework and stripped before props reach
        the impl. The strategy controls when the auto-mount wrapper attaches; it never affects SSR
        output.
      </p>

      <h2 id="show">Show</h2>
      <CodeBlock code={SHOW} />
      <p>
        Conditional render. <code>when</code> is a reactive predicate; truthy renders{' '}
        <code>children()</code>, falsy renders <code>fallback</code> (or nothing). Both branches are
        lazy — only the active branch evaluates.
      </p>
      <Callout kind="tip" title="Replaces the function-in-JSX pattern">
        Prefer <code>{`<Show when={...}>`}</code> over <code>{`{() => cond ? <X /> : null}`}</code>{' '}
        in JSX children — same semantics, reads better, and the intent is named.
      </Callout>

      <h2 id="tabs">Tabs &amp; Tab</h2>
      <CodeBlock code={TABS} />
      <p>
        Composable tabs primitive. Pass <code>&lt;Tab label="..."&gt;</code> children; each tab's
        label travels with its panel content (no parallel arrays to keep in sync). When{' '}
        <code>group</code> is set, the framework auto-wires a <code>place-tab-${'{group}'}</code>{' '}
        cookie so the active tab persists across reloads. First paint shows the cookie-resolved tab
        with no JS.
      </p>
      <p>
        Interactivity rides on a single document-level delegated click handler the framework inlines
        once per page (when any <code>&lt;Tabs&gt;</code> renders) — no per-instance JS bundle.
        Keyboard navigation (Arrow keys, Home, End) is included.
      </p>

      <h3 id="tabs-variants">Variants &amp; customization</h3>
      <CodeBlock code={TABS_VARIANTS} />
      <Callout kind="tip" title="CodeBlock inside Tabs">
        Drop a <code>&lt;CodeBlock&gt;</code> directly inside a <code>&lt;Tab&gt;</code> and the
        docs styles automatically strip its outer border so the two don't double up visually.
      </Callout>

      <h3 id="tabs-filter">As a filter trigger</h3>
      <p>
        Tabs without panel content work as a filter selector. Each tab click dispatches a{' '}
        <code>place:tabs</code> CustomEvent that bubbles to <code>document</code>, with{' '}
        <code>detail.group</code> and <code>detail.value</code>. Subscribe from any island to drive
        reactive state.
      </p>
      <CodeBlock code={TABS_FILTER} />
      <p>
        Cookie persistence still applies — reload the page and the same filter tab stays active. The
        framework's tabs runtime handles the click → cookie write → DOM swap atomically; islands
        subscribe to the event for the reactive side.
      </p>

      <h2 id="suspense">Suspense</h2>
      <CodeBlock code={SUSPENSE} />
      <p>
        Streaming SSR boundary. The fallback ships in the initial HTML; once the async children
        resolve, the framework streams a swap chunk that replaces the placeholder anchors. Works
        pre-hydration; no client JS required for the swap itself. Views that read from an unresolved
        Suspense get classified as <em>island+stream</em> — the auto-mount wrapper subscribes to the
        Channel B state envelope on the client.
      </p>

      <h2 id="error-boundary">errorBoundary()</h2>
      <CodeBlock code={ERROR} />
      <p>
        Catches synchronous render errors in the wrapped subtree. Returns the fallback view. Async
        errors inside a streaming Suspense boundary surface here too.
      </p>

      <h2 id="form">Form</h2>
      <CodeBlock code={FORM} />
      <p>
        Submits to a typed <code>action()</code>. With JS: fetch + JSON, typed return. Without JS:
        form-encoded POST that the same action accepts. CSRF token + same-origin + body-limit
        pipeline applies either way.
      </p>

      <h2 id="keyed">keyed()</h2>
      <CodeBlock code={KEYED} />
      <p>
        Stable identity for list children. Without it, the framework treats each list as opaque and
        re-creates the DOM on every change; with it, only added/removed/reordered children mutate.
      </p>

      <h2 id="virtual-list">virtualList()</h2>
      <CodeBlock code={VLIST} />
      <p>
        Windowed render for long lists. Returns reactive <code>totalSize()</code> and{' '}
        <code>visible()</code>; you place the items at absolute positions. ADR 0008 has the
        rationale.
      </p>

      <h2 id="component">component()</h2>
      <CodeBlock code={COMPONENT} />
      <p>
        Plain render function. Runs on both server and client. Reach for <code>component()</code>{' '}
        when you want a typed wrapper for shared chrome; reach for <code>island()</code> when the
        subtree needs interactivity.
      </p>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/concepts/ssr">SSR & islands hydration</Link> — the wire format + the classifier
        </li>
        <li>
          <Link to="/api/page">page()</Link> — page-level fields + streaming
        </li>
        <li>
          <Link to="/api/state">state · watch · derived</Link>
        </li>
      </ul>
    </article>
  ),
})
