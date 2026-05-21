// /api/persistence — @place-ts/persistence overview.
// persistedState() + the storage adapters that back it.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const PERSISTED_STATE = `// persistedState(adapter) — a State<T> that loads from the adapter
// on creation and saves on every change. Persistence sits ON TOP of
// reactivity: the state primitive knows nothing about storage; the
// adapter is a plain object with load() + save().
import { persistedState, localStorageAdapter } from '@place-ts/persistence'

const { state: theme, dispose } = persistedState(
  localStorageAdapter('app:theme', 'dark'),
)

theme()            // 'dark' on first run, or the persisted value
theme.set('light') // writes to localStorage immediately
dispose()          // stops the auto-save watch (rarely needed —
                   // most state lives for the app's lifetime)`

const LOCAL_STORAGE = `// localStorageAdapter — sync, JSON-serializable values.
import { localStorageAdapter } from '@place-ts/persistence'

const adapter = localStorageAdapter('notes:draft', '', {
  // Optional — defaults are JSON.stringify / JSON.parse.
  serialize: (v) => JSON.stringify(v),
  deserialize: (raw) => JSON.parse(raw),
})

// Corrupt JSON or a save error (quota exceeded, storage disabled)
// falls back to the default value rather than throwing.`

const MEMORY = `// memoryAdapter — in-memory, for tests and no-op fallbacks.
import { memoryAdapter } from '@place-ts/persistence'

const adapter = memoryAdapter({ count: 0 })
// Nothing touches disk / localStorage — useful in unit tests and
// as a graceful fallback where no real storage exists.`

const CROSS_TAB = `// crossTabAdapter(inner, channelName) — wraps any adapter so
// writes propagate to other tabs of the same origin in near-
// realtime, via BroadcastChannel. Conflict policy: last-write-wins.
import {
  persistedState,
  localStorageAdapter,
  crossTabAdapter,
} from '@place-ts/persistence'

const { state: prefs } = persistedState(
  crossTabAdapter(
    localStorageAdapter('app:prefs', {}),
    'app-prefs-sync',
  ),
)

// Edit prefs in tab A → tab B's persistedState re-loads and updates.
// The save → broadcast → reload loop is broken internally so writes
// don't echo forever.`

const INDEXED_DB = `// indexedDBAdapter — async storage for large values. The adapter
// contract is sync at load() — it keeps a cached value, kicks off
// the async IDB load on construction, and fires observe() when the
// load resolves so persistedState picks up the stored value.
import { persistedState, indexedDBAdapter } from '@place-ts/persistence'

const { state: doc } = persistedState(
  indexedDBAdapter('editor:doc', { blocks: [] }, {
    dbName: 'place',   // default
    storeName: 'kv',   // default
  }),
)`

const SERVER = `// serverAdapter — HTTP + WebSocket backed persistence. Speaks to a
// tiny key-value sync server: GET/PUT /kv/:key, plus a WebSocket
// that pushes a change signal per write. Like IndexedDB, it caches
// over async storage and fires observe() on remote changes.
import { persistedState, serverAdapter } from '@place-ts/persistence'

const { state: shared } = persistedState(
  serverAdapter({
    baseUrl: 'http://localhost:5180',
    key: 'doc:42',
    defaultValue: { title: '' },
    // wsUrl defaults to baseUrl with http(s) → ws(s).
  }),
)`

export default page('/persistence', {
  meta: '@place-ts/persistence',
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>@place-ts/persistence</code>
      </h1>
      <p>
        Storage adapters for <code>@place-ts/reactivity</code> state. One primitive —{' '}
        <code>persistedState()</code> — wraps a state so it loads from a backing store on creation
        and saves on every change. The adapter is a plain object (<code>load</code> +{' '}
        <code>save</code>, optionally <code>observe</code> / <code>refresh</code>), so adapters are
        easy to test, swap, and compose.
      </p>

      <Callout kind="note" title="Persistence sits on top of reactivity">
        The reactivity primitive doesn't know about storage. <code>persistedState</code> wraps a
        plain <code>state()</code> with an auto-save <code>watch</code>. The underlying{' '}
        <code>State&lt;T&gt;</code> stays exposed — compose it with{' '}
        <Link to="/api/data">
          <code>collection()</code>
        </Link>
        , <code>history()</code>, etc. unchanged.
      </Callout>

      <h2 id="persisted-state">
        <code>persistedState(adapter, options?)</code>
      </h2>
      <p>
        Returns <code>{`{ state, dispose }`}</code>. The state is initialized from{' '}
        <code>adapter.load()</code>; every change triggers <code>adapter.save(value)</code>. When
        the adapter exposes <code>observe</code> (cross-tab, server sync), external changes re-load
        the state. Pass <code>{`{ equals }`}</code> for a structural comparator on object-shaped
        state.
      </p>
      <CodeBlock code={PERSISTED_STATE} />

      <h2 id="local-storage">
        <code>localStorageAdapter(key, default, options?)</code>
      </h2>
      <p>
        Sync adapter backed by <code>localStorage</code> (or any compatible <code>Storage</code>).
        JSON-serializable values by default; pass custom <code>serialize</code> /{' '}
        <code>deserialize</code> for richer types. Save errors are swallowed — corrupt data falls
        back to the default.
      </p>
      <CodeBlock code={LOCAL_STORAGE} />

      <h2 id="memory">
        <code>memoryAdapter(initial)</code>
      </h2>
      <p>In-memory adapter — useful for tests and as a no-op fallback.</p>
      <CodeBlock code={MEMORY} />

      <h2 id="cross-tab">
        <code>crossTabAdapter(inner, channelName)</code>
      </h2>
      <p>
        Wraps any adapter so writes propagate to other tabs of the same origin via{' '}
        <code>BroadcastChannel</code>. Conflict policy is last-write-wins. Composes cleanly over{' '}
        <code>localStorageAdapter</code>, <code>indexedDBAdapter</code>, or{' '}
        <code>serverAdapter</code>.
      </p>
      <CodeBlock code={CROSS_TAB} />

      <h2 id="indexed-db">
        <code>indexedDBAdapter(key, default, options?)</code>
      </h2>
      <p>
        Async storage for large values. The <code>PersistenceAdapter</code> contract is sync at{' '}
        <code>load()</code>, so the adapter keeps a cached value and fires <code>observe</code>{' '}
        callbacks when the async load resolves — consumer code never deals with promises just to
        read state.
      </p>
      <CodeBlock code={INDEXED_DB} />

      <h2 id="server">
        <code>serverAdapter(options)</code>
      </h2>
      <p>
        HTTP + WebSocket backed persistence — syncs through a tiny key-value sync server. Caches
        over async storage like <code>indexedDBAdapter</code>; the WebSocket pushes a change signal
        per write, so other clients re-fetch via the same load path.
      </p>
      <CodeBlock code={SERVER} />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/state">state · watch · derived</Link> — the reactivity primitives
        </li>
        <li>
          <Link to="/api/data">@place-ts/data</Link> — <code>collection()</code> composes with
          persisted state
        </li>
      </ul>
    </article>
  ),
})
