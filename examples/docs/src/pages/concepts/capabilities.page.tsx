// /concepts/capabilities — the typed-slot alternative to React's
// useContext. Why context loses on SSR, what defineCapability fixes,
// and the clientOnly auto-detection that removes the typeof window
// ceremony.

import { Link, page } from '@place/component'
import { Callout } from '../../components/callout.tsx'
import { CodeBlock } from '@place/design'

const DEFINE = `import { defineCapability } from '@place/capability'

interface NoteStore {
  all(): readonly Note[]
  create(input: NoteInput): string
}

export const NoteStoreCap = defineCapability<NoteStore>('NoteStore', {
  clientOnly: true,  // touching this cap during SSR auto-emits a
                     // placeholder; the body runs on the client only.
})`

const INSTALL = `app({
  pages: [...],
  caps: [
    [RouterCap, pathRouter],
    [NoteStoreCap, {
      server: () => inMemoryNoteStore(SEED_NOTES),   // SSR-friendly seed
      client: () => localStorageNoteStore(),         // real persistence
    }],
  ],
}).run()`

const USE = `const NotesList = component(() => {
  const store = NoteStoreCap.use()  // fully typed; throws if unwired
  return (
    <ul>
      {() => store.all().map((n) => <li>{n.title}</li>)}
    </ul>
  )
})`

const REACT_CTX_BAD = `// React: silently undefined on SSR if the provider isn't above. No
// type-system way to know whether the consumer is "safe" to render.
const v = useContext(MyContext)
if (!v) throw new Error('MyContext not provided')  // every consumer ceremony`

// Local path — final URL is composed by `routes('/concepts', […])`
// in `pages/concepts/index.ts`. Folder reorgs become a one-line edit
// in the barrel; this file stays portable.
export default page('/capabilities', {
  // No `meta:` — auto-title from `<h1>Capabilities</h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>Capabilities</h1>
      <p>
        Capabilities are typed slots: a named contract that components consume and the app provides.
        Same job as React context, four differences that matter:
      </p>
      <ul>
        <li>
          <strong>Typed end-to-end.</strong> The cap's type flows to every <code>.use()</code> site
          without a generic ceremony.
        </li>
        <li>
          <strong>Scoped, not global.</strong> Provisions sit in lexical scope; no "above the
          provider" rules to remember.
        </li>
        <li>
          <strong>SSR-aware.</strong> <code>{`clientOnly: true`}</code> caps that get touched during
          SSR auto-emit a placeholder span and run their body on hydration.
        </li>
        <li>
          <strong>Per-runtime install.</strong> Same cap, different impls on server vs client.
        </li>
      </ul>

      <h2 id="define">defineCapability()</h2>
      <CodeBlock code={DEFINE} />
      <p>
        A capability is a key + a type. It doesn't carry a default value — provision sites are
        responsible for that, and unprovisioned use throws with a clear message.
      </p>

      <h2 id="install">Per-runtime install</h2>
      <p>
        The framework dispatches the right factory based on the runtime. Same cap; the server
        renders against the seed store, the client hydrates against localStorage. No{' '}
        <code>typeof window</code> checks anywhere in your code.
      </p>
      <CodeBlock code={INSTALL} />

      <h2 id="use">use() at the call site</h2>
      <CodeBlock code={USE} />
      <p>
        <code>NoteStoreCap.use()</code> returns the typed instance. If the cap is{' '}
        <code>clientOnly</code> and not installed (SSR), <code>.use()</code> throws a special{' '}
        <code>ClientOnlyAbort</code> that the component machinery catches — the component renders as
        an empty placeholder, then mounts the real body on hydration. You don't write a guard.
      </p>

      <h2 id="why-not-context">Why not React context</h2>
      <CodeBlock code={REACT_CTX_BAD} />
      <Callout kind="warn" title="Action at a distance">
        Context's silent failure mode bites in two places: SSR (where the provider didn't render)
        and refactors (where the provider moves). Capabilities make both errors explicit at the type
        level.
      </Callout>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/define-capability">API: defineCapability()</Link>
        </li>
        <li>
          <Link to="/concepts/reactivity">Concepts: reactivity</Link>
        </li>
      </ul>
    </article>
  ),
})
