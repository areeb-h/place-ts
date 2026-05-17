import { cls, type View, wire } from '@place/component'
import {
  crossTabAdapter,
  indexedDBAdapter,
  localStorageAdapter,
  memoryAdapter,
  type PersistenceAdapter,
  persistedState,
  serverAdapter,
} from '@place/persistence'
import { type State, state, watch } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

// The point of this demo: the UI below never imports an adapter
// directly. It reads / writes the active session's State<Notes>
// produced by `persistedState(adapter)`. Switching the backend tears
// down the previous session and rebuilds with the new adapter; every
// other line of UI code is unchanged.
//
// Why session lives in a `state` rather than a closure variable: the
// UI subscribes to the session reactively, so a backend swap re-fires
// every consumer (including the reactive children rendering `lines`).
// A plain mutable would leave consumers subscribed to the previous
// session's state and they'd freeze on stale data.

interface Notes {
  lines: string[]
}

interface Session {
  state: State<Notes>
  dispose: () => void
}

type Backend = 'memory' | 'localStorage' | 'crossTab' | 'indexedDB' | 'server'

const KEY = 'sandbox:persistence:demo'
const EMPTY: Notes = { lines: [] }
const SYNC_SERVER_URL = 'http://localhost:5180'

function buildAdapter(b: Backend): PersistenceAdapter<Notes> {
  switch (b) {
    case 'memory':
      return memoryAdapter(EMPTY)
    case 'localStorage':
      return localStorageAdapter<Notes>(KEY, EMPTY)
    case 'crossTab':
      return crossTabAdapter(localStorageAdapter<Notes>(KEY, EMPTY), KEY)
    case 'indexedDB':
      return indexedDBAdapter<Notes>(KEY, EMPTY)
    case 'server':
      return serverAdapter<Notes>({
        baseUrl: SYNC_SERVER_URL,
        key: KEY,
        defaultValue: EMPTY,
      })
  }
}

export function PersistenceExample(): View {
  const backend = state<Backend>('localStorage')
  const draft = state('')

  // Active session is reactive — consumers re-subscribe when it
  // changes. `session.peek()` reads the previous value without
  // tracking it as a dep of this watch, so disposing prev doesn't
  // loop the watch.
  const session = state<Session | null>(null)
  watch(() => {
    const b = backend()
    session.peek()?.dispose()
    session.set(persistedState(buildAdapter(b)))
  })

  const lines = (): readonly string[] => session()?.state().lines ?? []

  const add = () => {
    const v = draft().trim()
    const s = session()
    if (!v || s === null) return
    s.state.set({ lines: [...s.state().lines, v] })
    draft.set('')
  }
  const clear = () => session()?.state.set(EMPTY)

  const backendOptions: { value: Backend; label: string; hint: string }[] = [
    { value: 'memory', label: 'memory', hint: 'lost on reload' },
    { value: 'localStorage', label: 'localStorage', hint: 'survives reload' },
    { value: 'crossTab', label: 'crossTab', hint: 'syncs across tabs of this origin' },
    {
      value: 'indexedDB',
      label: 'indexedDB',
      hint: 'async; load() reconciles via refresh()',
    },
    {
      value: 'server',
      label: 'server',
      hint: `Bun server at ${SYNC_SERVER_URL} — run \`bun run sync-server\` first; syncs across devices via WebSocket`,
    },
  ]

  return (
    <ExampleCard
      id="persistence"
      phase={3}
      number="10"
      title="Persistence — swap the adapter, consumer code unchanged"
      description="One UI, four backends. Memory: lost on reload. localStorage: survives reload. crossTab: edits propagate to other tabs of this origin. indexedDB: async storage; the sync load() surface stays sync because the adapter caches, and the refresh() hook reconciles after broadcasts."
      note="The swap claim of the platform demonstrated in one panel. The code below uses persistedState's resulting State<Notes> exactly as if it were any other reactive state. None of the UI knows whether it's reading memory, localStorage, BroadcastChannel, or IndexedDB. The commonplace book uses the same swap pattern."
    >
      <div class="flex flex-wrap gap-1.5">
        {backendOptions.map((opt) => (
          <button
            type="button"
            onClick={() => backend.set(opt.value)}
            class={() =>
              cls(
                'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                backend() === opt.value
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border bg-card hover:bg-card',
              )
            }
            title={opt.hint}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <p class="text-xs text-muted font-mono">
        {() => backendOptions.find((o) => o.value === backend())?.hint ?? ''}
      </p>

      <div class="flex gap-2">
        <input
          type="text"
          {...wire(draft)}
          placeholder="add a line…"
          class="flex-1 px-3 py-1.5 rounded-md bg-bg border border-border text-sm focus:border-accent/60 focus:outline-none"
        />
        <Button onClick={add}>add</Button>
        <Button variant="subtle" onClick={clear}>
          clear
        </Button>
      </div>

      <ul class="list-none p-0 m-0 space-y-1 max-h-48 overflow-y-auto">
        {() => {
          const items = lines()
          if (items.length === 0) {
            return <li class="px-3 py-2 text-xs text-muted/60 font-mono">— no entries — </li>
          }
          return (
            <span class="contents">
              {items.map((line, i) => (
                <li class="px-3 py-1.5 text-sm rounded-md bg-bg/60 border border-border/40 font-mono text-fg/90 flex items-baseline gap-3">
                  <span class="text-xs text-muted/60">{String(i + 1).padStart(2, '0')}</span>
                  <span class="flex-1">{line}</span>
                </li>
              ))}
            </span>
          )
        }}
      </ul>

      <p class="text-xs text-muted leading-relaxed">
        Try: open a second tab with backend set to{' '}
        <span class="font-mono text-accent">crossTab</span> — add a line in one tab; the other ticks
        within ~1 frame. Switch to <span class="font-mono text-accent">indexedDB</span> and reload —
        entries come back once IDB resolves (briefly blank during the async load).
      </p>
    </ExampleCard>
  )
}
