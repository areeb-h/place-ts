// Round 7 — note detail page. Reading experience: generous max-width,
// editorial typography (.prose styles in the root layout), a header
// strip with metadata and an edit button, tag pills at the top, body
// rendered with preserved whitespace.

import { component, Link, notFound, page } from '@place/component'
import { RouterCap } from '@place/routing'
import { type Note, NoteStoreCap } from '../store.ts'

const dateFmt = (t: number): string => {
  const d = new Date(t)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const FALLBACK: Note = {
  id: '',
  title: '',
  content: '',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
}

const NoteDetail = component<{ noteId: string }>((p) => {
  const store = NoteStoreCap.use()
  const live = (): Note => store.get(p.noteId) ?? FALLBACK

  return (
    <article class="h-full overflow-y-auto">
      <div class="max-w-2xl mx-auto px-6 py-10 space-y-6 prose">
        <header class="space-y-3 not-prose">
          <div class="flex items-center justify-between gap-4">
            <Link
              to="/"
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
              all notes
            </Link>
            <Link
              to={`/notes/${p.noteId}/edit`}
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-card border border-border hover:border-accent text-fg text-xs font-medium no-underline transition-colors"
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
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              edit
            </Link>
          </div>

          <h1 class="text-3xl font-semibold tracking-tight text-fg m-0 leading-tight">
            {() => live().title || 'untitled'}
          </h1>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-mono text-muted">
            <span>created {() => dateFmt(live().createdAt)}</span>
            <span class="text-border">·</span>
            <span>updated {() => dateFmt(live().updatedAt)}</span>
          </div>

          {() => {
            const tags = live().tags
            if (tags.length === 0) return ''
            return (
              <div class="flex flex-wrap gap-1.5 pt-1">
                {tags.map((tag) => (
                  <Link
                    to={`/tags/${tag}`}
                    class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono bg-card/60 text-muted hover:text-accent border border-border/40 hover:border-accent/40 no-underline transition-colors"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            )
          }}
        </header>

        <hr class="border-border/40" />

        <div class="text-fg/90 leading-relaxed whitespace-pre-wrap text-[15px]">
          {() => {
            const content = live().content
            if (content) return content
            return (
              <p class="text-muted italic m-0">
                this note has no content yet.{' '}
                <Link
                  to={`/notes/${p.noteId}/edit`}
                  class="text-accent hover:opacity-80 no-underline"
                >
                  start writing →
                </Link>
              </p>
            )
          }}
        </div>
      </div>
    </article>
  )
})

export default page('/notes/:id', {
  meta: { title: 'note · commonplace' },
  view: () => {
    const router = RouterCap.use()
    const store = NoteStoreCap.use()
    const id = router.segment(1) ?? ''
    const note = store.get(id)
    if (!note) throw notFound(`note ${id} not found`)
    return <NoteDetail noteId={id} />
  },
  onNotFound: () => (
    <div class="h-full flex items-center justify-center p-6">
      <div class="text-center space-y-4 max-w-md">
        <div class="text-7xl text-muted/20 font-light">404</div>
        <h2 class="text-lg font-semibold text-fg m-0">note not found</h2>
        <p class="text-sm text-muted m-0">
          this note doesn't exist on this device (or hasn't synced yet).
        </p>
        <Link
          to="/"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-card border border-border hover:border-accent text-fg text-sm no-underline transition-colors"
        >
          ← back to notes
        </Link>
      </div>
    </div>
  ),
})

// Helper class for "this section escapes prose styles" — used inside
// .prose containers above. Tailwind's @tailwindcss/typography ships it
// natively; we ship our own one-line shim so users without typography
// installed still get the expected behavior. (Tailwind v4 utility:
// .not-prose { all: revert; } is enough for our scope.)
