// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { watch } from '../../../reactivity/src/index.ts'
import {
  hashRouter,
  memoryRouter,
  parsePath,
  pathRouter,
  RouterCap,
  route,
  searchParams,
} from '../../src/index.ts'

beforeEach(() => {
  globalThis.location.hash = ''
})

afterEach(() => {
  globalThis.location.hash = ''
})

describe('memoryRouter', () => {
  test('initial path defaults to /', () => {
    const r = memoryRouter()
    expect(r.path()).toBe('/')
  })

  test('initial path can be customized', () => {
    const r = memoryRouter('/foo')
    expect(r.path()).toBe('/foo')
  })

  test('navigate updates path', () => {
    const r = memoryRouter()
    r.navigate('/notes/abc')
    expect(r.path()).toBe('/notes/abc')
  })

  test('replace updates path', () => {
    const r = memoryRouter()
    r.replace('/x')
    expect(r.path()).toBe('/x')
  })

  test('path is reactive — watchers re-run on navigate', () => {
    const r = memoryRouter('/start')
    let observed = ''
    const stop = watch(() => {
      observed = r.path()
    })
    expect(observed).toBe('/start')
    r.navigate('/end')
    expect(observed).toBe('/end')
    stop()
  })

  test('back / forward are inert in v0.1', () => {
    const r = memoryRouter('/x')
    expect(() => r.back()).not.toThrow()
    expect(() => r.forward()).not.toThrow()
    expect(r.path()).toBe('/x')
  })
})

describe('hashRouter', () => {
  let cleanup: (() => void) | undefined

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
  })

  test('reads initial hash', () => {
    globalThis.location.hash = '/initial'
    const router = hashRouter()
    cleanup = router.dispose
    expect(router.path()).toBe('/initial')
  })

  test("initial hash absent normalizes to '/'", () => {
    const router = hashRouter()
    cleanup = router.dispose
    // Was '' before normalization; now '/' so `path() === '/'` is the
    // reliable home-page check regardless of how the URL got there.
    expect(router.path()).toBe('/')
  })

  test('navigate updates location.hash and path() synchronously', () => {
    const router = hashRouter()
    cleanup = router.dispose
    router.navigate('/notes/x')
    expect(globalThis.location.hash).toBe('#/notes/x')
    expect(router.path()).toBe('/notes/x')
  })

  test('navigate triggers reactive subscribers', () => {
    const router = hashRouter()
    cleanup = router.dispose
    let observed: string | null = null
    const stop = watch(() => {
      observed = router.path()
    })
    router.navigate('/x')
    expect(observed).toBe('/x')
    stop()
  })

  test('hashchange event syncs reactive path (browser back/forward)', () => {
    const router = hashRouter()
    cleanup = router.dispose
    // Simulate the browser changing the hash (e.g., user hits back).
    globalThis.location.hash = '/external'
    globalThis.dispatchEvent(new Event('hashchange'))
    expect(router.path()).toBe('/external')
  })

  test('replace updates path without changing history length', () => {
    const router = hashRouter()
    cleanup = router.dispose
    const before = globalThis.history.length
    router.replace('/r')
    expect(router.path()).toBe('/r')
    expect(globalThis.history.length).toBe(before)
  })

  test('navigate accepts paths with or without leading hash', () => {
    const router = hashRouter()
    cleanup = router.dispose
    router.navigate('#/with-hash')
    expect(router.path()).toBe('/with-hash')
    router.navigate('/no-hash')
    expect(router.path()).toBe('/no-hash')
  })

  test('dispose removes the hashchange listener', () => {
    const router = hashRouter()
    router.dispose()
    globalThis.location.hash = '/after-dispose'
    globalThis.dispatchEvent(new Event('hashchange'))
    // path() still reflects whatever navigate/replace last wrote, which
    // here is the (normalized) initial — the external hash change must
    // NOT have propagated.
    expect(router.path()).toBe('/')
  })
})

