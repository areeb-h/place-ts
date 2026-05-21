# ADR 0029: Place streaming — suspense-driven, request-coalesced

**Status:** core shipped; cross-request coalescing deferred (2026-05-21)
**Date:** 2026-05-15
**Affects:** `systems/component/src/ssr.ts` (`renderToStream` + `suspense()` + `<Suspense>` shipped); `systems/component/src/__spa_nav.ts` (incremental shell-swap shipped); a future `systems/component/src/streaming/coordinator.ts` for cross-request coalescing — **NOT shipped**.

> **Inventory note (2026-05-21).** The single-request streaming surface
> shipped: `renderToStream` in [ssr.ts:374], `suspense()` boundary
> primitive in [ssr.ts:191], and the `<Suspense>` JSX wrapper with
> `EffectBranded<'suspense'>` for the classifier. Apps use it through
> the standard `<Suspense fallback={…}>` shape, and `resource()` is
> the producer side. The CROSS-REQUEST coalescing coordinator — the
> distinguishing claim of this ADR vs Astro / Marko / Next — has NOT
> been built. The trigger for that build is a workload that proves
> the savings real: two concurrent requests for the same suspended
> projection, the second piggybacking the first's resolved value
> rather than re-fetching. The docs site has no such concurrent fan-
> in, and no concrete app on the roadmap does either. Build when a
> workload demands it; the streaming substrate is already wired so
> the coordinator slots in as a `SuspenseCap` impl swap rather than
> a re-architecture.

## Context

`renderToString` ships the whole HTML synchronously; `renderToStream` exists in the framework but the docs site doesn't use it. Marko 6 does out-of-order streaming; Astro 5/6 ships Server Islands as per-island fetches; Next 19.2 PPR streams Flight chunks; SolidStart streams via Marko 6's serializer. None of them does the thing we can structurally do: **stream coalesced across concurrent requests for the same projection of the reactivity graph.**

## The decision

Adopt a **per-suspense, in-order streaming model** with a typed `<template data-place-fill>` envelope for filling slots. The wire format is the framework's existing reactivity graph, serialized line-by-line in a state channel. Authors write `suspense({ priority, fallback })` and `renderToStream`; everything else is the framework's call. The novel piece — **cross-request stream coalescing** — sits behind an opt-in `{ share: 'request-coalesce' }` and is gated by capability fingerprints that the type system already declares.

## Design

### Streaming model

Top-down tree walk. On hitting a `suspense()` whose resources are unresolved, emit a placeholder:

```html
<place-slot id="s7" data-await="r3,r4"><!-- fallback content --></place-slot>
```

…and continue with the rest of the document. When all of `s7`'s resources resolve, emit (anywhere before `</body>`):

```html
<template data-place-fill="s7">…real HTML…</template>
<script nonce="...">__place.fill("s7")</script>
```

`<template>` is the right choice (not a hidden `<div style="display:none">` as Marko historically used): templates are inert at parse time, don't trigger image/script loads, and `replaceChildren()` moves the children in one syscall.

**Per-tag streaming is a non-goal.** Marko's per-tag tree walker suspends between sibling children; the gain over per-suspense is measurable only on pathological trees. Authors who want it write smaller suspense boundaries.

### Wire format — two channels

**Channel A — HTML, the document itself.** No transformation. Shell + slots; later `<template data-place-fill>` chunks appended.

**Channel B — state**, a single `<script id="__place_state__" type="application/place-state+json">` that the runtime tails as it grows. Line-delimited envelopes:

```
{"v":1,"k":"r","id":"r3","val":<json>}                          // resource resolved
{"v":1,"k":"s","id":"count","val":3}                            // state slot
{"v":1,"k":"err","id":"r3","msg":"...","code":"E_TIMEOUT","slot":"s7"}
{"v":1,"k":"done"}                                              // explicit terminator
```

Resource IDs and state IDs **are the same identifiers the reactivity graph uses on the server.** No mapping table needed on the client. This is the structural payoff of charter clause 3 ("the graph is observable") — the wire format IS the graph, serialized.

State serialization uses the Marko 6 / SolidStart serializer (deep dedup across flushes, ~6× faster than `devalue`). License-compatible vendoring confirmed before Phase 2.

**Termination is explicit.** `{"v":1,"k":"done"}` is the stream terminator. Closed connection without `done` → client triggers full-page reload. No "guess if the stream is complete." This avoids the React Flight pattern where the absence of an explicit terminator means errors silently truncate the page.

### Composition with the rest of the framework

**SPA-nav (`__spa_nav.ts`).** Click → `fetch()` starts → shell-complete signaled by `<!--place-shell-end-->` marker → existing main-swap fires *immediately*, before the rest of the response lands. Suspense fills arrive as separate envelopes and are applied incrementally without blocking the swap-complete event. Sub-5 ms baseline stays sub-5 ms because the shell swap is the same node count as today.

