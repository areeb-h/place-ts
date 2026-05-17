# ADR 0025: SRI + attack-surface reduction (T5-D phase 2 close-out)

**Status:** accepted, shipped (2026-05-15)
**Date:** 2026-05-15
**Affects:** `systems/component/src/meta.ts` (renderDocument emits SRI
attrs); `systems/component/src/build/island-bundler.ts` +
`build/route-splitter.ts` (compute SHA-384 per bundle);
`systems/component/src/index.ts` (plumb integrity + add SRI for
legacy `clientJs`; auto cap-install via `_auto-init.ts` generated
into the shared chunk); `systems/component/src/app.ts` (derive
`clientCaps` from `router:` / `caps:` config);
`systems/component/src/__spa_nav.ts` (size cap, timeout, content-type
+ cross-origin redirect rejection); `systems/routing/src/index.ts`
(`__placeClientImport` metadata on `pathRouter`/`hashRouter`);
docs site: deleted `_init.ts`, removed all 4 side-effect imports.

## Context

T5-D phase 2 shipped islands-only docs + SPA navigation. User pushed
back: (1) `_init.ts` was an obvious "this should be automatic"
hangnail; (2) can we reduce the attack surface further; (3) where do
we stand vs other frameworks.

This ADR closes all three.

## Decisions

### 1. Auto cap-install — `_init.ts` is gone

Framework router factories (`pathRouter`, `hashRouter`, `memoryRouter`)
now carry `__placeClientImport: { module, name, capName }` metadata.
At server startup, `app()` reads the metadata off `config.router` and
any `config.caps[…]` factories, and forwards a `clientCaps` array
through `ServeOptions`.

`buildIslandBundles()` consumes `clientCaps` to generate a side-
effect-only `.place/island-entries/_auto-init.ts` module that
imports each cap + factory and installs them (guarded by
`cap.use(null) === null` so it's idempotent across HMR + manual
installs).

Every island's auto-mount wrapper imports the generated init module
as a side-effect. Bun's `splitting: true` puts the body in the
shared chunk; ES module semantics guarantee it evaluates **exactly
once per page** no matter how many islands mount.

User-facing diff: the docs `islands/` directory no longer contains
`_init.ts`; 4 island modules no longer have an `import './_init.ts'`
line. `app({ router: pathRouter })` is all that's needed.

For third-party / user-defined caps, the user can attach
`__placeClientImport` to their own factory function and it works the
same way. Or use the explicit `clientCaps:` field on `ServeOptions`
if they want full control.

### 2. SRI (Subresource Integrity) on every emitted script

Every `<script>` the framework emits — bootstrap, per-island, per-
route, even the legacy single `client.js` — now carries:
```html
<script type="module"
        src="/islands/foo.js"
        nonce="…"
        integrity="sha384-…"
        crossorigin="anonymous"></script>
```

**Triple defense:**
- **CSP nonce** — only the inline scripts and external scripts with
  this nonce can execute. Blocks XSS that injects new script tags
  (no nonce → blocked).
- **Subresource Integrity (sha384)** — browser computes SHA-384 of
  the fetched bytes and compares to the declared hash before
  executing. Blocks CDN tampering, MITM injection (even past TLS),
  cache poisoning, malicious proxy injection.
- **CORS (`crossorigin="anonymous"`)** — required for SRI to work
  with cross-origin scripts; for same-origin scripts it's a no-op
  guard.

Hashes are computed at bundle time via `crypto.subtle.digest('SHA-384', ...)`
in both `buildIslandBundles` and `buildRouteSplitBundles`, returned
as `Map<bundleUrl, base64Hash>`, accumulated in serve()'s
`scriptIntegrity` record, and passed per-render to renderPage via
the new `scriptIntegrity?` option on `RenderPageOptions`.

`renderDocument` emits the `integrity` + `crossorigin` attrs when the
URL has an entry in the map; absent entries get a plain script tag
(no SRI), so apps using pre-built `clientJs` without hash data don't
break.

### 3. SPA runtime hardening

The inline `PLACE_SPA_NAV` runtime now defends against four classes
of attack:

| Attack | Mitigation |
|---|---|
| Cross-origin redirect (302 to attacker.example.com) | Parse `r.url` after fetch; reject if origin ≠ location.origin → fall back to full nav |
| Non-HTML response (download, JSON, malicious blob) | Check `Content-Type` starts with `text/html`; else fall back |
| Indefinite hang (server stalls, no timeout) | `AbortController` armed with `setTimeout(ctl.abort, 10000)`; aborts after 10 s |
| Memory exhaustion (giant response) | Reject responses > 8 MiB after `r.text()` |
| Credential exfiltration | `credentials: 'same-origin'` (default, made explicit) — cookies never sent cross-origin |

All four mitigations fall back to `location.href = url` so the user
can always still reach the destination via native navigation. No
silent breakage.

## Security posture comparison (2026-05-15)

