// /concepts/reactivity — the reactivity model with a live interactive
// demo embedded in the page. The user manipulates source states and
// watches the derived value + log update in real time, using the same
// `@place/reactivity` primitives the framework itself uses.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'
import { Callout } from '../../components/callout.tsx'
import ReactivityDemo from '../../islands/reactivity-demo.tsx'
import ViewportDemo from '../../islands/viewport-demo.tsx'

const STATE_EX = `import { state } from '@place/reactivity'

const count = state(0)

count()        // 0
count.set(1)
count()        // 1`

const WATCH_EX = `import { state, watch } from '@place/reactivity'

const a = state(2)
const b = state(3)

watch(() => {
  console.log('c =', a() + b())  // logs whenever a or b change
})

a.set(5)  // logs "c = 8"
b.set(1)  // logs "c = 6"`

const DERIVED_EX = `import { derived, state } from '@place/component'

const a = state(2)
const b = state(3)

// derived(fn) returns a memoized () => T accessor. It tracks a + b
// and recomputes only when one of them changes value.
const c = derived(() => a() + b())

c()  // 5 — computed
c()  // 5 — cached (no recomputation)
a.set(10)
c()  // 13 — recomputed exactly once`

const DERIVED_PLAIN = `// Plain functions that read state also "derive" — but they recompute
// on every call. Reach for derived() when you want caching.
const c = () => a() + b()`

const TWO_COLOR = `// Two-color graph propagation. When a writes, dependents go RED
// (dirty); reads pull them through and they go BLACK (clean). A
// dependent that re-reads to the same value short-circuits — its
// downstream stays clean. This is the same algorithm TC39 standardizes
// for native signals.`

export default page('/reactivity', {
  // No `meta:` — auto-title from `<h1>Reactivity</h1>`; layout adds the
  // ` · place docs` suffix. To add a "concepts" segment use the string
  // shorthand: `meta: 'Reactivity · concepts'`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>Reactivity</h1>
      <p>
        place's reactivity is fine-grained signals — read a state, you depend on it; write to it,
        only the dependents recompute. No virtual DOM, no per-tick reconciliation, no diffing.
      </p>

      <h2 id="try-it">Try it</h2>
      <p>
        Below is a tiny graph: two source states (<code>a</code>, <code>b</code>), a derived value
        <code>c = a + b</code>, and a watch effect logging every recomputation. Click the buttons —
        the framework's own reactive primitives are driving the page you're reading.
      </p>
      <ReactivityDemo />

      <h2 id="state">state()</h2>
      <p>
        A writable cell. <code>read()</code> samples (and tracks if inside a reactive context);
        <code>write()</code> updates and notifies subscribers.
      </p>
      <CodeBlock code={STATE_EX} />

      <h2 id="watch">watch()</h2>
      <p>
        A reactive effect. Re-runs whenever any state it read changes. Returns a disposer; auto-
        disposes inside component scope.
      </p>
      <CodeBlock code={WATCH_EX} />

      <h2 id="derived">derived()</h2>
      <p>
        Memoized derived value. Wraps a function and caches the last result; recomputes only when a
        tracked dependency changes value.
      </p>
      <CodeBlock code={DERIVED_EX} />
      <p>
        For ad-hoc derivations that aren't read more than once per pass, a plain function works too
        — the reactive graph still wires up, you just pay the recomputation each call:
      </p>
      <CodeBlock code={DERIVED_PLAIN} />

      <Callout kind="tip" title="No useMemo equivalent">
        place's <code>derived()</code> is the only memo primitive you'll need. There's no separate
        "computed", no dependency array, no equality function to pass — the graph already knows
        which sources changed.
      </Callout>

      <h2 id="two-color">Two-color propagation</h2>
      <CodeBlock code={TWO_COLOR} />
      <p>
        Each node has a color: <strong>black</strong> (clean) or <strong>red</strong> (dirty). A
        write paints all dependents red; a read pulls a red node back to black by recomputing. The
        algorithm is the one TC39 picked for the signals proposal — when native signals ship, this
        code maps to them directly.
      </p>

      <h2 id="batching">Batching</h2>
      <p>
        Multiple writes inside <code>batch()</code> trigger one downstream flush:
      </p>
      <CodeBlock
        code={`import { batch } from '@place/reactivity'

batch(() => {
  a.set(10)
  b.set(20)
})  // watchers run once, after the batch`}
      />

      <h2 id="viewport">viewport — reactive screen size</h2>
      <p>
        The framework ships one viewport primitive every component subscribes to instead of wiring
        its own <code>matchMedia</code> / <code>ResizeObserver</code>. Resize your browser; the
        readout below updates without a page reload.
      </p>
      <ViewportDemo />
      <CodeBlock
        code={`import { viewport } from '@place/component'

viewport.width()                  // () => number
viewport.height()                 // () => number
viewport.breakpoint()             // () => 'sm' | 'md' | 'lg' | 'xl' | '2xl'
viewport.prefersReducedMotion()   // () => boolean
viewport.prefersDark()            // () => boolean
viewport.matches('(min-width: 800px)')  // (q) => () => boolean

// Behavioural responsiveness (use this for "which component to render"):
{viewport.breakpoint() === 'sm' ? <MobileDrawer /> : <Sidebar />}

// Stylistic responsiveness (use Tailwind to avoid flash on hydrate):
<div class="hidden md:block">…</div>`}
      />
      <Callout kind="note" title="When to use which">
        <code>viewport.*</code> is for <strong>behavioural</strong> responsiveness — picking a
        component to render based on screen size. Tailwind utilities (<code>sm:</code> /{' '}
        <code>md:</code> / <code>lg:</code>) are for <strong>stylistic</strong> responsiveness — the
        CSS itself is media-query-based so there's no JS-driven flash on hydrate. Combine freely.
      </Callout>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/state">API: state · watch · derived</Link>
        </li>
        <li>
          <Link to="/concepts/capabilities">Concepts: capabilities</Link>
        </li>
      </ul>
    </article>
  ),
})
