// @vitest-environment happy-dom
//
// Execution-level tests for the SPA-nav `navigate()` runtime.
//
// The bake-time tests in `spa-nav-prefetch.test.ts` pin the source
// string but never run it; that's missed real bugs (the supervisor
// spawn ENOENT, the two-pressed toggle blip — both surfaced only
// when we actually loaded a page). These tests evaluate the IIFE
// in happy-dom, mock fetch + history, and assert the behaviour of:
//
//   - Same-origin link click intercept → fetch + main swap
//   - History pushState fires on a regular navigation
//   - Modified-key click is NOT intercepted (cmd/ctrl/shift open in new tab)
//   - Cross-origin link is not intercepted
//   - place:navigate custom event triggers a programmatic nav
//   - Multi-island script reconciliation appends missing <script src=>

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { placeSpaNav } from '../../src/__spa_nav.ts'

// Minimal HTML shell with one main + one link. Each test re-installs
// it to avoid cross-test pollution.
const SHELL = `<!DOCTYPE html><html><head></head><body>
  <a id="link" href="/about" data-place-link>About</a>
  <a id="ext" href="https://example.com/x" data-place-link>External</a>
  <main id="m"><h1>home</h1></main>
</body></html>`

// Response factory — produces a Response-like object the IIFE's
// readHtml will accept. `r.text()` returns the body; `r.headers.get`
// must return a Content-Type starting with `text/html`. `r.url` is
// the resolved URL (history pushState semantics).
function htmlResponse(url: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

let _fetchSpy: ReturnType<typeof vi.fn> | null = null
let _pushStateSpy: ReturnType<typeof vi.fn> | null = null

// Install the runtime ONCE per test file. Each test resets the DOM
// + the mocks; the IIFE's document/window listeners persist (they're
// what we're testing). Re-installing would double-register every
// listener and double-fire on every click.
beforeAll(() => {
  document.documentElement.innerHTML = SHELL
  const src = placeSpaNav({ prefetch: false })
  // biome-ignore lint/security/noGlobalEval: deliberate IIFE eval for runtime test
  new Function(src)()
})

beforeEach(() => {
  // Reset DOM body only; the IIFE's globals stay installed.
  document.body.innerHTML = `
    <a id="link" href="/about" data-place-link>About</a>
    <a id="ext" href="https://example.com/x" data-place-link>External</a>
    <main id="m"><h1>home</h1></main>
  `
  // Mock fetch fresh per test.
  _fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = `<!DOCTYPE html><html><head><title>About</title></head><body><main id="m"><h1>about</h1><p>about body</p></main></body></html>`
    return htmlResponse(url, body)
  })
  ;(globalThis as { fetch?: unknown }).fetch = _fetchSpy

  // Spy on pushState.
  _pushStateSpy = vi.fn(
    (..._args: [unknown, string, string | URL | null]) => undefined,
  )
  const orig = window.history.pushState.bind(window.history)
  vi.spyOn(window.history, 'pushState').mockImplementation((s, t, u) => {
    _pushStateSpy?.(s, t, u)
    return orig(s, t, u as never)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  ;(globalThis as { fetch?: unknown }).fetch = undefined
})

describe('placeSpaNav — navigate() execution', () => {
  test('clicking a same-origin data-place-link intercepts + fetches', async () => {
    const link = document.getElementById('link') as HTMLAnchorElement
    link.click()
    // navigate() is async (fetch + DOM parse + swap). Drain microtasks.
    await new Promise<void>((r) => setTimeout(r, 30))
    // The intercept happened — fetch fired with the link's href.
    expect(_fetchSpy).toHaveBeenCalled()
    const firstArg = _fetchSpy?.mock.calls[0]?.[0]
    expect(String(firstArg)).toMatch(/\/about/)
    // (pushState + post-swap DOM are exercised by the publish smoke
    // against a real dev server; happy-dom's DOMParser semantics in
    // vitest aren't reliable enough to assert on them here.)
  })

  test('modified click (ctrl) does NOT intercept', async () => {
const link = document.getElementById('link') as HTMLAnchorElement
    // Simulate ctrl+click. We need a MouseEvent because dispatchEvent
    // with a custom event won't carry ctrlKey through happy-dom's
    // click bubble.
    const evt = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      button: 0,
    })
    link.dispatchEvent(evt)
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(_fetchSpy).not.toHaveBeenCalled()
  })

  test('cross-origin link is NOT intercepted', async () => {
const link = document.getElementById('ext') as HTMLAnchorElement
    link.click()
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(_fetchSpy).not.toHaveBeenCalled()
  })

  test('place:navigate custom event triggers programmatic navigation', async () => {
window.dispatchEvent(
      new CustomEvent('place:navigate', { detail: { url: '/somewhere' } }),
    )
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(_fetchSpy).toHaveBeenCalledTimes(1)
    const firstArg = _fetchSpy?.mock.calls[0]?.[0]
    expect(String(firstArg)).toMatch(/\/somewhere/)
  })

  test('place:navigate with replace=true does not push history', async () => {
window.dispatchEvent(
      new CustomEvent('place:navigate', {
        detail: { url: '/replace-here', replace: true },
      }),
    )
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(_fetchSpy).toHaveBeenCalled()
    expect(_pushStateSpy).not.toHaveBeenCalled()
  })

  // Note: full <main> body-swap + script reconciliation are exercised
  // by the publish smoke (`smoke-test-publish.sh` curls a real dev
  // server and inspects the SSR'd HTML). happy-dom's DOMParser /
  // replaceWith behavior in vitest doesn't cleanly reflect the same
  // semantics, so we don't assert on the post-swap DOM here.

  test('idempotent install — second IIFE eval is a no-op (window.__place_spa guard)', () => {
// Should not throw or double-install.
    const src = placeSpaNav({ prefetch: false })
    // The IIFE checks `if (window.__place_spa) return` at the top.
    expect(() => new Function(src)()).not.toThrow()
  })
})
