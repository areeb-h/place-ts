// Home page — lists every post + an interactive search palette.
//
// The framework's @place-ts/data primitive (`collection`) returns
// `posts.all()` synchronously; SSR renders the list on the server,
// and the same code path runs on the client for SPA-nav between
// posts. The search island ships separately and hydrates after first
// paint.

import { page } from '@place-ts/component'
import SearchPalette from '../islands/search-palette.tsx'
import { posts } from '../posts.ts'

export default page('/', {
  meta: { title: 'Posts' },
  view: () => (
    <div class="space-y-10">
      <header class="space-y-2">
        <h1 class="text-4xl font-semibold tracking-tight">__APP_NAME__</h1>
        <p class="text-muted">a place-ts content site — edit src/posts.ts to add your own.</p>
      </header>

      <section class="space-y-3">
        <h2 class="text-sm font-mono uppercase tracking-wide text-muted">Search</h2>
        <SearchPalette />
      </section>

      <section class="space-y-3">
        <h2 class="text-sm font-mono uppercase tracking-wide text-muted">All posts</h2>
        <ul class="space-y-4">
          {posts.all().map((post) => (
            <li class="border-l-2 border-border pl-4 py-1">
              <Link
                to={`/posts/${post.slug}`}
                class="text-lg text-fg no-underline hover:text-accent"
              >
                {post.title}
              </Link>
              <div class="text-xs font-mono text-muted mt-0.5">{post.date}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  ),
})
