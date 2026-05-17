// All routing concerns for the sandbox in one file: the page registry,
// the index/not-found views, and the dispatcher. main.tsx is a four-line
// boot script; everything route-shaped lives here.

import { component, urlState, type View, wire } from '@place/component'
import { RouterCap } from '@place/routing'
import { CounterExample } from './examples/01-counter.tsx'
import { TemperatureExample } from './examples/02-temperature.tsx'
import { DiamondExample } from './examples/03-diamond.tsx'
import { DynamicDepsExample } from './examples/04-dynamic.tsx'
import { DerivableExample } from './examples/05-derivable.tsx'
import { BatchingExample } from './examples/06-batching.tsx'
import { KeyedListExample } from './examples/07-keyed-list.tsx'
import { CapabilityExample } from './examples/08-capability.tsx'
import { ResourceExample } from './examples/09-resource.tsx'
import { PersistenceExample } from './examples/10-persistence.tsx'
import { DxHelpersExample } from './examples/11-dx-helpers.tsx'
import { ErrorBoundaryExample } from './examples/12-error-boundary.tsx'

export type Phase = 1 | 2 | 3 | 4 | 5 | 6

export interface Page {
  readonly slug: string
  readonly number: string
  readonly label: string
  readonly phase: Phase
  readonly Component: () => View
}

export const PAGES: readonly Page[] = [
  { slug: 'counter', number: '01', label: 'Counter', phase: 1, Component: CounterExample },
  {
    slug: 'temperature',
    number: '02',
    label: 'Derived chain',
    phase: 1,
    Component: TemperatureExample,
  },
  {
    slug: 'diamond',
    number: '03',
    label: 'Diamond convergence',
    phase: 1,
    Component: DiamondExample,
  },
  { slug: 'dynamic', number: '04', label: 'Dynamic deps', phase: 1, Component: DynamicDepsExample },
  {
    slug: 'derivable',
    number: '05',
    label: 'Derivable state',
    phase: 2,
    Component: DerivableExample,
  },
  {
    slug: 'batching',
    number: '06',
    label: 'Batch · flush · defer',
    phase: 3,
    Component: BatchingExample,
  },
  { slug: 'keyed', number: '07', label: 'Keyed list', phase: 2, Component: KeyedListExample },
  {
    slug: 'capability',
    number: '08',
    label: 'Capabilities',
    phase: 3,
    Component: CapabilityExample,
  },
  {
    slug: 'resource',
    number: '09',
    label: 'resource (async)',
    phase: 5,
    Component: ResourceExample,
  },
  {
    slug: 'persistence',
    number: '10',
    label: 'Persistence',
    phase: 3,
    Component: PersistenceExample,
  },
  { slug: 'dx-helpers', number: '11', label: 'DX helpers', phase: 2, Component: DxHelpersExample },
  {
    slug: 'error-boundary',
    number: '12',
    label: 'errorBoundary',
    phase: 2,
    Component: ErrorBoundaryExample,
  },
]

const IndexPage = component(() => {
  // Bidirectional URL ↔ state binding. The input value below IS the URL
  // ?q= param. Type → URL updates → refresh preserves it → share the
  // URL and the recipient sees what you typed.
  const q = urlState('q', '')

  return (
    <article class="space-y-4 max-w-2xl">
      <h2 class="text-xl font-semibold text-fg">place — sandbox</h2>
      <p class="text-sm text-muted leading-relaxed">
        Pick an example from the sidebar. Each one mounts its own reactive graph on demand — only
        the page you're viewing runs, no offscreen tickers, no wasted watches. Routing is
        hash-based; browser back/forward, Cmd-click "open in new tab", and deep-linking via URL all
        work natively.
      </p>

      <div class="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-2">
        <div class="text-xs font-mono text-accent uppercase tracking-wider">urlState live demo</div>
        <input
          type="text"
          {...wire(q)}
          placeholder="type here — the URL updates as you go"
          class="w-full px-3 py-2 rounded-md bg-bg/80 border border-border text-sm placeholder:text-muted/60 focus:border-accent/60 focus:outline-none transition-colors"
        />
        <div class="text-xs text-muted font-mono">
          {() => {
            const v = q()
            return v
              ? `?q=${encodeURIComponent(v)} — refresh preserves this · share the URL · clear to remove the param`
              : 'try typing — the input value is bound bidirectionally to the URL'
          }}
        </div>
      </div>
    </article>
  )
})

const NotFoundPage = (): View => {
  const home = RouterCap.use().link('/')
  return (
    <article class="text-center py-16 space-y-4">
      <div class="text-5xl text-muted/30">404</div>
      <p class="text-sm text-muted">no example matches that route</p>
      <a
        {...home}
        class="inline-block text-sm text-accent hover:text-accent underline-offset-4 hover:underline"
      >
        ← back to the index
      </a>
    </article>
  )
}

/**
 * Reactive view that mounts the page matching the current route. Reads
 * the active slug from `RouterCap`, so any subscriber re-runs on
 * navigation. `null` (path `/`) → Index; unknown slug → NotFound.
 *
 * Pass it as a function child: `<Layout>{dispatch}</Layout>`. The
 * component layer treats function children as reactive, so dispatch()
 * re-evaluates each time the route changes.
 */
export function dispatch(): View {
  const slug = RouterCap.use().segment(0)
  if (slug === null) return IndexPage({})
  const page = PAGES.find((p) => p.slug === slug)
  return page ? page.Component() : NotFoundPage()
}
