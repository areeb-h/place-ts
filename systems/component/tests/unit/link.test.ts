// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { hashRouter } from '../../../routing/src/index.ts'
import { Link, mount, renderToString, withCapability } from '../../src/index.ts'

// `Link` reads RouterCap to build href + click handler. Tests exercise
// SSR (renderToString) + DOM (mount) paths.

describe('Link — typed JSX client-navigation helper', () => {
  test('renders <a> with the router-flavored href', () => {
    const router = hashRouter()
    const html = renderToString(
      withCapability(router.capability, router.impl, Link({ to: '/about', children: 'About' })),
    )
    // hashRouter prepends '#' for href.
    expect(html).toContain('<a')
    expect(html).toContain('href="#/about"')
    expect(html).toContain('>About</a>')
  })

  test('static class is applied; activeClass not applied when not on this route', () => {
    const router = hashRouter()
    const view = withCapability(
      router.capability,
      router.impl,
      Link({ to: '/about', class: 'btn', activeClass: 'is-active', children: 'About' }),
    )
    const html = renderToString(view)
    // Class includes the static 'btn' but not the activeClass when off-route.
    // (cls() strips empty strings, so the output is just "btn".)
    expect(html).toContain('class="btn"')
    expect(html).not.toContain('is-active')
  })

  test('aria-current is "page" when the link points at the active route', () => {
    const router = hashRouter()
    // hashRouter starts at '/'. Linking to '/' should be active.
    const view = withCapability(router.capability, router.impl, Link({ to: '/', children: 'Home' }))
    const html = renderToString(view)
    expect(html).toContain('aria-current="page"')
  })

  test('off-route link omits aria-current', () => {
    const router = hashRouter()
    const view = withCapability(
      router.capability,
      router.impl,
      Link({ to: '/somewhere-else', children: 'Else' }),
    )
    const html = renderToString(view)
    expect(html).not.toContain('aria-current="page"')
  })

  test('passes title and aria-label through', () => {
    const router = hashRouter()
    const html = renderToString(
      withCapability(
        router.capability,
        router.impl,
        Link({ to: '/x', title: 'Tooltip', 'aria-label': 'A11y', children: 'X' }),
      ),
    )
    expect(html).toContain('title="Tooltip"')
    expect(html).toContain('aria-label="A11y"')
  })

  test('mount(): clicking the link navigates the router (not a hard reload)', () => {
    const router = hashRouter()
    const root = document.createElement('div')
    document.body.appendChild(root)
    try {
      const dispose = mount(Link({ to: '/notes/abc', children: 'Open' }), root, {
        provide: [router],
      })
      const a = root.querySelector('a') as HTMLAnchorElement
      expect(a).not.toBeNull()
      expect(a.getAttribute('href')).toBe('#/notes/abc')
      // Simulate a plain click (no modifiers); router should navigate.
      a.click()
      expect(router.path()).toBe('/notes/abc')
      dispose()
    } finally {
      root.remove()
    }
  })

  test('prefetch: emits data-prefetch="true" attr', () => {
    const router = hashRouter()
    const html = renderToString(
      withCapability(
        router.capability,
        router.impl,
        Link({ to: '/x', prefetch: true, children: 'X' }),
      ),
    )
    expect(html).toContain('data-prefetch="true"')
  })

  test('external https:// URL bypasses router (no aria-current, no onClick router-prefix)', () => {
    // No router provided — proves the link doesn't even try to call
    // `RouterCap.use()` for external URLs.
    const html = renderToString(Link({ to: 'https://example.com/docs', children: 'Docs' }))
    expect(html).toContain('href="https://example.com/docs"')
    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('#https://')
  })

  test('mailto: bypasses router', () => {
    const html = renderToString(Link({ to: 'mailto:hi@x.com', children: 'Email' }))
    expect(html).toContain('href="mailto:hi@x.com"')
  })

  test('tel: bypasses router', () => {
    const html = renderToString(Link({ to: 'tel:+1234567890', children: 'Call' }))
    expect(html).toContain('href="tel:+1234567890"')
  })

  test('protocol-relative // URL bypasses router', () => {
    const html = renderToString(Link({ to: '//cdn.example.com/x.js', children: 'CDN' }))
    expect(html).toContain('href="//cdn.example.com/x.js"')
  })

  test('fragment-only #section bypasses router (in-page anchor)', () => {
    const html = renderToString(Link({ to: '#section-2', children: 'Section' }))
    expect(html).toContain('href="#section-2"')
  })

  test('target="_blank" auto-adds rel="noopener noreferrer" + bypasses router', () => {
    const router = hashRouter()
    // Even an internal /path goes external when target=_blank.
    const html = renderToString(
      withCapability(
        router.capability,
        router.impl,
        Link({ to: '/x', target: '_blank', children: 'X' }),
      ),
    )
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    // No router routing — plain anchor.
    expect(html).not.toContain('aria-current')
  })

  test('explicit rel overrides the auto-added _blank rel', () => {
    const html = renderToString(
      Link({ to: 'https://example.com', target: '_blank', rel: 'opener', children: 'X' }),
    )
    expect(html).toContain('rel="opener"')
    expect(html).not.toContain('noopener noreferrer')
  })

  test('SSR shell — no RouterCap installed — falls back to plain anchor with href', () => {
    // The flagship use case: server-side renders of pages whose routing
    // is owned by `app([pages]).serve()` (not a client-side RouterCap).
    // Internal `<Link>` must emit a working <a href> with no onClick /
    // aria-current, since neither is meaningful before hydration. The
    // client-side Link re-mounts with the real router on hydrate.
    const html = renderToString(Link({ to: '/about', class: 'btn', children: 'About' }))
    expect(html).toContain('<a')
    expect(html).toContain('href="/about"')
    expect(html).toContain('class="btn"')
    expect(html).toContain('>About</a>')
    // No router-only attributes leak into the shell render.
    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('onclick')
  })

  test('SSR shell — internal Link without router still passes prefetch + title attrs', () => {
    const html = renderToString(
      Link({ to: '/notes/abc', prefetch: true, title: 'Open note', children: 'abc' }),
    )
    expect(html).toContain('href="/notes/abc"')
    expect(html).toContain('data-prefetch="true"')
    expect(html).toContain('title="Open note"')
  })
})
