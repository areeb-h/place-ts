# Post-T5-D + T6 systems audit (2026-05-15)

Charter-vs-shipped drift report across all systems + the design package.
Run after the T6 bug-fix sweep closed (SRI byte-stability, per-response
CSP `style-src` hash injection, universal `aria-current` updater,
shared-state inlining, "magic with clarity" charter pivot — ADR 0026).

Three `critic` agents ran in parallel, each covering 3–4 systems, with
**charter scope** (charter alignment only, not interface or API/DX
review). Findings below are consolidated verbatim from the agent
reports; severity follows the agents' own grading.

**TL;DR:** the implementations are healthy and internally consistent.
The CHARTERS are drifting behind code. Two systems (`capability`,
`routing`) have v0.3-era stub charters that no longer describe the
shipped surface. One system (`security`) ships without a charter at
all. `data`'s charter describes a system that doesn't exist yet
(`collection<T>()` is the only shipped primitive; the promised
`query`/`mutation` surface is missing). `design`'s charter contradicts
itself on arbitrary Tailwind values — 5 source files leak them.

The bug fixes (T6-A / T6-B / T6-C / T6-E) all pass ADR-0026's three
criteria; T6-F's charter rewrite is reflected in the platform charter
but not yet propagated into the per-system charters.

The recommended action item from every audit row is **rewrite the
charter to match shipped reality, or roll the shipped reality back to
the charter.** Most of the drift is one-way (code outran charter), so
the rewrite path is the realistic one.

---

## Severity legend

- **blocking** — a contradiction that breaks the platform charter or
  invalidates a system's stated guarantee. Must address before
  publication.
- **important** — a contradiction or gap that future-me / other
  readers will get tripped by. Address in the next charter pass.
- **nit** — cosmetic, stylistic, or low-impact. Fix opportunistically.

---

## `systems/component`

Charter alignment mostly intact post-ADR-0026, but several shipped
magics need to be re-grounded in the charter text and one violates a
hard charter line.

- **important — drift.** `systems/component/docs/00-charter.md:54-65`
  still reads as if `app({ router, caps })` magic, `islandsDir`
  auto-discovery, auto cap-install via generated `_auto-init.ts`, the
  universal `aria-current` updater, and per-response CSP `style-src`
  hash injection are all out of scope. ADR 0026 narrowed commitment #3
  to "no string-directive markers" but the charter file still lists
  the seven pre-pivot commitments. Shipped magic features
  (ADRs 0023–0025) are nowhere on the system's "owns" list.
- **important — gap.** Charter commitment #7 ("No codegen") at line 64
  is contradicted by `build/island-bundler.ts:303-329`, which writes
  generated `.place/island-entries/_auto-init.ts` to disk and bundles
  it. ADR 0025 §1 confirms this is intentional. Either reword #7 (e.g.
  "no user-visible codegen") or it fails the gate.
- **important — gap (ADR-0026 (b), traceability).** `islandsDir`
  discovery (`build/discover-islands.ts:34`) walks a directory at
  server-start and registers default exports as islands. No public
  manifest endpoint, no `bun run …` dump, no devtool surface. ADR
  0026's "Open questions" admits this. Until that gap is closed,
  auto-discovery is not yet traceable in tooling.
- **important — gap (ADR-0026 (a), discoverable in source).**
  `__placeClientImport` is attached to router factories as an untyped
  expando (`systems/routing/src/index.ts:644,719`). A user reading
  `pathRouter` cannot grep its signature and see the metadata. ADR
  0026 requires a *named metadata field* — this is a side-channel.
- **nit — drift.** Charter commitment #6 ("No built-in caches") reads
  absolute; `cache.ts:23-57` ships `CacheStore` + `CacheEntry`
  consumed by ISR. `cache.ts` justifies it as "ISR-only" but the
  charter line doesn't acknowledge ISR exists.
- **What's solid.** SRI byte-stability (`build/island-bundler.ts:332-446`)
  and per-response CSP hash injection (`index.ts:5890-6179`) both
  pass all three ADR-0026 criteria cleanly. SPA nav runtime
  (`__spa_nav.ts`) is appropriately hardened.

**Next move:** rewrite the system charter to reflect ADR-0026 + the
islands/SPA/SRI shipped surface; either retract commitments #6/#7 or
scope them precisely.

---

## `systems/capability`

The charter is a v0.3 stub. The shipped surface has outgrown it on
every axis. Worst-aligned of the audited systems.

