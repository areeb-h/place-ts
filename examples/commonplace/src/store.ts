// Note store, exposed as a capability so consumers don't have to know
// whether they're reading from memory, localStorage, IndexedDB, or a
// remote sync server.
//
// The pattern this file demonstrates: write the store against the
// reactivity primitive (state), then *swap* the underlying state for a
// `persistedState` to gain persistence — every consumer of the
// `NoteStore` capability is unchanged.

import { defineCapability } from '@place/capability'
import { collection } from '@place/data'
import {
  crossTabAdapter,
  indexedDBAdapter,
  localStorageAdapter,
  memoryAdapter,
  type PersistenceAdapter,
  persistedState,
  serverAdapter,
} from '@place/persistence'
import { type History, history, type State, state } from '@place/reactivity'
import { searchable } from '@place/search'

export interface Note {
  readonly id: string
  title: string
  content: string
  tags: readonly string[]
  readonly createdAt: number
  updatedAt: number
}

export type NoteInput = {
  title: string
  content: string
  tags: readonly string[]
}

export interface NoteStore {
  /** Reactive list of all notes, sorted newest-created first. */
  readonly all: () => readonly Note[]
  get(id: string): Note | null
  create(input: NoteInput): string
  update(id: string, patch: Partial<NoteInput>): void
  remove(id: string): void
  /** Bounded undo/redo over the entire notes array. Wired to ⌘Z / ⌘⇧Z. */
  readonly history: History
}

/**
 * Note-specific search helper. Built on `@place/search` and bound to the
 * Note shape so the call site doesn't have to know which fields to scan.
 *
 * The store doesn't own search any more — they're separate systems that
 * compose at the call site.
 */
export const searchNotes = (store: NoteStore): ((query: () => string) => () => readonly Note[]) =>
  searchable(store.all, {
    fields: (n) => [n.title, n.content, ...n.tags],
  })

// Flagged `clientOnly: true` because the storage adapters (localStorage,
// IndexedDB, crossTab broadcast) only resolve in the browser. Touching
// this cap during SSR throws an error that points pages at the
// `clientOnly: true` opt-in instead of the generic "not provided" copy.
export const NoteStoreCap = defineCapability<NoteStore>('NoteStore', { clientOnly: true })

// Web standard, available in every modern browser + Node 19+ + Bun.
// Replaces the hand-rolled `n${counter}-${Date.now()}` scheme — the
// counter reset on page reload meant freshly-created notes shared a
// prefix across sessions, with collisions if two were created in the
// same millisecond. UUIDs sidestep both problems.
const newId = () => `n${crypto.randomUUID().slice(0, 8)}`

// `collection` from @place/data handles the keyed CRUD shape (the
// boring half). The wrapper below adds the *domain* logic: id
// generation on create, automatic `updatedAt` on every mutation, the
// createdAt-descending sort that's stable across edits (sorting by
// updatedAt would make the note you're editing jump to the top of the
// sidebar on every keystroke — disruptive UX), and a history primitive
// for undo/redo bound to the whole notes array.
function noteStoreFromCell(notes: State<Note[]>): NoteStore {
  const c = collection<Note>(notes, { sortBy: (a, b) => b.createdAt - a.createdAt })
  // Manual-commit history: snapshots fire only on the user-driven
  // mutations below, NOT on every state change. This matters when a
  // cross-tab broadcast or server push writes to `notes` — auto-mode
  // would record those as undoable, and ⌘Z would roll back another
  // tab's edit. With manual commits, undo only rolls back what we did.
  // We always create new Note objects via spread, so deep: false is
  // correct (no structuredClone cost per write).
  const h = history(notes, { auto: false })
  return {
    all: c.all,
    get: c.get,
    history: h,
    create(input) {
      const id = newId()
      const now = Date.now()
      c.add({ ...input, id, createdAt: now, updatedAt: now })
      h.commit()
      return id
    },
    update(id, patch) {
      c.update(id, { ...patch, updatedAt: Date.now() })
      h.commit()
    },
    remove(id) {
      c.remove(id)
      h.commit()
    },
  }
}

export function inMemoryNoteStore(seed: readonly Note[] = []): NoteStore {
  return noteStoreFromCell(state<Note[]>([...seed]))
}

/**
 * The backend choices the commonplace book exposes via its URL toggle.
 * `?backend=server` swaps in the Bun sync server (run with
 * `bun run sync-server` first); other values map to in-browser
 * adapters. Default is `crossTab` — the best out-of-the-box UX for a
 * single-user multi-tab session.
 */
export type Backend = 'memory' | 'localStorage' | 'crossTab' | 'indexedDB' | 'server'

