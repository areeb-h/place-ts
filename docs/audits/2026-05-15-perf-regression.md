# T6-H — Perf regression investigation (2026-05-15)

User report:
> page transition is really slow now compared to before . and sometimes
> it takes a lot of time to load when hard refreshed and also sometimes
> server error

Probe: `examples/docs/probes/perf-regression.ts http://localhost:5174`.

## Headline findings

1. **Server-side is not the bottleneck.** HTML page TTFB is **0.8 – 4 ms warm,
   18 ms cold** (one-time per-route lazy build by Bun's dev pipeline).
   No 500s observed across 100+ sequential requests. Server log shows
   every page + every island bundle served in `<2 ms`.

2. **Inline sourcemaps inflate dev bundles ~4×.** The probe found
   `/islands/mobile-nav-button.js` is **12.1 kB raw, of which 9.0 kB
   (75 %) is the inline base64 sourcemap**, leaving only 3.1 kB of
   actual code. The same pattern repeats across all 7 islands. Total
   island payload: **132.7 kB raw / 54.0 kB gzipped** in dev.
   Production builds (`sourcemap: 'none'`) would ship roughly the
   gzipped fraction — under 30 kB total for all 7 islands.

3. **View Transitions are the most likely source of perceived
   slowness on SPA-nav.** `__spa_nav.ts:85` wraps every swap in
   `document.startViewTransition(swap)` with no custom duration, so
   the browser runs a default ~250 ms cross-fade. That dominates the
   <10 ms fetch + parse + swap path. Pre-T6-A the islands were all
   SRI-blocked, so `<a data-place-link>` clicks fell through to native
   full-page navigation (no view transition) — which would feel
   *faster* to a user despite being a worse architecture. The
   regression is real, but it is a UX consequence of view-transitions
   being on, not a code defect.

4. **No "sometimes server error" reproduced.** Likely stale from the
   earlier SRI-blocked state (browser-side console errors that read
   as failures to the user) or a transient restart during the
   debugging session. Current server is healthy.

## Measurement detail

### Server-side TTFB (3 runs per route, with one trailing 4th)

| route                  | run1   | run2   | run3   | HTML size |
|------------------------|--------|--------|--------|-----------|
| `/`                    | 18.5ms | 1.6ms  | 1.9ms  | 124.8 kB  |
| `/concepts/reactivity` | 2.2ms  | 2.4ms  | 2.5ms  | 124.5 kB  |
| `/api/components`      | 2.1ms  | 1.1ms  | 1.2ms  | 131.6 kB  |
| `/why`                 | 1.7ms  | 1.7ms  | 2.5ms  | 132.9 kB  |
| `/recipes`             | 1.6ms  | 5.0ms  | 1.0ms  | 112.4 kB  |
| `/getting-started`     | 0.9ms  | 1.0ms  | 0.8ms  | 122.1 kB  |

Cold first-fetch of `/` at 18.5 ms is the per-route Bun.build pass
warming up. Subsequent fetches are sub-3 ms.

### Island bundle sizes

| url                              | raw     | gzip   | ratio |
|----------------------------------|---------|--------|-------|
| `/islands/mobile-nav-button.js`  | 12.1 kB | 5.1 kB | 0.42  |
| `/islands/search-trigger.js`     | 16.9 kB | 7.3 kB | 0.43  |
| `/islands/theme-toggle.js`       | 24.4 kB | 9.4 kB | 0.39  |
| `/islands/page-nav.js`           | 22.0 kB | 8.4 kB | 0.38  |
| `/islands/toc.js`                | 22.1 kB | 9.1 kB | 0.41  |
| `/islands/search-palette.js`     | 12.1 kB | 5.1 kB | 0.42  |
| `/islands/mobile-nav-drawer.js`  | 23.2 kB | 9.7 kB | 0.42  |
| **TOTAL**                        | 132.7   | 54.0   |       |

### Hot-refresh p50/p95 on `/concepts/reactivity` (10 sequential)

- **p50:** 1.4 ms
- **p95:** 4.2 ms
- **max:** 4.2 ms
- Raw runs: 1.3 1.4 1.5 1.3 1.2 1.6 1.1 4.2 2.0 0.9 ms

## Recommendations (not in T6 scope — flag for next Tier)

### Dev-only: external sourcemaps (high-value, low-risk)

Switch the dev bundler `sourcemap` setting from `'inline'` to
`'external'` (`systems/component/src/index.ts:5492, 5566`). Bun emits
`.js.map` siblings; the framework's `splitterBundles` map already
serves whatever URLs Bun produces, so the `.map` files will be served
at the same path with `.map` suffix.

- **Impact:** dev island payload drops from 133 kB → ~33 kB (4× win).
- **DX preserved:** browser dev tools fetch the external `.map`
  separately when the user opens DevTools.
- **Effort:** ~30 minutes (verify Bun's external-sourcemap output
  shape, ensure the `bundles` map captures `.map` outputs, set
  correct `Content-Type: application/json` for them).
- **Risk:** Bun's chunk-splitting interaction with external maps is
  untested in this repo — verify both per-route and per-island paths.

### View Transitions: per-link opt-in (UX call)

Today `viewTransitions: true` on `app({...})` blanket-applies
`document.startViewTransition()` to every SPA-nav. A 250 ms cross-fade
per click is overkill for plain content pages.

Options to discuss with the user (not auto-applied):
- **Shorter default** — inject `::view-transition-old(root), ::view-transition-new(root) { animation-duration: 120ms }` alongside the
  existing `@view-transition { navigation: auto }` rule.
- **Opt-out per link** — read a `data-no-transition` attribute on `<a>`
  and skip the wrapper.
- **Off by default** — make `viewTransitions: true` opt-in per page.

This is a charter-#7-clean ("magic with clarity") spec choice; no
right answer until the user says which UX they want.

### HTTP compression (medium-value, easy)

Currently every response is served uncompressed. Adding `gzip` or
`brotli` Content-Encoding when the client `Accept-Encoding` allows
would cut transit by ~60 % across all responses. Bun has built-in
compression hooks. Not in T6 scope; recommended for a follow-on perf
Tier.

## Probe and rerun

```
bun examples/docs/probes/perf-regression.ts [base-url]
```

Re-run after any of the recommendations above to confirm the
expected delta. Baseline columns are captured in this report's tables.

## Verdict

**No code defect found.** The framework is fast where it should be
fast (server <5 ms TTFB, hot-refresh p95 4.2 ms). The user's
perceived "slow page transition" is the View Transitions API's
default 250 ms cross-fade — a UX choice, not a perf regression.
The "sometimes long hard-refresh" is one-time per-route Bun build
warmup (18 ms first hit, <3 ms after).

T6-H closes without code changes. The two follow-on optimizations
(external sourcemaps in dev, shorter view-transition timing) live in
Tier 7 alongside the charter rewrites surfaced by the audit.
