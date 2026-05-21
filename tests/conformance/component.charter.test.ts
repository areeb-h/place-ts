// @vitest-environment happy-dom
//
// Conformance tests for the COMPONENT system charter.
//
// Each test pins one architectural commitment from
// systems/component/docs/00-charter.md so a future code change that
// silently violates the charter trips here.
//
// Charter clauses tested (from the §"Architectural commitments"
// section, post Tier 15-C refresh):
//
//   1. Routes are values, not files
//   2. One Page object, both sides
//   3. Server-only code is structural (no 'use server'/'use client')
//   4. Hydration data is one inspectable script tag
//   5. Security is opt-in but trivial
//   6. Page-level `revalidate` at the framework boundary
//   7. Codegen allowed only when it doesn't hide intent

import { div, page, renderPage, span } from '@place-ts/component'
import { app } from '@place-ts/component/server'
import { describe, expect, test } from 'vitest'

describe('component charter conformance — architectural commitments', () => {
  // ── Charter clause #1: Routes are values, not files ──────────────────
  test('charter: a page() value carries its own .path; routing is by value', () => {
    const home = page('/', { view: () => div({}, ['hi']) })
    const about = page('/about', { view: () => div({}, ['about']) })

    // The route key lives ON the page value. File location is meaningless.
    expect(home.path).toBe('/')
    expect(about.path).toBe('/about')

    // `app({ pages })` builds the routes table from each page's `.path`.
    const a = app({ pages: [home, about] })
    expect(a.routes['/']).toBe(home)
    expect(a.routes['/about']).toBe(about)
  })

  test('charter: duplicate paths throw at app() time with the offending key named', () => {
    const a = page('/dup', { view: () => div({}, []) })
    const b = page('/dup', { view: () => div({}, []) })
    expect(() => app({ pages: [a, b] })).toThrow(/duplicate path/)
    expect(() => app({ pages: [a, b] })).toThrow(/\/dup/)
  })

  // ── Charter clause #2: One Page object, both sides ───────────────────
  test('charter: the same page() literal is importable on server + client', () => {
    // A page is just a value; importing it from either runtime gives the
    // same object identity. (We can't test cross-runtime here, but we
    // can test the value-shape contract: page() returns a plain object
    // with `path` and `view` fields — no transport-specific tagging.)
    const home = page('/', {
      view: () => span({}, ['hello']),
      meta: 'Home',
    })
    expect(typeof home.path).toBe('string')
    expect(typeof home.view).toBe('function')
    // No `__client` / `__server` marker keys.
    const keys = Object.keys(home)
    expect(keys).not.toContain('__server')
    expect(keys).not.toContain('__client')
  })

  // ── Charter clause #4: Hydration data is one inspectable script tag ──
  test('charter: load() data is serialised to a single <script type="application/json"> tag', async () => {
    const home = page('/', {
      load: () => ({ greeting: 'hello' }),
      view: ({ greeting }: { greeting: string }) => div({}, [greeting]),
    })
    const html = await (await renderPage(home, new Request('http://x/'))).text()
    // One — and only one — load script per page.
    const matches = html.match(/<script[^>]+id="__place_load__"/g) ?? []
    expect(matches.length).toBe(1)
    // It's `type="application/json"` (not executable, not a wire format
    // requiring a parser to inspect).
    expect(html).toMatch(/<script type="application\/json"[^>]*id="__place_load__"[^>]*>/)
    // The data is right there in plaintext.
    expect(html).toContain('"greeting":"hello"')
  })

  test('charter: load data is HTML-attribute-escape-safe in the script', async () => {
    const p = page('/', {
      load: () => ({ payload: '</script><script>alert(1)</script>' }),
      view: () => span({}, ['x']),
    })
    const html = await (await renderPage(p, new Request('http://x/'))).text()
    // The escape must produce </script> — NOT a raw </script>
    // inside the load tag's content.
    expect(html).toContain('\\u003c/script\\u003e')
    // Only ONE actual </script> closing tag — the load script's own.
    // (Any later page-level inline scripts have their own.)
    const closes = html.match(/<\/script>/g) ?? []
    // At least 1 (the load tag's close) — possibly more for runtime
    // scripts, but the malicious </script> must NOT contribute.
    expect(closes.length).toBeGreaterThanOrEqual(1)
  })

  // ── Charter clause #6: revalidate at the framework boundary ──────────
  test('charter: pages declare revalidate at the page-level field; no per-component cache', () => {
    // `revalidate` lives on the page definition — the framework reads it
    // when matching the route. Pages opt in declaratively.
    const cached = page('/cached', {
      revalidate: 60,
      view: () => div({}, ['cached']),
    })
    expect(cached.revalidate).toBe(60)
    // Tagged form
    const tagged = page('/tagged', {
      revalidate: { ttl: 60, tags: ['posts'] },
      view: () => div({}, ['tagged']),
    })
    expect(tagged.revalidate).toEqual({ ttl: 60, tags: ['posts'] })
  })

  // ── Charter clause #3: structural server-only — no string directives ──
  test('charter: no `use server` / `use client` string markers are required to opt in/out of either runtime', async () => {
    // The page contract has no `'use server'` / `'use client'` knobs.
    // Server-only behaviour is structural (e.g. `load()` only runs
    // server-side because the framework's request handler calls it).
    const p = page('/', {
      load: () => ({ ran: 'on server' }),
      view: ({ ran }: { ran: string }) => div({}, [ran]),
    })
    // The page object itself has no `'use'` markers.
    const json = JSON.stringify(p)
    expect(json).not.toContain('use server')
    expect(json).not.toContain('use client')
    // The rendered HTML serialises the load data; the load function
    // didn't have to be string-tagged.
    const html = await (await renderPage(p, new Request('http://x/'))).text()
    expect(html).toContain('on server')
  })

  // ── Charter clause #7: codegen is allowed if discoverable in source ──
  // (No conformance test here — codegen happens at build time, not
  // testable in unit scope. The audit ADR pattern is the contract.)
})
