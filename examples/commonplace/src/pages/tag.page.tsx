// Round 7 — tag-filtered notes page (`/tags/:tag`). Reuses the
// `NotesList` component from the home page with `initialTag` set and
// filters disabled (the tag is fixed by the URL path, not a search
// field). `clientOnly: true` defers the body to hydrate.

import { page } from '@place/component'
import { RouterCap } from '@place/routing'
import { NotesList } from './home.page.tsx'

export default page('/tags/:tag', {
  meta: (props) => ({
    title: `#${(props as { params?: { tag?: string } }).params?.tag ?? 'tag'} · commonplace`,
  }),
  view: () => {
    const router = RouterCap.use()
    const tag = router.segment(1) ?? ''
    return <NotesList initialQuery="" initialTag={tag} editableFilters={false} />
  },
})
