// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { div, page, renderPage, span, themeTokens } from '../../src/index.ts'

// Page meta + styles render to the document <head>. Tests round-trip
// via renderPage and assert on the response body — covers HTML escape,
// dynamic meta (fn vs value), Open Graph, Twitter, icons, extras, and
// styles (link href / inline / array).

const ssr = (p: Parameters<typeof renderPage>[0]): Promise<string> =>
  renderPage(p, new Request('http://x/?name=alice')).then((r) => r.text())

describe('page().meta — typed document <head>', () => {
  test('title + description + lang render', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: { title: 'Home', description: 'A demo', lang: 'es' },
      }),
    )
    expect(body).toContain('<title>Home</title>')
    expect(body).toContain('<meta name="description" content="A demo">')
    expect(body).toContain('<html lang="es">')
  })

  test('escapes title and meta content (XSS safety)', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: { title: '<script>x</script>', description: '"hi" & bye' },
      }),
    )
    expect(body).not.toContain('<script>x</script>')
    expect(body).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(body).toContain('content="&quot;hi&quot; &amp; bye"')
  })

  test('Open Graph fields emit <meta property="og:*">', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: {
          og: {
            title: 'OG Title',
            image: '/cover.png',
            type: 'website',
            siteName: 'My Site',
          },
        },
      }),
    )
    expect(body).toContain('<meta property="og:title" content="OG Title">')
    expect(body).toContain('<meta property="og:image" content="/cover.png">')
    expect(body).toContain('<meta property="og:type" content="website">')
    expect(body).toContain('<meta property="og:siteName" content="My Site">')
  })

  test('Twitter fields emit <meta name="twitter:*">', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: {
          twitter: { card: 'summary_large_image', site: '@me', creator: '@me' },
        },
      }),
    )
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(body).toContain('<meta name="twitter:site" content="@me">')
  })

  test('icon shorthand string emits <link rel="icon">', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: { icon: '/favicon.ico' },
      }),
    )
    expect(body).toContain('<link rel="icon" href="/favicon.ico">')
  })

  test('icon object form emits type and sizes', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: { icon: { href: '/icon-32.png', type: 'image/png', sizes: '32x32' } },
      }),
    )
    expect(body).toContain('<link rel="icon" href="/icon-32.png" type="image/png" sizes="32x32">')
  })

  test('robots, canonical, theme-color, color-scheme', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: {
          robots: 'noindex, nofollow',
          canonical: 'https://example.com/',
          themeColor: '#fff',
          colorScheme: 'light dark',
        },
      }),
    )
    expect(body).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(body).toContain('<link rel="canonical" href="https://example.com/">')
    expect(body).toContain('<meta name="theme-color" content="#fff">')
    expect(body).toContain('<meta name="color-scheme" content="light dark">')
  })

  test('keywords array joins with comma', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: { keywords: ['ssr', 'hydration', 'place'] },
      }),
    )
    expect(body).toContain('<meta name="keywords" content="ssr, hydration, place">')
  })

  test('extra entries: link + meta + script + style', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: {
          extra: [
            { tag: 'link', rel: 'preconnect', href: 'https://cdn.example' },
            { tag: 'meta', httpEquiv: 'X-UA-Compatible', content: 'IE=edge' },
            { tag: 'script', src: '/analytics.js', async: true },
            { tag: 'style', inline: 'h1{color:red}' },
          ],
        },
      }),
    )
    expect(body).toContain('<link rel="preconnect" href="https://cdn.example">')
    expect(body).toContain('<meta http-equiv="X-UA-Compatible" content="IE=edge">')
    expect(body).toContain('<script src="/analytics.js" async></script>')
    expect(body).toContain('<style>h1{color:red}</style>')
  })

  test('dynamic meta — function receives merged props', async () => {
    const body = await ssr(
      page({
        url: (u) => ({ name: u.searchParams.get('name') ?? 'guest' }),
        load: () => ({ post: 'My Post' }),
        view: ({ name, post }) => span({}, [`${name} ${post}`]),
        meta: ({ name, post }) => ({
          title: `${post} — by ${name}`,
          og: { title: post, description: `Post by ${name}` },
        }),
      }),
    )
    expect(body).toContain('<title>My Post — by alice</title>')
    expect(body).toContain('<meta property="og:title" content="My Post">')
    expect(body).toContain('<meta property="og:description" content="Post by alice">')
  })

  test('htmlClass + bodyClass attach class attrs to <html> / <body>', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: {
          htmlClass: 'h-full dark',
          bodyClass: 'bg-zinc-950 text-zinc-100 font-sans antialiased',
        },
      }),
    )
    // Both attrs ride on the root element open tags.
    expect(body).toContain('<html lang="en" class="h-full dark">')
    expect(body).toContain('<body class="bg-zinc-950 text-zinc-100 font-sans antialiased">')
  })

  test('htmlClass / bodyClass are escaped (XSS safety)', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: { bodyClass: 'safe" onload=alert(1) "' },
      }),
    )
    // Quote escaped → no early closure of class="..." attribute.
    expect(body).toContain('class="safe&quot; onload=alert(1) &quot;"')
    expect(body).not.toContain('class="safe"')
  })

  test('renderPage option `htmlClassPrefix` prepends a class onto <html>', async () => {
    const body = await renderPage(
      page({ view: () => div({}, ['x']), meta: { htmlClass: 'h-full' } }),
      new Request('http://x/'),
      {},
      { htmlClassPrefix: 'theme-dark' },
    ).then((r) => r.text())
    // Prefix lands first; user class follows.
    expect(body).toContain('<html lang="en" class="theme-dark h-full">')
  })

  test('htmlClassPrefix works when meta has no htmlClass of its own', async () => {
    const body = await renderPage(
      page({ view: () => div({}, ['x']), meta: { title: 'h' } }),
      new Request('http://x/'),
      {},
      { htmlClassPrefix: 'theme-light' },
    ).then((r) => r.text())
    expect(body).toContain('<html lang="en" class="theme-light">')
  })

  test('htmlClassPrefix integrates with themeTokens — server-side theme selection', async () => {
    const tokens = themeTokens({
      default: 'dark',
      themes: {
        dark: { '--color-bg': 'oklch(0.14 0 0)' },
        light: { '--color-bg': 'oklch(1 0 0)' },
      },
    })
    // Simulating what serve() does: read theme from request, compute
    // class, prepend.
    const themeClass = tokens.htmlClass('light')
    const body = await renderPage(
      page({ view: () => div({}, ['x']), meta: { htmlClass: 'h-full' } }),
      new Request('http://x/'),
      {},
      { htmlClassPrefix: themeClass },
    ).then((r) => r.text())
    expect(body).toContain('<html lang="en" class="theme-light h-full">')
  })

  test('omitted htmlClass / bodyClass produce no class attr at all', async () => {
    const body = await ssr(page({ view: () => div({}, ['x']), meta: {} }))
    // Bare tags, no stray class="" attrs.
    expect(body).toContain('<html lang="en"><head>')
    expect(body).toMatch(/<body>(?!.*class=)/)
  })

  test('charset and viewport are configurable', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        meta: { charset: 'iso-8859-1', viewport: 'width=320' },
      }),
    )
    expect(body).toContain('<meta charset="iso-8859-1">')
    expect(body).toContain('<meta name="viewport" content="width=320">')
  })
})

