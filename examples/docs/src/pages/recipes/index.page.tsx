// /recipes — index of how-to guides. Each card links to a focused
// recipe page; the index itself does no heavy lifting.

import { Link, page } from '@place-ts/component'

interface Recipe {
  readonly to: string
  readonly title: string
  readonly body: string
  readonly tag: string
}

const RECIPES: readonly Recipe[] = [
  {
    to: '/recipes/forms',
    title: 'Forms & actions',
    body: 'Typed submit, CSRF on by default, JS-on and JS-off both work. <Form action={...}> is the shortcut.',
    tag: 'mutation',
  },
  {
    to: '/recipes/data-fetching',
    title: 'Data fetching',
    body: 'Page load() for SSR-injected data, ISR for caching, useSearch for typed URL params.',
    tag: 'load',
  },
  {
    to: '/recipes/auth',
    title: 'Authentication',
    body: 'Session cookie, server-side guard via load(), redirect on unauthenticated.',
    tag: 'security',
  },
  {
    to: '/recipes/streaming',
    title: 'Streaming SSR',
    body: 'Mark the page streaming: true, wrap slow children in <Suspense>. Comment-marker swap, no React baggage.',
    tag: 'perf',
  },
  {
    to: '/recipes/theming',
    title: 'Theming & dark mode',
    body: 'theme() with bare color keys, auto light-dark() mode, no-flash cookie persistence. themeTokens() for custom CSS variables.',
    tag: 'design',
  },
]

// Local path `/` = index of the `/recipes` group; composed in
// `pages/recipes/index.ts` via `routes('/recipes', […])`.
export default page('/', {
  // No `meta:` — auto-title from `<h1>Recipes</h1>`.
  view: () => (
    <article class="max-w-3xl">
      <h1 class="text-3xl font-semibold text-fg mb-2">Recipes</h1>
      <p class="text-muted text-lg mb-8">
        Patterns we ship in the framework, written as how-tos with full code.
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {RECIPES.map((r) => (
          <Link
            to={r.to}
            class="block rounded-lg bg-card/40 border border-border/60 p-5 hover:border-accent/40 hover:bg-card/70 transition-colors no-underline"
          >
            <div class="flex items-baseline justify-between mb-2">
              <h2 class="text-base font-semibold text-fg m-0">{r.title}</h2>
              <span class="text-[10px] font-mono text-accent uppercase tracking-wider">
                {r.tag}
              </span>
            </div>
            <p class="text-sm text-muted leading-relaxed m-0">{r.body}</p>
          </Link>
        ))}
      </div>
    </article>
  ),
})
