// /api/define-capability — capability primitive reference.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'

const SIG = `defineCapability<T>(name: string, options?: DefineCapabilityOptions): Capability<T>`

const BASIC = `import { defineCapability } from '@place/capability'

interface Logger {
  info(msg: string): void
  warn(msg: string): void
}

export const LoggerCap = defineCapability<Logger>('Logger')`

const CLIENT_ONLY = `export const NoteStoreCap = defineCapability<NoteStore>('NoteStore', {
  clientOnly: true,    // touching during SSR throws ClientOnlyAbort;
                       // component machinery catches it and emits a
                       // placeholder span instead of crashing.
})`

const USE = `// In a component body:
const logger = LoggerCap.use()        // throws if unprovisioned
const logger = LoggerCap.tryUse()     // returns null if unprovisioned`

const INSTALL = `// app() install:
caps: [[LoggerCap, () => console]]

// Or imperatively (rare): install(impl) RETURNS a disposer.
// Call the disposer to remove that specific installation —
// there is no .uninstall() method.
const dispose = LoggerCap.install(myLogger)
// ...later, to tear it down:
dispose()`

const SCOPED = `import { withCapability } from '@place/component'

// Provision for a single subtree:
withCapability(LoggerCap, scopedLogger, <Subtree />)`

export default page('/define-capability', {
  // No `meta:` — auto-title from `<h1><code>defineCapability()</code></h1>`.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>
        <code>defineCapability()</code>
      </h1>
      <p>
        Declares a typed slot. The returned <code>Capability</code> has <code>.use()</code>,{' '}
        <code>.tryUse()</code>, <code>.provide()</code>, and <code>.install()</code> methods.{' '}
        <code>install(impl)</code> returns a disposer — call it to remove that installation; there
        is no <code>uninstall</code>.
      </p>

      <h2 id="signature">Signature</h2>
      <CodeBlock code={SIG} />

      <h2 id="basic">Basic</h2>
      <CodeBlock code={BASIC} />

      <h2 id="client-only">clientOnly</h2>
      <CodeBlock code={CLIENT_ONLY} />
      <p>
        Marks the cap as browser-only. SSR <code>.use()</code> calls throw a special{' '}
        <code>ClientOnlyAbort</code> that the component machinery intercepts — the component renders
        as a <code>{`<span data-place-auto>`}</code> placeholder, and the real body mounts at
        hydration. No <code>typeof window</code> guards needed in consumer code.
      </p>

      <h2 id="use">use() and tryUse()</h2>
      <CodeBlock code={USE} />

      <h2 id="install">install() — at the app level</h2>
      <CodeBlock code={INSTALL} />
      <p>
        Each <code>install(impl)</code> call is tracked by a unique token, so the returned disposer
        removes exactly that installation regardless of stack order. Disposing twice is a no-op.
      </p>

      <h2 id="scoped">Scoped provision</h2>
      <CodeBlock code={SCOPED} />
      <p>
        Limits the provision to a subtree. Outside the subtree, <code>.use()</code> falls back to
        whatever's installed at the app level (or throws).
      </p>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/concepts/capabilities">Concepts: capabilities</Link>
        </li>
        <li>
          <Link to="/api/components">Boundary components</Link>
        </li>
      </ul>
    </article>
  ),
})