- **blocking — contradiction.** Charter scope at
  `systems/capability/docs/00-charter.md:7` declares the API as
  `handle(kinds, handler, body)`. The shipped surface
  (`systems/capability/src/index.ts:42-515`) ships `defineCapability`
  / `cap` / `provide` / `install` / `use` / `tryUse` / `requires` /
  `Provision` — a per-cap-slot model with separate provide/install/use,
  not a single `handle()`. The charter and code describe two
  fundamentally different APIs.
- **important — gap.** `runWithCapabilityScope` +
  `runWithCapabilityScopeSync` (`index.ts:320-346`) introduce
  per-request `AsyncLocalStorage` scoping with a top-level-await
  `node:async_hooks` import gated on `__PLACE_BROWSER__`. This is
  load-bearing for multi-tenant SSR and is exactly the kind of
  "hidden globals" failure called out in
  `docs/platform/07-prior-art-failures.md:33-37`. The charter doesn't
  mention ALS, doesn't bound the behavior, and doesn't reconcile it
  with the prior-art-failure rebuttal.
- **important — gap.** `ClientOnlyAbort` (`index.ts:371-383`) +
  `clientOnly` option create a structural SSR/CSR signaling channel
  that the component system catches and rewrites. Cross-system
  contract; belongs in `docs/platform/04-interfaces.md`. Charter is
  silent.
- **important — gap.** `Effect<E,T>` / `IO` / `Mutate` / `Async` /
  `Throws<E>` / `Read<S>` types (`index.ts:124-138`) ship as
  effect-kind placeholders. Charter line 16 says "effect *kinds*
  (reactivity declares them)" — but these types live in `capability`.
  Ownership unclear.
- **What's solid.** `requires()` brand + per-request ALS isolation is
  good design; the issue is purely the charter never sanctioned it.

**Next move:** rewrite this charter from scratch. It currently
describes an API that doesn't exist.

---

## `systems/routing`

Charter is a v0.3 stub from before any code shipped. The code is
mature; the charter is empty.

- **important — drift.** Charter at
  `systems/routing/docs/00-charter.md:7-10` lists "Loader coupling…"
  and "Transition coordination…" Neither shipped.
  `systems/routing/src/index.ts:21-30` (deferred list) explicitly
  punts on both.
- **important — gap.** Every shipped surface is undocumented in
  charter: `route()`, `searchParams()`, `Link`, `RouterHandle`,
  `serverRouter()`, `parsePath()`, `RouterCap`, `__placeClientImport`
  metadata. Zero overlap with shipped API.
- **important — gap.** `serverRouter(req)` at `index.ts:757-781` is a
  routing↔component cross-cut contract. Charter's "does not own —
  HTTP / SSR transport" reads as if this couldn't exist; but it does,
  and it's load-bearing.
- **important — gap.** `__placeClientImport` on `pathRouter` /
  `hashRouter` (`index.ts:644, 719`) is a build-system contract
  attached via untyped expando — ADR-0026 (a) miss (see component
  finding too).
- **nit — gap.** `place:nav` listener inside `pathRouter()`
  (`index.ts:702-710`) is the routing-side half of the SPA-nav
  contract owned by `component/__spa_nav.ts`. This implicit cross-
  system pairing belongs in `04-interfaces.md`.
- **What's solid.** Shipped code is internally consistent and
  disciplined (typed routes, derived per-key segment/param caches,
  defensive `URLSearchParams` cloning at `:559`, hidden-property
  `Link` spread guard at `:434-454`).

**Next move:** rewrite charter to match shipped reality; demote
loader-coupling + transitions to deferred sections at the bottom.

---

## `systems/reactivity`

- **important — contradiction.**
  `systems/reactivity/src/index.ts:586-588` exports `peek(state)`
  marked `@deprecated`. Pre-v0.1, interface stability isn't frozen;
  the deprecated re-export contradicts the "experimental nothing
  ships" stability discipline of `04-interfaces.md:209`. Delete it
  rather than ship deprecated surface pre-publish.
- **important — contradiction.** `state(initial: T | (() => T))`
  reuses one entry point for raw + derived state via `typeof === 'function'`
  (`index.ts:473-485`). Storing a function-typed value forces
  `state<Handler>(() => myHandler)` and silently makes the outer fn a
  derivation. ADR-0026 (a) is violated for that case — the call site
  `state(myHandler)` reads as raw-state-of-function but runs as a
  derivation.
- **important — gap.** Charter promises "Phase 4 typed effects" and
  watch-may-grow-effect-kinds; the shipped `WatchOptions`
  (`index.ts:439-447`) exposes `defer` only and commits the default
  *forever*. No extension slot for typed-effect `watch`.