**Islands.** An island marker inside a streamed slot loads its bundle the moment the slot fills. Above-fold islands hydrate immediately; below-fold use `IntersectionObserver` + `requestIdleCallback`. Per-island streaming priority is a typed prop:

```tsx
<suspense priority="high" fallback={<Skel />}><Chart /></suspense>
<suspense priority="low" fallback={<Skel />}><Footer /></suspense>
```

The server orders flushes by priority within data resolution constraints.

**Thaw (ADR 0027).** Thaw markers serialize via the same Channel B envelopes. A thaw component inside a suspense slot ships its initial state in the fill envelope, not in the attribute — saving a re-parse and letting the thaw runtime read state via `__place.state['thaw/counter#3']`. Thaw + streaming compose cleanly: a page can be fully thaw-only, ship 0 island bundles, *and* stream.

### Error model

| Error site | Behavior |
|---|---|
| Shell error (before first byte) | Respond 500 with error page. Same as today's `renderToString` path. |
| Suspense boundary error | Suspense renders its `fallback` synchronously; the resource error is logged; no fill is sent for that slot. Client sees the fallback terminally. Channel B emits `{"k":"err","slot":"s7"}` so dev tools / error reporters see it. |
| Mid-stream uncaught (above any boundary) | Server emits `{"k":"err","slot":"__root__","fatal":true}` then `{"k":"done"}` then closes. Runtime, on a fatal envelope, full-reloads to a clean error route. Better than React's silent half-page. |

### Caching model — three tiers, all opt-in

1. **No cache (default).** Per-request stream.
2. **Shell cache.** Pages whose synchronous render is request-invariant cache the bytes up to the shell-end marker on a CDN with a `Cache-Tag`. Per-request stream resumes from that byte. API: `renderToStream(view, { shellCache: 'edge', shellKey: (req) => ... })`. Typed function; no string directives.
3. **Cross-request coalescing.** The novel tier — see below.

### The novel idea: request coalescing on graph projections

**Proposal: when two users request the same URL at the same time, the server renders once, multicasts the stream chunks to both connections.**

