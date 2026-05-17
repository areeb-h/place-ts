// /roadmap — visual timeline of done / in-progress / planned milestones.
// Renders the timeline as a vertical list with a colored left-edge to
// signal status; no library, no animation, just clean structure.
//
// All styling lives in Tailwind utility class strings via `recipe()`.
// The `animate-roadmap-pulse` token (for the active "now" milestone)
// is registered in styles.ts since custom keyframes need Tailwind v4
// @theme + @keyframes — handled there.

import { page, recipe } from '@place/component'

type Status = 'done' | 'now' | 'next' | 'later'

interface Milestone {
  readonly version: string
  readonly title: string
  readonly status: Status
  readonly highlights: readonly string[]
}

const ROADMAP: readonly Milestone[] = [
  {
    version: 'v0.1',
    title: 'Reactivity core',
    status: 'done',
    highlights: [
      'state(), watch(), batch(), untrack(), state.peek()',
      'Two-color graph propagation',
      'Property tests for synchronous core, derivable state',
    ],
  },
  {
    version: 'v0.2',
    title: 'Capabilities + routing',
    status: 'done',
    highlights: [
      'defineCapability() with typed slots + per-runtime install',
      'pathRouter + memoryRouter + RouterCap',
      'urlState() for URL-bound state',
    ],
  },
  {
    version: 'v0.4',
    title: 'Pages as values',
    status: 'done',
    highlights: [
      'page() / layout() / app()',
      'Co-located actions via on:',
      '<Link> with typed routes',
    ],
  },
  {
    version: 'v0.6',
    title: 'SSR + hydration',
    status: 'done',
    highlights: [
      'renderToStream + suspense() with comment-marker swap',
      'Auto-CSRF, same-origin, body-limit security pipeline',
      'Theme tokens with cookie-based selection (no FOUC)',
    ],
  },
  {
    version: 'v0.7',
    title: 'Production polish',
    status: 'done',
    highlights: [
      'virtualList() — windowed render (ADR 0008)',
      'View Transitions opt-in',
      'Tailwind v4 inline with CSP-strict hashing',
      'Per-runtime cap factories',
      'Auto ClientOnly via ClientOnlyAbort',
    ],
  },
  {
    version: 'v0.8',
    title: 'Docs site + commonplace polish',
    status: 'done',
    highlights: [
      'this docs site — comprehensive concepts + API + recipes',
      'Cmd+K search, interactive reactivity demo',
      'commonplace UX rethink',
      'CSP-strict inline-style hashing for all layout/page CSS',
    ],
  },
  {
    version: 'v0.9',
    title: 'Static export + first public deploy',
    status: 'now',
    highlights: [
      'app().build() — islands-aware static export (ADR 0051)',
      'strict static CSP via a generated Cloudflare _headers file',
      'live on Cloudflare Pages — 100/100/100/100 Lighthouse',
      'hover/focus prefetch — instant SPA navigation, auth-safe',
      'framework-owned theme persistence (themeEarlyScript, no flash)',
      'first public git repo with a layered commit history',
    ],
  },
  {
    version: 'v0.10',
    title: 'Migrations + adapters',
    status: 'next',
    highlights: [
      'Migration guides from Next, Remix, TanStack Start',
      'Node adapter (without Bun)',
      'Cloudflare Workers adapter',
      'create-app templates: blog, dashboard, e-commerce',
    ],
  },
  {
    version: 'v1.0',
    title: 'Stability + benchmarks',
    status: 'later',
    highlights: [
      'API freeze + semver',
      'Published benchmark suite vs Next/Remix/TanStack',
      'Recipe library hits 50+ patterns',
      'First-class examples gallery with live previews',
    ],
  },
]

const STATUS_META: Record<Status, { label: string }> = {
  done: { label: 'shipped' },
  now: { label: 'in progress' },
  next: { label: 'next' },
  later: { label: 'planned' },
}

const marker = recipe({
  base: 'absolute left-0.5 top-1.5 w-3 h-3 rounded-full bg-bg border-2',
  variants: {
    status: {
      done: 'border-[oklch(0.78_0.14_145)] bg-[oklch(0.78_0.14_145)]',
      now: 'border-accent bg-accent animate-roadmap-pulse',
      next: 'border-muted',
      later: 'border-border/80',
    },
  },
})

const statusPill = recipe({
  base: 'font-mono font-semibold text-[10px] leading-none uppercase tracking-[0.08em] px-2 py-0.5 rounded-xl',
  variants: {
    status: {
      done: 'text-[oklch(0.78_0.14_145)] bg-[color-mix(in_oklab,oklch(0.78_0.14_145)_14%,transparent)]',
      now: 'text-accent bg-accent/15',
      next: 'text-muted bg-muted/12',
      later: 'text-muted bg-transparent border border-border/80',
    },
  },
})

export default page('/roadmap', {
  // No `meta:` — auto-title from `<h1>Roadmap</h1>`.
  view: () => (
    <article class="max-w-3xl">
      <h1 class="text-3xl font-semibold text-fg mb-2">Roadmap</h1>
      <p class="text-muted text-lg mb-8">
        Versions are cuts of cohesive work, not strict semver until v1.0. Every entry that's shipped
        has a passing CI gate; planned entries are intentions, not promises.
      </p>
      {/* The vertical timeline rail is a ::before pseudo on the list,
          drawn from the second item's marker top to the last item's
          marker bottom — gives a continuous line behind every marker. */}
      <ol class="list-none p-0 m-0 relative before:content-[''] before:absolute before:left-[7px] before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-border/70">
        {ROADMAP.map((m) => (
          <li class="relative pl-8 pb-7">
            <div class={marker({ status: m.status })} aria-hidden="true" />
            <div>
              <div class="flex items-baseline gap-3 mb-2 flex-wrap">
                <span class="font-mono font-semibold text-xs leading-none text-accent px-1.5 py-0.5 rounded bg-accent/12">
                  {m.version}
                </span>
                <span class="font-semibold text-fg">{m.title}</span>
                <span class={statusPill({ status: m.status })}>{STATUS_META[m.status].label}</span>
              </div>
              <ul class="list-disc pl-5 m-0 text-[color-mix(in_oklab,var(--color-fg)_85%,var(--color-muted))] text-[0.875rem]">
                {m.highlights.map((h) => (
                  <li class="my-0.5">{h}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </article>
  ),
})
