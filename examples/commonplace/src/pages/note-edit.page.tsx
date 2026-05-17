// Round 7 — note edit page. Distraction-free editor: minimal chrome,
// borderless title + body inputs, tags as comma-separated chips. Save
// goes through the co-located `on: { save }` action so the full
// security pipeline (auto-CSRF + same-origin + body-limit + proto-
// pollution) is exercised on every keystroke-batched save. The
// handler is an echo — commonplace's data lives client-side — but
// the round-trip demonstrates the action() surface.

import { cls, component, Fragment, Link, onKey, page, wire } from '@place/component'
import { state } from '@place/reactivity'
import { RouterCap } from '@place/routing'
import { type Note, NoteStoreCap } from '../store.ts'

const FALLBACK: Note = {
  id: '',
  title: '',
  content: '',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
}

const noteEditPage = page('/notes/:id/edit', {
  meta: { title: 'edit · commonplace' },
  on: {
    save: async (
      input: { title: string; content: string; tags: readonly string[] },
      { params },
    ): Promise<{
      id: string
      title: string
      content: string
      tags: readonly string[]
      updatedAt: number
    }> => {
      return {
        id: params['id'] ?? '',
        title: input.title,
        content: input.content,
        tags: input.tags,
        updatedAt: Date.now(),
      }
    },
  },
  view: () => {
    const router = RouterCap.use()
    const id = router.segment(1) ?? ''
    return <NoteEdit noteId={id} />
  },
})

export default noteEditPage

const NoteEdit = component<{ noteId: string }>((p) => {
  const store = NoteStoreCap.use()
  const router = RouterCap.use()
  const current = (): Note => store.get(p.noteId) ?? FALLBACK

  const title = state(current().title)
  const content = state(current().content)
  const tagsCsv = state(current().tags.join(', '))
  const saving = state(false)
  const error = state<string | null>(null)
  const dirty = state(false)

  const parseTags = (csv: string): readonly string[] =>
    csv
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

  const onSubmit = async (e: Event): Promise<void> => {
    e.preventDefault()
    saving.set(true)
    error.set(null)
    try {
      const saved = await noteEditPage.save({
        title: title(),
        content: content(),
        tags: parseTags(tagsCsv()),
      })
      store.update(p.noteId, {
        title: saved.title,
        content: saved.content,
        tags: saved.tags,
      })
      router.navigate(`/notes/${p.noteId}`)
    } catch (err) {
      error.set(err instanceof Error ? err.message : String(err))
    } finally {
      saving.set(false)
    }
  }

  const onDelete = (): void => {
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm('Delete this note?')) {
      return
    }
    store.remove(p.noteId)
    router.navigate('/')
  }

  // Combine `wire()`'s state-write with the dirty-tracker into one
  // onInput handler. Spreading `{...wire(s)}` after `onInput=…` (or
  // vice-versa) overrides one of them — JSX props are last-write-wins.
  // Wrap so both effects fire on every keystroke.
  const wireWithDirty = <T,>(w: { value: () => T; onInput: (e: Event) => void }) => ({
    value: w.value,
    onInput: (e: Event) => {
      w.onInput(e)
      if (!dirty()) dirty.set(true)
    },
  })

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={onKey('Escape', () => router.navigate(`/notes/${p.noteId}`))}
      class="h-full overflow-y-auto"
    >
      <div class="max-w-2xl mx-auto px-6 py-8 space-y-5">
        <div class="flex items-center justify-between gap-4">
          <Link
            to={`/notes/${p.noteId}`}
            class="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg no-underline transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            cancel
          </Link>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={onDelete}
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              delete
            </button>
            <button
              type="submit"
              disabled={() => saving()}
              class={cls(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md',
                'bg-accent text-accent-fg text-xs font-medium',
                'hover:opacity-90 disabled:opacity-50 transition-opacity',
              )}
            >
              {() =>
                saving() ? (
                  'saving…'
                ) : (
                  <Fragment>
                    save
                    {dirty() ? <span class="opacity-70 ml-0.5">●</span> : null}
                  </Fragment>
                )
              }
            </button>
          </div>
        </div>

        <input
          type="text"
          {...wireWithDirty(wire(title))}
          placeholder="untitled"
          class={cls(
            'w-full text-3xl font-semibold tracking-tight bg-transparent border-0',
            'focus:outline-none placeholder:text-muted/40 text-fg',
          )}
        />

        <div class="flex items-center gap-2 text-xs text-muted">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01" />
          </svg>
          <input
            type="text"
            {...wireWithDirty(wire(tagsCsv))}
            placeholder="add tags, comma-separated"
            class={cls(
              'flex-1 bg-transparent border-0 focus:outline-none',
              'placeholder:text-muted/50 text-fg font-mono text-xs',
            )}
          />
        </div>

        <hr class="border-border/40" />

        <textarea
          {...wireWithDirty(wire(content))}
          placeholder="start writing…"
          class={cls(
            'w-full min-h-[60vh] bg-transparent border-0',
            'focus:outline-none placeholder:text-muted/40',
            'text-fg/90 leading-relaxed text-[15px] resize-none',
          )}
        />

        {() => {
          const e = error()
          if (!e) return ''
          return (
            <div class="px-3 py-2 rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-xs font-mono">
              {e}
            </div>
          )
        }}

        <p class="text-[11px] text-muted/60 font-mono pt-2">
          press <kbd class="px-1 py-0.5 rounded bg-card border border-border/60">esc</kbd> to cancel
          · saves go through the auto-CSRF action pipeline
        </p>
      </div>
    </form>
  )
})
