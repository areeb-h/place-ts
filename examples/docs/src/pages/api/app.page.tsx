// /api/app — app() reference. The single entry point that absorbs
// server/client dispatch, cap install, port reading, and bundling.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'
import { Callout } from '../../components/callout.tsx'

const SIG = `app(config: AppConfig).run()`

const FULL = `import { app } from '@place/component/server'
import { pathRouter, RouterCap } from '@place/routing'
import { rootLayout } from './layouts/root.layout'
import home from './pages/home.page'
import about from './pages/about.page'

export default app({
  name: '@my-org/site',
  pages: [home, about],
  layout: rootLayout,
  theme: tokens,
  tailwind: true,
  security: 'standard',
  viewTransitions: true,
  caps: [[RouterCap, pathRouter]],
}).run()`

const CAPS_PER_RUNTIME = `caps: [
  [RouterCap, pathRouter],                   // function form (client only)
  [NoteStoreCap, {                            // object form (per-runtime)
    server: () => inMemoryStore(seed),
    client: () => localStorageStore(),
  }],
]`

const BUILD = `// app().build({ outDir }) — pre-render to a static site. Runs the
// full server setup (Tailwind compile, island discovery + bundling,
// theme resolution) then, instead of starting a server, writes the
// complete static site to outDir:
//
//   <outDir>/index.html, <outDir>/about/index.html, …
//   <outDir>/islands/<name>-<hash>.js   (+ shared chunks)
//   <outDir>/_headers                   (Cloudflare strict CSP)
//
// The exported site is fully interactive — island bundles ship and
// SPA-nav works. Server-side only; for CDN static hosts.

import { app } from '@place/component/server'
import { pages } from './pages'

await app({ pages, theme: tokens }).build({ outDir: 'dist' })`

const DISCOVER = `// discoverPages(dir) — async helper that imports every *.page.tsx
// (plus subdir index.ts barrels) under a directory and returns a
// flat Page[]. It does NOT derive routes from file paths — each
// page's page('/path', def) declaration stays the source of truth.
import { app, discoverPages } from '@place/component/server'

export default app({
  pages: await discoverPages('./src/pages'),
}).run()`

const ROUTES = `// routes(prefix, pages, opts?) — a pure value transform: prefixes
// every page's path and (optionally) applies a shared layout. Used
// to group feature folders. No registration, no side effects.
import { routes } from '@place/component/server'

// admin/index.ts
export default routes('/admin', [dashboard, users, settings], {
  layout: adminLayout,
})

// app.ts — compose the groups into one app:
app({ pages: [home, ...adminRoutes, ...postRoutes] }).run()`

