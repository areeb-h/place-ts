# 07 — Prior Art Failures

What other platforms got wrong, and what we deliberately avoid because of it. Counterpoint to [01-charter.md](01-charter.md): the charter says what we *will* do; this doc says what we *will not*, with names and specifics.

"Don't repeat the mistakes others made" is not actionable as a slogan. It only becomes actionable when the mistakes are named, the failure modes specified, and the alternative explicit.

Each entry: the platform, what it got wrong, the failure mode, what we do instead.

---

## Next.js

A React meta-framework that bundles routing, rendering modes, data fetching, server functions, caching, and a build pipeline into one product.

### Failure: the App Router / Pages Router schism

App Router introduced a parallel routing system that made Pages Router users second-class. Migration was nontrivial and lossy. The community paid for the architectural choice for years.

**What we do instead:** systems are independently versionable. A v0.2 → v0.3 transition in routing does not force a rewrite of components or data layer. Interfaces are versioned; ADRs record breaking changes; stability tiers ([04-interfaces.md](04-interfaces.md)) are honored.

### Failure: magic file conventions

`page.tsx`, `layout.tsx`, `route.ts`, `"use client"`, `"use server"`, special folder names. The framework dictates structure; structure is not expressed by types.

**What we do instead:** structure is expressed by types and explicit imports. There is no "this filename means X" magic. The build system analyses *what code does*, not where it lives.

### Failure: coupling everything to one monolith

Routing, rendering, data, bundling, deployment — all coupled. Cannot use one without the others.

**What we do instead:** nine independently-understandable systems, each with its own charter. Routing without components is meaningful. Reactivity without routing is meaningful. The platform's coherence is *additive*, not coupled.

### Failure: hidden async-local-storage globals

`headers()`, `cookies()`, request context stored on AsyncLocalStorage. Action at a distance.

**What we do instead:** capabilities are passed explicitly via the capability system. A function that reads cookies declares it in its type and runs in a scope where a cookie handler is installed. No globals.

### Failure: multiple rendering modes with subtle interactions

SSG, SSR, ISR, React Server Components, client components, Suspense boundaries. Each is plausible alone; the combinatorial space is bewildering.

**What we do instead:** one rendering model. Time-indexed reactive graph. SSR is "render the graph at tick T on the server, serialize it, restore it on client." There is no "ISR mode" or "RSC mode." Resumability falls out of graph serialization.

### Failure: caching defaults that surprise

`fetch` was cached by default, then opt-out, then deprecated, then changed. Multiple cache tiers (data cache, full route cache, router cache, request memoization) interacting.

**What we do instead:** caching is a separate system with explicit policies. The default is "no caching" and caching is opt-in, named, and inspectable. Cache state is part of the graph and visible in dev tools.

### Failure: Vercel-shaped optimizations leaking into the framework

Edge runtime, ISR, Image component all carry assumptions about a specific deploy target.

**What we do instead:** persistence is its own system with adapters. There is no privileged deploy target. The platform runs the same way against IndexedDB, against a self-hosted server, against a managed sync service.

### Failure: Server Actions as strings-as-RPC

A function with `"use server"` becomes an RPC endpoint identified by a content hash, with hidden serialization, no capability story.

**What we do instead:** typed effects + capability handlers. A function that wants to perform a server-side mutation declares the effect in its type; the framework root installs the handler that performs the RPC. The wire format is a build artefact, not a runtime surprise.

### Failure: compiler opacity

Turbopack and the Next.js compiler rewrite user code in ways the user can't see. Source maps are best-effort. Debugging is fighting the rewrites.

**What we do instead:** the build system's outputs are inspectable. Closure hashes, effect-kind analyses, auto-imported identifiers, per-island manifests, and any compile-time rewrites are documented and visible. The discipline is not *less* magic, it is *visible* magic — see charter non-negotiable #7 ("Magic with clarity") and [ADR 0026](../decisions/0026-magic-with-clarity.md).

### Failure: no clear platform map

What does Next.js own? "The whole thing." Which means: nothing cleanly.

**What we do instead:** [00-system-map.md](00-system-map.md). Nine systems. Each with its own scope. The platform is the coherence; ownership is per-system.

---

