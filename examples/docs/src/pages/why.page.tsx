// Why place — comparison with Next, Remix, TanStack Start. The core
// pitch is shown as side-by-side code (same feature, three syntaxes)
// followed by a feature matrix. No fluff — just the receipts.

import { page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../components/callout.tsx'
import { ComparisonTable } from '../components/comparison-table.tsx'

// Tabs + Tab are auto-imported from @place-ts/component via bunfig preload.

const PLACE_HELLO = `// src/pages/hello.page.tsx
import { page } from '@place-ts/component'

export default page('/hello', {
  view: () => <h1>Hello</h1>,
})`

const NEXT_HELLO = `// app/hello/page.tsx
export default function Page() {
  return <h1>Hello</h1>
}
// (file path = route; no value to reference)`

const REMIX_HELLO = `// app/routes/hello.tsx
export default function Hello() {
  return <h1>Hello</h1>
}
// (file path = route; framework wires it via convention)`

const PLACE_ACTION = `export default page('/posts/:id', {
  on: {
    save: async (input: { title: string }, { params }) => {
      await db.posts.update(params.id, input)
      return { ok: true }
    },
  },
  view: () => /* call pageRef.save({...}) — fully typed */ null,
})`

const NEXT_ACTION = `// app/posts/[id]/page.tsx
'use server'  // ← required marker
export async function save(formData: FormData) {
  // formData is untyped; you destructure strings.
  await db.posts.update(/* id from cookie? closure? */, {
    title: formData.get('title') as string,
  })
}
// caller imports save(), passes FormData; types lost.`

const PLACE_CAP = `import { defineCapability } from '@place-ts/capability'

export const NoteStoreCap = defineCapability<NoteStore>('NoteStore', {
  clientOnly: true,
})

// In a page:
const store = NoteStoreCap.use()  // typed; provided once at app config`

const REACT_CTX = `const NoteStoreContext = createContext<NoteStore | null>(null)

function Provider({ children }: { children: ReactNode }) {
  const value = useMemo(() => createStore(), [])
  return <NoteStoreContext.Provider value={value}>{children}</NoteStoreContext.Provider>
}

function useStore() {
  const v = useContext(NoteStoreContext)
  if (!v) throw new Error('NoteStoreContext not provided')
  return v
}
// 12 lines for what one defineCapability does.`

export default page('/why', {
  // No `meta:` — framework auto-promotes the `<h1>Why place</h1>` below;
  // layout's `titleTemplate: '%s · place docs'` does the rest.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>Why place</h1>
      <p>
        Three frameworks already own this space. Each made one structural mistake we're not making —
        and the difference shows up in code you write every day.
      </p>

      <Callout kind="note" title="Honest framing">
        Next, Remix, and TanStack Start are all good. place isn't a strict upgrade — it's a
        different bet about what the framework should hide and what it should expose.
      </Callout>

      <h2 id="hello-world">Hello, world</h2>
      <p>The smallest unit — declare a route. Same outcome, three philosophies.</p>
      <Tabs group="why-hello">
        <Tab label="place">
          <CodeBlock code={PLACE_HELLO} />
        </Tab>
        <Tab label="Next.js">
          <CodeBlock code={NEXT_HELLO} />
        </Tab>
        <Tab label="Remix">
          <CodeBlock code={REMIX_HELLO} />
        </Tab>
      </Tabs>
      <p>
        Next and Remix both encode the route in the <em>file path</em>. Move the file, your route
        moves with it; references to it (links, action callers) get stale. place puts the route in a{' '}
        <em>value</em> — refactor it, TypeScript flags every call site.
      </p>

      <h2 id="actions">Server actions</h2>
      <p>
        Mutation is the API people get wrong first. The <code>'use server'</code> marker hides too
        much; the FormData contract throws away types.
      </p>
      <Tabs group="why-actions">
        <Tab label="place">
          <CodeBlock code={PLACE_ACTION} />
        </Tab>
        <Tab label="Next.js">
          <CodeBlock code={NEXT_ACTION} />
        </Tab>
      </Tabs>
      <p>
        place's action lives on the same page as its caller, with the full input type intact. The
        endpoint is visible (<code>POST /posts/:id/_action/save</code>); the path appears in your
        routes table; no Babel pass, no encrypted action IDs, no untyped FormData detour.
      </p>

      <h2 id="capabilities-vs-context">Capabilities, not context</h2>
      <p>
        React's context is global by default and silent on SSR mismatches. Capabilities are typed,
        scoped, and SSR-aware out of the box.
      </p>
      <Tabs group="why-cap">
        <Tab label="place">
          <CodeBlock code={PLACE_CAP} />
        </Tab>
        <Tab label="React + Context">
          <CodeBlock code={REACT_CTX} />
        </Tab>
      </Tabs>
      <p>
        <code>clientOnly: true</code> auto-emits an SSR-safe placeholder when a browser-only cap is
        touched during render. No <code>typeof window</code> branches. No hydration mismatches.
      </p>

      <h2 id="matrix">Feature matrix</h2>
      <ComparisonTable
        columns={['place', 'Next.js (App Router)', 'Remix', 'TanStack Start']}
        rows={[
          {
            feature: 'Routes',
            hint: 'how routes are declared',
            cells: ['values', 'file convention', 'file convention', 'file convention'],
          },
          {
            feature: 'Refactor by rename',
            hint: 'TS catches stale route refs',
            cells: [true, false, false, 'partial'],
          },
          {
            feature: 'Typed mutations',
            hint: 'caller knows the input type',
            cells: [true, 'FormData only', 'FormData only', true],
          },
          {
            feature: 'Schema-validated actions',
            hint: 'Zod / Valibot / ArkType, typed field errors',
            cells: [true, 'manual', 'manual', true],
          },
          {
            feature: 'No use client / use server markers',
            hint: 'no magic string directives',
            cells: [true, false, true, true],
          },
          {
            feature: 'No codegen step',
            hint: 'no generated files to regenerate',
            cells: [true, true, true, false],
          },
          {
            feature: 'SSR-safe typed context',
            hint: 'capabilities — no typeof window checks',
            cells: [true, false, false, false],
          },
          {
            feature: 'Islands hydration',
            hint: 'content pages ship zero framework JS',
            cells: [true, false, false, false],
          },
          {
            feature: 'Streaming SSR',
            hint: 'per-suspense boundaries',
            cells: [true, true, true, true],
          },
          {
            feature: 'Built-in CSRF',
            hint: 'automatic on every action',
            cells: [true, 'origin-check', false, false],
          },
          {
            feature: 'Built-in CSP + SRI',
            hint: 'strict headers, hashed scripts',
            cells: [true, false, false, false],
          },
          {
            feature: 'Image component',
            hint: 'srcset + lazy variants + caching',
            cells: ['pluggable', true, false, false],
          },
          {
            feature: 'Component library included',
            hint: '@place-ts/design — 14 primitives',
            cells: [true, false, false, false],
          },
          {
            feature: 'Animation primitives',
            hint: 'spring / tween / sequence as derived state',
            cells: [true, false, false, false],
          },
          {
            feature: 'RBAC gate component',
            hint: '<Can do="…"> reads the session',
            cells: [true, false, false, false],
          },
          {
            feature: 'View Transitions',
            hint: 'opt-in, zero extra JS',
            cells: [true, false, false, false],
          },
          {
            feature: 'Islands-aware static export',
            hint: 'pre-render + ship only island bundles',
            cells: [true, 'partial', false, 'partial'],
          },
          {
            feature: 'Bundle — hello world',
            hint: 'gzipped client JS, content page',
            cells: ['0 KB', '74 KB', '38 KB', '52 KB'],
          },
        ]}
      />
      <Callout kind="note">
        place ships an islands hydration model: a page with no interactive island ships{' '}
        <strong>zero</strong> framework JavaScript — a "hello world" content page is literally 0 KB
        on the client. Pages that need interactivity ship only their islands' bundles (typically 3–8
        KB each), never a whole-app runtime. Competitor numbers are a minimal "hello world" with the
        default router; the relative gap widens, not narrows, as apps grow.
      </Callout>

      <h2 id="when-not-to">When not to pick place</h2>
      <ul>
        <li>
          You need Node-specific integrations. place runs on Bun; the first-party adapters ship for
          Cloudflare Workers, Vercel Build Output, and Deno Deploy via{' '}
          <code>createFetchHandler()</code>, but pure-Node compatibility is best-effort.
        </li>
        <li>
          You have a large React codebase with deep React-specific patterns. place uses a different
          reactivity model; the migration cost is real.
        </li>
        <li>
          You need an established ecosystem. place is v0.x; the recipe library will be 10× smaller
          than Next's for a while.
        </li>
      </ul>
    </article>
  ),
})
