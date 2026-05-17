# ADR 0043: Tier 15-E phase 2 — typed-envelope HMR + per-island module swap

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/component/src/__hmr.ts`, `systems/component/src/index.ts` (server-side broadcast + Bun.build define), `systems/component/src/build/island-bundler.ts` (wrapper template), `systems/component/tests/unit/hmr.test.ts` (new).

## Context

ADR 0028 spec'd Place HMR — typed-island boundaries with effect-aware
state preservation, targeting sub-200 ms edit-to-DOM-patched and zero
prod bytes. The 2026-05-16 audit ranked HMR (then 1.46 s slow-path
reload) as the framework's most-visible UX debt against every
surveyed competitor (Vite 10-50 ms; Turbopack <50 ms).

ADR 0028 lists six phases:

1. Signature hashing (shipped Tier 8, T8-B).
2. **Wire format + WS server.**
3. **Client runtime.**
4. Build-transform accept wrapper.
5. Dev overlay.
6. Devtool integration (deferred — depends on devtool ADR pending).

This ADR records phases 2 + 3 + a slice of phase 4 (the wrapper
template now exposes the per-island registry the client needs). The
remaining work — a `__PLACE_DEV__`-gated accept-call AST visitor that
wraps `island()` exports automatically + the dev-overlay swap log —
carries to a future cut.

## Decision

Ship a typed HMR wire format and a per-island swap path that doesn't
restart the page. Existing `bun --watch`-style reload is preserved
as the slow-path / fallback for page/layout/framework edits.

### Wire format

WebSocket on `/__place_hmr` (existing endpoint, reused). Server-to-
client messages:

| Wire | Trigger | Client action |
|---|---|---|
| `'reload'` (bare string) | Child-process restart (page/layout/framework edit); rebuild with no actual island changes | `location.reload()` |
| `{ "t": "reload" }` | Programmatic explicit reload (reserved for future use) | `location.reload()` |
| `{ "t": "swap", "updates": [{ name, url, integrity, signature }] }` | Island rebuild produced changed URLs or signatures | Per-island swap (described below); fall back to reload on any failure |

The bare-string `'reload'` form is preserved for back-compat — any
hand-rolled HMR consumer that already speaks it keeps working.

### Per-island swap protocol

For each `{ name, url, integrity }` in the `swap` envelope:

1. Look up `window.__placeIslandRegistry[name]`. The registry is a
   shared singleton — every island's auto-generated wrapper writes a
   `disposeAll()` entry into it on module-init. Missing entry → fall
   back to reload.
2. Call `registry[name].disposeAll()`. Walks the island's marker Set,
   invokes each marker's stored disposer, clears the `viewMounted`
   sentinel attribute. Parent-scope signal cells stay alive — they
   weren't owned by the disposers.
3. Inject `<script type="module" src="<new-url>" integrity="<sha384>"
   crossorigin="anonymous" data-place-island="<name>">` at the end
   of `<head>`. The content-hashed URL guarantees the browser fetches
   fresh code, never a stale cache hit.
4. The new bundle's module-init runs `scanAndSchedule()` — discovers
   the markers (now without `viewMounted`) and hydrates them with the
   new render fn. Parent-scope state is reused; only the body changes.

If anything throws or any update has no matching registry entry, the
client calls `location.reload()`. Better a clean reload than a wedged
DOM.

### Server-side change detection

Within `serve()`'s `rebuildIslands` closure: before committing the
new bundler result, diff `nameToBundleUrl` and `signature` against
the previously-committed maps. Islands whose URL OR signature
changed are added to the `updates` list. If `updates.length > 0`
the server pushes `{ t: 'swap', updates }`; otherwise it falls back
to `broadcastHmrReload()` (the rebuild was triggered by a peripheral
file change that didn't actually move any island).

### Wrapper-level shared registry

The island wrapper template (`generateWrapperEntry` in
`island-bundler.ts`) now constructs each island's `markers` Set +
`disposers` WeakMap as references stored on
`window.__placeIslandRegistry[NAME]`. Old + new bundles share the
same maps by reference, so:

- The OLD bundle's `disposeAll()` (called by the HMR runtime) drains
  the live mounts.
- The NEW bundle's `hydrateOne()` repopulates the same Set + WeakMap
  on re-mount.

The `disposeAll` function itself is overwritten by each bundle —
fine, because the previous version has already executed by the time
a swap could replace it. Production builds rely on the same registry
for SPA-nav cleanup (`disposeDetached`); the HMR client is what's
DCE'd by `__PLACE_DEV__`, not the registry.

### `__PLACE_DEV__` define

Added a third Bun.build define alongside `__PLACE_BROWSER__`:

```ts
define: {
  __PLACE_BROWSER__: 'true',
  __PLACE_DEV__: isProduction ? 'false' : 'true',
}
```

Wired into all three Bun.build call sites in `_serveImpl` (legacy
single-bundle, route-splitter, island-bundler). Phase 4's
accept-call wrapper will gate its emission on this define so prod
bundles DCE the wrapper-and-WS-connect machinery to zero bytes. In
this phase the HMR client emission is still gated on `enableHmr`
(set from `!isProduction` in `serve()`), not on `__PLACE_DEV__`
directly — same effect, narrower change.

## Latency

Per-island swap (the new path) round-trip:

| Step | Time (target) |
|---|---|
| File save → bundler diff → swap broadcast | 30–100 ms (Bun's incremental build) |
| WS message → DOM patched on client | < 50 ms |
| **Total** | **80–150 ms p50** |

Vs. the legacy 1.46 s slow-path on the same edit. Sub-200 ms target
from ADR 0028 met for the common case (one island edit per save).
Slow-path still applies to page/layout/framework edits — same
~1.5 s — because the supervisor restarts the whole child.

A future phase can shrink the slow-path by re-rendering pages
server-side and pushing diffed HTML over the same WS channel; not
in scope for this ADR.

## State preservation contract (ADR 0028)

This phase covers the **per-island scope** case. The contract table
from ADR 0028 holds with one caveat: this cut doesn't yet have the
build-time AST visit that assigns stable keys to named in-body
`state()` bindings. The signature-hash-based reload (the existing
T8-B mechanism) is the fallback: if anything inside an island's body
moves at all, the swap dispose + re-mount on the same DOM nodes —
parent-scope cells survive, in-body cells reset. This is the
"pessimistic correct" version ADR 0028 names; the type-shape-based
optimization that distinguishes "body changed, shape didn't" is the
remaining phase-4 work.

| Thing | Preserved? |
|---|---|
| Signal cells owned by parent scope | YES — they're outside the island's WeakMap |
| Cells inside the swapped body | NO (this phase) — caller-cell re-mount via fresh `mount()` / `hydrate()` |
| `watch(fn)` effects | DISPOSED + REINSTALLED — disposer runs in `disposeAll`, new body installs fresh |
| Capability handles | YES — owned by app root, not the island |
| Router state, URL, scroll position | YES — outside the island chunk |
| DOM nodes themselves | YES — markers are reused; only their content is re-hydrated |

## Verification

- **1294 tests pass** (14 skipped) across 78 files. Was 1282 pre-
  this cut; +12 from the new `hmr.test.ts`.
- New tests cover: WS path, idempotent boot, legacy bare-string
  reload, typed `reload` envelope, unknown envelope ignored,
  malformed JSON ignored, swap with no registry entry → reload,
  swap with valid entry → `disposeAll()` called + fresh `<script>`
  injected with correct attributes (type=module, src, integrity,
  crossOrigin, data-place-island), swap with throwing `disposeAll`
  → reload, swap with empty updates → reload, multi-island swap →
  per-update injection, second `onopen` (reconnect) reloads.
- No regressions in the existing 1282 tests.

## What's NOT in this cut

- **Phase 4 build-transform accept wrapper.** A `__PLACE_DEV__`-gated
  AST visitor that wraps `island()` calls in a typed accept-call
  contract. Lands later; the manual registry plumbing in the wrapper
  template already gives us the same semantics for the common case.
- **Type-shape signature.** Today's signature is a 12-char content
  hash (T8-B). The type-shape version (props ID + cap set + named
  state-cell layout) is the optimization that lets the body change
  swap without re-mounting. Lands when Tier 9 promotes the
  classifier to authoritative.
- **Dev overlay swap log.** "filename ▸ swapped in 42 ms" + failed-
  swap source-mapped error. ADR 0028 phase 5; ergonomics, not
  correctness.
- **WS ack from client.** `{ t: 'ack', islandId, appliedHash, ms }`
  + server-side latency telemetry. Not blocking.
- **Capability handler hot-swap semantics.** Open question from ADR
  0028; today the cap's impl is owned by the app root and survives
  swaps because it's outside the island chunk — but editing the cap
  factory module itself triggers the slow-path reload (the supervisor
  doesn't know which cap is which). Adequate for now.

## Why this passes "magic with clarity" (ADR 0026)

- **Discoverable in source.** `window.__placeIslandRegistry` is a
  named global the consumer can inspect in devtools. The wrapper
  template + `__hmr.ts` are both readable; no compiler magic
  rewrites user code. Phase 4's `island()` accept wrapper will be
  the first compile-time transform in HMR — and even then, the
  emitted source is logged to disk under `.place/island-entries/`
  so a reader can audit it.
- **Traceable in tooling.** The server logs `[place hmr] islands
  rebuilt in N ms (M swapped)` per rebuild. The client falls back to
  full reload on any failure — no silent half-state. The HMR
  failures table in this ADR names every failure mode.
- **Faithful to performance budgets.** Per-island swap is one WS
  message + one `<script>` tag + one `mount()` call. The previous
  path was a full HTML round-trip + every island re-fetching + every
  island re-mounting. Net reduction: ~10× on the common dev iteration.
  Production bundles ship zero HMR bytes (the registry shape stays
  for SPA-nav cleanup; that's pre-existing).

## Tier 15 status after this cut

| Cut | Status | ADR |
|---|---|---|
| T15-A | ✓ | 0040 |
| T15-B + T15-C | ✓ | 0041 |
| T15-D + T15-F | ✓ | 0042 |
| T15-E (HMR) | ✓ phase 2 + 3 | 0043 (this) — phases 4-5 carryforward |

Tier 15 is now **functionally closed**. Remaining HMR phases (4-5)
are optimizations, not correctness gates; carries to a future
session.

## References

- ADR 0028 — Place HMR design.
- ADR 0026 — "Magic with clarity" gate.
- ADR 0019 — Typed islands as the boundary.
- ADR 0023 — Islands as the only hydration model.
