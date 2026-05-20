// /api/layout — layout() reference. Composable shells around pages.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'

const BASIC = `import { layout } from '@place/component'

export const rootLayout = layout({
  meta: { bodyClass: 'bg-bg text-fg' },
  view: ({ children }) => (
    <div class="min-h-screen flex flex-col">
      <Header />
      <main class="flex-1">{children}</main>
      <Footer />
    </div>
  ),
})`

const LOAD = `export const dashLayout = layout({
  load: async ({ req }) => ({
    user: await getUserFromRequest(req),
  }),
  view: ({ children, user }) => (
    <div>
      <UserBadge name={user.name} />
      {children}
    </div>
  ),
})`

const CHAIN = `// Layouts compose outside-in:
page('/admin/users', {
  layout: [rootLayout, adminLayout],
  view: ({ children }) => <UserList />,
})

// rootLayout wraps adminLayout wraps the page.
// Both layouts' load() run in chain order; results merge into a single
// loadData passed to every view + meta callback in the chain.`

const SLOTS = `// Typed named slots — let pages customize specific layout regions
// without parallel-route file conventions (Next.js) or magic single
// outlets (Nuxt). The layout's second type parameter declares the
// slot key union; pages get autocomplete on those keys.

const dashboard = layout<{}, 'headerActions' | 'sidebar'>({
  view: ({ children, slots }) => (
    <div class="grid grid-cols-[240px_1fr]">
      <aside class="border-r">
        {slots('sidebar') ?? <DefaultSidebar />}
      </aside>
      <main>
        <header class="flex justify-end gap-2 p-2">
          {slots('headerActions')}
        </header>
        {children}
      </main>
    </div>
  ),
})

// Each page fills the slots it cares about. Missing slots resolve
// to null; the layout can branch on \`slots.has('name')\` for fallbacks.
page('/users', {
  layout: dashboard,
  slots: {
    headerActions: () => <NewUserButton />,
    sidebar:       () => <UserFilters />,
  },
  view: () => <UserList />,
})

page('/settings', {
  layout: dashboard,
  // No \`headerActions\` slot — that region renders null.
  slots: { sidebar: () => <SettingsNav /> },
  view: () => <SettingsForm />,
})`

export default page('/layout', {
  // No `meta:` — auto-title from `<h1><code>layout()</code></h1>`.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>
        <code>layout()</code>
      </h1>
      <p>
        A layout is a page-shaped value that takes <code>children</code>. Compose them outside-in to
        share chrome across many pages.
      </p>

      <h2 id="basic">Basic</h2>
      <CodeBlock code={BASIC} />

      <h2 id="load">load — server-side data</h2>
      <CodeBlock code={LOAD} />
      <p>
        Layout <code>load</code> runs server-side before <code>view()</code>. Its return merges into{' '}
        <code>loadData</code> which flows to every layout and the page in the chain.
      </p>

      <h2 id="chain">Layout chains</h2>
      <CodeBlock code={CHAIN} />

      <h2 id="slots">Typed named slots</h2>
      <p>
        Layouts can expose <strong>typed named slots</strong> — regions a page can fill with custom
        content. The layout's second type parameter declares the slot key union; pages get
        TypeScript autocomplete on those keys. No file convention, no <code>@</code>-prefixed
        parallel routes, no <code>{`<NuxtPage />`}</code> magic.
      </p>
      <CodeBlock code={SLOTS} />
      <p>
        Slots are functions (lazy), so the layout decides when to render them — branching with{' '}
        <code>slots.has('name')</code> covers the "render a fallback when unfilled" case without
        cost. Slot fills survive the whole layout chain: an outer layout doesn't need to know what
        its inner layouts consume.
      </p>
      <p>
        <strong>Compared to other frameworks:</strong> Next.js requires parallel routes (file-system
        magic, <code>@modal/page.tsx</code> directories) for the same UX. Nuxt has one{' '}
        <code>{`<NuxtPage />`}</code> outlet per layout — multi-slot isn't first-class. Remix's{' '}
        <code>{`<Outlet />`}</code> is single-slot too. place's named slots are typed values flowing
        through props.
      </p>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/page">page()</Link>
        </li>
        <li>
          <Link to="/api/app">app()</Link> — set the default layout for every page
        </li>
      </ul>
    </article>
  ),
})
