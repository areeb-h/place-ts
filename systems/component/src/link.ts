// `<Link>` JSX helper — typed, accessible, reactively-active client
// navigation for `RouterCap`. The routing system already exposes a
// `Link` value-type via `router.link(to, opts)` (with href, onClick,
// aria-current, active, go); this is the JSX wrapper that consumes it.
//
// What it does that a raw `<a href={...}>` doesn't:
//   1. Calls `RouterCap.use()` so the click goes through the active
//      router instead of triggering a full-page reload.
//   2. Reactive `aria-current="page"` when the link points at the
//      current route — pure-CSS active styling via
//      `a[aria-current="page"] { … }` works without JS.
//   3. Optional `activeClass` for an explicit class instead of relying
//      on the aria-current selector.
//   4. Modifier-click escape hatch: Cmd/Ctrl/Shift/Alt clicks skip the
//      router and let the browser open in a new tab/window.
//   5. Prefetch-on-hover hook (Phase 7.x): no-op for hash routers,
//      foundation for future path-router prefetch.
//
// Usage (JSX syntax in app code; this file produces the View directly
// via `el()` since the component package itself doesn't compile JSX):
//
//   <Link to="/notes/abc">Open</Link>
//   <Link to="/notes/abc" class="btn" activeClass="font-bold">Open</Link>
//   <Link to="/notes/abc" replace>Open</Link>
//   <Link to="/?tag=react" preserveQuery>Filter</Link>

import { RouterCap } from '../../routing/src/index.ts'
import { type Child, cls, component, el } from './index.ts'

/**
 * Module-augmentation slot for the app's registered routes. Apps opt in
 * by augmenting this interface from their entry file:
 *
 * ```ts
 * declare module '@place/component' {
 *   interface PlaceRoutes {
 *     '/': true
 *     '/blog/:id': true
 *     '/about': true
 *   }
 * }
 * ```
 *
 * When augmented, `<Link to="...">` constrains the `to` prop to the
 * union of registered paths — typos become compile-time errors.
 *
 * When NOT augmented (the default), `to` falls back to `string` so
 * apps that haven't opted in don't see a breaking change. This is the
 * SvelteKit-tested pattern for typed routes; see ADR 0004 for the
 * theming-augmentation precedent.
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging slot for app-side route augmentation; an empty default + non-breaking fallback is the SvelteKit/-tested pattern
export interface PlaceRoutes {}

/**
 * The route-key type derived from `PlaceRoutes`. Empty interface →
 * `keyof` is `never` → fall back to `string`. Augmented interface →
 * narrows to the union of declared paths.
 */
export type RouteKey = keyof PlaceRoutes extends never ? string : keyof PlaceRoutes & string

/**
 * External / non-routable href shapes that always bypass the router.
 * These are valid `to` values regardless of `PlaceRoutes` augmentation
 * because they never resolve through the routes table.
 */
export type ExternalHref =
  | `http://${string}`
  | `https://${string}`
  | `//${string}`
  | `mailto:${string}`
  | `tel:${string}`
  | `sms:${string}`
  | `#${string}`

export interface LinkProps {
  /**
   * Destination. Internal paths (start with `/`) go through `RouterCap`
   * and trigger client-side navigation. External URLs (`http://`,
   * `https://`, `mailto:`, `tel:`, `//` protocol-relative, `#`
   * fragment-only) bypass the router and render as a plain `<a>` so
   * the browser handles them natively (full-page nav, mail client, etc.).
   *
   * Type narrows to `keyof PlaceRoutes` when the app has augmented the
   * `PlaceRoutes` interface (see the JSDoc on `PlaceRoutes`); falls
   * back to `string` otherwise.
   */
  to: RouteKey | ExternalHref
  /** Replace the current history entry instead of pushing. Default false. */
  replace?: boolean
  /**
   * Preserve the current query string when navigating. Useful for filter
   * UIs where clicking another note shouldn't reset `?tag=react`.
   */
  preserveQuery?: boolean
  /** Static class applied always. */
  class?: string
  /** Class applied only when this link points at the current route. */
  activeClass?: string
  /**
   * Hint that the destination's data should be prefetched on hover.
   * Currently a no-op for hash routers (no separate bundle to fetch);
   * Phase 7.x will wire this into a path-router prefetch cache.
   */
  prefetch?: boolean
  /** Optional title for tooltips / a11y. */
  title?: string
  /** Optional aria-label override. Default: link text. */
  'aria-label'?: string
  /**
   * Anchor target. When set (e.g. `target="_blank"`), the link bypasses
   * the router so the browser opens in a new tab/window natively. We
   * also auto-add `rel="noopener noreferrer"` for `_blank` targets to
   * prevent the new context from controlling `window.opener`.
   */
  target?: '_self' | '_blank' | '_parent' | '_top' | string
  /** Override the auto-added rel for external/_blank links. */
  rel?: string
  children?: Child | Child[]
}