describe('parsePath', () => {
  test('empty path → empty segments + empty query', () => {
    const p = parsePath('')
    expect(p.segments).toEqual([])
    expect([...p.query.entries()]).toEqual([])
  })

  test("'/' → empty segments", () => {
    expect(parsePath('/').segments).toEqual([])
  })

  test('strips leading and trailing slashes', () => {
    expect(parsePath('/a/b/').segments).toEqual(['a', 'b'])
    expect(parsePath('a/b').segments).toEqual(['a', 'b'])
  })

  test('URL-decodes segments', () => {
    expect(parsePath('/a%20b/c%2Fd').segments).toEqual(['a b', 'c/d'])
  })

  test('preserves segments with malformed escapes (no throw)', () => {
    expect(parsePath('/%E0%A4%A').segments).toEqual(['%E0%A4%A'])
  })

  test('extracts query parameters', () => {
    const p = parsePath('/notes?tag=react&author=me')
    expect(p.segments).toEqual(['notes'])
    expect(p.query.get('tag')).toBe('react')
    expect(p.query.get('author')).toBe('me')
  })

  test('query without path', () => {
    const p = parsePath('?x=1')
    expect(p.segments).toEqual([])
    expect(p.query.get('x')).toBe('1')
  })
})

describe('Router.segments / Router.query', () => {
  test('memoryRouter reflects initial path', () => {
    const r = memoryRouter('/users/42?x=1')
    expect(r.segments()).toEqual(['users', '42'])
    expect(r.query().get('x')).toBe('1')
  })

  test('reactive on navigate (segments)', () => {
    const r = memoryRouter('/a')
    let observed: readonly string[] = []
    const stop = watch(() => {
      observed = r.segments()
    })
    expect(observed).toEqual(['a'])
    r.navigate('/b/c')
    expect(observed).toEqual(['b', 'c'])
    stop()
  })

  test('reactive on navigate (query)', () => {
    const r = memoryRouter('/?x=1')
    let observed: string | null = null
    const stop = watch(() => {
      observed = r.query().get('x')
    })
    expect(observed).toBe('1')
    r.navigate('/?x=2')
    expect(observed).toBe('2')
    stop()
  })

  test('parse is cached — same identity across reads while path is unchanged', () => {
    const r = memoryRouter('/a/b')
    const a = r.segments()
    const b = r.segments()
    expect(a).toBe(b)
    r.navigate('/c')
    const c = r.segments()
    expect(c).not.toBe(a)
  })

  test('mutating returned URLSearchParams does not affect router', () => {
    const r = memoryRouter('/?x=1')
    r.query().set('x', '999')
    expect(r.query().get('x')).toBe('1')
  })

  test('segment(i) returns the indexed segment or null', () => {
    const r = memoryRouter('/notes/42')
    expect(r.segment(0)).toBe('notes')
    expect(r.segment(1)).toBe('42')
    expect(r.segment(2)).toBeNull()
    expect(r.segment(99)).toBeNull()
  })

  test('segment(i) is reactive', () => {
    const r = memoryRouter('/a')
    let observed: string | null = ''
    const stop = watch(() => {
      observed = r.segment(0)
    })
    expect(observed).toBe('a')
    r.navigate('/b/c')
    expect(observed).toBe('b')
    r.navigate('/')
    expect(observed).toBeNull()
    stop()
  })

  test('param(key) returns the value or null', () => {
    const r = memoryRouter('/?tag=react&page=2')
    expect(r.param('tag')).toBe('react')
    expect(r.param('page')).toBe('2')
    expect(r.param('missing')).toBeNull()
  })

  test('param(key) is reactive', () => {
    const r = memoryRouter('/?tag=react')
    let observed: string | null = ''
    const stop = watch(() => {
      observed = r.param('tag')
    })
    expect(observed).toBe('react')
    r.updateQuery({ tag: 'svelte' })
    expect(observed).toBe('svelte')
    r.updateQuery({ tag: null })
    expect(observed).toBeNull()
    stop()
  })

  test('segment(0) does NOT re-fire when only the query string changes', () => {
    // Regression: typing in a URL-bound input updates `?q=…`, which
    // changes `path` and (in the old implementation) the entire
    // `parsed` derived state — so segment(0) consumers re-fired even
    // though segment(0) was still null. That re-render destroyed the
    // input's focus on every keystroke.
    const r = memoryRouter('/')
    let runs = 0
    const stop = watch(() => {
      r.segment(0)
      runs++
    })
    expect(runs).toBe(1)
    r.updateQuery({ q: 'a' })
    r.updateQuery({ q: 'ab' })
    r.updateQuery({ q: 'abc' })
    expect(runs).toBe(1) // still 1: segment(0) is still null
    stop()
  })

  test('segment(0) does NOT re-fire when only segment(1) changes', () => {
    const r = memoryRouter('/users/a')
    let runs = 0
    const stop = watch(() => {
      r.segment(0)
      runs++
    })
    expect(runs).toBe(1)
    r.navigate('/users/b')
    r.navigate('/users/c')
    expect(runs).toBe(1) // segment(0) is still 'users'
    r.navigate('/posts/x')
    expect(runs).toBe(2) // now segment(0) actually changed
    stop()
  })

  test('param(k) does NOT re-fire when an unrelated param changes', () => {
    const r = memoryRouter('/?tag=react&page=1')
    let tagRuns = 0
    const stop = watch(() => {
      r.param('tag')
      tagRuns++
    })
    expect(tagRuns).toBe(1)
    r.updateQuery({ page: '2' })
    r.updateQuery({ page: '3' })
    r.updateQuery({ unrelated: 'x' })
    expect(tagRuns).toBe(1) // tag never changed
    r.updateQuery({ tag: 'svelte' })
    expect(tagRuns).toBe(2)
    stop()
  })
})

