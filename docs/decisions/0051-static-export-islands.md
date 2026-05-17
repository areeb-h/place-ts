# ADR 0051: Islands-aware static export + Cloudflare Pages deploy

**Status:** accepted
**Date:** 2026-05-17
**Affects:** component, build, design (docs site)

## Context

The docs site (`examples/docs`) needs to be live on the internet. It
runs on the framework's own live Bun server — `app({...}).run()` →
`serve()` — with SSR, per-route bundle splitting, the islands
hydration model, and a per-request CSP nonce.

The user asked for the cheapest, fastest, most secure hosting. A docs
site is pure content: static pre-rendered HTML on a CDN edge beats
SSR-per-request on every axis (no cold start, no server attack
surface, free hosting from a private repo). The chosen host is
**Cloudflare Pages**.

But the framework's existing static exporter,
`buildStatic()` in `systems/component/src/build-static.ts`, predates
the islands model. It renders page HTML and optionally writes ONE
legacy `/client.js` — it emits **no island bundles**. A static export
of the docs would render readable pages with every interactive
feature dead (search / Cmd-K, theme toggle, ToC scroll-spy, mobile
nav, code-block tabs).

A static host also cannot deliver a per-request CSP nonce, so the
strict-CSP story needs a different mechanism.

## Options considered

1. **Run the live Bun server on a host (Fly.io / Railway / Render).**
   Zero framework work. But: SSR-per-request is slower than edge
   static for content, free tiers cold-start, a live process is
   attack surface, and it leaves `buildStatic` permanently behind the
   islands model — debt.
2. **Extend `buildStatic()` itself** to discover + bundle islands.
   Would duplicate `serve()`'s entire setup (Tailwind compile, island
   discovery + bundling, theme resolution) in a second code path.
3. **A static-export branch inside `serve()`.** `serve()` already
   does the full setup and already holds the built island bundles in
   memory (`splitterBundles: Map<url, Uint8Array>`, SRI-hashed).
   After setup, branch: instead of binding `Bun.serve`, pre-render
   every GET page route and write a complete static site. Zero
   duplication.

## Decision

**Option 3.** `serve({ staticExport: { outDir } })` runs the full
server setup, then writes the static site and returns without binding
a port. `app({...}).build({ outDir })` is the public wrapper. The
filesystem-writing logic lives in `build-static.ts`'s new
`writeStaticSite()`; `serve()` only supplies the render callback
(closing over `renderPage` + the serve-level layouts / theme / SRI).

Static renders carry **no per-request CSP nonce**. The strict CSP is
delivered out-of-band via a generated Cloudflare `_headers` file:

- **`script-src`** is fully hash-locked — `'self'` (same-origin
  island bundles) + a `'sha256-…'` for each framework inline runtime
  script (collected by scanning the rendered HTML). No
  `'unsafe-inline'`: an injected `<script>` cannot run. This is the
  XSS-critical control and it is airtight (~5 distinct, page-stable
  hashes for the whole site).
- **`style-src 'self' 'unsafe-inline'`** — a deliberate, documented
  concession. `<CodeBlock>` emits a per-token `style="color:…"` for
  syntax highlighting (hundreds of inline style attributes); hashing
  them all would produce a ~20 KB CSP header, over common CDN/browser
  limits. Inline-*style* injection is far lower risk than
  inline-*script* injection — industry CSP guidance treats
  `style-src 'unsafe-inline'` as acceptable while flagging
  `script-src 'unsafe-inline'` as critical. The proper end-state
  (token colors via CSS custom properties) is a `<CodeBlock>`
  refactor tracked separately.

Deploy is a GitHub Actions workflow (`.github/workflows/deploy-docs.yml`):
on push to `main`, install Bun → `bun --filter '@place/docs' build`
→ `wrangler pages deploy`.

## Consequences

- **The framework gains a real SSG capability.** Any islands app can
  `app({...}).build({ outDir })` to a fully-interactive static site.
- The docs deploy needs no server, no npm publish (the monorepo wires
  the framework via workspace deps), and works from a private repo.
- `staticExport` mode forces production build semantics (minified
  island bundles, stable SRI, no HMR, no dev watcher).
- `_serveImpl`'s static branch returns `undefined` cast to
  `Bun.Server` — the one concession to not refactoring the 1400-line
  function; `app().build()` discards the return, so the cast never
  surfaces.
- A non-islands app's legacy single `clientJs` bundle is written too
  (merged into the bundle map), so `buildStatic()`'s original use
  case is covered by the new path as well.
- Open follow-up: `<CodeBlock>` inline-style → CSS-variable refactor,
  which would let `style-src` drop `'unsafe-inline'`.

## Notes

- `writeStaticSite()` scans inline `<script>` blocks with an
  `indexOf`-based pass, not a regex parser — the input is the
  framework's own deterministic output and a framework-emitted inline
  script never contains a literal `</script>`. Bounded + verifiable.
- Verified end-to-end: 26 pages + 16 bundles exported; served locally
  under the generated `_headers` CSP with zero violations; all
  islands mount, theme toggle / search / SPA-nav work.
- npm publishing was explicitly deferred — not needed for the docs,
  and premature while the API is still reshaping (Tier 17).