const STORE_KEY = 'place:notes:v1'
const SYNC_SERVER_URL = 'http://localhost:5180'

function buildAdapter(backend: Backend, seed: readonly Note[]): PersistenceAdapter<Note[]> {
  const seedCopy = (): Note[] => [...seed]
  switch (backend) {
    case 'memory':
      return memoryAdapter<Note[]>(seedCopy())
    case 'localStorage':
      return localStorageAdapter<Note[]>(STORE_KEY, seedCopy())
    case 'crossTab':
      return crossTabAdapter(localStorageAdapter<Note[]>(STORE_KEY, seedCopy()), STORE_KEY)
    case 'indexedDB':
      return indexedDBAdapter<Note[]>(STORE_KEY, seedCopy())
    case 'server':
      return serverAdapter<Note[]>({
        baseUrl: SYNC_SERVER_URL,
        key: STORE_KEY,
        defaultValue: seedCopy(),
      })
  }
}

/**
 * NoteStore backed by the chosen persistence adapter.
 *
 * The capability surface is identical regardless of backend — swapping
 * impls does not touch any consumer. This is the swap claim of the
 * platform demonstrated in the reference app.
 */
export function persistedNoteStore(backend: Backend, seed: readonly Note[] = []): NoteStore {
  const adapter = buildAdapter(backend, seed)
  const { state: notes } = persistedState(adapter)
  return noteStoreFromCell(notes)
}

// Seeds in createdAt order: most recent first so the user's eye lands on
// the freshest one, but stable — none will jump as the user edits. IDs
// are FIXED strings so bookmarks + deep links survive across reloads and
// fresh storage initializations (a randomized `newId()` per seed would
// invalidate every URL between sessions, breaking the "URLs are real"
// premise of the path-routing demo).
// Exported so `app.ts` can seed the server-side in-memory store with
// the same content the client's localStorage-backed store starts with —
// SSR paints real notes on first byte, hydration matches client state.
export const SEED_NOTES: Note[] = [
  {
    id: 'seed-capability',
    title: 'Capability handlers replace context globals',
    content:
      "React's useContext is an implicit global with all the action-at-a-distance bugs that implies. defineCapability + provide + use is the explicit alternative — typed slots, lexical scope, no hidden globals. The runtime piece is the half that doesn't need a compiler.",
    tags: ['platform', 'capability'],
    createdAt: Date.now() - 86400000 * 1,
    updatedAt: Date.now() - 86400000 * 0.5,
  },
  {
    id: 'seed-reactivity',
    title: 'Two-color graph coloring',
    content:
      'The reactivity algorithm that solves diamond convergence in O(n).\n\nOn write, mark direct dependents DIRTY; transitive dependents CHECK. On read of a CHECK node, walk sources — if any actually changed value, recompute; otherwise mark CLEAN.\n\nThis is what TC39 standardizes and what Solid/Vue/Vapor all converge on. Place implements it in ~80 LOC.',
    tags: ['reactivity', 'algorithm'],
    createdAt: Date.now() - 86400000 * 5,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'seed-useeffect',
    title: 'Why useEffect is wrong',
    content:
      "React's useEffect is the universal escape hatch that became a crutch.\n\nThe model — re-run the component on state change, then bridge gaps with effects — generates the bugs it's trying to solve. Derivable state eliminates the most common antipattern (sync local state with a prop) at the primitive level.",
    tags: ['react', 'criticism', 'reactivity'],
    createdAt: Date.now() - 86400000 * 10,
    updatedAt: Date.now() - 86400000 * 4,
  },
]

/**
 * Pick the active backend from the URL — `?backend=server` (or
 * `localStorage`, `indexedDB`, `memory`). Defaults to `crossTab` for
 * the best out-of-the-box single-user multi-tab UX.
 *
 * Validates against the known set so a typo (`?backend=postgres`) falls
 * back to default rather than silently constructing nothing.
 */
export function activeBackend(): Backend {
  if (typeof globalThis.location === 'undefined') return 'crossTab'
  const v = new URLSearchParams(globalThis.location.search).get('backend') ?? ''
  const known: readonly Backend[] = ['memory', 'localStorage', 'crossTab', 'indexedDB', 'server']
  return (known as readonly string[]).includes(v) ? (v as Backend) : 'crossTab'
}

/**
 * Default store for the commonplace book reference app. Backend chosen
 * via the URL `?backend=` parameter — see `activeBackend()`. Seeded
 * once on first run with three editorial notes that introduce the
 * platform's design ideas. Reloads preserve user edits and additions.
 */
export const seedStore = (): NoteStore => persistedNoteStore(activeBackend(), SEED_NOTES)
