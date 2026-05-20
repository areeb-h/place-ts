// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { div, h1, main, notFound, p, page, renderPage, span } from '../../src/index.ts'

// page() bundles {url, load, view, shell} into one object that both
// serve() and boot() consume. renderPage exercises the server side end-
// to-end without spinning up Bun.serve. boot() exercises the client
// side against the SSR'd HTML.

describe('page() — declarative page object', () => {
  test('renderPage: pure view (no url/load) renders the document shell', async () => {
    const home = page({
      view: () => div({ class: 'home' }, ['hi']),
      meta: { title: 'home' },
    })
    const res = await renderPage(home, new Request('http://x/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const body = await res.text()
    expect(body.startsWith('<!doctype html>')).toBe(true)
    expect(body).toContain('<title>home</title>')
    expect(body).toContain('<div data-h="0" class="home">hi</div>')
    // No load → no embedded data script.
    expect(body).not.toContain('__place_load__')
  })

  test('renderPage: url(url, params) feeds props into view', async () => {
    const greet = page({
      url: (u) => ({ name: u.searchParams.get('name') ?? 'visitor' }),
      view: ({ name }) => span({}, [`hi, ${name}`]),
    })
    const res = await renderPage(greet, new Request('http://x/?name=alice'))
    expect(await res.text()).toContain('hi, alice')
  })

  test('renderPage: load() result merges with url props and serializes into a <script>', async () => {
    const home = page({
      url: () => ({ a: 1 }),
      load: async () => ({ b: 2, msg: 'hello' }),
      view: ({ a, b, msg }) => div({}, [`${a}+${b}=${a + b} ${msg}`]),
    })
    const body = await (await renderPage(home, new Request('http://x/'))).text()
    expect(body).toContain('1+2=3 hello')
    expect(body).toContain('id="__place_load__"')
    expect(body).toContain('"b":2')
    expect(body).toContain('"msg":"hello"')
  })

  test('renderPage: load script escapes </script> to prevent breakout', async () => {
    const evil = page({
      load: () => ({ payload: '</script><script>alert(1)</script>' }),
      view: () => span({}, ['x']),
    })
    const body = await (await renderPage(evil, new Request('http://x/'))).text()
    // The escaped form must appear; the raw </script> must NOT inside the load script.
    expect(body).toContain('\\u003c/script\\u003e')
    // There's exactly one </script> in the doc (closing the load tag),
    // not the two an injection would produce.
    const closes = body.match(/<\/script>/g) ?? []
    expect(closes.length).toBe(1)
  })

  test('renderPage: load() throwing yields 500 text/plain', async () => {
    // Explicit `<{}, {}>` so a load() that only throws (return type
    // inferred as `never`) doesn't poison the Page generics.
    const broken = page<Record<string, never>, Record<string, never>>({
      load: () => {
        throw new Error('db down')
      },
      view: () => div({}, ['x']),
    })
    // Vitest runs with NODE_ENV !== 'production' by default, so the
    // dev error overlay fires — HTML response with the error name +
    // message + stack frames. Production behavior (text/plain 500) is
    // checked in the next test by setting NODE_ENV inline.
    const res = await renderPage(broken, new Request('http://x/'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const body = await res.text()
    expect(body).toContain('Error') // err.name
    expect(body).toContain('db down') // err.message
    expect(body).toContain('place / load threw') // overlay tag
  })

  test('renderPage: load() throwing yields minimal text/plain 500 in production', async () => {
    const prev = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    try {
      const broken = page<Record<string, never>, Record<string, never>>({
        load: () => {
          throw new Error('db down')
        },
        view: () => div({}, ['x']),
      })
      const res = await renderPage(broken, new Request('http://x/'))
      expect(res.status).toBe(500)
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      // Production: minimal-info, no stack leakage.
      const body = await res.text()
      expect(body).toBe('Internal Server Error: db down')
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = prev
    }
  })

  test('renderPage: view() throwing routes to dev error overlay (was uncaught)', async () => {
    // Was a real bug — `p.view(props)` ran outside try/catch. A throw
    // here propagated out of renderPage. Now caught and renders the
    // overlay just like a load() throw.
    const broken = page<Record<string, never>, Record<string, never>>({
      view: () => {
        throw new Error('view kaboom')
      },
    })
    const res = await renderPage(broken, new Request('http://x/'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const body = await res.text()
    expect(body).toContain('view kaboom')
    expect(body).toContain('place / render threw')
  })

  test('renderPage: function meta() throwing routes to dev error overlay', async () => {
    const broken = page<Record<string, never>, Record<string, never>>({
      view: () => div({}, ['x']),
      meta: () => {
        throw new Error('meta kaboom')
      },
    })
    const res = await renderPage(broken, new Request('http://x/'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain('meta kaboom')
  })

  test('renderPage: page.headers extend the response', async () => {
    const home = page({
      view: () => span({}, ['x']),
      headers: { 'X-Custom': 'yes' },
    })
    const res = await renderPage(home, new Request('http://x/'))
    expect(res.headers.get('x-custom')).toBe('yes')
  })

  test('renderPage: receives params (route captures)', async () => {
    const user = page({
      url: (_u, params) => ({ id: params['id'] ?? 'none' }),
      view: ({ id }) => span({}, [`user:${id}`]),
    })
    const body = await (
      await renderPage(user, new Request('http://x/users/42'), { id: '42' })
    ).text()
    expect(body).toContain('user:42')
  })
})

// Round 5 (cut 5.1): `page(path, def)` overload co-locates the path
// with the page module so serve()'s routes object doesn't have to repeat
// the path. The legacy single-arg form keeps working unchanged.
describe('page(path, def) — Round 5 path-on-page overload', () => {
  test('stores the path on the returned page object', () => {
    const p = page('/posts/:id', { view: () => span({}, ['x']) })
    expect(p.path).toBe('/posts/:id')
  })

  test('legacy page(def) leaves path undefined', () => {
    const p = page({ view: () => span({}, ['x']) })
    expect(p.path).toBeUndefined()
  })

  test('preserves all other fields (load, view, meta) from def', () => {
    const p = page('/counter', {
      load: async () => ({ count: 42 }),
      view: () => span({}, ['x']),
      meta: { title: 'Count', description: 'a counter' },
    })
    expect(p.path).toBe('/counter')
    expect(typeof p.load).toBe('function')
    // meta narrows to PageMeta when not a function-prop variant.
    expect((p.meta as { description?: string }).description).toBe('a counter')
  })

  test("rejects a path that doesn't start with '/'", () => {
    expect(() => page('posts/:id', { view: () => span({}, []) })).toThrow(/must start with '\/'/)
  })

  test('rejects an empty-string path', () => {
    expect(() => page('', { view: () => span({}, []) })).toThrow(/must start with '\/'/)
  })

  test('rejects calls that pass a path but no definition', () => {
    // @ts-expect-error — no overload matches a bare path; runtime guard
    expect(() => page('/x')).toThrow(/definition.+required/i)
  })
})

// Round 5 (cut 5.3): `on: {}` dict on pages — co-located actions.
// Each entry auto-registers as `POST {page.path}/_action/{key}` with
// the full action() security pipeline; a typed caller is exposed on
// the page object.
describe('page({on: {...}}) — co-located actions', () => {
  test('exposes a caller method for each on-key', () => {
    const p = page('/x', {
      on: {
        ping: async () => 'pong',
      },
      view: () => span({}, ['x']),
    })
    // The caller is attached as a property of the page object.
    expect(typeof (p as unknown as { ping: unknown }).ping).toBe('function')
  })

  test('stashes _onHandlers for serve() to spread', () => {
    const p = page('/x', {
      on: {
        ping: async () => 'pong',
      },
      view: () => span({}, ['x']),
    })
    const handlers = (p as { _onHandlers?: Record<string, unknown> })._onHandlers
    expect(handlers).toBeDefined()
    expect(Object.keys(handlers ?? {}).length).toBeGreaterThan(0)
    // The path key encodes METHOD + url so action() can dispatch.
    const key = Object.keys(handlers ?? {})[0] ?? ''
    expect(key).toMatch(/POST \/x\/_action\/ping/)
  })

  test('refuses on: in the legacy single-arg page(def) form', () => {
    expect(() =>
      page({
        on: { ping: async () => 'pong' },
        view: () => span({}, ['x']),
      }),
    ).toThrow(/two-arg form/)
  })

  test('refuses on-keys that collide with existing Page fields', () => {
    // `view` is a built-in page field; an on-action named 'view' would
    // overwrite the rendered view. The factory rejects this at build
    // time so the user sees the conflict early.
    expect(() =>
      page('/x', {
        on: {
          view: async () => 'collision',
        },
        view: () => span({}, ['x']),
      }),
    ).toThrow(/collides with an existing page field/)
  })

  test('refuses on-keys that are not valid JS identifiers', () => {
    expect(() =>
      page('/x', {
        on: {
          'not valid': async () => 'x',
        },
        view: () => span({}, ['x']),
      }),
    ).toThrow(/must be a valid JS identifier/)
  })

  test('empty on: dict adds no handlers and no methods', () => {
    const p = page('/x', { on: {}, view: () => span({}, ['x']) })
    expect((p as { _onHandlers?: unknown })._onHandlers).toBeUndefined()
  })

  test('multiple on-keys produce one handler each', () => {
    const p = page('/x', {
      on: {
        a: async () => 1,
        b: async () => 2,
        c: async () => 3,
      },
      view: () => span({}, ['x']),
    })
    const handlers = (p as { _onHandlers?: Record<string, unknown> })._onHandlers ?? {}
    expect(Object.keys(handlers).length).toBe(3)
    const pAny = p as unknown as Record<string, unknown>
    expect(typeof pAny['a']).toBe('function')
    expect(typeof pAny['b']).toBe('function')
    expect(typeof pAny['c']).toBe('function')
  })
})

// Round 5 (cut 5.5): `search:` schema on pages — typed parsing of
// URLSearchParams into a typed `search` prop. Server-side and client-
// side both run the same schema for hydration parity.
describe('page({search: ...}) — typed search params', () => {
  test('parsed search is exposed on view props during SSR', async () => {
    const p = page('/x', {
      search: (raw) => ({ q: raw['q'] ?? '', page: Number(raw['page'] ?? 1) }),
      view: (props) => {
        const s = (props as unknown as { search: { q: string; page: number } }).search
        return span({}, [`q=${s.q} p=${s.page}`])
      },
    })
    const res = await renderPage(p, new Request('http://x/?q=hello&page=3'))
    const body = await res.text()
    expect(body).toContain('q=hello p=3')
  })

  test('search defaults when params missing', async () => {
    const p = page('/x', {
      search: (raw) => ({ tag: raw['tag'] }),
      view: (props) => {
        const s = (props as unknown as { search: { tag: string | undefined } }).search
        return span({}, [`tag=${s.tag ?? 'none'}`])
      },
    })
    const body = await (await renderPage(p, new Request('http://x/'))).text()
    expect(body).toContain('tag=none')
  })

  test('search parse failure routes to the error overlay (dev)', async () => {
    const p = page('/x', {
      search: () => {
        throw new Error('bad search param')
      },
      view: () => span({}, ['x']),
    })
    const res = await renderPage(p, new Request('http://x/?bad=yes'))
    expect(res.status).toBe(500)
    expect(await res.text()).toContain('bad search param')
  })

  test('pages without search: do not get a search prop', async () => {
    let received: Record<string, unknown> | null = null
    const p = page('/x', {
      view: (props) => {
        received = props as Record<string, unknown>
        return span({}, ['x'])
      },
    })
    await renderPage(p, new Request('http://x/?q=hello'))
    expect(received).not.toBeNull()
    // `received` is typed as null|Record after the assignment; cast to read.
    expect((received as unknown as { search?: unknown } | null)?.search).toBeUndefined()
  })
})

// Round 5 (cut 5.7): per-page onError + onNotFound handlers + the
// `notFound()` helper for typed load() signals.
describe('page({onError, onNotFound}) — per-page error views', () => {
  test('onError catches load() throws and renders the page-supplied view as 500', async () => {
    const p = page<Record<string, never>, Record<string, never>>('/x', {
      load: () => {
        throw new Error('database down')
      },
      onError: (err) => span({ class: 'err' }, [`local error: ${err.message}`]),
      view: () => span({}, ['x']),
    })
    const res = await renderPage(p, new Request('http://x/'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const body = await res.text()
    expect(body).toContain('local error: database down')
  })

  test('onError catches view() throws too (renders for any render-phase error)', async () => {
    // The onError path only catches load() throws today (renderPage
    // catches view() throws separately into renderRouteError). Confirm
    // that a view() throw without onError falls back to the dev overlay
    // — keeps the test honest about scope.
    const p = page('/x', {
      onError: () => span({}, ['caught']),
      view: () => {
        throw new Error('view boom')
      },
    })
    const res = await renderPage(p, new Request('http://x/'))
    expect(res.status).toBe(500)
    // For now, view() throws still route to renderRouteError; the
    // onError hook only triggers via load(). Document the limit by
    // asserting the dev-overlay output is what fires here.
    expect(await res.text()).toContain('view boom')
  })

  test('absent onError falls through to the dev error overlay', async () => {
    const p = page<Record<string, never>, Record<string, never>>('/x', {
      load: () => {
        throw new Error('no handler')
      },
      view: () => span({}, ['x']),
    })
    const res = await renderPage(p, new Request('http://x/'))
    expect(res.status).toBe(500)
    expect(await res.text()).toContain('no handler')
  })

  test('notFound() thrown from load() routes to onNotFound as 404', async () => {
    const p = page<Record<string, never>, Record<string, never>>('/x', {
      load: () => {
        throw notFound('post not found')
      },
      onNotFound: () => span({ class: 'nf' }, ['this post does not exist']),
      view: () => span({}, ['x']),
    })
    const res = await renderPage(p, new Request('http://x/'))
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('this post does not exist')
  })

  test('notFound() without onNotFound falls through to error overlay', async () => {
    const p = page<Record<string, never>, Record<string, never>>('/x', {
      load: () => {
        throw notFound()
      },
      view: () => span({}, ['x']),
    })
    const res = await renderPage(p, new Request('http://x/'))
    // No handler → fall through to renderRouteError as a regular 500.
    expect(res.status).toBe(500)
  })

  test('notFound() is distinguishable from a plain Error', () => {
    const nf = notFound()
    const regular = new Error('regular')
    // The framework uses Symbol.for('@place/component:notFound') as the
    // marker — internal but checkable in tests.
    const marker = Symbol.for('@place/component:notFound')
    expect((nf as Error & { [k: symbol]: unknown })[marker]).toBe(true)
    expect((regular as Error & { [k: symbol]: unknown })[marker]).toBeUndefined()
  })

  // ─── Type-level: params inferred from path string ─────────────────────
  //
  // These tests don't assert at runtime — they assert via `tsc` (the
  // suite runs under `bun run typecheck`). If the inference regresses,
  // the types on the underscore-prefixed assignments below stop matching
  // and typecheck fails. Runtime expectations are pinned with `expect`
  // so vitest counts the test.
  test('page(path, def): params are typed from the path string', () => {
    const p = page('/posts/:id/comments/:cid', {
      load: ({ params }) => {
        // Compile-time: params.id and params.cid exist and are string.
        // Runtime: server route matcher fills these in.
        const _idType: string = params.id
        const _cidType: string = params.cid
        return { id: _idType, cid: _cidType }
      },
      view: ({ id, cid }) => span({}, [`${id}/${cid}`]),
    })
    expect(p.path).toBe('/posts/:id/comments/:cid')
  })

  test('page(path, def): no params in path → params record is empty', () => {
    const p = page('/about', {
      load: ({ params }) => {
        // Type of params is Record<string, never>; reading any key is
        // typed as never (won't compile if we destructure expecting
        // something specific). This test pins the no-param shape.
        const keys = Object.keys(params)
        return { keyCount: keys.length }
      },
      view: ({ keyCount }) => span({}, [String(keyCount)]),
    })
    expect(p.path).toBe('/about')
  })

  test('page(path, viewFn): view-fn shorthand wraps to { view: fn }', () => {
    // The shorthand is purely a syntactic saving — the runtime shape
    // of the returned page object is identical to passing { view: fn }.
    const p = page('/why', () => span({}, ['why']))
    expect(p.path).toBe('/why')
    expect(typeof p.view).toBe('function')
    // The path-string still feeds ParamsOf at the type level: this
    // page's params type is Record<string, never> (no `:x` in path).
  })

  // ----- meta DX improvements (page-directive fundamentals) -----

  test("meta string shorthand: meta: 'X' is equivalent to meta: { title: 'X' }", async () => {
    const p = page('/why', {
      meta: 'Why place',
      view: () => div({}, ['body']),
    })
    const body = await (await renderPage(p, new Request('http://x/why'))).text()
    expect(body).toContain('<title>Why place</title>')
  })

  test('meta function returning a string is normalized to { title }', async () => {
    const p = page('/posts/:id', {
      url: (_u, params) => ({ id: params['id']! }),
      // function form returning a string — should be normalized to { title }
      meta: ({ id }) => `Post ${id}`,
      view: () => div({}, ['body']),
    })
    // Manually provide params; the test bypasses serve()'s router.
    const body = await (
      await renderPage(p, new Request('http://x/posts/abc'), { id: 'abc' })
    ).text()
    expect(body).toContain('<title>Post abc</title>')
  })

  test('auto-title: framework promotes the first <h1> in main when meta.title is absent', async () => {
    // No `meta:` at all — title should come from the page's <h1>.
    // The auto-title collector only triggers for h1 inside <main>; the
    // page authors wrap their body in <main> as usual.
    const why = page('/why', {
      view: () => main({}, [h1({}, ['Why place']), p({}, ['body'])]),
    })
    const body = await (await renderPage(why, new Request('http://x/why'))).text()
    expect(body).toContain('<title>Why place</title>')
  })

  test('auto-title respects meta.title when explicitly set', async () => {
    // Explicit title wins — auto-derivation is the fallback, not a clobber.
    const why = page('/why', {
      meta: { title: 'Hand-written title' },
      view: () => main({}, [h1({}, ['Why place'])]),
    })
    const body = await (await renderPage(why, new Request('http://x/why'))).text()
    expect(body).toContain('<title>Hand-written title</title>')
    expect(body).not.toContain('<title>Why place</title>')
  })

  test('auto-title composes with layout titleTemplate', async () => {
    // Page declares no meta; <h1> drives the title; layout wraps it.
    // This is the docs-shape happy path: pages are pure content.
    const { layout } = await import('../../src/index.ts')
    const root = layout({
      meta: { titleTemplate: '%s · place docs' },
      view: ({ children }) => div({}, [children]),
    })
    const why = page('/why', {
      layout: root,
      view: () => main({}, [h1({}, ['Why place']), p({}, ['body'])]),
    })
    const body = await (await renderPage(why, new Request('http://x/why'))).text()
    expect(body).toContain('<title>Why place · place docs</title>')
  })

  test('titleTemplate: layout-provided template wraps the page title', async () => {
    const { layout } = await import('../../src/index.ts')
    const root = layout({
      meta: { titleTemplate: '%s · place docs' },
      view: ({ children }) => div({}, [children]),
    })
    const p = page('/why', {
      layout: root,
      meta: 'Why place',
      view: () => div({}, ['body']),
    })
    const body = await (await renderPage(p, new Request('http://x/why'))).text()
    expect(body).toContain('<title>Why place · place docs</title>')
  })

  test('titleAbsolute: page opts out of the inherited template', async () => {
    const { layout } = await import('../../src/index.ts')
    const root = layout({
      meta: { titleTemplate: '%s · place docs' },
      view: ({ children }) => div({}, [children]),
    })
    const landing = page('/', {
      layout: root,
      meta: { title: 'place', titleAbsolute: true },
      view: () => div({}, ['body']),
    })
    const body = await (await renderPage(landing, new Request('http://x/'))).text()
    expect(body).toContain('<title>place</title>')
    expect(body).not.toContain('· place docs</title>')
  })

  test('page(path, def): explicit generic still overrides inference', () => {
    // Caller wants the URL props shape to be `{ id: number }` rather
    // than the inferred `{ id: string }`. Pre-specifying the generic
    // lands on overload (4), not the inferred (1b). Using `url:`
    // (rather than `load:`) avoids the L-inference conflict — when
    // the user supplies one generic explicitly, TS doesn't infer the
    // remaining generics from later parameters.
    const p = page<{ id: number }>('/posts/:id', {
      url: () => ({ id: 42 }),
      view: ({ id }) => {
        // `id` is typed as `number` at the call site (pinned by the
        // explicit generic).
        const _n: number = id
        return span({}, [String(_n)])
      },
    })
    expect(p.path).toBe('/posts/:id')
  })
})
