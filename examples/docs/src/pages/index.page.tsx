// Landing page. Big hero with a typing code preview + a feature
// grid + a "what's inside" rundown of every shipping system. The
// page is denser than the typical framework landing because place is
// a *platform of nine systems* — we name each one.

import { Link, page } from '@place-ts/component'
import { Badge, Card, CodeBlock } from '@place-ts/design'
// TypingCode is now pure SSR + CSS — no JS reactivity needed for the
// reveal animation. Imported directly from `components/`, not islands.
import { TypingCode } from '../components/typing-code.tsx'
import { button, inlineCode, sectionLabel } from '../design-system.ts'

const APP_SHAPE = `import { app, discoverPages } from '@place-ts/component/server'
import { pathRouter } from '@place-ts/routing'
import { mainLayout } from './layouts/main.layout'
import { tokens } from './theme'

export default await app({
  pages: await discoverPages('./src/pages'),
  layout: mainLayout,
  theme: tokens,
  router: pathRouter,
}).start()`

interface Feature {
  readonly title: string
  readonly body: string
  readonly tag?: string
}

const FEATURES: readonly Feature[] = [
  {
    title: 'Routes as values',
    body: "Every page is a value. Move a file, route doesn't break. No codegen, no stale .d.ts, no file-system magic. Refactors are TypeScript renames.",
  },
  {
    title: 'Capabilities, not context',
    body: 'Typed slots installed with explicit scope. No useContext action-at-a-distance. SSR-safe by construction — clientOnly caps auto-emit placeholders.',
  },
  {
    title: 'Reactivity, not re-render',
    body: 'Fine-grained signals + two-color graph coloring. The same algorithm TC39 standardizes. No virtual DOM, no per-tick reconciliation.',
    tag: 'tc39',
  },
  {
    title: 'Real SSR',
    body: 'suspense() with comment-marker swap. ISR via lazy stale-while-revalidate. Per-route security headers. Auto-CSRF + same-origin + body-limit defaults.',
    tag: 'streaming',
  },
  {
    title: 'Actions, typed',
    body: 'Co-located on:{} dict per page. Auto-typed callers; the path is visible; no Babel pass, no encrypted action IDs. Schema-agnostic — bring your own validator.',
  },
  {
    title: 'Theme system, four-tier DX',
    body: '<ThemeToggle /> drops in one tag for defaults; useTheme() is the headless primitive for BYO UI; setTheme(name) is the escape hatch. SSR ships no theme class when undecided — OS preference drives via @media, zero blip on hard refresh.',
    tag: 'new',
  },
  {
    title: 'Scaffolder that respects you',
    body: '`bunx @place-ts/create-app` — three curated templates (minimal · content · app) + five composable feature packs (theme, tests, CI, design, persistence). Interactive picker with sensible defaults; every choice exposed as a flag for CI.',
    tag: 'new',
  },
  {
    title: 'Production deploy adapters',
    body: 'createFetchHandler() → Web-standard Request/Response. First-class adapters for Cloudflare Workers, Vercel Build Output, Deno Deploy. Static export emits a CSP-ready _headers file.',
  },
  {
    title: 'Server logs that scan',
    body: 'PLACE_LOG_LEVEL env var · scoped [hmr] / [isr] prefixes · terminal-rendered error frames with source-mapped file:line · static-asset noise suppressed at default level. Compact startup banner with Local + Network URLs.',
    tag: 'new',
  },
  {
    title: 'Strict-CSP by default',
    body: 'No inline scripts, no inline styles (style:* directives use setProperty). Content-Security-Policy ships sane defaults; CSRF, same-origin, body-limit, prototype-pollution guards all on.',
  },
  {
    title: 'Motion as state',
    body: '@place-ts/reactivity/motion — animate() returns a Derived<number>. Springs, tweens, sequences. SSR resolves to rest. No <motion.div> factory, no two-runtime split, no 34KB floor.',
  },
  {
    title: 'One CLI, zero config',
    body: 'Bun.serve + Bun.build out of the box. Tailwind v4 inline. Auto port-walk on EADDRINUSE. Content-hashed prod bundles. Source-map-aware dev overlay.',
    tag: 'bun',
  },
]

interface System {
  readonly name: string
  readonly summary: string
}

const SYSTEMS: readonly System[] = [
  {
    name: 'reactivity',
    summary: 'state · watch · batch · resource · history · motion (spring · tween · sequence)',
  },
  {
    name: 'component',
    summary:
      'page · layout · app · island · Tabs · Show · suspense · Form · virtualList · useTheme · setTheme · adapters',
  },
  {
    name: 'capability',
    summary: 'defineCapability · scoped install · per-runtime impls',
  },
  {
    name: 'routing',
    summary: 'pathRouter · hashRouter · memoryRouter · route · searchParams',
  },
  {
    name: 'data',
    summary: 'collection() — keyed CRUD over State<T[]> · trash/restore · cursor pagination',
  },
  {
    name: 'persistence',
    summary: 'persistedState · localStorage · IndexedDB · cross-tab · server sync',
  },
  {
    name: 'search',
    summary: 'searchable() · reactive substring + token match · rank()-based ordering',
  },
  {
    name: 'security',
    summary:
      'CSP-strict · auto-CSRF · same-origin · body-limit · criticalAction() · macaroons · audit log',
  },
  {
    name: 'design',
    summary:
      'Button · Field · Dialog · Sheet · Combobox · Toast · Tooltip · Menu · ThemeToggle · Prose · CodeBlock',
  },
]

