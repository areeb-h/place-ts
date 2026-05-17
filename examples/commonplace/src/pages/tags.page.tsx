// Round 7 — tags index. Lists every unique tag with its count, sorted
// by frequency. Click a tag to jump to its filtered view.

import { cls, Link, page } from '@place/component'
import { NoteStoreCap } from '../store.ts'

export default page('/tags', {
  meta: { title: 'tags · commonplace' },
  view: () => {
    const store = NoteStoreCap.use()
    const tagCounts = (): readonly [string, number][] => {
      const counts = new Map<string, number>()
      for (const n of store.all()) {
        for (const t of n.tags) {
          counts.set(t, (counts.get(t) ?? 0) + 1)
        }
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    }

    return (
      <div class="h-full overflow-y-auto">
        <div class="max-w-3xl mx-auto px-6 py-10">
          <header class="space-y-2 mb-8">
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
            <h1 class="text-2xl font-semibold tracking-tight text-fg m-0">tags</h1>
            <p class="text-sm text-muted m-0">
              {() => {
                const n = tagCounts().length
                if (n === 0) return 'no tags yet — add some when you write a note.'
                return `${n} unique ${n === 1 ? 'tag' : 'tags'} across your notes.`
              }}
            </p>
          </header>

          {() => {
            const tags = tagCounts()
            if (tags.length === 0) {
              return (
                <div class="rounded-lg bg-card/40 border border-border/40 p-8 text-center">
                  <div class="text-muted/30 text-5xl font-light mb-2">#</div>
                  <p class="text-sm text-muted m-0">
                    when you tag a note, it'll show up here for quick browsing.
                  </p>
                </div>
              )
            }
            return (
              <ul class="list-none p-0 m-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {tags.map(([tag, count]) => (
                  <li>
                    <Link
                      to={`/tags/${tag}`}
                      class={cls(
                        'group flex items-baseline justify-between gap-3 px-3 py-2 rounded-md',
                        'bg-card/40 border border-border/40 hover:border-accent/40 hover:bg-card/70',
                        'no-underline transition-all',
                      )}
                    >
                      <span class="font-mono text-sm text-fg group-hover:text-accent transition-colors truncate">
                        #{tag}
                      </span>
                      <span class="text-[11px] font-mono text-muted shrink-0">
                        {count} {count === 1 ? 'note' : 'notes'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }}
        </div>
      </div>
    )
  },
})
