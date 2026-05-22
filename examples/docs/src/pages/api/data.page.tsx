// /api/data — @place-ts/data overview.
// v0.1 ships ONE primitive: collection<T>().

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const COLLECTION = `// collection<T>(state, options?) — keyed CRUD over a State<T[]>.
// The collection operates on a reactive array; the State stays
// exposed so you can compose it with persistedState, history, etc.
import { state } from '@place-ts/reactivity'
import { collection } from '@place-ts/data'

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
import { state } from '@place-ts/reactivity'
import { collection } from '@place-ts/data'
import { persistedState, localStorageAdapter } from '@place-ts/persistence'

const { state: noteState } = persistedState(
  localStorageAdapter<Note[]>('notes', []),
)
const notes = collection<Note>(noteState)

// Every add / update / remove now persists automatically — the
// collection mutates the state, persistedState's watch saves it.`

const TRASH = `// Soft delete (0.2.0). trash(key) marks an item as trashed without
// removing it from the underlying array; restore(key) un-marks. The
// reactive trash set is its own state cell, so all() / get() / cursor()
// re-evaluate when an item goes in or out of trash.

c.trash('a')             // mark 'a' as trashed (no-op if absent / already trashed)
c.restore('a')           // un-mark
c.trashedKeys()          // → readonly string[]  — reactive list of trashed keys

// Default reads filter out trashed items:
c.all()                  // → all non-trashed
c.get('a')               // → null if 'a' is trashed
c.cursor()               // → only non-trashed items

// Opt-in: include trash in a one-off read (useful for "trash bin" UI).
c.all({ includeTrash: true })          // → everything, including trashed
c.get('a', { includeTrash: true })     // → item even if trashed`

const CURSOR = `// Cursor-based pagination (0.2.0). Returns { items, next } where
// 'next' is the key to pass back for the next page (or null if the
// current page is the last). Stable under inserts: if items are added
// AFTER your current page boundary, they appear on later cursor()
// calls; if added BEFORE, they don't shift your existing pages.
//
// Cursor pagination is the right shape over offset-based for reactive
// collections because the item set can change between page requests.
// Stale 'after' keys (item deleted since the previous call) are
// gracefully handled — the framework falls back to the position-based
// equivalent so you don't get a 500 on a stale handle.

const page1 = c.cursor({ limit: 20 })
//  page1.items: readonly T[]    — at most 20 items
//  page1.next:  string | null   — pass to load the next page

const page2 = c.cursor({ after: page1.next ?? undefined, limit: 20 })
const page3 = c.cursor({ after: page2.next ?? undefined, limit: 20 })

// Reactive: cursor() re-evaluates when the underlying state changes,
// so deletions, additions, and trash flips all flow through.

// includeTrash: defaults to false (matches all() / get()).
c.cursor({ limit: 50, includeTrash: true })`

export default page('/data', {
  meta: '@place-ts/data',
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>@place-ts/data</code>
      </h1>
      <p>
        Data primitives over <code>@place-ts/reactivity</code>. v0.1 ships exactly one helper —{' '}
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
        Because the collection wraps a plain <code>State&lt;T[]&gt;</code>, wrapping that state with{' '}
        <code>persistedState</code> makes every mutation durable — no special integration.
      </p>
      <CodeBlock code={COMPOSE} />

      <h2 id="trash">
        Soft delete — <code>trash</code> / <code>restore</code> (0.2.0)
      </h2>
      <p>
        <code>trash(key)</code> marks an item as trashed without removing it from the underlying
        array; <code>restore(key)</code> un-marks it. The reactive trash set lives in its own state
        cell, so <code>all()</code> / <code>get()</code> / <code>cursor()</code> re-evaluate when an
        item flips in or out of trash. Default reads filter trashed items out; pass{' '}
        <code>{`{ includeTrash: true }`}</code> for "trash bin" UI.
      </p>
      <CodeBlock code={TRASH} />

      <h2 id="cursor">
        Cursor-based pagination — <code>cursor()</code> (0.2.0)
      </h2>
      <p>
        Returns <code>{`{ items, next }`}</code> where <code>next</code> is the key to pass back for
        the following page (or <code>null</code> if the current page is the last). Stable under
        inserts: items added <em>after</em> the current page boundary appear on later{' '}
        <code>cursor()</code> calls; items added <em>before</em> don't shift your existing pages.
        Reactive — re-evaluates when the underlying state changes. Stale <code>after</code> keys
        (item deleted since the previous call) gracefully fall back to position-based equivalence.
      </p>
      <CodeBlock code={CURSOR} />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/state">state · watch · derived</Link>
        </li>
        <li>
          <Link to="/api/persistence">@place-ts/persistence</Link>
        </li>
        <li>
          <Link to="/api/search">@place-ts/search</Link> — reactive search over a collection
        </li>
      </ul>
    </article>
  ),
})