export default page('/app', {
  // No `meta:` — auto-title from `<h1><code>app()</code></h1>`.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>
        <code>app()</code>
      </h1>
      <p>
        Declares the application. <code>app()</code> runs only on the server — <code>.run()</code>{' '}
        installs server-side capabilities and starts <code>Bun.serve</code>. In the islands
        hydration model each interactive island ships and mounts its own client bundle, so there is
        no client-side <code>app</code> entry.
      </p>

      <h2 id="signature">Signature</h2>
      <CodeBlock code={SIG} />

      <h2 id="full-example">Full example</h2>
      <CodeBlock code={FULL} filename="src/app.ts" />

      <h2 id="config">Options</h2>

      <h3 id="pages">
        <code>pages</code> (required)
      </h3>
      <p>
        The explicit list of page values. Order is irrelevant for routing; the framework matches by
        path. Duplicate paths throw at startup.
      </p>

      <h3 id="layout">
        <code>layout</code>
      </h3>
      <p>
        Default layout chain wrapping every page that doesn't override it. Single layout or array;
        chains compose outside-in.
      </p>

      <h3 id="caps">
        <code>caps</code>
      </h3>
      <p>Per-app capability provisions. Two shapes:</p>
      <CodeBlock code={CAPS_PER_RUNTIME} />
      <p>
        The function form runs only on the runtime where the cap is used (typically client for{' '}
        <code>clientOnly</code> caps). The object form lets you ship distinct server and client
        impls without conditionals.
      </p>

      <h3 id="theme">
        <code>theme</code>
      </h3>
      <p>
        A <code>themeTokens()</code> result. The active theme class auto-prefixes the{' '}
        <code>{`<html>`}</code> element; the framework reads the theme cookie per-request to avoid
        FOUC.
      </p>

      <h3 id="tailwind">
        <code>tailwind</code>
      </h3>
      <p>
        <code>true</code> opts into Tailwind v4 inline compilation; CSS is compiled once at startup
        and inlined into every page (hash-stable for CSP). Or pass a config object for content globs
        and a custom base.
      </p>

      <h3 id="security">
        <code>security</code>
      </h3>
      <p>
        Per-route security headers. <code>'standard'</code> ships a strict CSP (nonce-bound scripts,
        hashed inline styles, frame-ancestors none), HSTS, X-Content-Type-Options, and same-origin
        defaults. Or pass an object for fine control.
      </p>

      <h3 id="view-transitions">
        <code>viewTransitions</code>
      </h3>
      <p>
        <code>true</code> appends the <code>@view-transition {`{ navigation: auto }`}</code> rule
        gated behind <code>prefers-reduced-motion: no-preference</code>. Browsers without
        cross-document VT navigate normally.
      </p>

      <h3 id="port">
        <code>port</code>
      </h3>
      <p>
        Explicit port, or omit to read <code>process.env.PORT</code>, or fall back to 5174. The
        client-side <code>.run()</code> ignores this.
      </p>

      <h2 id="run">
        <code>.run()</code>
      </h2>
      <p>
        The app entry point. Installs server-side capabilities (the <code>server</code> factories
        from <code>caps</code>), then starts <code>Bun.serve</code> and returns the{' '}
        <code>Bun.Server</code> promise. <code>.serve()</code> is the same call, one level lower —
        both run server-side only and throw if invoked in a browser.
      </p>

      <Callout kind="tip" title="The server entry — islands are the client entries">
        Your <code>app.ts</code> runs only on the server. There is no client-side <code>app</code>{' '}
        runtime: each interactive island ships and mounts its own bundle, so a page with no island
        ships zero framework JavaScript. Client-side capability factories (from{' '}
        <code>router</code> / <code>caps</code>) are forwarded to the island bundler, which wires
        them into the island bundles automatically.
      </Callout>

      <h2 id="build">
        <code>.build({'{ outDir }'})</code> — static export
      </h2>
      <p>
        Instead of <code>.run()</code>, call <code>.build({'{ outDir }'})</code> to pre-render the
        whole app to a static site. It runs the full server setup — Tailwind compile, island
        discovery and bundling, theme resolution — then writes <code>index.html</code> per route,
        the island chunks, and a <code>_headers</code> file (Cloudflare strict CSP) to{' '}
        <code>outDir</code>. The exported site is fully interactive; it's the right shape for CDN
        static hosts. Server-side only.
      </p>
      <CodeBlock code={BUILD} />

      <h2 id="discover-pages">
        <code>discoverPages(dir)</code>
      </h2>
      <p>
        An async helper that imports every <code>*.page.tsx</code> (and subdirectory{' '}
        <code>index.ts</code> barrel) under a directory and returns a flat <code>Page[]</code> —
        feed it straight into <code>pages</code> with top-level await. It does <em>not</em> derive
        routes from file paths: each page's <code>page('/path', def)</code> declaration stays the
        single source of truth for its route.
      </p>
      <CodeBlock code={DISCOVER} />

      <h2 id="routes">
        <code>routes(prefix, pages, opts?)</code>
      </h2>
      <p>
        A pure value transform — prefixes every page's <code>path</code> and optionally applies a
        shared <code>layout</code> (pages with their own layout keep theirs). No registration, no
        side effects; composes recursively. Use it to group feature folders, then spread the
        groups into <code>app()</code>.
      </p>
      <CodeBlock code={ROUTES} />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/page">page()</Link>
        </li>
        <li>
          <Link to="/api/layout">layout()</Link>
        </li>
        <li>
          <Link to="/api/define-capability">defineCapability()</Link>
        </li>
      </ul>
    </article>
  ),
})