export default page('/', {
  // Landing page wants its title verbatim — opt out of the layout's
  // `titleTemplate: '%s · place docs'` suffix.
  meta: { title: 'place — a TS-first web platform', titleAbsolute: true },
  view: () => (
    <div class="max-w-4xl">
      <section class="mb-20">
        <Badge intent="accent" class="mb-6 font-mono">
          <span class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          v0.12 · DX overhaul — templates, logs, theme system
        </Badge>
        <h1 class="text-5xl sm:text-6xl font-semibold tracking-tight text-fg mb-5 leading-[1.05]">
          One platform.
          <br />
          Nine systems.
          <br />
          {/* Animated gradient text. `animate-hero-shimmer` keyframe
              token + arbitrary background-position-size are wired in
              styles.ts. */}
          <span class="bg-clip-text text-transparent bg-[linear-gradient(110deg,var(--color-accent)_0%,oklch(0.78_0.16_30)_50%,var(--color-accent)_100%)] bg-[length:200%_100%] animate-hero-shimmer">
            Visible magic.
          </span>
        </h1>
        <p class="text-base sm:text-lg text-muted leading-relaxed mb-7 max-w-2xl">
          place is a TypeScript-first web platform built on Bun. Smaller surface than Next, fewer
          footguns than Remix, more honest than TanStack. Nine composable systems with explicit
          boundaries — reactivity, component, capability, routing, data, persistence, search,
          security, design.
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <Link to="/getting-started" class={button({ intent: 'primary', size: 'lg' })}>
            Get started
            <span aria-hidden="true">→</span>
          </Link>
          <Link to="/why" class={button({ intent: 'secondary', size: 'lg' })}>
            Why place
          </Link>
          <Link to="/concepts/reactivity" class={button({ intent: 'ghost', size: 'lg' })}>
            See the reactivity demo
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section class="mb-20">
        <div class="flex items-baseline justify-between mb-4">
          <h2 class={sectionLabel}>The shape</h2>
          <span class="text-[10px] font-mono text-muted">src/app.ts</span>
        </div>
        <noscript>
          <CodeBlock code={APP_SHAPE} filename="src/app.ts" />
        </noscript>
        <TypingCode code={APP_SHAPE} filename="src/app.ts" />
        <p class="text-sm text-muted mt-4 max-w-2xl">
          One config. One <code class={inlineCode}>.run()</code>. The framework handles
          server/client dispatch, port discovery, cap installation, and bundling. No{' '}
          <code class={inlineCode}>if (typeof window)</code> branch.
        </p>
      </section>

      <section class="mb-20">
        <h2 class={`${sectionLabel} mb-4`}>What you get</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <Card intent="flat" padding="md" interactive>
              <div class="flex items-baseline justify-between mb-2 gap-2">
                <h3 class="text-sm font-semibold text-fg m-0">{f.title}</h3>
                {f.tag ? <span class="text-[10px] font-mono text-accent">{f.tag}</span> : null}
              </div>
              <p class="text-xs text-muted leading-relaxed m-0">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section class="mb-20">
        <h2 class={`${sectionLabel} mb-4`}>Nine systems, named</h2>
        <div class="rounded-xl bg-card/30 border border-border/60 overflow-hidden">
          {SYSTEMS.map((s, i) => (
            <div
              class={`flex items-baseline gap-4 px-5 py-3 ${
                i < SYSTEMS.length - 1 ? 'border-b border-border/40' : ''
              }`}
            >
              <span class="text-sm font-mono text-accent w-28 flex-shrink-0">{s.name}</span>
              <span class="text-sm text-muted">{s.summary}</span>
            </div>
          ))}
        </div>
        <p class="text-sm text-muted mt-4 max-w-2xl">
          Each system has its own charter, its own ADRs, and its own{' '}
          <code>deliberately not doing</code> list. Use what helps. Drop what doesn't.
        </p>
      </section>

      <section class="mb-20 rounded-xl bg-gradient-to-br from-accent/10 via-card/30 to-transparent border border-accent/30 p-8">
        <h2 class="text-2xl font-semibold text-fg mb-3">Built on the platform itself.</h2>
        <p class="text-sm text-muted leading-relaxed mb-4 max-w-2xl">
          This docs site is a place app. The interactive reactivity demo on{' '}
          <Link to="/concepts/reactivity">the reactivity page</Link> uses the same{' '}
          <code class={inlineCode}>@place-ts/reactivity</code> primitives the framework ships. The
          Cmd+K search palette uses the same <code class={inlineCode}>globalKey</code> +{' '}
          <code class={inlineCode}>state</code> you'd use in your app. There's no privileged
          internal surface you can't reach.
        </p>
        <Link
          to="/examples"
          class="inline-flex items-center gap-2 text-sm font-medium text-accent no-underline hover:underline"
        >
          See more examples
          <span aria-hidden="true">→</span>
        </Link>
      </section>
    </div>
  ),
})

// hmr-test-mark

// hmr-test-mark

// hmr-test-mark
