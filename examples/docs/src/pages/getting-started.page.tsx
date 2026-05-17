// Getting-started guide. Five steps from zero to a running place app.
// Each step includes the actual code; no marketing fluff. Code blocks
// route through <CodeBlock> for syntax highlighting + copy.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'

const INSTALL_BUN = `curl -fsSL https://bun.sh/install | bash`

const SCAFFOLD = `bunx @place/create-app my-app
cd my-app
bun install
bun run dev`

const ADD_PAGE = `// src/pages/about.page.tsx
import { page } from '@place/component'

export default page('/about', {
  meta: 'About',  // string shorthand; layout's titleTemplate adds the suffix
  view: () => (
    <article>
      <h1>About</h1>
      <p>Hi from place.</p>
    </article>
  ),
})`

const ADD_DATA = `import { page, shape, useSearch } from '@place/component'

export default page('/posts', {
  search: shape({ page: 'number', tag: 'string?' }),
  view: (props) => {
    const { page: p, tag } = useSearch<{ page: number; tag?: string }>(props)
    return <PostList page={p} tag={tag} />
  },
})`

const ADD_ACTION = `const postPage = page('/posts/:id', {
  on: {
    delete: async (_input, { params }) => {
      await db.posts.delete(params.id)
      return { ok: true }
    },
  },
  view: () => (
    <button onClick={() => postPage.delete()}>Delete</button>
  ),
})`

const ADD_ISLAND = `// src/islands/counter.tsx — \`island\`, \`state\` auto-imported.

const Counter = island((props: { start?: number }) => {
  const n = state(props.start ?? 0)
  return (
    <button onClick={() => n.set(n() + 1)}>
      Clicked {n} times
    </button>
  )
})

// Use anywhere in a page (or another island), JSX-callable.
export default page('/demo', {
  view: () => (
    <article>
      <h1>Click me</h1>
      <Counter start={5} />
    </article>
  ),
})`

const ADD_CAP = `import { defineCapability } from '@place/capability'

interface NoteStore {
  all(): readonly Note[]
  create(input: NoteInput): string
}

export const NoteStoreCap = defineCapability<NoteStore>('NoteStore', {
  clientOnly: true,
})`

const INSTALL_CAP = `app({
  pages: [home, postIndex, postDetail],
  caps: [
    [RouterCap, pathRouter],
    [NoteStoreCap, {
      server: () => inMemoryStore(seed),  // SSR-friendly seed
      client: () => localStorageStore(),  // hydrates to real data
    }],
  ],
}).run()`

export default page('/getting-started', {
  // No `meta:` — auto-title from `<h1>Getting started</h1>`.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>Getting started</h1>
      <p>
        Six steps from zero to a running place app — install, add a page, add typed data, add a
        server action, add an interactive island, add a capability. The whole flow takes about
        four minutes. If you've used Next or TanStack Start you'll recognize the shape; the
        difference is in what's <em>missing</em>: no file-system routing, no codegen, no
        encrypted action IDs, no <code>'use client'</code> markers, no per-page hydration bundle.
      </p>

      <h2>1. Install</h2>
      <p>place runs on Bun. If you don't have it yet:</p>
      <CodeBlock code={INSTALL_BUN} lang="bash" />
      <p>Then scaffold a fresh app:</p>
      <CodeBlock code={SCAFFOLD} lang="bash" />
      <p>
        The dev server starts on <code>localhost:5174</code> with hot-reload, source-map error
        overlay, and auto-Tailwind. No <code>vite.config.ts</code>, no <code>next.config.js</code>,
        no <code>tsup</code>.
      </p>

      <h2>2. Add a page</h2>
      <p>
        Pages are values. Each one declares its own path, view, optional load, optional actions. The
        framework derives the routes table from the pages array — the path is written exactly once,
        where the page lives.
      </p>
      <CodeBlock code={ADD_PAGE} filename="src/pages/about.page.tsx" />
      <p>
        Add it to the app's pages array. Refactoring? Rename the import — TypeScript catches every
        call site. No codegen step.
      </p>

      <h2>3. Add typed data</h2>
      <p>
        Pages can declare a typed <code>search:</code> schema. The framework runs it server-side
        before <code>view()</code>, so URL params arrive parsed and validated. Use the built-in{' '}
        <code>shape()</code> for flat objects; Zod/Valibot slot in via the <code>ActionSchema</code>{' '}
        interface.
      </p>
      <CodeBlock code={ADD_DATA} />

      <h2>4. Add an action</h2>
      <p>
        Co-located actions live in the page's <code>on:</code> dict. Each handler auto-registers at{' '}
        <code>POST {`{path}/_action/{key}`}</code> with the full security pipeline: auto-CSRF,
        same-origin enforcement, body-size limit, prototype-pollution guard. The client-side caller
        is auto-typed.
      </p>
      <CodeBlock code={ADD_ACTION} />
      <p>
        No <code>'use server'</code> marker, no Babel pass, no encrypted action IDs. The endpoint is
        visible in your routes table.
      </p>

      <h2>5. Add interactivity (an island)</h2>
      <p>
        Anything that needs JS in the browser — a click handler, reactive state, a timer — goes
        inside an <code>island(fn)</code> call. The wrapper makes the function a JSX-callable
        component; the framework's Bun plugin discovers it at build time, bundles it per-island,
        and inlines a <code>{`<script>`}</code> into pages that actually render the island.
      </p>
      <CodeBlock code={ADD_ISLAND} />
      <p>
        Pages with <strong>no islands</strong> ship zero framework JS. Pages with one island ship
        ~1–2 KB gzipped for the island plus a 14 KB shared runtime chunk that's cached across
        every interactive page in your app. The hydration boundary is typed — no{' '}
        <code>'use client'</code> marker, no string convention. See{' '}
        <Link to="/api/components">island, Tabs, Show, Suspense</Link> for the full primitive list.
      </p>

      <h2>6. Add a capability</h2>
      <p>
        Capabilities replace React-style context. Typed slots, lexical scope, no
        action-at-a-distance. Browser-only caps (e.g. a path router that drives{' '}
        <code>window.history</code>) declare themselves with <code>{`{ clientOnly: true }`}</code>,
        and the component framework auto-emits an SSR-safe placeholder when one is touched during
        render.
      </p>
      <CodeBlock code={ADD_CAP} />
      <p>Then install it in your app config:</p>
      <CodeBlock code={INSTALL_CAP} filename="src/app.ts" />

      <hr />

      <h2>Next steps</h2>
      <ul>
        <li>
          <Link to="/api/page">
            API reference for <code>page()</code>
          </Link>
        </li>
        <li>
          Roadmap: see the <code>docs/roadmap.md</code> file in the repo.
        </li>
        <li>
          Examples: <code>examples/commonplace</code> is a real reference app. Every shipping
          feature is exercised end-to-end.
        </li>
      </ul>
    </article>
  ),
})
