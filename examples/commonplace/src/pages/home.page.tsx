// Round 7 — home page (notes list + URL-driven filter state).
//
// Layout: two columns on desktop (240px sidebar + flexible content),
// collapses to single column under 720px. Sidebar carries the "new
// note" CTA + tag cloud; main column shows the notes list as proper
// cards with title, excerpt, tags, and updated-at.
//
// `clientOnly: true` defers the entire view to hydrate-time so the
// server emits a placeholder span and the client mounts the real
// notes list when caps are ready.

import {
  cls,
  component,
  Fragment,
  keyed,
  Link,
  page,
  shape,
  useSearch,
  virtualList,
  wire,
} from '@place/component'
import { state } from '@place/reactivity'
import { RouterCap } from '@place/routing'
import { type Note, NoteStoreCap, searchNotes } from '../store.ts'

// Round 7 cut 5: typed `search` accessor. The shape() validator runs
// at request time and produces a typed object; `useSearch<T>(props)`
// surfaces it at the call site without `as unknown as`.
export default page('/', {
  meta: { title: 'commonplace' },
  search: shape({ q: 'string?', tag: 'string?' }),
  view: (props) => {
    const { q, tag } = useSearch<{ q?: string; tag?: string }>(props)
    return <NotesList initialQuery={q ?? ''} initialTag={tag ?? null} />
  },
})

interface NotesListProps {
  initialQuery: string
  initialTag: string | null
  /** When false, the search input + tag filter pill are hidden (used by
   *  `/tags/:tag` where the tag is fixed by the URL path). */
  editableFilters?: boolean
}

const dateFmt = (t: number): string => {
  if (!t) return ''
  const d = new Date(t)
  const now = Date.now()
  const diff = now - t
  const day = 86400000
  if (diff < day) return 'today'
  if (diff < day * 2) return 'yesterday'
  if (diff < day * 7) return `${Math.floor(diff / day)}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const NotesList = component<NotesListProps>((props) => {
  // `store` is needed during render (list + filters read it).
  // `router` is only used inside event handlers, so we defer the
  // `.use()` until the handler fires. This keeps SSR free of
  // browser-only caps and lets the home page paint with real notes
  // on first byte instead of dropping into an auto-placeholder.
  const store = NoteStoreCap.use()
  const query = state(props.initialQuery)
  const searched = searchNotes(store)(query.read)
  const filtered = (): readonly Note[] => {
    const t = props.initialTag
    const list = searched()
    return t ? list.filter((n) => n.tags.includes(t)) : list
  }

  // Tag cloud for the sidebar. Counts include the full store, not just
  // the filtered set — gives a stable navigation surface that doesn't
  // shift as you type into the search box.
  const tagCounts = (): readonly [string, number][] => {
    const counts = new Map<string, number>()
    for (const n of store.all()) {
      for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }

  const createNote = (): void => {
    const id = store.create({ title: '', content: '', tags: [] })
    RouterCap.use().navigate(`/notes/${id}/edit`)
  }

  const list = virtualList({
    count: () => filtered().length,
    estimateSize: () => 116,
  })

  return (
    <div class="h-full grid grid-cols-1 md:grid-cols-[240px_1fr] max-w-6xl mx-auto">
      <aside class="hidden md:flex md:flex-col gap-4 border-r border-border/40 p-5 overflow-y-auto">
        <button
          type="button"
          onClick={createNote}
          class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-accent text-accent-fg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          new note
        </button>

        <div class="space-y-2">
          <div class="flex items-baseline justify-between">
            <h2 class="text-[10px] uppercase tracking-wider text-muted font-semibold m-0">tags</h2>
            <Link
              to="/tags"
              class="text-[10px] text-muted hover:text-fg no-underline transition-colors"
            >
              see all →
            </Link>
          </div>
          {() => {
            const tags = tagCounts()
            if (tags.length === 0) {
              return (
                <p class="text-xs text-muted/70 m-0">
                  no tags yet — add some when you write a note
                </p>
              )
            }
            return (
              <ul class="list-none p-0 m-0 flex flex-wrap gap-1.5">
                {tags.slice(0, 16).map(([tag, count]) => (
                  <li>
                    <Link
                      to={`/tags/${tag}`}
                      class={cls(
                        'inline-flex items-baseline gap-1.5 px-2 py-0.5 rounded-md',
                        'text-[11px] font-mono no-underline transition-colors',
                        props.initialTag === tag
                          ? 'bg-accent/20 text-accent border border-accent/40'
                          : 'bg-card/60 text-muted hover:text-fg hover:bg-card border border-transparent hover:border-border/60',
                      )}
                    >
                      <span>#{tag}</span>
                      <span class="opacity-60">{count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }}
        </div>

        <div class="space-y-2 text-[11px] text-muted/70 mt-auto pt-3 border-t border-border/40">
          <p class="m-0">
            <span class="text-muted">{() => store.all().length}</span> notes ·{' '}
            <span class="text-muted">{() => tagCounts().length}</span> tags
          </p>
          <p class="m-0 font-mono leading-relaxed">
            press <kbd class="px-1 py-0.5 rounded bg-card border border-border text-[10px]">/</kbd>{' '}
            to search
          </p>
        </div>
      </aside>

      <section class="flex flex-col h-full min-h-0">
        {(props.editableFilters ?? true) && (
          <div class="flex-shrink-0 px-6 pt-5 pb-3 border-b border-border/40 space-y-2">
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted/60">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </span>
              <input
                type="search"
                placeholder="search notes…"
                {...wire(query)}
                class={cls(
                  'w-full pl-9 pr-3 py-2 rounded-md bg-card/60 border border-border/60',
                  'text-sm text-fg placeholder:text-muted/60',
                  'focus:border-accent focus:bg-card focus:outline-none',
                  'transition-colors',
                )}
              />
            </div>
            {() => {
              const t = props.initialTag
              if (!t) return ''
              return (
                <div class="flex items-center gap-2 text-xs text-muted">
                  <span>filtered by</span>
                  <Link
                    to="/"
                    class={cls(
                      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md',
                      'bg-accent/15 border border-accent/40 text-accent no-underline',
                      'hover:bg-accent/25 transition-colors font-mono text-[11px]',
                    )}
                  >
                    #{t}
                    <span class="text-[10px] opacity-70">×</span>
                  </Link>
                </div>
              )
            }}
          </div>
        )}

        <div ref={list.containerRef} class="flex-1 overflow-auto">
          {() => {
            if (filtered().length === 0) {
              return (
                <div class="h-full flex items-center justify-center p-12">
                  <div class="text-center space-y-2 max-w-sm">
                    <div class="text-muted/30 text-5xl font-light">∅</div>
                    <h3 class="text-base font-medium text-fg m-0">
                      {query()
                        ? 'no matches'
                        : props.initialTag
                          ? `no notes tagged #${props.initialTag}`
                          : 'no notes yet'}
                    </h3>
                    <p class="text-sm text-muted m-0">
                      {query()
                        ? 'try a different query, or clear the search.'
                        : 'start writing — your notes live on this device.'}
                    </p>
                    {() =>
                      !query() && !props.initialTag ? (
                        <button
                          type="button"
                          onClick={createNote}
                          class="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-accent-fg text-xs font-medium hover:opacity-90 transition-opacity"
                        >
                          + create your first note
                        </button>
                      ) : (
                        ''
                      )
                    }
                  </div>
                </div>
              )
            }
            return (
              <div
                class="px-6 pb-6 pt-3"
                style={() => `position: relative; height: ${list.totalSize()}px`}
              >
                {keyed(
                  list.visible,
                  (item) => filtered()[item.index]?.id ?? `_${item.index}`,
                  (item) => {
                    const id = filtered()[item.index]?.id ?? ''
                    return (
                      <div
                        style={() =>
                          `position: absolute; top: ${item.start}px; height: ${item.size}px; left: 1.5rem; right: 1.5rem`
                        }
                      >
                        <NoteCard noteId={id} />
                      </div>
                    )
                  },
                )}
              </div>
            )
          }}
        </div>
      </section>
    </div>
  )
})

