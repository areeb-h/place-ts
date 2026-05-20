// @vitest-environment happy-dom
//
// Conformance tests for the ROUTING system charter.
//
// One test per architectural commitment in
// systems/routing/docs/00-charter.md.
//
// Commitments tested:
//   1. Routes are values, not file paths
//   2. Params are typed from the path string (callable Route value)
//   3. One router cap per page lifecycle
//   4. The URL is reactive state
//   5. SSR is read-only

import { div, page } from '@place/component'
import { routes } from '@place/component/server'
import { memoryRouter, parsePath, route, serverRouter } from '@place/routing'
import { describe, expect, test } from 'vitest'

describe('routing charter conformance — architectural commitments', () => {
  // ── Commitment #1: Routes are values, not file paths ─────────────────
  test('charter: route() builds typed URL helpers from string literals', () => {
    const r = route('/posts/:id')
    expect(r.pattern).toBe('/posts/:id')
    // `route()` returns a callable — `r(params)` builds the URL.
    expect(r({ id: '42' })).toBe('/posts/42')
  })

  test('charter: routes(prefix, [pages]) prefixes paths declaratively', () => {
    const a = page('/list', { view: () => div({}, []) })
    const b = page('/:id', { view: () => div({}, []) })
    const prefixed = routes('/posts', [a, b])
    expect(prefixed.map((p) => p.path).sort()).toEqual(['/posts/:id', '/posts/list'])
  })

  // ── Commitment #2: Params typed from the path string ─────────────────
  test("charter: ParamsOf<'/posts/:id'> = { id: string } (TS-level only — runtime check via shape)", () => {
    const r = route('/posts/:id/comments/:cid')
    // ParamsOf is a type-level inference; runtime check: r() accepts
    // the typed keys and produces the substituted URL.
    const url = r({ id: 'p1', cid: 'c2' })
    expect(url).toBe('/posts/p1/comments/c2')
  })

  test('charter: route().match(path) extracts typed params from a concrete URL', () => {
    const r = route('/posts/:id')
    const params = r.match('/posts/42')
    expect(params).toEqual({ id: '42' })
    expect(r.match('/other/42')).toBeNull()
  })

  test('charter: parsePath splits a URL path into segments + query', () => {
    const parts = parsePath('/posts/42?tag=tech&page=2')
    expect(parts.segments).toEqual(['posts', '42'])
    expect(parts.query.get('tag')).toBe('tech')
    expect(parts.query.get('page')).toBe('2')
  })

  // ── Commitment #4: The URL is reactive state ─────────────────────────
  test('charter: Router.path() is reactive — navigate updates it synchronously', () => {
    // memoryRouter returns a `RouterHandle` that IS the Router (plus
    // Provision shape for cap-install, plus `.dispose()`).
    const r = memoryRouter('/initial')
    expect(r.path()).toBe('/initial')
    r.navigate('/next')
    expect(r.path()).toBe('/next')
    r.dispose()
  })

  test('charter: Router exposes navigate / replace / back / forward / query methods', () => {
    const r = memoryRouter('/a')
    expect(typeof r.navigate).toBe('function')
    expect(typeof r.replace).toBe('function')
    expect(typeof r.path).toBe('function')
    expect(typeof r.query).toBe('function')
    expect(typeof r.back).toBe('function')
    expect(typeof r.forward).toBe('function')
    r.dispose()
  })

  // ── Commitment #5: SSR is read-only ──────────────────────────────────
  test('charter: serverRouter(req) refuses navigation methods', () => {
    const req = new Request('http://example.com/posts/42?page=2')
    const sr = serverRouter(req)
    // Reads work — the path includes the query string per serverRouter's
    // contract (it forwards `pathname + search` as the initial path).
    expect(sr.path()).toContain('/posts/42')
    expect(sr.query().get('page')).toBe('2')
    // Writes throw.
    expect(() => sr.navigate('/elsewhere')).toThrow()
    expect(() => sr.replace('/elsewhere')).toThrow()
    expect(() => sr.back()).toThrow()
    expect(() => sr.forward()).toThrow()
  })

  // ── Commitment #3: One router cap per page lifecycle ─────────────────
  test('charter: RouterHandle is triple-duty (Router + Provision + Disposer)', () => {
    const handle = memoryRouter('/x')
    // Router shape:
    expect(typeof handle.path).toBe('function')
    expect(typeof handle.navigate).toBe('function')
    // Provision shape — has `capability` + `impl` for cap-install machinery:
    expect(handle.capability).toBeDefined()
    expect(handle.impl).toBeDefined()
    expect(typeof handle.capability.install).toBe('function')
    expect(typeof handle.capability.use).toBe('function')
    // Disposer:
    expect(typeof handle.dispose).toBe('function')
    handle.dispose()
  })
})
