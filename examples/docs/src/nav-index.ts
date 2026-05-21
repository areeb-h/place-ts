// Single source of truth for the docs nav. The sidebar reads it for
// the section tree; the search palette reads the flattened list with
// keyword hints for fuzzy match. Keep entries terse — the search
// matches against `label`, `keywords`, and the trailing path segment.
//
// **Organization principle** (post-2026-05-17 restructure):
//   1. Start — orientation, install, comparison, examples
//   2. Learn — concepts (mental model) + recipes (how-to patterns)
//   3. Reference — grouped by purpose:
//        - API — the core framework spine (app/page/layout/action/
//          state/caps/components/motion)
//        - Packages — the on-top systems & libraries: @place-ts/design,
//          @place-ts/security, @place-ts/persistence, @place-ts/data,
//          @place-ts/search
//   4. Explore — roadmap

export interface NavLink {
  readonly to: string
  readonly label: string
  readonly keywords?: readonly string[]
}

export interface NavSection {
  readonly title: string
  readonly links: readonly NavLink[]
}

export const NAV: readonly NavSection[] = [
  {
    title: 'Start',
    links: [
      { to: '/', label: 'Introduction', keywords: ['overview', 'home', 'place'] },
      {
        to: '/getting-started',
        label: 'Getting started',
        keywords: ['install', 'setup', 'scaffold', 'first app', 'tutorial'],
      },
      {
        to: '/why',
        label: 'Why place',
        keywords: ['comparison', 'next', 'remix', 'tanstack', 'vs', 'differences'],
      },
      { to: '/examples', label: 'Examples', keywords: ['demo', 'gallery', 'app'] },
    ],
  },
  {
    title: 'Concepts',
    links: [
      {
        to: '/concepts/reactivity',
        label: 'Reactivity',
        keywords: ['state', 'signals', 'watch', 'derived', 'two-color', 'tc39'],
      },
      {
        to: '/concepts/capabilities',
        label: 'Capabilities',
        keywords: ['context', 'provide', 'inject', 'slot', 'cap', 'di'],
      },
      {
        to: '/concepts/routes-as-values',
        label: 'Routes as values',
        keywords: ['router', 'file-system', 'codegen', 'page'],
      },
      {
        to: '/concepts/ssr',
        label: 'SSR & islands hydration',
        keywords: [
          'ssr',
          'hydration',
          'islands',
          'island',
          'server-side',
          'streaming',
          'suspense',
          'wire-format',
          'data-view',
          'classifier',
        ],
      },
      {
        to: '/concepts/security',
        label: 'Security',
        keywords: ['csp', 'csrf', 'same-origin', 'body-limit', 'prototype-pollution', 'security'],
      },
    ],
  },
  {
    title: 'Recipes',
    links: [
      { to: '/recipes', label: 'Index', keywords: ['how-to', 'recipes', 'patterns'] },
      {
        to: '/recipes/forms',
        label: 'Forms & actions',
        keywords: [
          'submit',
          'mutation',
          'csrf',
          'validation',
          'fromStandard',
          'zod',
          'valibot',
          'field-errors',
          'standard-schema',
        ],
      },
      {
        to: '/recipes/data-fetching',
        label: 'Data fetching',
        keywords: ['load', 'fetch', 'cache', 'isr', 'swr'],
      },
      {
        to: '/recipes/auth',
        label: 'Authentication & RBAC',
        keywords: [
          'login',
          'session',
          'cookie',
          'jwt',
          'rbac',
          'can',
          'permissions',
          'authorization',
          'gate',
          'cerbos',
          'permify',
        ],
      },
      {
        to: '/recipes/streaming',
        label: 'Streaming SSR',
        keywords: ['suspense', 'stream', 'chunk', 'progressive'],
      },
      {
        to: '/recipes/theming',
        label: 'Theming & dark mode',
        keywords: ['theme', 'dark', 'light', 'tokens', 'colors', 'oklch'],
      },
    ],
  },
  {
    title: 'API',
    links: [
      {
        to: '/api/app',
        label: 'app()',
        keywords: ['entry', 'serve', 'boot', 'run', 'build', 'discoverPages', 'routes', 'static'],
      },
      { to: '/api/page', label: 'page()', keywords: ['route', 'view', 'meta', 'load'] },
      {
        to: '/api/layout',
        label: 'layout()',
        keywords: ['wrap', 'chain', 'shell', 'frame'],
      },
      {
        to: '/api/action',
        label: 'action()',
        keywords: [
          'rpc',
          'mutation',
          'server',
          'typed',
          'csrf',
          'submit',
          'shape',
          'fromStandard',
          'standard-schema',
          'zod',
          'valibot',
          'arktype',
          'validation',
        ],
      },
      {
        to: '/api/critical-action',
        label: 'criticalAction()',
        keywords: [
          'critical',
          'high-assurance',
          'envelope',
          'hmac',
          'macaroon',
          'perm',
          'requires',
          'replay',
          'nonce',
          'audit',
          'tamper-evident',
          'tamper',
          'capability',
          'capabilities',
          'rbac',
          'authorization',
          'authz',
          'payment',
          'security',
          'provisionActionKey',
          'provisionMacaroon',
          'installActionKey',
          'installMacaroon',
        ],
      },
      {
        to: '/api/state',
        label: 'state · watch · derived',
        keywords: ['reactive', 'signal', 'effect', 'batch'],
      },
      {
        to: '/api/define-capability',
        label: 'defineCapability()',
        keywords: ['cap', 'context', 'install', 'use'],
      },
      {
        to: '/api/components',
        label: 'Components: view / Show / Suspense / Form',
        keywords: [
          'view',
          'island',
          'level',
          'static',
          'thaw',
          'island+stream',
          'classifier',
          'boundary',
          'streaming',
          'hydrate',
          'fallback',
          'show',
          'conditional',
          'form',
          'keyed',
          'virtual',
        ],
      },
      {
        to: '/api/motion',
        label: 'motion',
        keywords: ['animate', 'spring', 'tween', 'sequence', 'curve', 'animation'],
      },
    ],
  },
  {
    title: 'Packages',
    links: [
      {
        to: '/api/design',
        label: '@place-ts/design',
        keywords: [
          'button',
          'field',
          'input',
          'textarea',
          'dialog',
          'sheet',
          'drawer',
          'toast',
          'tooltip',
          'menu',
          'combobox',
          'typeahead',
          'select',
          'avatar',
          'badge',
          'card',
          'copy',
          'codeblock',
          'components',
          'design',
        ],
      },
      {
        to: '/api/security',
        label: '@place-ts/security',
        keywords: [
          'session',
          'sessioncap',
          'requireSession',
          'can',
          'rbac',
          'permissions',
          'csrf',
          'signedToken',
          'rateLimit',
          'cookies',
          'csp',
          'fromStandard',
        ],
      },
      {
        to: '/api/persistence',
        label: '@place-ts/persistence',
        keywords: [
          'persistedState',
          'localStorage',
          'indexeddb',
          'cross-tab',
          'crosstab',
          'broadcastchannel',
          'sync',
          'adapter',
          'storage',
          'memory',
          'server',
        ],
      },
      {
        to: '/api/data',
        label: '@place-ts/data',
        keywords: [
          'collection',
          'crud',
          'keyed',
          'entity',
          'store',
          'array',
          'add',
          'update',
          'remove',
        ],
      },
      {
        to: '/api/search',
        label: '@place-ts/search',
        keywords: [
          'searchable',
          'search',
          'filter',
          'query',
          'substring',
          'token',
          'fulltext',
          'find',
        ],
      },
    ],
  },
  {
    title: 'Explore',
    links: [{ to: '/roadmap', label: 'Roadmap', keywords: ['plan', 'future', 'todo'] }],
  },
]

export interface FlatNavEntry extends NavLink {
  readonly section: string
}

export const FLAT_NAV: readonly FlatNavEntry[] = NAV.flatMap((section) =>
  section.links.map((l) => ({ ...l, section: section.title })),
)
