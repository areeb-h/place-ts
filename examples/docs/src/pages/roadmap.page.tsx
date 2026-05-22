// /roadmap — visual timeline of done / in-progress / planned milestones.
// Renders the timeline as a vertical list with a colored left-edge to
// signal status; no library, no animation, just clean structure.
//
// All styling lives in Tailwind utility class strings via `recipe()`.
// The `animate-roadmap-pulse` token (for the active "now" milestone)
// is registered in styles.ts since custom keyframes need Tailwind v4
// @theme + @keyframes — handled there.

import { page, recipe } from '@place-ts/component'

type Status = 'done' | 'now' | 'next' | 'later'

interface Milestone {
  readonly version: string
  readonly title: string
  readonly status: Status
  readonly highlights: readonly string[]
}

// Versions are cuts of cohesive work, not strict semver (see the note
// in the page body). Each entry's highlights are kept honest against
// what actually shipped — the journal + audits hold the detail.
const ROADMAP: readonly Milestone[] = [
  {
    version: 'v0.1',
    title: 'Reactivity core',
    status: 'done',
    highlights: [
      'state / derived / watch / batch / untrack / resource / history',
      'two-color graph propagation, synchronous core',
      'fast-check property tests for the synchronous core',
    ],
  },
  {
    version: 'v0.2',
    title: 'Component system',
    status: 'done',
    highlights: [
      'JSX via the TS automatic runtime, keyed lists, Fragment',
      'mount / el / onCleanup / errorBoundary / withCapability',
      'cls() + recipe() variant helper',
    ],
  },
  {
    version: 'v0.3',
    title: 'SSR + server primitives',
    status: 'done',
    highlights: [
      'page() / serve() / boot(), renderToString + hydrate',
      'typed meta + styles, first-class Tailwind v4',
      "security: 'standard' — per-request CSP nonce, CSRF, body limits",
    ],
  },
  {
    version: 'v0.4',
    title: 'Production SSR',
    status: 'done',
    highlights: [
      'per-request capability scopes (AsyncLocalStorage)',
      'action() typed RPC — JSON + FormData, ISR via revalidate',
      'streaming SSR + suspense()',
    ],
  },
  {
    version: 'v0.5',
    title: 'Deployment + DX',
    status: 'done',
    highlights: [
      'Node adapter, buildStatic SSG, font helper, image optimizer',
      'dev error overlay with source-mapped frames',
      'startup banner, content-hashed production bundles',
    ],
  },
  {
    version: 'v0.6',
    title: 'The "smaller app" arc',
    status: 'done',
    highlights: [
      'page(path, def) / app([pages]) / routes(prefix)',
      'co-located on: actions with auto-CSRF, search: URL state',
      'virtualList(); commonplace rebuilt as the flagship app',
    ],
  },
  {
    version: 'v0.7',
    title: 'Motion + design library',
    status: 'done',
    highlights: [
      '@place-ts/reactivity/motion — animate / tween / sequence / curve / motion / flip / colorMix',
      '@place-ts/design — 14 native-first primitives (Dialog, Sheet, Combobox, Menu, …)',
      'recipe() variants + themeTokens()',
    ],
  },
  {
    version: 'v0.8',
    title: 'Islands architecture',
    status: 'done',
    highlights: [
      'islands as the only hydration model — content pages ship 0 KB JS',
      'per-route bundle splitting, SRI-pinned island bundles',
      'per-island HMR, the effect-typed view classifier',
    ],
  },
  {
    version: 'v0.9',
    title: 'Design-system rewrite + foundation',
    status: 'done',
    highlights: [
      'CSS Anchor Positioning popovers, light-dark() theming',
      'typed class + classNames customization contract',
      'viewport primitive, typography tokens, charter conformance tests',
    ],
  },
  {
    version: 'v0.10',
    title: 'Docs site',
    status: 'done',
    highlights: [
      'this docs site — concepts + full API reference + recipes',
      'Cmd+K search, interactive reactivity demo',
      'every page dogfoods the framework',
    ],
  },
  {
    version: 'v0.11',
    title: 'Static export + first public deploy',
    status: 'done',
    highlights: [
      'app().build() — islands-aware static export (ADR 0051)',
      'live on Cloudflare Pages with auto-emitted _headers (strict CSP)',
      'hover-prefetch SPA navigation — instant, auth-safe',
      'framework-owned theme persistence (no flash), strict static CSP',
      'first public git repository with a layered commit history',
    ],
  },
  {
    version: 'v0.12',
    title: 'DX overhaul',
    status: 'done',
    highlights: [
      'scaffolder: 3 templates (minimal · content · app) + 5 composable feature packs (theme · tests · ci · design · persistence), interactive picker, --with / --without flags',
      'create-app architecture: base + overlay layers, unified-diff patches between layers, JSON-merged package.json across stacks',
      'server logs: PLACE_LOG_LEVEL · log.scope(...) · terminal error frames (source-mapped) · compact 3-section startup banner · build banner for static export',
      'theme DX: useTheme() headless hook · setTheme(name) no-tokens overload · <ThemeToggle/> in @place-ts/design (segmented + cycle variants) · SSR-blip eliminated by null-class on absent/system cookie',
      'production deploy adapters: createFetchHandler · Cloudflare Workers · Vercel Build Output · Deno Deploy',
      'data: trash/restore + cursor pagination · search: rank-based ordering · image optimization via sharpBackend()',
      'EADDRINUSE port-walk · bunx create-app . into current dir · template-version-pin CI guard across every layer',
    ],
  },
  {
    version: 'v0.13',
    title: 'Migrations + benchmarks',
    status: 'next',
    highlights: [
      'migration guides from Next, Remix, TanStack Start',
      'published benchmark suite vs Next / Remix / TanStack — honest numbers, no marketing math',
      'examples gallery with live previews',
    ],
  },
  {
    version: 'v1.0',
    title: 'Stability + freeze',
    status: 'later',
    highlights: [
      'API freeze + semver commitment',
      'L1 thaw runtime + effect-inference (ADR 0027 — research project)',
      'Phase 4-6 reactivity (deep work, separate ADR each)',
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
