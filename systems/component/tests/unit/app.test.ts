// @vitest-environment node
//
// Round 5 (cuts 5.2, 5.6) — `app(pages)` factory + `routes(prefix, pages)`
// grouping helper. Pure-value transforms; no Bun runtime needed.

import { describe, expect, test } from 'vitest'
import { layout, page, span } from '../../src/index.ts'
import { app, routes } from '../../src/server.ts'

describe('app(pages, opts) — Round 5 entry factory', () => {
  test('derives a routes object from pages with paths', () => {
    const home = page('/', { view: () => span({}, ['home']) })
    const post = page('/posts/:id', { view: () => span({}, ['post']) })
    const a = app([home, post])
    expect(Object.keys(a.routes).sort()).toEqual(['/', '/posts/:id'])
    expect(a.routes['/']).toBe(home)
    expect(a.routes['/posts/:id']).toBe(post)
  })

  test('throws on a page declared with the legacy single-arg form (no path)', () => {
    const pathless = page({ view: () => span({}, ['x']) })
    expect(() => app([pathless])).toThrow(/every page must have a path/)
  })

  test('throws on duplicate paths', () => {
    const a = page('/x', { view: () => span({}, ['a']) })
    const b = page('/x', { view: () => span({}, ['b']) })
    expect(() => app([a, b])).toThrow(/duplicate path '\/x'/)
  })

  test('refuses non-array first argument', () => {
    // @ts-expect-error — defensive runtime check for misuse
    expect(() => app('not an array')).toThrow(/must be an array/)
  })

  test('.serve() in non-browser env passes through to serve()', async () => {
    // We don't actually start a server (port-bind side effect); we just
    // confirm calling .serve() doesn't throw the browser guard. The
    // method is async — checking startup-validation throws via the
    // existing `serve()` path is sufficient.
    const home = page('/', { view: () => span({}, ['home']) })
    // `clientPath` '/' collides with the route '/' — serve() validates
    // this at startup and rejects. Confirms `.serve()` reached the
    // serve() flow rather than throwing the browser guard.
    const a = app([home], { clientPath: '/' })
    await expect(a.serve()).rejects.toThrow(/collides with clientPath/)
  })
})

describe('routes(prefix, pages, opts) — feature-folder grouping', () => {
  test('prefixes every page path with the given prefix', () => {
    const list = page('/', { view: () => span({}, ['list']) })
    const detail = page('/:id', { view: () => span({}, ['detail']) })
    const grouped = routes('/posts', [list, detail])
    // Index page (path: `/`) lands at the prefix itself; non-index
    // pages get prefixed normally.
    expect(grouped.map((p) => p.path)).toEqual(['/posts', '/posts/:id'])
  })

  test('preserves all non-path fields from the original page', () => {
    const original = page('/x', {
      view: () => span({}, ['x']),
      meta: { title: 'Hello' },
    })
    const [moved] = routes('/admin', [original])
    expect(moved?.path).toBe('/admin/x')
    expect((moved?.meta as { title?: string })?.title).toBe('Hello')
  })

  test('inherits layout from opts when page has no explicit layout', () => {
    const lay = layout({ view: ({ children }) => span({}, [children]) })
    const p = page('/x', { view: () => span({}, ['x']) })
    const [withLayout] = routes('/admin', [p], { layout: lay })
    expect(withLayout?.layout).toBe(lay)
  })

  test("preserves a page's explicit layout over the group's layout", () => {
    const groupLayout = layout({ view: ({ children }) => span({}, [children]) })
    const pageLayout = layout({ view: ({ children }) => span({}, [children]) })
    const p = page('/x', { view: () => span({}, ['x']), layout: pageLayout })
    const [out] = routes('/admin', [p], { layout: groupLayout })
    expect(out?.layout).toBe(pageLayout)
  })

  test('handles trailing slash in prefix (normalizes to no double slash)', () => {
    const p = page('/users', { view: () => span({}, ['x']) })
    const [out] = routes('/admin/', [p])
    expect(out?.path).toBe('/admin/users')
  })

  test('handles root prefix (`/`) — pages keep their own path unchanged', () => {
    const p = page('/users', { view: () => span({}, ['x']) })
    const [out] = routes('/', [p])
    expect(out?.path).toBe('/users')
  })

  test('rejects prefix not starting with `/`', () => {
    const p = page('/x', { view: () => span({}, ['x']) })
    expect(() => routes('admin', [p])).toThrow(/must start with '\/'/)
  })

  test('throws on pages without paths', () => {
    const pathless = page({ view: () => span({}, ['x']) })
    expect(() => routes('/admin', [pathless])).toThrow(/every page must have a path/)
  })

  test('composes recursively (routes inside routes)', () => {
    const list = page('/', { view: () => span({}, ['list']) })
    const detail = page('/:id', { view: () => span({}, ['detail']) })
    const inner = routes('/users', [list, detail])
    const outer = routes('/admin', inner)
    // The `/` (index) of the `/users` group lands at `/users` (no
    // trailing slash) — directory-index semantics. After the outer
    // `/admin` wrap, that becomes `/admin/users`.
    expect(outer.map((p) => p.path)).toEqual(['/admin/users', '/admin/users/:id'])
  })

  test('index page (path: `/`) in a non-root group resolves to the prefix itself', () => {
    const indexPage = page('/', { view: () => span({}, ['index']) })
    const other = page('/other', { view: () => span({}, ['other']) })
    const grouped = routes('/section', [indexPage, other])
    expect(grouped.map((p) => p.path)).toEqual(['/section', '/section/other'])
  })

  test('composes with app() — the derived routes object reflects the prefix', () => {
    const dashboard = page('/dashboard', { view: () => span({}, ['d']) })
    const users = page('/users', { view: () => span({}, ['u']) })
    const adminRoutes = routes('/admin', [dashboard, users])
    const home = page('/', { view: () => span({}, ['h']) })
    const a = app([home, ...adminRoutes])
    expect(Object.keys(a.routes).sort()).toEqual(['/', '/admin/dashboard', '/admin/users'])
  })
})
