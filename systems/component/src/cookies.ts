// `cookie(name)` — universal cookie read.
//
// Components reading user preference (theme choice, sidebar state,
// dismissed banners, etc.) need the SAME value on the SSR render and
// on the post-hydration client render. Otherwise the first paint flips
// when JS executes — the "blip" on hard refresh.
//
// `cookie(name)` is the SSR-aware sibling of `document.cookie`:
//   - On the server, `renderPage()` installs `_CookieJarCap` with the
//     parsed request cookies; this helper reads from it.
//   - On the client, it parses `document.cookie` directly.
//
// Both paths return the same value for the same request, so a
// component using `cookie('place-theme-choice')` for its initial state
// produces matching HTML on both runtimes — no flip on hydration.

import { defineCapability } from '@place-ts/capability'
import { type State, state, watch } from '@place-ts/reactivity'

/** Internal: holds the parsed cookies for the in-flight SSR request. */
export const _CookieJarCap = defineCapability<ReadonlyMap<string, string>>('CookieJar')

/**
 * Parse a `Cookie` header value into a `name -> value` map. Values are
 * URL-decoded (matching the encoding `document.cookie` and
 * `themeCookieHeader` apply on writes). Empty cookie or malformed
 * fragments are silently skipped.
 *
 * Public so apps that already have a parsed request can build the same
 * map for tests or non-HTTP contexts.
 */
export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    if (!k) continue
    const raw = part.slice(eq + 1).trim()
    try {
      out.set(k, decodeURIComponent(raw))
    } catch {
      // Malformed percent-encoding — fall back to the raw bytes so a
      // garbled cookie is still readable rather than disappearing.
      out.set(k, raw)
    }
  }
  return out
}

/**
 * Read a cookie value, isomorphic between SSR and the browser. Returns
 * `null` when the cookie isn't set (both on the server and the client),
 * so components can use `cookie('x') ?? 'default'` for initial state
 * and produce IDENTICAL HTML on both runtimes (no hydration flip).
 *
 *   // theme-toggle.tsx
 *   const choice = state<Choice>((cookie('place-theme-choice') as Choice) ?? 'system')
 *
 * The SSR side requires `renderPage()` to have installed the cookie
 * jar (it does, unconditionally). When called outside of an SSR
 * render — or before hydration on the client — the function returns
 * `null` rather than throwing.
 */
export function cookie(name: string): string | null {
  // Browser path. `document.cookie` is the canonical source.
  if (typeof document !== 'undefined' && typeof document.cookie === 'string') {
    const jar = parseCookieHeader(document.cookie)
    return jar.get(name) ?? null
  }
  // Server path. Read the jar installed by renderPage.
  const jar = _CookieJarCap.tryUse()
  if (jar === null) return null
  return jar.get(name) ?? null
}

export interface CookieStateOptions {
  /** Max-Age in seconds. Default: 1 year. */
  maxAgeSeconds?: number
  /** Path scope. Default: '/'. */
  path?: string
  /** Set the `Secure` flag. Default: false. */
  secure?: boolean
}

/**
 * Imperative cookie writer (client-only). Pairs with the isomorphic
 * `cookie()` reader and the reactive `cookieState()`. Use for the
 * "set this once, no subscription" case — accepting tracking consent,
 * dismissing a banner, recording the last-visited tab — where you
 * don't want a `State<T>` cell carrying the value around.
 *
 *   // when the user accepts cookies
 *   setCookie('cookies-consent', 'accepted')
 *
 *   // dismissing the welcome banner
 *   setCookie('welcome-dismissed', '1', { maxAgeSeconds: 60 * 60 * 24 * 30 })
 *
 * Defaults: `Path=/`, `Max-Age=31536000` (1 year), `SameSite=Lax`, no
 * `Secure`. Override any of those via `options`. The value is
 * percent-encoded so values with `;` or `=` round-trip through `cookie()`.
 *
 * Server-side this is a no-op — there's no `document` to mutate, and
 * a Set-Cookie header must come back on the Response. If you need to
 * set a cookie from a server handler, return a `Response` with a
 * `Set-Cookie` header (or use `themeCookieHeader()` for the theme case).
 * The no-op-on-server lets the same call site work in code shared
 * between island handlers and SSR utilities without branching.
 */
export function setCookie(
  name: string,
  value: string,
  options?: CookieStateOptions,
): void {
  if (typeof document === 'undefined') return
  const maxAge = options?.maxAgeSeconds ?? 60 * 60 * 24 * 365
  const path = options?.path ?? '/'
  const secure = options?.secure ? '; Secure' : ''
  // biome-ignore lint/suspicious/noDocumentCookie: synchronous cookie write.
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; SameSite=Lax${secure}`
}

/**
 * `State<T>` whose value is mirrored to a cookie. The initial value
 * comes from the cookie if set (on both SSR and the client — see
 * `cookie()` for the isomorphic read), otherwise from `defaultValue`.
 * Writes to `.set()` propagate to `document.cookie` on the client; on
 * SSR there's no document, so the write is a no-op (the SSR side only
 * reads).
 *
 * Use this for any state that should:
 *   - persist across reloads, and
 *   - render correctly on first paint (no SSR→hydration flip).
 *
 * Common cases: theme choice, tab group selection, sidebar collapsed
 * state, dismissed banners, layout preferences.
 *
 *   const tab = cookieState('place-docs-tab-hello', 'place')
 *   <Activity when={() => tab() === 'Next.js'}>...</Activity>
 *   <button onClick={() => tab.set('Next.js')}>...</button>
 *
 * The value type is constrained to `string` because cookies are
 * strings on the wire; if you need a richer type, layer a derived
 * state over this one that parses / serializes.
 */
export function cookieState<T extends string = string>(
  name: string,
  defaultValue: T,
  options?: CookieStateOptions,
): State<T> {
  const initial = (cookie(name) as T | null) ?? defaultValue
  const s = state<T>(initial)
  const maxAge = options?.maxAgeSeconds ?? 60 * 60 * 24 * 365
  const path = options?.path ?? '/'
  const secure = options?.secure ? '; Secure' : ''
  watch(() => {
    const v = s()
    if (typeof document === 'undefined') return
    // biome-ignore lint/suspicious/noDocumentCookie: synchronous cookie write.
    document.cookie = `${name}=${encodeURIComponent(String(v))}; Path=${path}; Max-Age=${maxAge}; SameSite=Lax${secure}`
  })
  return s
}