Each connection gets a private prefix (the shell's per-request bits — nonce, cookies-derived attributes templated in) and the shared body (resource resolutions, fills). Channel B envelopes are content-addressed: `{"v":1,"k":"r","id":"r3","hash":"sha256-...","val":...}`. A late joiner gets a quick replay of all envelopes flushed so far (held in a small ring buffer keyed by URL + capability-fingerprint), then joins the live tail.

**Why this is novel:**
- React Flight is request-private; no framework treats the stream as shared.
- This is *not* shell-caching — the dynamic suspense fills are shared too, provided their inputs (capability scope) are identical.
- The graph-as-wire-format makes it safe: an envelope keyed by graph node ID is the same value for everyone with the same upstream inputs.

**Concrete design:**

- `renderToStream(view, { share: 'request-coalesce' })`. Opt-in.
- The coordinator keys by `(route, normalized-query, capabilityFingerprint)`.
- `capabilityFingerprint` is computed from the capability scope. Typed effects (charter #4) already declare what request inputs they read — auth token, locale, etc. Two requests with the same fingerprint coalesce; two with different fingerprints don't.
- Per-connection prefix bytes (HTML shell up to first slot) are templated with placeholders the server fills per-connection. Cheap: small `replaceAll` over a 2-4 kB shell.
- Ring buffer holds envelopes for up to T=2 s after stream completion. Late joiners within T get a replay; outside T get a fresh render.
- Cancellation: if upstream errors, all coalesced connections receive the same fatal envelope and fall back to per-request renders on retry.

**Tradeoffs:**
- **Win:** Under spikes (a viral link → 1000 RPS for one route), the server renders the route ONCE, ships it 1000 times. CPU stays flat. **No incumbent framework does this.**
- **Cost:** Coordinator complexity — a few hundred LOC, in Bun this is `ReadableStream.tee()` + a map.
- **Failure mode:** A buggy capability declaration could coalesce two users with different auth.
- **Mitigation (load-bearing):** The capability system tags caps with `crossRequestSafe: true | false`. Default is `false`. The build errors if `share: 'request-coalesce'` is used on a route whose capability scope contains any cap not marked safe. Auth-bearing caps default to unsafe; flagging is an explicit, audited contract.

**Why no one else can take this path:**
- Flight is request-private by design; you'd have to fork React.
- Astro split islands into per-fetch precisely to make CDN caching simple — they sidestepped the problem.
- Marko/Solid/Qwik don't have capability fingerprints to safely coalesce on.

Place-ts has typed effects (charter #4) and graph-as-wire (charter #3) — the two preconditions.

### Authoring API

`suspense()` and `renderToStream()` already exist. Two additions:

```tsx
import { resource, suspense, page } from '@place-ts/component'

const userR = resource(() => fetchUser(id))
const ordersR = resource(() => fetchOrders(id))

export default page('/u/:id', {
  view: () => (
    <Layout>
      <h1>{userR().name}</h1>                              {/* in shell — blocks */}
      <suspense priority="high" fallback={<Skel />}>
        <UserCard r={userR} />
      </suspense>
      <suspense priority="low" fallback={<OrdersSkel />}>
        <Orders r={ordersR} />
      </suspense>
    </Layout>
  ),
})
```

That's it. No `"use server"`, no `server:defer`, no `<await>`. The existing `suspense()` learns a typed `priority` prop and the runtime takes it from there. Opt into coalescing on a per-page basis:

```tsx
export default page('/u/:id', {
  view: () => /* … */,
  stream: { share: 'request-coalesce', coalesceWindowMs: 2000 },
})
```

### Performance budget

Content page with shell + 2 suspended islands, 100 Mbit / 30 ms RTT, Bun on commodity hardware:

| metric | target | Marko 6 | Astro SI | Next 19.2 PPR |
|---|---|---|---|---|
| TTFB (shell start) | < 15 ms | ~10 ms | ~5 ms (cached) | < 5 ms (cached shell) |
| Time to first paint | < 60 ms | ~80 ms | ~80 ms | ~120 ms |
| Time to interactive (thaw chrome) | < 100 ms | n/a | ~600 ms | ~800 ms |
| First-flight JS (content page) | 0 kB | ~10 kB | 0 kB | ~50 kB RSC runtime |
| TTI for last suspended island | < 250 ms | < 250 ms | ~400 ms (extra fetch) | ~400 ms |

Beating Astro on TTI-last comes from skipping the separate fetch. Beating Next.js comes from no RSC runtime.

## What we avoid

- **A Flight-style binary protocol.** Place's reactivity already serializes; reuse it.
- **String directives** (`"use server"`, `server:defer`). All hints are typed props on `suspense()`.
- **Per-island separate fetches** (Astro). One stream wins on TTI when the network is slow.
- **Hiding the wire** (Qwik QRL hashing, RSC Flight). Channel B envelopes are inspectable JSON lines.
- **Pretending dynamic streams cache as a whole.** Cache the shell or coalesce the request; don't lie about the dynamic part.

## Open questions

- **Marko 6 serializer:** vendor or port? Decision needs a license diff + a benchmark vs `devalue` on place's actual graph shapes.
- **Channel B placement:** inline `<script>` + JSON lines, or a separate `application/x-place-state` resource fetched by the inline runtime? Inline keeps it in one HTTP response; separate composes better with HTTP/3 multiplexing. Lean toward inline.
- **Coalesce window T:** 2 s feels right but is untested. Ship coalescing as opt-in with a per-route `{ coalesceWindowMs }`; pick a default after real-traffic data.
- **103 Early Hints** for per-island bundle preload over the same connection? Bun supports it; nothing here precludes it. Likely follow-on.

## Phases

- **Phase 1 — Wire format spec + serializer.** Vendor/port the Marko 6 serializer. Spec the envelope contract. ~400 LOC.
- **Phase 2 — Per-suspense streaming.** Update `renderToStream` to emit shells + slots + fills. Update `__spa_nav.ts` to swap on shell-complete. ~500 LOC.
- **Phase 3 — Channel B state channel.** Replace `data-thaw-state` JSON attrs and `data-place-island-props` for streamed components with Channel B envelopes. ~300 LOC.
- **Phase 4 — Error model end-to-end.** Mid-stream error envelopes, fatal-envelope full-reload, dev overlay integration.
- **Phase 5 — Request coalescing.** Coordinator + capability fingerprint + `crossRequestSafe` cap tagging. ~600 LOC including tests.
- **Phase 6 — Docs site migration.** Move `/concepts/reactivity`, `/api/components`, recipes' data pages to streaming. Measure.

## References

- [Marko HTML Streaming docs](https://markojs.com/docs/explanation/streaming)
- [eBay engineering: Async Fragments — Progressive HTML Rendering with Marko](https://innovation.ebayinc.com/tech/engineering/async-fragments-rediscovering-progressive-html-rendering-with-marko/)
- [Astro Server Islands docs](https://docs.astro.build/en/guides/server-islands/)
- [Solid SSR streams keeping me in Suspense — Dan Jarkovský](https://medium.com/qest/solids-ssr-streams-keeping-me-in-suspense-e0a870d95280)
- [Qwik Resumable concept](https://qwik.dev/docs/concepts/resumable/)
- [React 19.2 release notes](https://react.dev/blog/2025/10/01/react-19-2)
- [Next.js Partial Prerendering Platform Guide](https://nextjs.org/docs/app/guides/ppr-platform-guide)
- [Flight Protocol Syntax — React on Rails](https://reactonrails.com/docs/pro/react-server-components/flight-protocol-syntax/)
- [Strict CSP — web.dev](https://web.dev/articles/strict-csp)
- ADR 0023 — islands as the only hydration model
- ADR 0027 — "thaw" resumability (composes via Channel B)
- ADR 0026 — magic with clarity (the discoverability gate this design satisfies)
- ADR 0030 — unified hydration via effect-typed classification (consumes this streaming model as the L3 emitter)