- **important — drift.** ADR-0026 (c) faithful-to-budgets is not
  addressed by `resource()`'s hydration shape (`index.ts:803-810`).
  Reaches into `globalThis.__place.r` — magic that's traceable in
  concept but undocumented in the reactivity charter. The
  `hydrationKey` surface is a cross-system contract with
  `@place/component`'s SSR layer that the charter never sanctions.
- **nit — drift.** Motion sub-module's `clock` exported as
  `Derived<number>` (`motion/index.ts:27`) but the reactivity
  charter's "Time" section (Phase 5) reserves time-indexing semantics
  for a temporal-tuple. Motion clock pre-empts Phase 5 vocabulary
  without cross-reference; risk of double-defining "time".
- **What's solid.** Three-state derivable, COMPUTING + needsRerun
  cycle break, untrack semantics, history with auto/manual modes —
  all internally consistent and well-commented.

**Next move:** delete `peek`; document `resource`'s SSR coupling in
the reactivity charter, OR move `resource` out of `@place/reactivity`
into the system that owns SSR transfer.

---

## `systems/data`

- **blocking — contradiction.** Charter (`docs/00-charter.md:7-12`)
  declares ownership of typed queries, loaders, mutations,
  source-of-truth abstraction. Shipped surface (`src/index.ts`) is a
  single `collection<T>()` helper over `State<T[]>`. The promised
  `query` primitive, `QueryResult<T>`, mutations, and the `data`
  capability shape **do not exist** in source.
  `04-interfaces.md:148-165` defines a `Query<T,A>` / `defineQuery`
  shape — none of it ships. Largest charter-vs-shipped gap audited.