/**
 * External / non-routable URLs that should bypass `RouterCap` and let
 * the browser handle navigation natively. Match the standard prefixes
 * the platform's been using forever:
 *
 *   - `http://`, `https://`        → cross-origin or absolute
 *   - `//`                          → protocol-relative
 *   - `mailto:`, `tel:`, `sms:`     → external apps
 *   - `#section-id`                 → fragment-only (in-page anchor)
 *
 * Anything else (starts with `/` or a relative path) is treated as
 * internal and routed.
 */
function isExternalHref(to: string): boolean {
  return (
    to.startsWith('http://') ||
    to.startsWith('https://') ||
    to.startsWith('//') ||
    to.startsWith('mailto:') ||
    to.startsWith('tel:') ||
    to.startsWith('sms:') ||
    to.startsWith('#')
  )
}

/**
 * Typed client-navigation link. Reads the active router from
 * `RouterCap` when one is installed and goes through it for click +
 * active-state. When no router is installed (e.g. SSR rendering pages
 * whose routing is handled server-side by `app([pages]).serve()`), the
 * link falls back to a plain `<a href={to}>` anchor — the server emits
 * working HTML; the client-side Link re-mounts with the real router
 * during hydration and wires up `onClick` + `aria-current`.
 *
 * This makes `<Link>` safe to use inside layouts/views that render on
 * both runtimes without requiring callers to thread `<ClientOnly>`
 * around every navigation primitive.
 *
 * Wrapped in `component()` so the `RouterCap.tryUse()` call defers to
 * mount/render time (when the cap scope is active) instead of running
 * eagerly when the JSX is constructed.
 */
export const Link = component<LinkProps>((props) => {
  const children: Child | Child[] = props.children ?? []
  const external = isExternalHref(props.to)
  const opensInNewTab = props.target === '_blank'
  // External URLs and `target="_blank"` skip RouterCap entirely — they
  // render as a plain anchor and let the browser handle navigation.
  // Auto-add `rel="noopener noreferrer"` for _blank to prevent the new
  // context from controlling window.opener (security best practice).
  if (external || opensInNewTab) {
    const rel = props.rel ?? (opensInNewTab ? 'noopener noreferrer' : undefined)
    return el(
      'a',
      {
        href: props.to,
        class: props.class ?? '',
        ...(props.target ? { target: props.target } : {}),
        ...(rel ? { rel } : {}),
        ...(props.title ? { title: props.title } : {}),
        ...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {}),
      },
      children,
    )
  }
  // Internal: go through the active router if one is installed.
  // `tryUse()` returns null when no RouterCap is present — typically on
  // the server runtime where path-routing is handled by Bun.serve and
  // there is no client-side router to mount until hydration. In that
  // shell-only render we emit a bare anchor; the client re-renders the
  // Link with full router behavior once mounted.
  //
  // `data-place-link=""` marks the anchor so the pre-boot capture
  // runtime (`__place_runtime.ts`) can recognize it and call
  // `preventDefault()` on clicks that fire before hydration — otherwise
  // the browser's native anchor-follow runs and the page navigates
  // before the SPA `onClick` handler (which lives in `routing/src/index.ts`)
  // gets attached. The marker is present on both the SSR (no-router)
  // shell anchor AND the hydrated anchor so the runtime sees it
  // identically through the whole streaming + hydrate window.
  const router = RouterCap.tryUse()
  if (router === null) {
    return el(
      'a',
      {
        href: props.to,
        class: props.class ?? '',
        'data-place-link': '',
        ...(props.title ? { title: props.title } : {}),
        ...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {}),
        ...(props.prefetch ? { 'data-prefetch': 'true' } : {}),
      },
      children,
    )
  }
  const link = router.link(props.to, {
    ...(props.replace ? { replace: true } : {}),
    ...(props.preserveQuery ? { preserveQuery: true } : {}),
  })
  // Reactive className: combines static + activeClass (when active).
  const className = (): string =>
    cls(
      props.class ?? '',
      props.activeClass !== undefined && link.active() ? props.activeClass : '',
    )
  return el(
    'a',
    {
      href: link.href,
      onClick: link.onClick as unknown as (e: Event) => void,
      'aria-current': link['aria-current'],
      class: className,
      'data-place-link': '',
      ...(props.title ? { title: props.title } : {}),
      ...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {}),
      ...(props.prefetch ? { 'data-prefetch': 'true' } : {}),
    },
    children,
  )
})
