# ADR 0052: `trailingSlash` option + canonical-href emission from `<Link>`

**Status:** accepted
**Date:** 2026-05-20
**Affects:** `@place/component` (`<Link>`, `serve()`, `app()`); deployment story for static hosts

## Context

Lighthouse on the live Cloudflare Pages deploy of the docs site flagged:

> Document request latency — Est savings of 40 ms
> Had redirects (1 redirects, +37 ms)
> `place-ts.pages.dev/getting-started` was redirected to `place-ts.pages.dev/getting-started/`

Cloudflare Pages serves `dist/getting-started/index.html` at the canonical
URL `/getting-started/`. A request to the bare `/getting-started` form is
301-redirected to the slash form. The cost is paid by every link click
+ every prefetch, and it breaks prefetch warm-hits entirely (the
prefetch sees `r.redirected === true` and refuses to cache — see
`0187922` for the prefetch-side tolerance fix).

The framework's `<Link>` was emitting hrefs verbatim from the author's
`to=` prop. Pages registered as `page('/getting-started', …)` produce
`<Link to="/getting-started">`, which renders `<a href="/getting-started">`,
which gets 301'd.

## Options considered

1. **Configure Cloudflare's trailing-slash setting via dashboard.**
   - Pro: zero code change.
   - Con: deployment-specific. Apps deploying to Vercel / GitHub Pages /
     Netlify / S3+CloudFront need a different config each. Framework
     doesn't own the URL shape.

2. **Emit pages as `dist/path.html` instead of `dist/path/index.html`.**
   - Pro: `/path` and `/path/` both work on most static hosts without
     redirects.
   - Con: changes the static-export structure; breaks any host config
     that expects `/path/index.html`. Also worse for human-readable URLs.

3. **Ship a `_redirects` file with `200`-status rules that disable
   Cloudflare's auto-301.**
   - Pro: framework-controlled.
   - Con: Cloudflare's auto-301 happens BEFORE `_redirects` rules apply.
     This actually doesn't work; verified.

4. **Add a `trailingSlash: 'preserve' | 'always'` option that makes
   `<Link>` emit canonical-form hrefs.**
   - Pro: framework controls the URL shape its links emit. Apps opt in
     once + every link gets the right form. Compatible with any
     static host whose canonical form has trailing slashes
     (Cloudflare's default, Netlify, GitHub Pages). The runtime router
     already matches both `/path` and `/path/` (segments are
     leading/trailing-slash-stripped on parse), so registered routes
     don't need to change.
   - Con: opinionated default vs. preserving authored form. Mitigated
     by defaulting to `'preserve'` — apps opt in.

## Decision

**Option 4.** Add `serve({ trailingSlash: 'preserve' | 'always' })`
threading through `app()`. When `'always'`, `<Link>` normalises every
internal href to the canonical trailing-slash form at SSR render
time. Default is `'preserve'` so no existing app changes.

The implementation is a module-level setter in `link.ts` matching the
existing pattern for app-wide configs (`cookieState` etc.). The
`<Link>` component reads the active mode at every href emission site
(external + no-router shell + with-router path).

The docs app opts in: `app({ trailingSlash: 'always', … })`.

## Consequences

- **Cloudflare Pages deploys lose the +37 ms redirect penalty** on
  every link click + prefetch. Prefetch warm-hits now actually warm.
- The runtime router is unchanged — both URL forms match the same
  route. Existing bookmarks to `/path` still work via the host's
  remaining 301 (we don't suppress the host-side redirect; we just
  stop emitting hrefs that trigger it).
- Apps with a non-trailing-slash style preference can keep
  `'preserve'` (the default). Apps deploying to hosts where
  `/path` is canonical can stay on `'preserve'` too.
- `<Link>`'s `aria-current` computation is unaffected — the comparison
  is `pathname`-based with the same normalisation.
- External hrefs (http/https/mailto/etc.) and fragment-only (`#…`)
  are NEVER touched by normalisation. The policy is for internal
  routable paths only.

## Notes

- Headline metric: docs site Lighthouse 98 → expected 99–100 after
  next deploy, primarily from this fix.
- Implementation: `systems/component/src/link.ts`
  (`_setTrailingSlash`, `normalizeTrailingSlash`); `serve()` calls
  the setter at boot from `options.trailingSlash`.
- Companion fix in the SPA-nav runtime: `samePath()` discriminator
  inside `__spa_nav.ts`'s prefetch path treats trailing-slash
  redirects as benign (the response IS the requested page); see
  commit `0187922`.
- Commit: `b4f1413`.
