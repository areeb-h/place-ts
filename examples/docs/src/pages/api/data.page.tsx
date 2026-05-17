// /api/data — @place/data overview.
// v0.1 ships ONE primitive: collection<T>().

import { Link, page } from '@place/component'
import { Callout } from '../../components/callout.tsx'
import { CodeBlock } from '@place/design'

const COLLECTION = `// collection<T>(state, options?) — keyed CRUD over a State<T[]>.
// The collection operates on a reactive array; the State stays
// exposed so you can compose it with persistedState, history, etc.
import { state } from '@place/reactivity'
import { collection } from '@place/data'

interface Note { id: string; title: string; tags: string[] }

const notes = state<Note[]>([])
const c = collection<Note>(notes, {
  // sort comparator for all(); omit for insertion order.
  sortBy: (a, b) => a.title.localeCompare(b.title),
})

c.add({ id: 'a', title: 'first', tags: [] })
c.get('a')                       // → { id: 'a', … } | null  (reactive)
c.update('a', { title: 'edit' }) // merge patch into item 'a'
c.remove('a')
c.all()                          // → readonly Note[], sorted (reactive)`

const CUSTOM_KEY = `// The key defaults to (item) => item.id. Pass \`id\` for a
// differently-named or composite key.
const users = collection<User>(state<User[]>([]), {
  id: (u) => u.uuid,
})

const items = collection<Item>(state<Item[]>([]), {
  id: (it) => \`\${it.org}:\${it.slug}\`,   // composite key
})`

const COMPOSE = `// The underlying State<T[]> stays exposed — wrap it with
// persistedState so the whole collection survives reloads.
import { state } from '@place/reactivity'
import { collection } from '@place/data'
import { persistedState, localStorageAdapter } from '@place/persistence'

const { state: noteState } = persistedState(
  localStorageAdapter<Note[]>('notes', []),
)
const notes = collection<Note>(noteState)

// Every add / update / remove now persists automatically — the
// collection mutates the state, persistedState's watch saves it.`

export default page('/data', {
  meta: '@place/data',
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>@place/data</code>
      </h1>
      <p>
        Data primitives over <code>@place/reactivity</code>. v0.1 ships exactly one helper —{' '}
        <code>collection&lt;T&gt;()</code> — the keyed-CRUD shape that every entity store
        hand-rolls. The position is deliberate: most app-level "data" problems collapse to a typed
        array in a <code>State&lt;T[]&gt;</code> plus the existing capability, persistence, and
        cache primitives. A typed-query layer lands only if a real workload demands one the
        reactivity primitives can't satisfy.
      </p>

      <Callout kind="note" title="Operates on a State, not an opaque store">
        <code>collection()</code> takes a <code>State&lt;T[]&gt;</code> and returns CRUD helpers
        over it. The state stays exposed — compose it with{' '}
        <Link to="/api/persistence">
          <code>persistedState</code>
        </Link>
        , <code>history()</code>, <code>crossTabAdapter</code> unchanged. Domain logic (id
        generation, timestamps, validation) lives in the consumer, not the primitive.
      </Callout>

      <h2 id="collection">
        <code>collection&lt;T&gt;(state, options?)</code>
      </h2>
      <p>
        Builds a keyed-CRUD interface over a <code>State&lt;T[]&gt;</code>. <code>all()</code> and{' '}
        <code>get(key)</code> are reactive reads; <code>add</code> / <code>update</code> /{' '}
        <code>remove</code> are writes. <code>add</code> throws on a duplicate key;{' '}
        <code>update</code> throws if the patch would change the key (use <code>remove</code> +{' '}
        <code>add</code> for a rename) — loud failures over silent corruption.
      </p>
      <CodeBlock code={COLLECTION} />

      <h2 id="custom-key">Custom &amp; composite keys</h2>
      <p>
        The key extractor defaults to <code>(item) =&gt; item.id</code>. Pass <code>id</code> for a
        differently-named property or a composite key.
      </p>
      <CodeBlock code={CUSTOM_KEY} />

      <h2 id="compose">Composing with persistence</h2>
      <p>
        Because the collection wraps a plain <code>State&lt;T[]&gt;</code>, wrapping that state
        with <code>persistedState</code> makes every mutation durable — no special integration.
      </p>
      <CodeBlock code={COMPOSE} />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/state">state · watch · derived</Link>
        </li>
        <li>
          <Link to="/api/persistence">@place/persistence</Link>
        </li>
        <li>
          <Link to="/api/search">@place/search</Link> — reactive search over a collection
        </li>
      </ul>
    </article>
  ),
})
