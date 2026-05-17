# ADR 0026: Charter pivot — "magic with clarity"

**Status:** accepted (2026-05-15)
**Date:** 2026-05-15
**Affects:** `docs/platform/01-charter.md` (non-negotiable #7 rewritten);
`docs/platform/07-prior-art-failures.md` (compiler-opacity rebuttal
updated); `systems/component/docs/00-charter.md` (commitment #3
narrowed from "no magic markers" to "no string-directive markers").

## Context

The earlier charter non-negotiable #7 read:

> AI-friendly throughout. Typed everything. Explicit syntax. Predictable
> shapes. **No compiler magic that hides intent.** Identifiers carry
> meaning. The compiler is part of the contract; ergonomics for humans
> and ergonomics for LLMs are the same problem.

The bolded clause was carried over from a phase when "magic" meant
"file conventions, string directives, runtime tagging that the user
can't see." The intent was real and correct: a reader of the source
should be able to predict the runtime behavior from the text. The
*phrasing* drifted, though, into reading as a general anti-magic
stance — which then collided with the framework's own direction:

- **Auto-imports** (ADR 0013) hand identifiers to the user without
  an `import` line. By the strict reading of the old clause that's
  magic that hides intent.
- **Typed islands** (ADR 0019) introduce a JSX-prop-driven build-time
  split that the user doesn't write out as a manifest. Same.
- **Auto cap-install** (ADR 0024) — the user writes `app({ router:
  pathRouter })` and the framework generates a side-effect-only
  init module the user never sees. Same.
- **CSP byte-stability + inline-style hashing** (T6-A/B) — the
  framework computes hashes per response and threads them into
  `style-src` without the user touching CSP at all. Same.
- **Universal aria-current updater** (T6-C) — every `[data-place-link]`
  in the document gets its active state synced on SPA nav by the
  framework's inline runtime. The user does not opt in or wire it.
  Same.

Each of those is *exactly the kind of magic the framework should
ship.* The user does less work, the result is more correct, and the
inference is **discoverable** (typed JSX prop, named metadata field,
documented helper).

A request from the user (2026-05-15): drop the absolute "no magic"
phrasing from the charter and replace it with a clearer formulation
that lets the framework keep going in this direction without each
new magical inference reading as a charter contradiction.

## Decision

**Charter non-negotiable #7 is rewritten** to:

> **Magic with clarity.** Typed everything. Explicit syntax. Predictable
> shapes. The framework adds compile-time and runtime magic — auto-
> imports, island discovery, auto cap-install, reactive props, typed
> reactive JSX directives — when it removes ceremony without removing
> observability. Every magical inference is (a) **discoverable in
> source** (typed JSX prop, named metadata field, exported helper —
> not a string-as-directive), (b) **traceable in tooling** (per-bundle
> origin, per-island manifest, the reactivity graph still spans it),
> and (c) **faithful to performance budgets** (no hidden cost that
> defeats a quoted floor). The discipline is not *less* magic, it is
> *visible* magic. Identifiers carry meaning. The compiler is part of
> the contract; ergonomics for humans and ergonomics for LLMs are the
> same problem.

The three criteria — **discoverable, traceable, faithful** — are the
gate every new magical inference passes through before it ships.

### What this **does** allow

- Typed JSX props that drive build-time transforms (`<MyWidget island>`,
  `style:transform={…}`, `class:active={…}`, `bind:value={state}`).
- Build-time plugins that resolve symbols against a typed registry
  (auto-import).
- Build-time discovery that scans a directory and produces an explicit
  manifest the dev can inspect (auto-discovered islands; an exposed
  manifest endpoint or build-time dump is part of the contract).
- Framework-generated source files (the `_auto-init.ts` cap-install
  module) — discoverable on disk, traceable by ADR.
- Per-response automatic CSP hash injection — the dev sees the CSP
  header in DevTools and the hashes correspond to literal style values
  the SSR emitted.
- Universal runtime hooks the framework installs once (e.g. SPA-nav's
  aria-current updater) — documented in the system's runtime contract
  and observable in the runtime source the framework ships.

### What this still **rejects**

- **String directives parsed as magic** (`'use server'`, `'use client'`,
  `'@swr'`-as-string). ADR 0003 + ADR 0019 still hold.
- **File-name conventions parsed as routing intent** (`page.tsx`,
  `+page.svelte`, `.server.ts` suffix). Routes are values.
- **Filename-as-export-name** (`my-component.tsx` exporting an
  implicit `MyComponent`). ADR 0003 still holds.
- **Untyped reactive context globals** the user can read but never see
  in source (React Context's pattern). The capability layer is the
  typed replacement.
- **Compiler rewrites whose output you can't grep for.** Source maps
  must let the dev see the transformed code on disk or in a build-
  dump file; rewrites that hide the result entirely are out.
- **Magic that buys ceremony reduction at the cost of a perf floor**
  (e.g. a global auto-subscribed store that's free to write but ships
  10KB minimum). The third criterion (faithful to budgets) blocks
  this.

### How `'magic with clarity'` reads in practice

For each proposed addition the framework runs three questions:

1. **Discoverable in source?** Can the dev read the call site and
   predict the behavior?
2. **Traceable in tooling?** Can the dev open DevTools / the build
   manifest / the source map / a generated file and see what the
   magic did?
3. **Faithful to budgets?** Is the cost bounded and disclosed (bundle
   size, render time, memory, network)?

Three yeses → ship. Any no → either restructure to fix the gap, or
reject.

## Consequences

### Positive

- The framework can continue layering ceremony-reducing magic without
  every ADR reading as a charter contradiction.
- The three criteria are sharper than "no magic" — they catch real
  failure modes (the kind ADR 0003 / 0019 reject) while letting in
  the kind of magic ADRs 0013, 0019, 0024 already shipped.
- The pivot is reflected in writing so future-me doesn't re-litigate.

### Negative

- The criteria are slightly subjective. "Traceable in tooling" allows
  arguing about whether a particular tool surface counts. The intent
  is that **someone shipping new framework magic carries the burden
  of building the discoverability/traceability surface alongside the
  feature** — not after.

### Documentation

- `docs/platform/01-charter.md` non-negotiable #7 rewritten in place.
- `docs/platform/07-prior-art-failures.md` "compiler opacity" rebuttal
  refreshed to align.
- `systems/component/docs/00-charter.md` commitment #3 narrowed from
  "no magic markers" to "no string-directive markers" (the
  distinction ADR 0019 already made).
- Casual mentions of "no magic" elsewhere in the codebase (probes,
  inline comments, page copy) are left as-is — they were rhetorical,
  not load-bearing. They can be cleaned up incrementally when
  individual files are next touched.

## Open questions (deferred)

- **Build-manifest format.** The "traceable in tooling" criterion
  asks for a per-island / per-route / per-auto-import manifest. We
  have ad-hoc disclosure today (the `.place/island-entries/` dir,
  the SSR'd `data-place-island` attrs); a unified manifest surface
  is a Tier 7 candidate.
- **Devtool surface.** Charter clause 3 ("the graph is observable")
  composes with clause 7 — the eventual reactivity-graph devtool is
  the place where "traceable in tooling" becomes literal. ADR 0017
  defers canvas pending devtool work; the devtool itself becomes the
  observability surface for *all* magic the framework ships, not just
  canvas.

## References

- [ADR 0003 — page as data + the server framework](./0003-page-as-data-and-the-server-framework.md) — string-directive rejection that survives this pivot.
- [ADR 0013 — auto-import plugin](./0013-auto-import-plugin.md) — already-shipped magic that passes the new criteria.
- [ADR 0019 — typed islands, not string directives](./0019-typed-islands-not-string-directives.md) — distinction-by-shape that prefigures this ADR.
- [ADR 0024 — SPA navigation + island DX](./0024-spa-nav-and-island-dx.md) — auto-cap-install magic.
- [ADR 0025 — SRI + attack-surface reduction](./0025-sri-and-attack-surface-reduction.md) — strict-CSP defaults that compose with T6-B's per-response hash injection.
