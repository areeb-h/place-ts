// @vitest-environment happy-dom
//
// Tests for the HMR runtime (`__hmr.ts`, ADR 0028 phase 2).
//
// `placeHmr()` returns an inline-JS source string that runs on every
// dev page. The source: (a) opens a WebSocket to `/__place_hmr`,
// (b) parses incoming messages as typed envelopes, (c) per-island
// hot-swaps via `window.__placeIslandRegistry[name].disposeAll()` +
// fresh `<script type="module">` injection, (d) falls back to
// `location.reload()` on any failure or unknown message.
//
// We execute the source in happy-dom with a mocked WebSocket and a
// faked `location.reload`, then exercise the handler via the
// onmessage path the runtime installs. The test reaches into the
// runtime via globals it sets on `window`, mirroring the contract
// the framework relies on.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HMR_WS_PATH, placeHmr } from '../../src/__hmr.ts'

type FakeWS = {
  onopen: ((ev: Event) => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onclose: ((ev: CloseEvent) => void) | null
  onerror: ((ev: Event) => void) | null
  close: () => void
  send: (data: string) => void
}

declare global {
  interface Window {
    __placeHmr?: number
    // biome-ignore lint/suspicious/noExplicitAny: test harness reaches into the registry
    __placeIslandRegistry?: Record<string, any>
  }
}

describe('placeHmr() — typed-envelope HMR client', () => {
  let lastWs: FakeWS | null = null
  let reloadCount = 0
  const originalReload = window.location.reload
  const originalWS = (globalThis as { WebSocket?: unknown }).WebSocket

  beforeEach(() => {
    // Reset window-level flags the runtime sets.
    delete (window as Window).__placeHmr
    delete (window as Window).__placeIslandRegistry
    reloadCount = 0
    lastWs = null
    // happy-dom's `location.reload` is a real function we replace.
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: () => {
        reloadCount++
      },
    })
    // Replace WebSocket with a manually-controllable fake.
    ;(globalThis as { WebSocket?: unknown }).WebSocket = function (this: FakeWS, _url: string) {
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      this.close = () => {}
      this.send = () => {}
      lastWs = this
    } as unknown as typeof WebSocket
    // Clear any leftover injected script tags from previous tests.
    document.querySelectorAll('script[data-place-island]').forEach((s) => {
      s.remove()
    })
  })

  afterEach(() => {
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: originalReload,
    })
    ;(globalThis as { WebSocket?: unknown }).WebSocket = originalWS
    vi.useRealTimers()
  })

  /** Boot the runtime against happy-dom + the WS fake. */
  function boot(): FakeWS {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(placeHmr())()
    if (!lastWs) throw new Error('runtime did not construct WebSocket')
    return lastWs
  }

  test('opens a WS connection to the expected path', () => {
    const captured: string[] = []
    ;(globalThis as { WebSocket?: unknown }).WebSocket = function (this: FakeWS, url: string) {
      captured.push(url)
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      this.close = () => {}
      this.send = () => {}
      lastWs = this
    } as unknown as typeof WebSocket
    boot()
    expect(captured[0]).toMatch(new RegExp(`${HMR_WS_PATH}$`))
  })

  test('idempotent: second call is a no-op (window.__placeHmr guards)', () => {
    let ctorCount = 0
    ;(globalThis as { WebSocket?: unknown }).WebSocket = function (this: FakeWS, _url: string) {
      ctorCount++
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      this.close = () => {}
      this.send = () => {}
      lastWs = this
    } as unknown as typeof WebSocket
    new Function(placeHmr())()
    new Function(placeHmr())()
    expect(ctorCount).toBe(1)
  })

  test('legacy bare string `"reload"` triggers location.reload()', () => {
    const ws = boot()
    ws.onmessage?.({ data: 'reload' })
    expect(reloadCount).toBe(1)
  })

  test('`{ t: "reload" }` envelope triggers location.reload()', () => {
    const ws = boot()
    ws.onmessage?.({ data: JSON.stringify({ t: 'reload' }) })
    expect(reloadCount).toBe(1)
  })

  test('unknown envelope is ignored (no reload, no throw)', () => {
    const ws = boot()
    expect(() => ws.onmessage?.({ data: JSON.stringify({ t: 'mystery' }) })).not.toThrow()
    expect(reloadCount).toBe(0)
  })

  test('malformed JSON is ignored (no reload, no throw)', () => {
    const ws = boot()
    expect(() => ws.onmessage?.({ data: '{not-json' })).not.toThrow()
    expect(reloadCount).toBe(0)
  })

  test('swap with no matching registry entry falls back to reload', () => {
    const ws = boot()
    ws.onmessage?.({
      data: JSON.stringify({
        t: 'swap',
        updates: [{ name: 'unknownIsland', url: '/islands/x.js', integrity: null }],
      }),
    })
    expect(reloadCount).toBe(1)
  })

  test('swap with valid registry entry calls disposeAll() + injects fresh <script>', () => {
    const disposeSpy = vi.fn()
    ;(window as Window).__placeIslandRegistry = {
      counter: {
        markers: new Set(),
        disposers: new WeakMap(),
        disposeAll: disposeSpy,
      },
    }
    const ws = boot()
    ws.onmessage?.({
      data: JSON.stringify({
        t: 'swap',
        updates: [
          {
            name: 'counter',
            url: '/islands/counter-abc12345.js',
            // Raw base64 — matches the wire format. The runtime
            // prepends `sha384-` when assembling the script tag.
            integrity: 'deadbeef',
          },
        ],
      }),
    })
    // No reload — successful swap.
    expect(reloadCount).toBe(0)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    // Fresh script tag was injected.
    const injected = document.querySelector(
      'script[data-place-island="counter"]',
    ) as HTMLScriptElement | null
    expect(injected).not.toBeNull()
    expect(injected?.src).toContain('/islands/counter-abc12345.js')
    expect(injected?.type).toBe('module')
    // The wire ships the raw base64 digest; the HMR runtime prepends
    // the `sha384-` algorithm prefix so the browser accepts the SRI
    // hash. Without this prefix the browser silently refuses to load
    // the script and the swap wedges — the regression this asserts.
    expect(injected?.integrity).toBe('sha384-deadbeef')
    expect(injected?.crossOrigin).toBe('anonymous')
  })

  test('swap with disposeAll() throwing falls back to reload', () => {
    ;(window as Window).__placeIslandRegistry = {
      counter: {
        markers: new Set(),
        disposers: new WeakMap(),
        disposeAll: () => {
          throw new Error('boom')
        },
      },
    }
    const ws = boot()
    ws.onmessage?.({
      data: JSON.stringify({
        t: 'swap',
        updates: [{ name: 'counter', url: '/islands/x.js', integrity: null }],
      }),
    })
    expect(reloadCount).toBe(1)
    // No fresh script was injected (failure happened mid-apply).
    const injected = document.querySelector('script[data-place-island="counter"]')
    expect(injected).toBeNull()
  })

  test('swap with empty updates array falls back to reload', () => {
    const ws = boot()
    ws.onmessage?.({ data: JSON.stringify({ t: 'swap', updates: [] }) })
    expect(reloadCount).toBe(1)
  })

  test('onopen never triggers refresh; soft-refresh fires only on a changed boot id', () => {
    // The HMR client soft-refreshes on a genuine server restart —
    // detected by a changed `boot` id in the `hello` envelope — never
    // on a bare reconnect. A flaky socket can reconnect freely without
    // looping. (Pre-0.4.0 this called location.reload(); 0.4.0+ calls
    // softRefresh() which fetches the current URL and replaces <main>.)
    try {
      sessionStorage.removeItem('__place_boot')
    } catch {
      // sessionStorage unavailable — the runtime degrades; test n/a.
    }
    // Stub fetch so softRefresh() doesn't crash; capture call count.
    let fetchCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      fetchCalls++
      // Return a never-resolving promise — we only care that fetch
      // was invoked, not what it does next. The runtime catches
      // rejections, so this is safe.
      return new Promise(() => {})
    }) as unknown as typeof fetch

    try {
      const ws = boot()
      // Opening the socket is not a refresh trigger.
      ws.onopen?.(new Event('open'))
      expect(fetchCalls).toBe(0)
      expect(reloadCount).toBe(0)
      // First `hello`: record the boot id, no refresh.
      ws.onmessage?.({ data: JSON.stringify({ t: 'hello', boot: 'srv-A' }) })
      expect(fetchCalls).toBe(0)
      // Reconnect to the SAME server (same boot id): no refresh.
      ws.onmessage?.({ data: JSON.stringify({ t: 'hello', boot: 'srv-A' }) })
      expect(fetchCalls).toBe(0)
      // A CHANGED boot id means the server restarted → soft refresh
      // (one fetch of the current URL). Full location.reload() does
      // NOT happen on this path anymore.
      ws.onmessage?.({ data: JSON.stringify({ t: 'hello', boot: 'srv-B' }) })
      expect(fetchCalls).toBe(1)
      expect(reloadCount).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('swap of multiple islands injects one <script> per update', () => {
    const dispA = vi.fn()
    const dispB = vi.fn()
    ;(window as Window).__placeIslandRegistry = {
      a: { markers: new Set(), disposers: new WeakMap(), disposeAll: dispA },
      b: { markers: new Set(), disposers: new WeakMap(), disposeAll: dispB },
    }
    const ws = boot()
    ws.onmessage?.({
      data: JSON.stringify({
        t: 'swap',
        updates: [
          { name: 'a', url: '/islands/a-1.js', integrity: null },
          { name: 'b', url: '/islands/b-2.js', integrity: null },
        ],
      }),
    })
    expect(reloadCount).toBe(0)
    expect(dispA).toHaveBeenCalledTimes(1)
    expect(dispB).toHaveBeenCalledTimes(1)
    expect(document.querySelector('script[data-place-island="a"]')).not.toBeNull()
    expect(document.querySelector('script[data-place-island="b"]')).not.toBeNull()
  })
})
