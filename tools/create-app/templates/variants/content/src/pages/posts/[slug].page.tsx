// Dynamic post route. `:slug` is captured from the URL and passed to
// `load(ctx)` via `ctx.params.slug`. The `load()` result flows into
// `view({...})` as props — SSR-rendered, no client-side fetch needed
// for first paint.
//
// `getStaticPaths()` lists every slug to pre-render at build time
// (`PLACE_BUILD=dist`). Without it, the slug would still resolve at
// request time on a live server — but for a static export the build
// needs to know which slugs to generate HTML for.

import { page } from '@place-ts/component'
import { type Post, posts } from '../../posts.ts'

export default page('/posts/:slug', {
  getStaticPaths: () => posts.all().map((p) => ({ slug: p.slug })),
  load: ({ params }): { post: Post | undefined } => ({
    post: posts.get(params.slug),
  }),
  meta: ({ post }: { post?: Post }) => ({ title: post?.title ?? 'Not found' }),
  view: ({ post }: { post?: Post }) => {
    if (!post) {
      return (
        <div class="space-y-4">
          <h1 class="text-3xl font-semibold">Post not found</h1>
          <p class="text-muted">
            No post matches this slug.{' '}
            <Link to="/" class="text-accent">
              Back home
            </Link>
            .
          </p>
        </div>
      )
    }
    return (
      <article class="space-y-6">
        <header class="space-y-2">
          <h1 class="text-4xl font-semibold tracking-tight">{post.title}</h1>
          <div class="text-xs font-mono text-muted">{post.date}</div>
        </header>
        <div class="text-fg leading-relaxed whitespace-pre-wrap">{post.body}</div>
        <footer class="pt-6 border-t border-border">
          <Link to="/" class="text-sm text-accent">
            ← all posts
          </Link>
        </footer>
      </article>
    )
  },
})