describe('Router.navigate options', () => {
  test('preserveQuery keeps the existing query string', () => {
    const r = memoryRouter('/users/1?tag=react&author=me')
    r.navigate('/users/2', { preserveQuery: true })
    expect(r.path()).toBe('/users/2?tag=react&author=me')
  })

  test('preserveQuery: a new query in the path overrides per-key', () => {
    const r = memoryRouter('/?tag=react&author=me')
    r.navigate('/?tag=vue', { preserveQuery: true })
    expect(r.query().get('tag')).toBe('vue')
    expect(r.query().get('author')).toBe('me')
  })

  test('preserveQuery without a current query is just navigate', () => {
    const r = memoryRouter('/')
    r.navigate('/users/1', { preserveQuery: true })
    expect(r.path()).toBe('/users/1')
  })

  test('replace option uses replace semantics', () => {
    const r = memoryRouter('/a')
    r.navigate('/b', { replace: true })
    expect(r.path()).toBe('/b')
  })

  test('replace + preserveQuery compose', () => {
    const r = memoryRouter('/a?tag=x')
    r.navigate('/b', { replace: true, preserveQuery: true })
    expect(r.path()).toBe('/b?tag=x')
  })
})

describe('Router.updateQuery', () => {
  test('sets a new query parameter, preserving the path', () => {
    const r = memoryRouter('/users/42')
    r.updateQuery({ tag: 'react' })
    expect(r.path()).toBe('/users/42?tag=react')
    expect(r.query().get('tag')).toBe('react')
  })

  test('merges with existing query, leaving untouched keys alone', () => {
    const r = memoryRouter('/?author=me&sort=date')
    r.updateQuery({ tag: 'react' })
    expect(r.query().get('author')).toBe('me')
    expect(r.query().get('sort')).toBe('date')
    expect(r.query().get('tag')).toBe('react')
  })

  test('null deletes a key, preserving others', () => {
    const r = memoryRouter('/?tag=react&author=me')
    r.updateQuery({ tag: null })
    expect(r.query().has('tag')).toBe(false)
    expect(r.query().get('author')).toBe('me')
    expect(r.path()).toBe('/?author=me')
  })

  test('removing the last param drops the ?', () => {
    const r = memoryRouter('/notes?tag=x')
    r.updateQuery({ tag: null })
    expect(r.path()).toBe('/notes')
  })

  test('replace option keeps history flat', () => {
    const r = memoryRouter('/')
    let pathChanges = 0
    const stop = watch(() => {
      r.path()
      pathChanges++
    })
    pathChanges = 0
    r.updateQuery({ tag: 'a' }, { replace: true })
    r.updateQuery({ tag: 'b' }, { replace: true })
    expect(r.path()).toBe('/?tag=b')
    // Two writes regardless; the assertion is that the call accepts
    // the option without throwing and the result reflects both.
    expect(pathChanges).toBe(2)
    stop()
  })

  test('reactive consumers see the new query', () => {
    const r = memoryRouter('/')
    let observed: string | null = null
    const stop = watch(() => {
      observed = r.query().get('tag')
    })
    expect(observed).toBeNull()
    r.updateQuery({ tag: 'react' })
    expect(observed).toBe('react')
    stop()
  })
})

