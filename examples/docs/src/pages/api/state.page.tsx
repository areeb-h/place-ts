// /api/state — state, watch, derived, .peek(), untrack, batch, flush.
// Documented as the canonical reactive surface; all primitives are
// re-exported from `@place-ts/component` so apps don't need a second
// import root.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const STATE = `import { state } from '@place-ts/component'

const count = state(0)
count()              // 0 (tracks if inside a reactive context)
count.set(1)         // direct write
count.update((c) => c + 1)   // functional updater`

const STATE_LAZY = `// Pass a function for lazy init — runs once, on first read.
const heavy = state(() => computeExpensiveDefault())`

const WATCH = `import { state, watch } from '@place-ts/component'

const a = state(2)
const b = state(3)
const dispose = watch(() => {
  console.log('sum =', a() + b())
})

a.set(5)   // logs "sum = 8"
dispose()    // stops watching`

const DERIVED = `import { derived, state } from '@place-ts/component'

const a = state(2)
const b = state(3)
const c = derived(() => a() + b())

c()       // 5 (computed)
c()       // 5 (cached — no recomputation)
a.set(10)
c()       // 13 (recomputed once)`

const PEEK = `// .peek() is a METHOD on every state / derived cell — there is no
// standalone peek import. It reads the current value WITHOUT
// subscribing the surrounding watch / derived.

watch(() => {
  const tracked = a()       // subscribes — watch re-runs when a changes
  const v = b.peek()        // reads b WITHOUT subscribing
  console.log('a =', tracked, 'b (snapshot) =', v)
})`

const UNTRACK = `import { untrack } from '@place-ts/component'

watch(() => {
  const tracked = a()
  const ignored = untrack(() => b())   // doesn't add b as a dep
})`

const BATCH = `import { batch } from '@place-ts/component'

batch(() => {
  a.set(10)
  b.set(20)
})   // watchers run once, after the batch`

const FLUSH = `import { flush } from '@place-ts/component'

// Pending reactive updates run microtask-deferred by default. flush()
// drains the queue synchronously — useful in tests and in DOM-read
// after-write scenarios.
a.set(5)
flush()
// every watcher of a has now re-run`

export default page('/state', {
  // No `meta:` — auto-title from `<h1>state · watch · derived</h1>`.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>state · watch · derived</h1>
      <p>
        The reactive primitives. All available from <code>@place-ts/component</code> as the
        canonical import root — they're re-exports from <code>@place-ts/reactivity</code>, which
        apps can also import directly if they prefer that scope.
      </p>

      <h2 id="state">state()</h2>
      <CodeBlock code={STATE} />
      <CodeBlock code={STATE_LAZY} />
      <p>
        <code>state(initial)</code> returns a callable cell — call it to read (the canonical form),
        and write with <code>.set(value)</code> or <code>.update(prev =&gt; next)</code>. Reading
        inside a tracking context subscribes that context to writes. <code>.read()</code> /{' '}
        <code>.write()</code> are back-compat aliases for the callable read and <code>.set</code> /{' '}
        <code>.update</code>; prefer the canonical forms in new code.
      </p>

      <h2 id="watch">watch()</h2>
      <CodeBlock code={WATCH} />
      <p>
        Reactive effect. Re-runs on every change to any read state. The first call always runs.
        Returns a disposer; <code>watch</code> inside a component scope auto-disposes when the
        component unmounts.
      </p>
      <Callout kind="warn" title="Don't write to read state inside watch">
        A <code>watch</code> that reads <code>x</code> and writes <code>x</code> creates a
        self-trigger. The framework guards against immediate infinite recursion, but the watch will
        re-fire on each external change in a loop. Wrap writes in <code>untrack(...)</code> when the
        read is incidental (e.g. appending to a log), or split the effect into two watches.
      </Callout>

      <h2 id="derived">derived()</h2>
      <CodeBlock code={DERIVED} />
      <p>
        Memoized accessor. <code>derived(fn)</code> returns <code>() =&gt; T</code> that caches its
        last result; the body recomputes only when one of its tracked sources changes value. Read it
        many times in one render pass — only the first call computes.
      </p>
      <Callout kind="tip" title="When NOT to derive">
        For one-shot computations or simple JSX expressions, a plain function works:{' '}
        <code>{`const sum = () => a() + b()`}</code> — reactive at the read site, just not memoized.
        Reach for <code>derived</code> when caching matters.
      </Callout>

      <h2 id="peek">.peek()</h2>
      <p>
        <code>.peek()</code> is a method on every state and <code>derived</code> cell — not a
        standalone import. It returns the current value without subscribing the active{' '}
        <code>watch</code> / <code>derived</code>. Reach for it when you need a value's current
        snapshot but don't want a dependency edge (logging, one-shot reads inside an effect).
      </p>
      <CodeBlock code={PEEK} />

      <h2 id="untrack">untrack()</h2>
      <CodeBlock code={UNTRACK} />

      <h2 id="batch">batch()</h2>
      <CodeBlock code={BATCH} />

      <h2 id="flush">flush()</h2>
      <CodeBlock code={FLUSH} />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/concepts/reactivity">Concepts: reactivity</Link> — the model + live demo
        </li>
        <li>
          <Link to="/api/components">island · Show · Suspense · Form</Link>
        </li>
      </ul>
    </article>
  ),
})