- **important — contradiction.** `collection.update`'s
  rename-rejection (`index.ts:130-141`) bakes in a policy ("renames
  not allowed"). Charter's §"What this system does not own" includes
  schema choices, and the source comment says "Domain logic lives in
  the consumer, not here." Rename-as-error IS a domain policy.
- **important — gap.** Charter says data "Depends on cache,
  persistence, build." Shipped collection depends on `State<T[]>`
  only — nothing composes with cache or persistence. Source-of-truth
  unification claim is unbacked.
- **important — gap (local-first, platform #6).** Data system is
  silent on local-vs-remote orientation; with no actual query
  primitive shipped, the local-first stance has no expression in code.
- **blocking — drift.** Charter status says "stub. Will be designed
  alongside the component system in v0.2." Code has shipped under a
  stub charter — direct inversion of decision-rights principle that
  scope changes come before code.
- **What's solid.** Composition-via-exposed-state idea is right and
  matches the graph-observable commitment.

**Next move:** either upgrade the charter to match what `collection`
actually is (a CRUD helper, not the data system) or freeze
`collection` as provisional and write the real data-system charter
before the next primitive lands.

---

## `systems/design` (package, not system per ADR 0016)

- **blocking — contradiction.** Charter non-negotiable #6
  (`docs/00-charter.md:111-114`) forbids arbitrary Tailwind values
  inside library components. Live violations:
  - `Dialog.tsx:48,53-55` — `max-w-[min(560px,92vw)]`, `max-h-[85vh]`
  - `presentational.tsx:26,78,85-91,96-97` — `text-[10px]`,
    `text-[11px]`, `bg-[color-mix(...)]`, `text-[oklch(...)]`,
    hard-coded oklch literals
  - `Field.tsx:147-148` — `min-h-[5rem]`
  - `Menu.tsx:222` — `min-w-[10rem] max-h-[60vh]`
  - `Toast.tsx:119,125-127,133,137-138,198` — `min-w-[280px]`,
    `max-w-[440px]`, color-mix oklch literals, `text-[11px]`
  Exactly the v4 escape-hatch the charter cites as defeating
  tokenization. Badge/Toast oklch literals additionally hardcode
  design-token values that should live in `themeTokens()`.
- **important — contradiction.** `Button.tsx:138-140`, `Field.tsx:98`,
  `Dialog.tsx:90`, every primitive exports `class?: string` and runs
  it through `cls()`. ADR-0016 §"Anti-pattern checklist" line 144
  marks `className`-as-override as the prior-art mistake; the current
  shape leaves the line ambiguous.
- **important — contradiction.** Charter §"What we build on" (line
  122) says skins flow via `SkinCap`. No primitive references
  `SkinCap` or any capability. ADR-0016 lines 116-122 explicitly
  invokes it; the absence is a contract gap.
- **important — gap (ADR-0026 (b)).** Recipes are typed but there's
  no manifest / dump that lists which recipes a build pulls in. For a
  library that re-exports `recipe()` magic, the charter doesn't
  specify the discoverability surface.
- **nit — drift.** `Toast.tsx:55,77` mutates a module singleton
  (`queue`, `nextId`) outside any reactivity scope. Platform
  non-negotiable #8 (no god-object) is bent: a singleton-with-global
  imperative API (`toast.success(...)`) is the kind of cross-system
  global the platform forbids. Charter doesn't justify the exception.
- **important — drift.** Charter (line 162) says `Button` is the only
  shipped primitive; rest are "Future — placeholder; not exported."
  Repo already ships Field/Dialog/Toast/Tooltip/Menu/presentational.
  Charter §Status lists the rest as "Backlog" — contradicts code.
- **What's solid.** Native-first composition (popover, `<dialog>`,
  `:user-invalid`) correctly applied; no `asChild`/`cloneElement`/
  runtime CSS-in-JS leakage in shipped code; recipe pattern
  consistently used as the typed override channel.

**Next move:** tear out the arbitrary Tailwind values (especially
oklch literals in Badge/Toast) into `themeTokens()` before any
further primitive lands. This is the charter's single hardest
non-negotiable, eroded in 5 files.

---

## `systems/cache`

- **important — drift.** README at `systems/cache/README.md:5`
  declares system "deferred indefinitely" and points consumers to
  `systems/component/src/cache.ts`. System-map at
  `docs/platform/00-system-map.md:16` still lists `cache` as system
  #4, v0.2 phase, owning typed-effect cache + invalidation graph +
  query identity. Map and reality have forked.
- **important — gap.** `systems/cache/docs/00-charter.md` line 11
  still says "Integration with persistence (cached durably) and
  reactivity (entries are `State`s)". Shipped `CacheStore`
  (`component/src/cache.ts:45-57`) is a plain
  `Promise<CacheEntry|null>` interface — not a reactive `State`.
- **important — gap (ADR-0005 boundary).**
  `CacheEntry.inlineStyleAttrHashes` (`component/src/cache.ts:42`,
  T6-B) is a content-derived hash list, not auth state — does not
  violate "no per-request state". However, ADR 0005 and
  `CacheEntry`'s doc are silent on the boundary between
  "content-derived" and "per-request" state. A future contributor
  adding a per-user `Set-Cookie` to `CacheEntry.headers` wouldn't be
  caught by structural ALS isolation: `CacheStore` is keyed by URL
  string, shared cross-request. Invariant lives in `cache(fn)` only.
- **What's solid.** `cache(fn)`'s `runWithCapabilityScopeSync`
  isolation (`component/src/cache.ts:281`) matches ADR 0005 and
  platform charter #8.

**Next move:** ratify the "cache deferred / `CacheStore` lives in
component" reality in `00-system-map.md` and `00-charter.md`, OR
restore the original system + interface.

---

## `systems/persistence`

- **important — drift.** Charter
  (`systems/persistence/docs/00-charter.md:27-34`) and
  `04-interfaces.md:79-84` both specify the adapter as
  `initial()`/`observe(onChange: (next: T) => void)`/`write(next: T)`/
  `conflict?`. Shipped (`systems/persistence/src/index.ts:35-65`) is
  `load()`/`save(value)`/`observe?(onChange: () => void)`/`refresh?()`.
  Three of four method names differ; `conflict` is missing; `refresh`
  is new and undocumented.
- **important — drift.** Charter implies *reactivity* owns the type;
  shipped reality: persistence owns and exports `persistedState`,
  reactivity does not. `04-interfaces.md:86-89`'s
  `export function persistedState from systems/reactivity` is wrong.
- **important — gap.** Charter line 9 lists adapters (in-memory,
  IndexedDB, server-synced LWW/CRDT/OT) and "sync state visibility"
  as State. Shipped: `serverAdapter` exists but exposes zero sync-state
  observability — no online/offline State, no lag, no queue.
- **Local-first (platform #6) — aligned in spirit.** `load` is sync;
  `serverAdapter.cached` defaults locally; network failures are
  silent and cached value survives.

---

## `systems/search`

**Aligned.** Charter scope frames v0.1 as substring/structured
queries; shipped `searchable` (`src/index.ts:48`) is exactly that.
Bigger items (ranking, embeddings, inverted index) explicitly
deferred in README + source. Map dependency claim on "data,
persistence, cache" is over-claimed for v0.1 (shipped depends on
nothing but a `() => readonly T[]` callable), but that's a planned
future state — nit at most.

---

## `systems/security`

- **blocking — contradiction.** `systems/security` has NO
  `docs/00-charter.md` file (only `src/index.ts`, `tests/`,
  `package.json`). Audit prompt names it; file is absent.
  `security` is not on the nine systems list in
  `docs/platform/00-system-map.md:11-21` either. Shipped
  `@place/security` package is in charter limbo: it exists, it's
  used, but it's unmapped and ungoverned. Platform non-negotiable #5
  ("each system independently understandable") cannot hold for a
  system with no charter doc.
- **important — drift.** `src/index.ts:32-35` header says "What this
  is NOT: An auth library." Surface as shipped: `SessionCap` +
  `requireSession` + `csrfToken` + `signedToken` + cookie helpers +
  `rateLimit`. That's the substrate of an auth library, not
  "primitives unrelated to auth."
- **blocking — gap.** CSP/SRI/nonce/body-limit/same-origin/auto-CSRF
  plumbing lives in `systems/component/src/security-headers.ts`
  (per ADR 0025), not in `@place/security`. No doc attributes which
  guarantees come from which system. `@place/security` exports
  `CSP_DEFAULTS` + `cspHeader` (`src/index.ts:307-331`) which look
  like *the* CSP entry point but are actually a vestigial starter —
  the real CSP pipeline (`renderSecurityHeaders`,
  presets, T6-B `'unsafe-hashes'` auto-injection) is in `component`.
  A reader asking "where is CSP configured?" hits the wrong file.
- **important — gap.** ADR 0025's threat-model table claims
  SRI, CSP-nonces, auto-CSRF, body-size limits, prototype-pollution
  strip as platform defaults. None of those guarantees are
  documented in any system charter. The closest is `component`'s
  system-map line ("typed metadata + CSP"). Full security posture
  split across an ADR and source comments.
- **important — gap (charter #7 "magic with clarity" at risk).** T6-B
  auto-injection of `'unsafe-hashes'` when `inlineStyleAttrHashes` is
  non-empty (`security-headers.ts:371-383`) is a substantive
  CSP-policy change: strict CSP silently gains `'unsafe-hashes'`
  whenever the renderer collects style-attribute hashes. Documented
  only in source comments + `CacheEntry`'s JSDoc. The inference is
  type-discoverable (the field exists) but the *consequence* (CSP
  relaxes to allow `'unsafe-hashes'`) is not. Worth surfacing in a
  charter or ADR-0025 update.

**Next move:** write `systems/security/docs/00-charter.md` (adding
`security` to the system map as the 10th system, or folding it under
`capability` with a doc redirect).

---

## Cross-cutting observations

1. **Charter rewrite is the dominant follow-up.** Two of nine systems
   have v0.3-era stub charters that don't describe shipped code
   (`capability`, `routing`). One has no charter at all (`security`).
   One charter describes a system that doesn't exist yet (`data`).
   This is the natural follow-up to ADR 0026's charter pivot — a
   per-system rewrite sweep that quotes the new "magic with clarity"
   three-criteria gate (a/b/c) and matches each system's commitments
   against shipped reality.
2. **`__placeClientImport` expando pattern** (`routing`) is the most
   important ADR-0026 (a) miss. The metadata should become a named
   `Symbol` or named field on a typed router-factory interface so
   the call-site `pathRouter` reveals the auto-install behavior.
3. **`04-interfaces.md` is stale** in at least two places: the
   persistence adapter signature (`initial`/`observe`/`write`/`conflict`
   vs shipped `load`/`save`/`observe`/`refresh`) and the location of
   `persistedState` (reactivity vs persistence).
4. **The bug-fix sweep (T6-A through T6-F) is clean** — agents found
   no regressions and several specific compliments for the byte-stable
   SRI design and the per-response CSP hash injection. ADR-0026's
   three criteria all hold for the new magic.
5. **`@place/design` 5-file Tailwind-escape-hatch erosion** is the
   highest-priority quick win: each one is a 1-3 line edit to lift
   the arbitrary value into a token, and the charter explicitly names
   this failure mode.

---

## Recommended follow-up Tier (Tier 7, sketch)

Three parallelable tracks, each its own ADR + commit:

- **T7-A — Per-system charter rewrite.** Bring `capability`,
  `routing`, `security` charters in sync with shipped surface; quote
  the ADR-0026 gate. Effort: ~3 sessions (one per system + a unified
  PR).
- **T7-B — Interface doc refresh.** Update `04-interfaces.md` for
  persistence adapter shape + `persistedState` location +
  `__placeClientImport` typing. Effort: ~1 session.
- **T7-C — Design library token migration.** Migrate the 5 files of
  arbitrary Tailwind values to tokens; expand `themeTokens()` to
  cover the design-token gaps (oklch literals in Badge/Toast).
  Effort: ~1 session.

These are not blocking ship; the framework runs correctly today.
They are blocking the perfection-bar the project has set for itself.
