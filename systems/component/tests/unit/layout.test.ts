// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { div, isLayout, layout, page, renderPage, span } from '../../src/index.ts'

const ssr = (p: Parameters<typeof renderPage>[0], url = 'http://x/'): Promise<string> =>
  renderPage(p, new Request(url)).then((r) => r.text())

describe('layout() — composable wrappers around pages', () => {
  test('isLayout(): typed brand check', () => {
    const l = layout({ view: ({ children }) => div({}, [children]) })
    expect(isLayout(l)).toBe(true)
    expect(isLayout({})).toBe(false)
    expect(isLayout(null)).toBe(false)
    expect(isLayout('layout')).toBe(false)
  })

  test('single layout wraps the page view', async () => {
    const root = layout({
      view: ({ children }) => div({ class: 'root' }, [children]),
    })
    const home = page({
      layout: root,
      view: () => span({ class: 'inner' }, ['hello']),
    })
    const html = await ssr(home)
    // Root wraps the inner span. (`data-h="N"` hydration markers ride
    // along on every framework-emitted element; we ignore them via the
    // class-based assertions.)
    expect(html).toContain('class="root"')
    expect(html).toContain('class="inner"')
    expect(html).toContain('hello')
    // Order: root before inner span.
    expect(html.indexOf('class="root"')).toBeLessThan(html.indexOf('class="inner"'))
  })

  test('multiple layouts compose outside-in (array order)', async () => {
    const outer = layout({
      view: ({ children }) => div({ class: 'outer' }, [children]),
    })
    const inner = layout({
      view: ({ children }) => div({ class: 'inner' }, [children]),
    })
    const home = page({
      // Array order = outermost first.
      layout: [outer, inner],
      view: () => span({ class: 'core' }, ['core']),
    })
    const html = await ssr(home)
    // Outer-most first in source order.
    const outerIdx = html.indexOf('class="outer"')
    const innerIdx = html.indexOf('class="inner"')
    const coreIdx = html.indexOf('class="core"')
    expect(outerIdx).toBeGreaterThan(-1)
    expect(innerIdx).toBeGreaterThan(outerIdx)
    expect(coreIdx).toBeGreaterThan(innerIdx)
  })

  test('layout load() data flows into both layout view and page view', async () => {
    interface UserData {
      user: { name: string }
    }
    const userLayout = layout<UserData>({
      load: () => ({ user: { name: 'alice' } }),
      view: ({ user, children }) =>
        div({ class: 'sidebar' }, [span({}, [`hi ${user.name}`]), children]),
    })
    const profile = page<Record<string, never>, UserData>({
      layout: userLayout,
      // The page also sees the layout-loaded `user` prop.
      view: ({ user }) => span({ class: 'profile' }, [`profile of ${user.name}`]),
    })
    const html = await ssr(profile)
    expect(html).toContain('hi alice')
    expect(html).toContain('profile of alice')
  })

  test("page.load() runs after layout.load() — page can override layout's keys", async () => {
    const root = layout<{ source: string }>({
      load: () => ({ source: 'layout' }),
      view: ({ children }) => div({}, [children]),
    })
    const home = page<Record<string, never>, { source: string }>({
      layout: root,
      load: () => ({ source: 'page' }),
      view: ({ source }) => span({}, [`source: ${source}`]),
    })
    const html = await ssr(home)
    // Page wins over layout for the `source` key.
    expect(html).toContain('source: page')
  })

  test('layout.meta merges with page.meta (page wins on title)', async () => {
    const root = layout({
      view: ({ children }) => div({}, [children]),
      meta: { title: 'layout title', description: 'layout desc' },
    })
    const home = page({
      layout: root,
      view: () => span({}, ['x']),
      meta: { title: 'page title' }, // overrides layout
    })
    const html = await ssr(home)
    // Page title wins.
    expect(html).toContain('<title>page title</title>')
    // Layout description survives (page didn't set one).
    expect(html).toContain('content="layout desc"')
  })

  test('htmlClass and bodyClass CONCATENATE across layout + page', async () => {
    const root = layout({
      view: ({ children }) => div({}, [children]),
      htmlClass: 'h-full',
      bodyClass: 'antialiased',
    })
    const home = page({
      layout: root,
      view: () => span({}, ['x']),
      htmlClass: 'dark',
      bodyClass: 'bg-bg text-fg',
    })
    const html = await ssr(home)
    // Both htmlClass values present, layout's first.
    expect(html).toContain('<html lang="en" class="h-full dark">')
    expect(html).toContain('<body class="antialiased bg-bg text-fg">')
  })

  test('layout styles emit BEFORE page styles (page can override)', async () => {
    const root = layout({
      view: ({ children }) => div({}, [children]),
      styles: { inline: '.from-layout {}' },
    })
    const home = page({
      layout: root,
      view: () => span({}, ['x']),
      styles: { inline: '.from-page {}' },
    })
    const html = await ssr(home)
    const layoutIdx = html.indexOf('.from-layout')
    const pageIdx = html.indexOf('.from-page')
    expect(layoutIdx).toBeGreaterThan(-1)
    expect(pageIdx).toBeGreaterThan(layoutIdx)
  })

  test('layout meta as a function receives merged props', async () => {
    interface UserData {
      user: { name: string }
    }
    const userLayout = layout<UserData>({
      load: () => ({ user: { name: 'bob' } }),
      view: ({ children }) => div({}, [children]),
      meta: ({ user }) => ({ title: `user: ${user.name}` }),
    })
    const profile = page<Record<string, never>, UserData>({
      layout: userLayout,
      view: () => span({}, ['x']),
    })
    const html = await ssr(profile)
    expect(html).toContain('<title>user: bob</title>')
  })

  test('keywords + extra arrays concatenate across layout + page', async () => {
    const root = layout({
      view: ({ children }) => div({}, [children]),
      meta: {
        keywords: ['layout-tag'],
        extra: [{ tag: 'meta', name: 'fromLayout', content: 'yes' }],
      },
    })
    const home = page({
      layout: root,
      view: () => span({}, ['x']),
      meta: {
        keywords: ['page-tag'],
        extra: [{ tag: 'meta', name: 'fromPage', content: 'yes' }],
      },
    })
    const html = await ssr(home)
    expect(html).toContain('content="layout-tag, page-tag"')
    expect(html).toContain('<meta name="fromLayout"')
    expect(html).toContain('<meta name="fromPage"')
  })

  test('layout.load() throwing routes through the dev error overlay', async () => {
    // Annotate load's return type so TS doesn't infer L as `never` from
    // the throw-only body — variance escape (same dance as dx-helpers).
    const broken = layout<Record<string, never>>({
      load: (): Record<string, never> => {
        throw new Error('layout load boom')
      },
      view: ({ children }) => div({}, [children]),
    })
    const home = page({
      layout: broken,
      view: () => span({}, ['x']),
    })
    const res = await renderPage(home, new Request('http://x/'))
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).toContain('layout load boom')
    expect(body).toContain('place / load threw')
  })

  test('no layout: existing pages keep working unchanged (back-compat)', async () => {
    const home = page({
      view: () => span({ class: 'plain' }, ['no layout here']),
      meta: { title: 'plain' },
    })
    const html = await ssr(home)
    expect(html).toContain('<title>plain</title>')
    expect(html).toContain('class="plain"')
  })

  test('extraLayouts (serve()-level default) prepends to the page chain', async () => {
    // Simulates what serve({ layout: rootLayout }) does: passes
    // extraLayouts via RenderPageOptions. The root wraps the page's
    // own layout (which wraps the page).
    const root = layout({
      view: ({ children }) => div({ class: 'root' }, [children]),
      htmlClass: 'h-full',
    })
    const userL = layout({
      view: ({ children }) => div({ class: 'user' }, [children]),
    })
    const home = page({
      layout: userL,
      view: () => span({ class: 'inner' }, ['x']),
      htmlClass: 'dark',
    })
    const res = await renderPage(
      home,
      new Request('http://x/'),
      {},
      {
        extraLayouts: [root],
      },
    )
    const html = await res.text()
    // Order: root → user → inner
    const rootIdx = html.indexOf('class="root"')
    const userIdx = html.indexOf('class="user"')
    const innerIdx = html.indexOf('class="inner"')
    expect(rootIdx).toBeGreaterThan(-1)
    expect(userIdx).toBeGreaterThan(rootIdx)
    expect(innerIdx).toBeGreaterThan(userIdx)
    // htmlClass concatenation includes both root and page values.
    expect(html).toContain('<html lang="en" class="h-full dark">')
  })

  test('extraLayouts: works when page has NO own layout', async () => {
    const root = layout({
      view: ({ children }) => div({ class: 'root' }, [children]),
    })
    const home = page({
      view: () => span({ class: 'inner' }, ['x']),
    })
    const res = await renderPage(
      home,
      new Request('http://x/'),
      {},
      {
        extraLayouts: [root],
      },
    )
    const html = await res.text()
    expect(html).toContain('class="root"')
    expect(html).toContain('class="inner"')
    expect(html.indexOf('class="root"')).toBeLessThan(html.indexOf('class="inner"'))
  })

  describe('typed named slots', () => {
    test('slots: filled by page, rendered by layout', async () => {
      const shell = layout<Record<string, never>, 'headerActions' | 'sidebar'>({
        view: ({ children, slots }) =>
          div({ class: 'shell' }, [
            div({ class: 'header' }, [slots('headerActions')]),
            div({ class: 'sidebar' }, [slots('sidebar')]),
            div({ class: 'main' }, [children]),
          ]),
      })
      const home = page({
        layout: shell,
        slots: {
          headerActions: () => span({ class: 'new-btn' }, ['New']),
          sidebar: () => span({ class: 'filters' }, ['Filters']),
        },
        view: () => span({ class: 'body' }, ['Hello']),
      })
      const html = await ssr(home)
      expect(html).toContain('class="new-btn"')
      expect(html).toContain('class="filters"')
      expect(html).toContain('class="body"')
      // Header content before sidebar before main body.
      expect(html.indexOf('class="new-btn"')).toBeLessThan(html.indexOf('class="filters"'))
      expect(html.indexOf('class="filters"')).toBeLessThan(html.indexOf('class="body"'))
    })

    test('slots.has(): false for unfilled, true for filled', async () => {
      const shell = layout<Record<string, never>, 'a' | 'b'>({
        view: ({ children, slots }) =>
          div({ class: 'shell' }, [
            slots.has('a') ? span({ class: 'has-a' }, [slots('a')]) : span({ class: 'no-a' }, []),
            slots.has('b') ? span({ class: 'has-b' }, [slots('b')]) : span({ class: 'no-b' }, []),
            children,
          ]),
      })
      const home = page({
        layout: shell,
        slots: { a: () => span({}, ['just-a']) },
        view: () => span({ class: 'body' }, ['x']),
      })
      const html = await ssr(home)
      expect(html).toContain('class="has-a"')
      expect(html).toContain('class="no-b"')
      expect(html).not.toContain('class="has-b"')
      expect(html).not.toContain('class="no-a"')
    })

    test('unfilled slot resolves to null (renders nothing)', async () => {
      const shell = layout<Record<string, never>, 'ghost'>({
        view: ({ children, slots }) =>
          div({ class: 'shell' }, [span({ class: 'before' }, [slots('ghost')]), children]),
      })
      const home = page({
        layout: shell,
        view: () => span({ class: 'body' }, ['x']),
      })
      const html = await ssr(home)
      // The `before` span renders, but its slot content is null/empty.
      expect(html).toContain('class="before"')
      // No "ghost" appears anywhere — the slot fill wasn't provided.
      expect(html).not.toContain('ghost')
    })

    test('slot fills survive across the whole layout chain', async () => {
      // The innermost layout reads the slot — the page's fills should
      // still reach it even when nested under outer layouts.
      const outer = layout({
        view: ({ children }) => div({ class: 'outer' }, [children]),
      })
      const inner = layout<Record<string, never>, 'aside'>({
        view: ({ children, slots }) =>
          div({ class: 'inner' }, [span({ class: 'aside' }, [slots('aside')]), children]),
      })
      const home = page({
        layout: [outer, inner],
        slots: { aside: () => span({ class: 'fill' }, ['I am inside']) },
        view: () => span({ class: 'body' }, ['x']),
      })
      const html = await ssr(home)
      expect(html).toContain('class="outer"')
      expect(html).toContain('class="inner"')
      expect(html).toContain('class="fill"')
      // Order outer → inner → aside fill → body.
      expect(html.indexOf('class="outer"')).toBeLessThan(html.indexOf('class="inner"'))
      expect(html.indexOf('class="inner"')).toBeLessThan(html.indexOf('class="fill"'))
      expect(html.indexOf('class="fill"')).toBeLessThan(html.indexOf('class="body"'))
    })
  })
})