describe('Router.link', () => {
  // Build a left-click MouseEvent — happy-dom's MouseEvent constructor
  // honors the init dict for these fields, which is exactly what
  // buildLink reads.
  const click = (init?: MouseEventInit): MouseEvent =>
    new MouseEvent('click', { cancelable: true, button: 0, ...init })

  test('href is the path itself for memoryRouter', () => {
    const r = memoryRouter('/')
    expect(r.link('/about').href).toBe('/about')
  })

  test('href is hash-prefixed for hashRouter', () => {
    const router = hashRouter()
    expect(router.link('/about').href).toBe('#/about')
    router.dispose()
  })

  test('go() navigates to the target', () => {
    const r = memoryRouter('/')
    r.link('/foo').go()
    expect(r.path()).toBe('/foo')
  })

  test('go() respects { replace: true }', () => {
    const r = memoryRouter('/start')
    r.link('/replaced', { replace: true }).go()
    expect(r.path()).toBe('/replaced')
  })

  test('go() respects { preserveQuery: true }', () => {
    const r = memoryRouter('/?tag=react')
    r.link('/notes', { preserveQuery: true }).go()
    expect(r.path()).toBe('/notes?tag=react')
  })

  test('plain left-click triggers navigation and preventDefault', () => {
    const r = memoryRouter('/')
    const link = r.link('/clicked')
    const ev = click()
    link.onClick(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(r.path()).toBe('/clicked')
  })

  test('modifier-clicks defer to the browser (no navigate, no preventDefault)', () => {
    const r = memoryRouter('/')
    const link = r.link('/somewhere')

    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      const ev = click(init)
      link.onClick(ev)
      expect(ev.defaultPrevented).toBe(false)
    }
    expect(r.path()).toBe('/')
  })

  test('non-left mouse buttons defer to the browser', () => {
    const r = memoryRouter('/')
    const link = r.link('/somewhere')

    for (const button of [1, 2]) {
      const ev = click({ button })
      link.onClick(ev)
      expect(ev.defaultPrevented).toBe(false)
    }
    expect(r.path()).toBe('/')
  })

  test('active() is true for exact path match, ignoring query', () => {
    const r = memoryRouter('/notes?tag=react')
    expect(r.link('/notes').active()).toBe(true)
    expect(r.link('/notes?tag=react').active()).toBe(true)
    expect(r.link('/notes?tag=svelte').active()).toBe(true) // path matches; query ignored
    expect(r.link('/notes/42').active()).toBe(false)
    expect(r.link('/').active()).toBe(false)
  })

  test('active() is reactive — re-runs on navigate', () => {
    const r = memoryRouter('/')
    const link = r.link('/about')
    let observed = false
    const stop = watch(() => {
      observed = link.active()
    })
    expect(observed).toBe(false)
    r.navigate('/about')
    expect(observed).toBe(true)
    r.navigate('/')
    expect(observed).toBe(false)
    stop()
  })

  test("aria-current is 'page' when active and undefined otherwise", () => {
    const r = memoryRouter('/about')
    expect(r.link('/about')['aria-current']()).toBe('page')
    expect(r.link('/other')['aria-current']()).toBeUndefined()
  })

  test('hashRouter end-to-end: click navigates and updates router state', () => {
    const router = hashRouter()
    const link = router.link('/clicked')
    const ev = click()
    link.onClick(ev)
    expect(router.path()).toBe('/clicked')
    expect(globalThis.location.hash).toBe('#/clicked')
    router.dispose()
  })

  test('only href/onClick/aria-current are enumerable — go and active stay hidden from {...spread}', () => {
    // Regression for the hard-refresh bug: spreading link onto an <a>
    // would invoke `go` as a reactive prop and navigate during mount,
    // mutating location.hash to the LAST link's target. Non-enumerable
    // `go` and `active` keeps the spread DOM-safe.
    const r = memoryRouter('/')
    const link = r.link('/safe')
    expect(Object.keys(link).sort()).toEqual(['aria-current', 'href', 'onClick'])
    // But direct property access still works:
    expect(typeof link.go).toBe('function')
    expect(typeof link.active).toBe('function')
    // And spreading is safe — no navigation occurs:
    const spread = { ...link }
    expect('go' in spread).toBe(false)
    expect('active' in spread).toBe(false)
    expect(r.path()).toBe('/')
  })
})