## Meteor

Reactive isomorphic full-stack platform; once the JavaScript reference for "platform of systems."

### Failure: reactivity tied to one transport

DDP was the reactivity transport. Components could not be moved off it without losing reactivity. Could not compose with non-DDP data.

**What we do instead:** reactivity is the foundation, transport-agnostic. Persistence adapters are pluggable; reactivity does not care which one is in use.

### Failure: single global state space

Mongo collections were global, accessed by name. No scoping. Two collections with the same name conflicted.

**What we do instead:** capability scopes. State has identity through the graph, not through global names.

### Failure: Atmosphere package manager fork

Meteor maintained its own package manager separate from npm, isolating its supply chain.

**What we do instead:** standard tooling. Bun + npm registry. We do not fork the ecosystem.

### Failure: monolith without typed boundaries

Meteor was isomorphic at the runtime level but did not have typed boundaries between client and server. Data shapes drifted silently.

**What we do instead:** typed effects + interfaces. Boundaries are typed and enforced.

---

## Blitz

A "framework on Next.js" that added RPC and Rails-shaped scaffolding.

### Failure: built on a moving foundation

Blitz tied itself to Next.js. When Next.js changed (App Router), Blitz had to choose between rewriting on top or maintaining a divergent fork. The team eventually pivoted Blitz to a "toolkit" rather than a framework.

**What we do instead:** the platform owns its foundation. Reactivity is ours. Build is ours. We do not stack on a moving target.

### Failure: adding features without addressing inherited debts

Blitz inherited Next.js's coupling and added more on top of it.

**What we do instead:** systems compose because they're designed to. We add capabilities, not bandages.

---

## Redwood

Full-stack platform with strong opinions: GraphQL, React, Storybook, Cells.

### Failure: heavy initial scaffolding

A new Redwood project starts with substantial code. Beginners are overwhelmed; experts find the scaffolding restrictive.

**What we do instead:** v0.1 demo runs on the reactivity primitive plus the commonplace example. Adding scaffolding is a deliberate later choice, not a default.

### Failure: workflow opinions everyone doesn't share

Storybook-driven component development assumes a workflow some teams don't want.

**What we do instead:** the platform supports workflows; it does not prescribe them.

### Failure: Cell pattern coupled to React

Cells are a React-specific data-fetching pattern. They don't generalize.

**What we do instead:** the data system's queries are typed `State`s; they don't depend on a specific render layer.

---

## React (recap — covered also in [systems/reactivity/docs/01-pain-points.md](../../systems/reactivity/docs/01-pain-points.md))

These are foundational lessons; brief recap because they shape the whole platform.

- **`useEffect` as the universal escape hatch.** What we do instead: derivation as primary; effects as typed and rare.
- **Strict mode introducing double renders to catch bugs the model creates.** What we do instead: a model that doesn't create those bugs in the first place.
- **The Compiler retrofitted to fix ergonomics.** What we do instead: design the ergonomics with the runtime; the build system enforces invariants, not papers over them.

---

## Recurring meta-lessons

Across all the failures above, six patterns repeat. These are the warning signs we check our own designs against. If a proposal triggers one, it's a sign we may be repeating a known failure.

1. **Bundling-without-boundary.** A platform that owns "everything" owns nothing cleanly. Boundaries are the platform's value.
2. **Magic conventions over typed contracts.** Types beat filename rules. Always.
3. **Globals leaking into the model.** Whether AsyncLocalStorage or Mongo collections, hidden globals hurt.
4. **Coupling to a deploy target.** Optimizations for a specific platform leak into the framework's API.
5. **Migration treadmills.** Breaking changes that force userland to rewrite are the most expensive mistakes a platform can make.
6. **Compiler opacity.** A compiler that rewrites code without users knowing what changes is hostile to debugging.

---

## How to use this doc

When designing a new system or interface, scan this doc for analogous decisions in prior platforms. If our design borrows the shape of a known-failed approach, *something* about our design needs to differ — or we need to be ready to fail the same way.

The Critic agent loads this doc when reviewing platform-level designs. The Researcher agent loads it when surveying prior art (so the survey doesn't restate what's already documented here). The Security Auditor loads it for pattern recognition.
