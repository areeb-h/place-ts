// Dev error overlay preview — exercises the framework's `renderRouteError`
// pipeline against four representative error shapes (capability missing,
// type error, syntax error, not-found) so we can review the visual
// treatment side-by-side. Each route deliberately throws inside
// `view()`; the framework's overlay path produces the HTML that ships
// to the browser in dev. Production runs return a minimal text/plain
// 500 instead.
//
// Run via `bun examples/overlay-preview/src/server.ts` from the project
// root — pages live under cwd so their stack frames classify as "user"
// code, which is what triggers the inline source-window preview.

import { page, renderPage } from '@place-ts/component'

const capPage = page('/cap', {
  view: () => {
    throw new Error(
      "capability 'Router' not provided. Wrap your code in Router.provide(impl, () => …) or call Router.install(impl) (keeping the disposer alive), or check Router.tryUse() to handle the absence gracefully.",
    )
  },
})

const typeErrorPage = page('/type', {
  view: () => {
    const obj: { nested?: { value: string } } = {}
    // @ts-expect-error intentionally undefined access to surface a TypeError
    return obj.nested.value
  },
})

const syntaxErrorPage = page('/syntax', {
  view: () => {
    throw new SyntaxError('Unexpected token } at position 42 in /api/users.ts')
  },
})

const notFoundPage = page('/notfound', {
  view: () => {
    const e = new Error('note "untitled-draft-abc" not found in store')
    e.name = 'NotFoundError'
    throw e
  },
})

const ROUTES: Record<string, ReturnType<typeof page>> = {
  '/cap': capPage,
  '/type': typeErrorPage,
  '/syntax': syntaxErrorPage,
  '/notfound': notFoundPage,
}

const indexHtml = `<!doctype html><html><head><meta charset="utf-8"><title>place — dev overlay preview</title><meta name="color-scheme" content="light dark"><style>
:root{--bg:oklch(0.13 0.006 286);--fg:oklch(0.97 0.001 286);--mu:oklch(0.62 0.012 286);--card:oklch(0.18 0.006 286);--bd:oklch(0.27 0.006 286);--ac:oklch(0.78 0.16 65);}
@media (prefers-color-scheme:light){:root{--bg:oklch(0.985 0.002 286);--fg:oklch(0.18 0.008 286);--mu:oklch(0.48 0.014 286);--card:#fff;--bd:oklch(0.92 0.005 286);}}
*{box-sizing:border-box}body{margin:0;font:14px/1.6 system-ui,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
.wrap{max-width:680px;width:100%}
h1{font-size:24px;font-weight:600;letter-spacing:-.01em;margin:0 0 .25rem}
p.lede{color:var(--mu);margin:0 0 2rem;font-size:15px}
ul{list-style:none;padding:0;margin:0;display:grid;gap:.5rem}
a.tile{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;background:var(--card);border:1px solid var(--bd);border-radius:12px;color:var(--fg);text-decoration:none;transition:all .15s ease}
a.tile:hover{border-color:var(--ac);background:color-mix(in oklab,var(--ac) 8%,var(--card));transform:translateX(2px)}
.tile-l{display:flex;flex-direction:column;gap:.15rem}
.tile-n{font-weight:600}
.tile-d{font-size:12.5px;color:var(--mu)}
.tile-c{font:11px/1 ui-monospace,monospace;padding:3px 8px;border-radius:999px;border:1px solid var(--bd);color:var(--mu);text-transform:uppercase;letter-spacing:.05em}
.footer{margin-top:2rem;font-size:12px;color:var(--mu);text-align:center}
.footer code{font:11.5px ui-monospace,monospace;background:var(--card);padding:1px 5px;border-radius:3px;border:1px solid var(--bd)}
</style></head><body><div class="wrap">
<h1>place — dev overlay preview</h1>
<p class="lede">Each link below renders the new dev error overlay for a different error shape. Sticky strip, accented hero, in-line source preview with syntax highlighting, capability-aware "Try this" panel, light + dark themes (honors your OS setting).</p>
<ul>
<li><a class="tile" href="/cap"><span class="tile-l"><span class="tile-n">Capability missing</span><span class="tile-d">RouterCap not installed — overlay surfaces 3 concrete fixes</span></span><span class="tile-c">amber</span></a></li>
<li><a class="tile" href="/type"><span class="tile-l"><span class="tile-n">TypeError</span><span class="tile-d">Read property of undefined — generic runtime failure</span></span><span class="tile-c">red</span></a></li>
<li><a class="tile" href="/syntax"><span class="tile-l"><span class="tile-n">SyntaxError</span><span class="tile-d">Unexpected token — bundler-shaped failure</span></span><span class="tile-c">amber</span></a></li>
<li><a class="tile" href="/notfound"><span class="tile-l"><span class="tile-n">NotFoundError</span><span class="tile-d">Resource missing — quieter blue accent</span></span><span class="tile-c">blue</span></a></li>
</ul>
<p class="footer">Each route deliberately throws inside <code>view()</code>; the framework's <code>renderRouteError</code> path produces the HTML you see.</p>
</div></body></html>`

const port = Number(process.env.PORT ?? '5190')
Bun.serve({
  port,
  hostname: '0.0.0.0',
  fetch: async (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(indexHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    const p = ROUTES[url.pathname]
    if (p) {
      return renderPage(p as never, req, {})
    }
    return new Response('not found', { status: 404 })
  },
})
console.log(`overlay preview server: http://localhost:${port}`)