describe('RouterHandle satisfies Provision', () => {
  test('hashRouter handle has non-enumerable capability + impl + dispose', () => {
    const router = hashRouter()
    // The Provision shape exists on the router for direct use in
    // mount({ provide: [router] }) — same trick as Link.
    expect(router.capability).toBe(RouterCap)
    expect(router.impl).toBe(router)
    expect(typeof router.dispose).toBe('function')
    // …but they must NOT enumerate (otherwise spread would leak them
    // and reactive bindings would invoke `dispose` like the Link bug).
    expect(Object.keys(router)).not.toContain('capability')
    expect(Object.keys(router)).not.toContain('impl')
    expect(Object.keys(router)).not.toContain('dispose')
    router.dispose()
  })

  test('memoryRouter handle has the same shape (dispose is a no-op)', () => {
    const router = memoryRouter('/x')
    expect(router.capability).toBe(RouterCap)
    expect(router.impl).toBe(router)
    expect(typeof router.dispose).toBe('function')
    expect(() => router.dispose()).not.toThrow()
  })
})

describe('pathRouter — History API mode (clean URLs)', () => {
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    // Reset to a known starting URL in happy-dom's location.
    globalThis.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    globalThis.history.replaceState(null, '', '/')
  })

  test('reads initial pathname + search', () => {
    globalThis.history.replaceState(null, '', '/notes/42?tag=react')
    const router = pathRouter()
    cleanup = router.dispose
    expect(router.path()).toBe('/notes/42?tag=react')
    expect(router.segment(0)).toBe('notes')
    expect(router.segment(1)).toBe('42')
    expect(router.param('tag')).toBe('react')
  })

  test("empty pathname normalizes to '/'", () => {
    const router = pathRouter()
    cleanup = router.dispose
    expect(router.path()).toBe('/')
  })

  test('navigate uses pushState (no full reload) and updates path() synchronously', () => {
    const router = pathRouter()
    cleanup = router.dispose
    router.navigate('/about')
    expect(globalThis.location.pathname).toBe('/about')
    expect(router.path()).toBe('/about')
  })

  test('replace uses replaceState — does not grow history', () => {
    const router = pathRouter()
    cleanup = router.dispose
    const before = globalThis.history.length
    router.replace('/replaced')
    expect(globalThis.location.pathname).toBe('/replaced')
    expect(globalThis.history.length).toBe(before)
  })

  test('popstate event syncs reactive path (browser back/forward)', () => {
    const router = pathRouter()
    cleanup = router.dispose
    // Simulate the browser changing the URL via back/forward.
    globalThis.history.replaceState(null, '', '/external')
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
    expect(router.path()).toBe('/external')
  })

  test('link href is the bare path (no hash prefix)', () => {
    const router = pathRouter()
    cleanup = router.dispose
    expect(router.link('/about').href).toBe('/about')
  })

  test('dispose removes the popstate listener', () => {
    const router = pathRouter()
    router.dispose()
    globalThis.history.replaceState(null, '', '/after-dispose')
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
    // path() still reflects the initial — popstate must NOT have propagated.
    expect(router.path()).toBe('/')
  })
})