| Capability | Next.js 16 | Astro 5/6 | SvelteKit | Solid Start | Remix | **place-ts** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Strict CSP by default | ✗ | partial (Astro 5 csp) | ✗ | ✗ | ✗ | **✓ `'standard'`** |
| Inline-style-safe (no `style=`) | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ `style:*` via setProperty** |
| CSP nonces per request | manual | manual | manual | manual | manual | **✓ automatic** |
| **SRI on framework scripts** | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ sha384 auto** |
| Auto-CSRF on state-changing actions | ✗ | ✗ | partial (hooks) | ✗ | ✓ | **✓** |
| Same-origin enforcement (state) | ✗ | ✗ | ✗ | ✗ | manual | **✓** |
| Body-size limit on actions | ✗ | ✗ | ✗ | ✗ | ✓ | **✓ (1 MB std / 256 KB strict)** |
| Prototype-pollution sentinel-key strip | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** |
| HTTP security headers default | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ (`'standard'`)** |
| Permissions-Policy default-deny | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** |
| Cross-Origin-Opener-Policy | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** |
| Auth-bleed-proof cache | ✗ ([Next #86538](https://github.com/vercel/next.js/discussions/86538)) | ✓ (no shared cache) | ✓ | ✓ | ✓ | **✓ (per-request ALS)** |
| Island-marker auto-validation | n/a | ✗ | n/a | n/a | n/a | **✓ (3-layer)** |
| Island name reserved-keys reject | n/a | ✗ | n/a | n/a | n/a | **✓** |
| SPA-nav cross-origin redirect reject | n/a (no built-in) | manual | manual | manual | manual | **✓** |
| SPA-nav timeout + size limit | n/a | ✗ | ✗ | ✗ | ✗ | **✓** |
| SPA-nav content-type check | n/a | ✗ | ✗ | ✗ | ✗ | **✓** |

place-ts is the only framework in this comparison that ships SRI by
default, validates SPA-nav response shape, and emits CSP nonces per
request without a `next.config.ts` middleware ritual.

## What's still on the roadmap (deferred follow-ups)

These are real follow-ons, not workarounds:

- **`<link rel="modulepreload" integrity>`** for chunked imports.
  Today SRI on the top-level `<script>` tag protects the entry; the
  browser computes integrity for each ES-module fetch in the graph
  ONLY if `integrity` is present on the parent. Emitting
  modulepreload-with-integrity for shared chunks would explicitly
  cover them too. The current state is already correct in practice
  for browsers that propagate parent-script integrity (Chrome,
  Safari, FF all do as of 2024+); the explicit preload is belt +
  suspenders.
- **Trusted Types policy.** Currently we don't enable `Trusted Types`
  default policy. Adding `require-trusted-types-for 'script'` to CSP
  would block `innerHTML = userInput` patterns at runtime. Few apps
  ship raw HTML through the framework today; turn on when an audit
  catches one.
- **Permissions-Policy fine-tuning per route.** Today every page
  gets the same default-deny policy. Some recipes (the reactivity
  demo, etc.) might want explicit grants. Per-page override is a
  simple `meta.permissionsPolicy` extension; deferred until a real
  page needs it.
- **`Cross-Origin-Embedder-Policy: require-corp`** is on `'strict'`
  but not `'standard'`. Bumping the default would force every
  third-party asset to opt into CORP — too tight for default; right
  for security-critical apps.

## Verification

Live (`http://localhost:4321/` running):
- Every `<script>` tag has `nonce="..." integrity="sha384-..." crossorigin="anonymous"`
- Auto-init code lives in the shared chunk at `chunk-b4dsvg8f.js`
  line ~676–677: `if (RouterCap.use(null) === null) RouterCap.install(pathRouter())`
- `_init.ts` is gone from `examples/docs/src/islands/`
- SPA runtime has `MAX_BYTES`, `TIMEOUT_MS`, content-type check,
  cross-origin redirect rejection — confirmed via curl + grep
- `bun run typecheck` clean across 14 projects
- `bun run test` — 1090 passed / 14 skipped

## Threat-model summary

The framework's defense-in-depth for the islands model now spans:

1. **Network layer**: same-origin enforcement on actions; same-
   origin redirect check on SPA nav; CORS on script fetches.
2. **Transport layer**: SRI verifies content regardless of TLS
   state (defeats MITM with valid cert, compromised CDN, etc.).
3. **HTML layer**: strict CSP (no `'unsafe-inline'`, no `'unsafe-eval'`,
   no inline event handlers, no `data:` images other than safe types);
   `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`;
   `Referrer-Policy: strict-origin-when-cross-origin`.
4. **Script layer**: CSP nonce blocks injected scripts; SRI blocks
   tampered scripts; auto-mount wrapper validates marker names and
   strips prototype-pollution sentinel keys.
5. **State layer**: per-request cap ALS prevents auth-bleed across
   concurrent requests; SPA-nav fetch uses `credentials: 'same-origin'`
   so credentials never leak cross-origin.

No framework in the surveyed set ships all five layers as defaults.
