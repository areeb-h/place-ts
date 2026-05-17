# Production readiness

place-ts is **pre-1.0**. This doc is the honest version of "is this ready for my workload?" It catalogues what has been load-tested vs not, what's been verified end-to-end vs unit-tested only, and what to watch for if you decide to deploy anyway. Updated each session.

If something below changes, update it in the same PR. The covenant in [stability-covenant.md](stability-covenant.md) covers API stability; this doc covers operational readiness, which is a different question.

## Status (2026-05-08)

| Surface | Unit tests | Browser-verified | Load-tested at scale | Known production users |
|---|---|---|---|---|
| Reactivity (`@place/reactivity`) | ✅ 145+ tests + property tests | ✅ via sandbox | ❌ | None |
| Component (`el`/`mount`/`hydrate`) | ✅ ~200+ tests | ✅ via all 3 examples | ❌ | None |
| SSR + streaming (`renderToString`/`renderToStream`/`suspense`) | ✅ | ✅ via sync-server `/ssr/*` | ❌ | None |
| `serve()` HTTP entry | ✅ (incl. bun-only suite) | ✅ all 3 examples boot | ❌ | None |
| `action()` typed RPC + auto-CSRF | ✅ | ✅ verified end-to-end in sync-server `/actions/demo` | ❌ | None |
| ISR (`revalidate` + `cache(fn)`) | ✅ incl. cap-scope isolation tests | ⚠️ commonplace exercises basics; cap-scope isolation not yet end-to-end browser-verified | ❌ | None |
| Capability scopes (ALS) | ✅ | ✅ via `serve()` request boundaries | ❌ | None |
| Layout primitive | ✅ | ✅ sync-server uses shared `siteLayout` | ❌ | None |
| Theming (`themeTokens`) | ✅ | ✅ commonplace dark/light + sandbox | ❌ | None |
| Hydration auditor (dev-only) | ✅ 6 tests | ⚠️ dev console output not browser-verified yet (test surface covers) | n/a (dev-only) | n/a |
| `<ClientOnly>` / `<Deferred>` | ✅ 4 tests | ❌ no example uses them yet | ❌ | None |
| `<Link>` typed via `PlaceRoutes` augmentation | ✅ type tests | ❌ no example app augments yet | ❌ | None |
| Source-map-aware error overlay | ✅ parser unit tests | ❌ not browser-verified end-to-end | ❌ | None |
| Content-hashed `/client.<sha>.js` in prod | ✅ via `bun test` (5 tests) | ❌ no production deploy | ❌ | None |
| Adapters: Node | ✅ (bun-only suite) | ❌ no production deploy | ❌ | None |
| Adapters: Vercel / Cloudflare | scaffolded only | ❌ | ❌ | None |
| `<Img>` markup | ✅ | ⚠️ markup-only, no optimizer backend yet | ❌ | None |
| View Transitions | ✅ | ❌ no example boots with the flag yet | ❌ | None |
| Security: CSP / HSTS / Permissions-Policy | ✅ | ✅ standard preset on all 3 examples | ❌ | None |
| Security: same-origin / body-limit / proto-pollution / signed CSRF | ✅ | ✅ verified via curl on sync-server | ❌ | None |

**Reading the columns:**

- **Unit tests** — covered by vitest under CI (`bun run ci`)
- **Browser-verified** — exercised end-to-end against a running example app's preview
- **Load-tested at scale** — dev-cycle benchmark scaffold exists ([scripts/bench-dev-cycle.ts](../scripts/bench-dev-cycle.ts)); no run rows yet. No production-traffic load test of any kind has been run.
- **Known production users** — what it says on the tin. None.

## What this means for you

**If you're evaluating place-ts for a side project / commonplace-shaped content app**, the structural answers (cache safety, CSP defaults, action security, hydration debugging) are real and tested. The framework powers three example apps including the reference commonplace book, and `bun run ci` is green on every cut. You're the first user; expect to find rough edges; file issues.

**If you're evaluating place-ts for production work that pages someone at 3am**, hold off until at least one of these is true:
- You've personally run the dev-cycle benchmark on your codebase shape and the numbers are acceptable
- You've deployed a non-critical service first and watched it for a week
- The "Known production users" column above is no longer empty

**If you're evaluating place-ts for a high-traffic application**:
- Per-route code splitting isn't shipped (single `client.js`); large apps will pay TTI cost
- HMR is process-restart, not module-level; large monorepo dev-cycle isn't tuned
- The image optimizer is markup-only; no backend yet
- Multi-replica deployment requires bringing your own `CacheStore` (memory store is single-process)

These aren't bugs — they're where the framework hasn't gotten to yet. The roadmap names them; the [stability covenant](stability-covenant.md) commits to not breaking what IS shipped.

## What's been deliberately tested in adversarial conditions

- Cache cap-scope isolation: **6 tests covering the auth-bleed-via-Session vector**, including a "two requests with different sessions don't share cached results" assertion ([cache.test.ts](../systems/component/tests/unit/cache.test.ts))
- Action security: **9 tests covering CSRF, body-size, proto-pollution, same-origin** + curl verification on sync-server with `Origin: http://evil.example.com` returning 403
- Hydration auditor: **6 tests covering class/style/attr divergence + extension classification** ([hydrate.test.ts](../systems/component/tests/unit/hydrate.test.ts))
- ISR cap isolation regression: present in test suite

## What's NOT been adversarially tested

- Concurrent-request load (no benchmark with N>1 concurrent requests on real hardware)
- Memory growth over hours of dev-cycle restarts
- Bun.build memory footprint at 1000+ component scale (the dev-cycle benchmark scaffold exists; no runs yet)
- TLS / production CSP under real CDN paths
- Adapters: Vercel / Cloudflare deploy paths

## How to help close gaps

If you deploy and something goes wrong, the issue body that helps most:
1. Which row from the table above you're hitting
2. The exact `serve()` config (redact secrets)
3. Repro shape — example app + the steps
4. What the framework SAID would happen vs what did

The framework's anti-bloat directive means we won't add a setting to "fix" something that's better fixed by understanding the failure. Bug reports that include the failure shape get triaged faster than feature requests for opt-out flags.

## Roadmap items that move rows

- [ISR multi-replica](roadmap.md#cache--persistence) — moves ISR's "single-process" caveat
- [HMR](research-hmr-codesplit.md) — moves the dev-cycle scale claim from "scaffold" to "measured"
- [Per-route code splitting](research-hmr-codesplit.md) — moves the client-bundle column
- [Image optimizer backend](research-img-vt-cli.md#gap-1--image-optimizer-backend) — moves `<Img>` from "markup-only"
- [File-split (audit Phase 2.1)](research-file-split-plan.md) — doesn't move any external row; it's a maintainability concern internal to the framework
- Vercel + Cloudflare adapters — moves their adapter rows

This page is pinned to update as those land. If a row stays "Known production users: None" after v1.0, that's a different signal than during v0.x.