describe('Router.url — shareable absolute URLs', () => {
  test('hashRouter url() includes hash prefix and origin', () => {
    globalThis.location.hash = '/notes/42'
    const router = hashRouter()
    const u = router.url()
    expect(u).toContain('#/notes/42')
    expect(u.startsWith(globalThis.location.origin)).toBe(true)
    router.dispose()
  })

  test('hashRouter url(to) builds for an arbitrary target', () => {
    const router = hashRouter()
    const u = router.url('/about')
    expect(u.endsWith('#/about')).toBe(true)
    router.dispose()
  })

  test('pathRouter url() returns clean origin + path', () => {
    globalThis.history.replaceState(null, '', '/clean')
    const router = pathRouter()
    expect(router.url()).toBe(`${globalThis.location.origin}/clean`)
    expect(router.url('/elsewhere')).toBe(`${globalThis.location.origin}/elsewhere`)
    router.dispose()
    globalThis.history.replaceState(null, '', '/')
  })

  test('memoryRouter url() returns the path itself (no origin)', () => {
    const r = memoryRouter('/x')
    expect(r.url()).toBe('/x')
    expect(r.url('/y')).toBe('/y')
  })
})

describe('route() — typed paths', () => {
  test('builds a static route', () => {
    const r = route('/about')
    expect(r({})).toBe('/about')
    expect(r.pattern).toBe('/about')
  })

  test('builds a route with a single param', () => {
    const r = route('/users/:id')
    expect(r({ id: 'abc' })).toBe('/users/abc')
  })

  test('builds a route with multiple params', () => {
    const r = route('/users/:id/posts/:postId')
    expect(r({ id: 'a', postId: '42' })).toBe('/users/a/posts/42')
  })

  test('URL-encodes param values when building', () => {
    const r = route('/notes/:slug')
    expect(r({ slug: 'a b/c' })).toBe('/notes/a%20b%2Fc')
  })

  test('home route builds /', () => {
    const r = route('/')
    expect(r({})).toBe('/')
  })

  test('match: returns params for a matching path', () => {
    const r = route('/users/:id')
    expect(r.match('/users/abc')).toEqual({ id: 'abc' })
  })

  test('match: extracts multiple params', () => {
    const r = route('/users/:id/posts/:postId')
    expect(r.match('/users/a/posts/42')).toEqual({ id: 'a', postId: '42' })
  })

  test('match: ignores query string', () => {
    const r = route('/users/:id')
    expect(r.match('/users/abc?tag=react')).toEqual({ id: 'abc' })
  })

  test('match: returns null on segment-count mismatch', () => {
    const r = route('/users/:id')
    expect(r.match('/users')).toBeNull()
    expect(r.match('/users/abc/extra')).toBeNull()
  })

  test('match: returns null on static-segment mismatch', () => {
    const r = route('/users/:id')
    expect(r.match('/accounts/abc')).toBeNull()
  })

  test('match: URL-decodes captured params', () => {
    const r = route('/notes/:slug')
    expect(r.match('/notes/a%20b%2Fc')).toEqual({ slug: 'a b/c' })
  })

  test('match: home pattern matches /', () => {
    const r = route('/')
    expect(r.match('/')).toEqual({})
    expect(r.match('/anywhere')).toBeNull()
  })

  test('integrates with router.navigate / router.link (route returns a string)', () => {
    const r = memoryRouter('/')
    const userRoute = route('/users/:id')

    r.navigate(userRoute({ id: 'alice' }))
    expect(r.path()).toBe('/users/alice')

    const link = r.link(userRoute({ id: 'bob' }))
    expect(link.href).toBe('/users/bob')
  })

  test('round-trip: build then match recovers the original params', () => {
    const r = route('/users/:id/posts/:postId')
    const params = { id: 'a b', postId: '42' }
    const built = r(params)
    expect(r.match(built)).toEqual(params)
  })
})

