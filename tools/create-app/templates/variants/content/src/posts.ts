// Posts collection. `collection()` from @place-ts/data wraps a
// `State<T[]>` with reactive keyed CRUD (get/all/add/update/remove +
// trash + cursor). The right shape for a small content set committed
// to the repo. For a database-backed store, swap the inner state with
// your own load + write; the collection wrapper stays.
//
// Each post has a slug (used as the lookup key + URL segment), title,
// date (ISO), and markdown body. Pre-rendered to HTML on build.

import { collection } from '@place-ts/data'
import { state } from '@place-ts/reactivity'

export interface Post {
  slug: string
  title: string
  date: string
  body: string
}

const seed: Post[] = [
  {
    slug: 'hello-world',
    title: 'Hello, world',
    date: '2026-01-01',
    body: 'This is the first post. Edit `src/posts.ts` to add your own.',
  },
  {
    slug: 'on-the-shelf',
    title: 'Books on the shelf',
    date: '2026-01-08',
    body: 'A note about what I am reading.',
  },
]

export const posts = collection<Post>(state(seed), {
  id: (p) => p.slug,
  sortBy: (a, b) => b.date.localeCompare(a.date),
})
