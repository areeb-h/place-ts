// /examples — gallery of real reference apps shipping in the monorepo.
// No live preview iframes here — each card links to source + a quick
// description of what's exercised end-to-end.

import { page } from '@place-ts/component'

interface Example {
  readonly title: string
  readonly summary: string
  readonly source: string
  readonly tags: readonly string[]
  readonly highlight?: boolean
}

const EXAMPLES: readonly Example[] = [
  {
    title: 'commonplace',
    summary:
      'Note-taking reference app. Exercises every shipping feature end-to-end — pages, layouts, ' +
      'capabilities (NoteStore with per-runtime impl), forms, actions, ISR, theme tokens, ' +
      "view transitions, virtualList. The canonical 'place app'.",
    source: 'examples/commonplace',
    tags: ['flagship', 'crud', 'theme', 'forms'],
    highlight: true,
  },
  {
    title: 'docs (this site)',
    summary:
      'The documentation site itself. Built with place; uses ' +
      'an inline-styled prose layout, a 3-column grid (sidebar / main / ToC), ' +
      'Cmd+K search, and an embedded reactivity demo.',
    source: 'examples/docs',
    tags: ['docs', 'search', 'theme'],
  },
  {
    title: 'sandbox',
    summary:
      'Minimal app used for quick iteration on framework features. Exercises edge cases the test ' +
      "suite can't cover — like dev overlay error rendering and HMR boundary behavior.",
    source: 'examples/sandbox',
    tags: ['dev', 'minimal'],
  },
  {
    title: 'sync-server',
    summary:
      'Standalone backend for cross-tab sync. Bun.serve + WebSocket fanout; pairs with the ' +
      'commonplace example when its persistence backend is set to "server".',
    source: 'examples/sync-server',
    tags: ['websocket', 'sync'],
  },
]

export default page('/examples', {
  // No `meta:` — auto-title from `<h1>Examples</h1>`.
  view: () => (
    <article class="max-w-3xl">
      <h1 class="text-3xl font-semibold text-fg mb-2">Examples</h1>
      <p class="text-muted text-lg mb-8">
        Reference apps that ship with place. Each one exercises a slice of the platform end-to-end —
        read the source to see how features compose in real apps.
      </p>
      <div class="grid grid-cols-1 gap-4">
        {EXAMPLES.map((ex) => (
          <a
            href={`https://github.com/anthropics/place-ts/tree/main/${ex.source}`}
            class={`block rounded-lg p-5 border transition-colors no-underline ${
              ex.highlight
                ? 'bg-accent/5 border-accent/40 hover:border-accent/70'
                : 'bg-card/40 border-border/60 hover:border-accent/40 hover:bg-card/70'
            }`}
          >
            <div class="flex items-baseline justify-between mb-2 gap-4">
              <h2 class="text-base font-semibold text-fg m-0 flex items-center gap-2">
                {ex.title}
                {ex.highlight ? (
                  <span class="text-[10px] font-mono text-accent uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/15">
                    flagship
                  </span>
                ) : null}
              </h2>
              <span class="text-[10px] font-mono text-muted">{ex.source}</span>
            </div>
            <p class="text-sm text-muted leading-relaxed m-0 mb-3">{ex.summary}</p>
            <div class="flex flex-wrap gap-1.5">
              {ex.tags.map((t) => (
                <span class="text-[10px] font-mono text-muted px-1.5 py-0.5 rounded bg-card border border-border/40">
                  #{t}
                </span>
              ))}
            </div>
          </a>
        ))}
      </div>
    </article>
  ),
})