describe('searchParams() — typed query-param schemas', () => {
  test('read returns parsed values for each key', () => {
    const r = memoryRouter('/?tag=react&page=3&sort=desc')
    const filters = searchParams({
      tag: (raw) => raw,
      page: (raw) => (raw ? Number(raw) : 1),
      sort: (raw) => (raw === 'desc' ? ('desc' as const) : ('asc' as const)),
    })
    const f = filters.read(r)
    expect(f.tag).toBe('react')
    expect(f.page).toBe(3)
    expect(f.sort).toBe('desc')
  })

  test('read uses parser defaults when keys are absent', () => {
    const r = memoryRouter('/')
    const filters = searchParams({
      tag: (raw) => raw,
      page: (raw) => (raw ? Number(raw) : 1),
    })
    const f = filters.read(r)
    expect(f.tag).toBeNull()
    expect(f.page).toBe(1)
  })

  test('read is reactive — re-runs in a watch on path change', () => {
    const r = memoryRouter('/?tag=react')
    const filters = searchParams({ tag: (raw) => raw })
    let observed: string | null = ''
    const stop = watch(() => {
      observed = filters.read(r).tag
    })
    expect(observed).toBe('react')
    r.navigate('/?tag=svelte')
    expect(observed).toBe('svelte')
    r.navigate('/')
    expect(observed).toBeNull()
    stop()
  })

  test('update sets keys in the URL', () => {
    const r = memoryRouter('/')
    const filters = searchParams({ tag: (raw) => raw, page: (raw) => Number(raw) || 1 })
    filters.update(r, { tag: 'react', page: 2 })
    expect(r.param('tag')).toBe('react')
    expect(r.param('page')).toBe('2')
  })

  test('update with null deletes the key', () => {
    const r = memoryRouter('/?tag=react&page=3')
    const filters = searchParams({ tag: (raw) => raw, page: (raw) => Number(raw) || 1 })
    filters.update(r, { tag: null })
    expect(r.param('tag')).toBeNull()
    expect(r.param('page')).toBe('3')
  })

  test('update preserves untouched keys', () => {
    const r = memoryRouter('/?tag=react&unrelated=keep')
    const filters = searchParams({ tag: (raw) => raw })
    filters.update(r, { tag: 'svelte' })
    expect(r.param('tag')).toBe('svelte')
    expect(r.param('unrelated')).toBe('keep')
  })

  test('update honors { replace: true } to keep the back stack flat', () => {
    const r = memoryRouter('/start')
    const filters = searchParams({ tag: (raw) => raw })
    filters.update(r, { tag: 'react' }, { replace: true })
    expect(r.path()).toBe('/start?tag=react')
  })
})

describe('Router path normalization', () => {
  test('memoryRouter normalizes empty initial to /', () => {
    expect(memoryRouter('').path()).toBe('/')
  })

  test("navigate('') normalizes to '/'", () => {
    const r = memoryRouter('/start')
    r.navigate('')
    expect(r.path()).toBe('/')
  })

  test("replace('') normalizes to '/'", () => {
    const r = memoryRouter('/start')
    r.replace('')
    expect(r.path()).toBe('/')
  })
})

describe('RouterCap', () => {
  test('exposes its name for error messages', () => {
    expect(RouterCap.name).toBe('Router')
  })

  test('throws when used outside provide / install scope', () => {
    expect(() => RouterCap.use()).toThrow(/Router/)
  })

  test('install + dispose round-trip', () => {
    const r = memoryRouter('/installed')
    const stop = RouterCap.install(r)
    expect(RouterCap.use().path()).toBe('/installed')
    stop()
    expect(() => RouterCap.use()).toThrow()
  })
})
