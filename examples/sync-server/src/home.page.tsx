// Demo page object — imported by both server.tsx and client.tsx, so
// it stays PURE: only fields that make sense on both sides (url, load,
// view, meta). Server-only adornments (styles, headers) live in
// server.tsx, where they're spread onto this page when registering it
// with the router. The split is deliberate:
//
//   - This file is bundled into BOTH server and client. Anything
//     imported here ships to the browser. The `tailwind()` helper
//     pulls in Node-only deps (lightningcss, native .node files) and
//     would explode the client bundle — keep it out of here.
//
//   - Server-side enhancements like compiled CSS, response headers,
//     CSP policies, etc. apply only to the SSR'd document and the
//     network response. The client never sees them as data; it only
//     observes their effects (CSS already in the DOM, headers already
//     interpreted by the browser).
//
// Mental model: `page()` defines what BOTH sides need. The serve()
// route table is where you say "and on top of that, when serving via
// HTTP, also do X". This is the explicit alternative to Remix's
// `.server.ts` magic-filename suffix.

import { page } from '@place/component'
import { Page } from './Page.tsx'

export const homePage = page({
  url: (u) => ({ name: u.searchParams.get('name') ?? 'visitor' }),
  load: () => ({ now: new Date().toISOString() }),
  view: ({ name, now }) => <Page name={name} now={now} />,

  // Typed metadata: every key maps to one specific HTML element. No
  // inferred magic, no `metadataBase` URL-resolving conventions. Can
  // be a function `(props) => Meta` for dynamic titles per page.
  meta: ({ name }) => ({
    title: `hello, ${name} — place SSR demo`,
    description: 'SSR + client hydration end-to-end via @place/component.',
    og: {
      title: `hello, ${name}`,
      description: 'A place SSR + hydration demo.',
      type: 'website',
    },
    twitter: { card: 'summary' },
    themeColor: '#fafafa',
    robots: 'noindex, nofollow',
  }),
})