// Re-export so `/tags/:tag` can reuse the same component with a fixed
// `initialTag` + filters disabled.
export { NotesList }

const NoteCard = component<{ noteId: string }>((p) => {
  const store = NoteStoreCap.use()
  const note = (): Note | null => (p.noteId ? store.get(p.noteId) : null)

  return (
    <article
      class={cls(
        'group relative h-[104px] rounded-lg bg-card/40 border border-border/40',
        'hover:bg-card/70 hover:border-border transition-all',
        'overflow-hidden',
      )}
    >
      <Link
        to={`/notes/${p.noteId}`}
        class="block h-full no-underline text-fg p-4 focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-lg"
      >
        <div class="flex items-baseline justify-between gap-3 mb-1">
          <h3 class="text-[15px] font-semibold text-fg truncate m-0 leading-snug">
            {() => {
              const n = note()
              if (!n) return ''
              return n.title || 'untitled'
            }}
          </h3>
          <time class="text-[11px] text-muted/70 font-mono shrink-0">
            {() => dateFmt(note()?.updatedAt ?? 0)}
          </time>
        </div>
        <p class="text-[13px] text-muted line-clamp-2 m-0 leading-relaxed">
          {() => {
            const n = note()
            if (!n) return ''
            const firstLine = n.content.split('\n').find((l) => l.trim()) ?? ''
            return firstLine || (n.title ? '' : 'empty')
          }}
        </p>
      </Link>
      <div class="absolute bottom-2.5 left-4 right-4 flex flex-wrap items-center gap-1 pointer-events-none">
        {() => {
          const n = note()
          if (!n || n.tags.length === 0) return ''
          const visible = n.tags.slice(0, 4)
          const overflow = n.tags.length > 4 ? n.tags.length - 4 : 0
          return (
            <Fragment>
              {visible.map((tag) => (
                <Link
                  to={`/tags/${tag}`}
                  class={cls(
                    'pointer-events-auto inline-flex items-center px-1.5 py-0.5 rounded-md',
                    'text-[10px] font-mono bg-card/70 text-muted no-underline border border-border/40',
                    'hover:text-accent hover:border-accent/40 transition-colors',
                  )}
                >
                  #{tag}
                </Link>
              ))}
              {overflow > 0 ? (
                <span class="text-[10px] text-muted/70 font-mono">+{overflow}</span>
              ) : null}
            </Fragment>
          )
        }}
      </div>
    </article>
  )
})
