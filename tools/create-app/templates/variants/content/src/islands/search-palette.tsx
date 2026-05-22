// Search palette island. Reactive substring search over the posts
// collection using @place-ts/search.
//
// `searchable(items, { fields })(query)` returns a getter for the
// filtered + ranked items. Items are tokenized + case-folded once
// per item (cached); typing into the input re-evaluates the filter
// only — no re-tokenization.
//
// This island ships its own client bundle. The search input has its
// own reactive state; the filtered list re-renders on every keystroke.

import { searchable } from '@place-ts/search'

import { posts } from '../posts.ts'

const filteredFor = searchable(() => posts.all(), {
  fields: (p) => [p.title, p.body],
})

export default island(() => {
  const query = state('')
  const filtered = filteredFor(() => query())

  return (
    <div class="space-y-3">
      <input
        type="search"
        placeholder="Search posts…"
        value={() => query()}
        onInput={(e) => query.set((e.currentTarget as HTMLInputElement).value)}
        class="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-sans text-fg placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
      />
      <ul class="space-y-1">
        {() =>
          filtered().map((post) => (
            <li>
              <Link
                to={`/posts/${post.slug}`}
                class="block px-3 py-2 rounded-md text-sm text-fg no-underline hover:bg-card transition-colors"
              >
                <span class="text-fg">{post.title}</span>
                <span class="text-muted ml-2 font-mono text-xs">{post.date}</span>
              </Link>
            </li>
          ))
        }
      </ul>
    </div>
  )
})