describe('page().styles — stylesheet sources', () => {
  test('string href emits <link rel="stylesheet">', async () => {
    const body = await ssr(page({ view: () => div({}, ['x']), styles: '/css/app.css' }))
    expect(body).toContain('<link rel="stylesheet" href="/css/app.css">')
  })

  test('inline source emits <style>', async () => {
    const body = await ssr(
      page({ view: () => div({}, ['x']), styles: { inline: 'body{margin:0}' } }),
    )
    expect(body).toContain('<style>body{margin:0}</style>')
  })

  test('array of mixed sources renders in order', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        styles: ['/css/reset.css', { inline: '.crit{color:red}' }, '/css/main.css'],
      }),
    )
    const reset = body.indexOf('<link rel="stylesheet" href="/css/reset.css">')
    const inline = body.indexOf('<style>.crit{color:red}</style>')
    const main = body.indexOf('<link rel="stylesheet" href="/css/main.css">')
    expect(reset).toBeGreaterThan(-1)
    expect(inline).toBeGreaterThan(reset)
    expect(main).toBeGreaterThan(inline)
  })

  test('inline with media attribute', async () => {
    const body = await ssr(
      page({
        view: () => div({}, ['x']),
        styles: { inline: 'body{}', media: 'print' },
      }),
    )
    expect(body).toContain('<style media="print">body{}</style>')
  })
})
