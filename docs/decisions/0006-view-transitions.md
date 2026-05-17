# ADR 0006: View Transitions are CSS, not framework-shaped wrappers

**Status:** accepted
**Date:** 2026-05-08
**Affects:** `@place/component` (`serve()` adds `viewTransitions?: boolean`)

## Context

Smooth cross-page transitions are a real UX win. The browser's View Transitions API ([Chrome 111+, Safari 18+, Firefox 144+ via Interop 2025](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document)) provides:

- **Same-document:** `document.startViewTransition(updateCallback)` — JS-driven snapshot/morph for SPA route swaps.
- **Cross-document:** `@view-transition { navigation: auto; }` — CSS-only, automatic on same-origin navigations. No JS API call required.

Each major framework took a different approach:
- **SvelteKit** ships a thin `onNavigate` hook — wrap your DOM swap in `document.startViewTransition`. Deliberately no abstraction.
- **Astro** built `<ClientRouter />` — a heavy wrapper that intercepts navigation, simulates VT in unsupported browsers, and ships custom `transition:*` directives. The 2025 community arc has been **away from `<ClientRouter />`** because cross-document VT became stable enough to use directly.
- **Nuxt** ships `definePageMeta({ viewTransition: ... })` per-page configuration with `types` for named transitions.

## Decision

place-ts ships **the standards path, nothing more**: an opt-in `serve({ viewTransitions: true })` that injects `@view-transition { navigation: auto; }` (gated on `prefers-reduced-motion: no-preference`) into every page's `<head>`. No JS, no per-element API, no `<ClientRouter>` wrapper.

```ts
serve({
  routes: { '/': home, '/posts/:id': post },
  viewTransitions: true,   // ← entire wiring
})
```

Pages style their own animations via standard CSS:

```css
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 0.3s;
}
```

Browsers without cross-document VT support ignore the at-rule and navigate normally. No fallback shim. No degradation logic.

## Why not build a `<ClientRouter>`-shaped wrapper

- **The browser API is the contract.** `@view-transition` is now Baseline (Firefox 144 closed the gap in October 2025 via Interop). Wrapping a stable browser API multiplies the maintenance surface for zero capability gain.
- **Astro's arc is the cautionary tale.** `<ClientRouter />` shipped before cross-document VT was widely available; once the browser API matured, the wrapper became dead weight that the community is now actively migrating away from.
- **Reduced-motion is a CSS concern.** The `@media (prefers-reduced-motion: no-preference)` gate is one line of CSS. Reimplementing it in JS would just duplicate `matchMedia` checks already done by the browser.
- **Per-route configuration belongs in CSS.** Naming, durations, easing, and named transitions are all expressible in pure CSS. There's no framework-side type that adds value over `view-transition-name: hero` on the relevant element.

## Why opt-in instead of default-on

- Not every app wants page-transition animation. A content-heavy commonplace book might; a sandbox/playground app shouldn't.
- The opt-in flag is one bool. The cost of opting out (default) is zero bytes; the cost of opting in is one CSS at-rule (~50 bytes).

## Consequences

- **Positive:** zero new API surface. The framework's job is the on/off switch and the reduced-motion gate. Apps own their animations entirely via CSS.
- **Positive:** survives browser API evolution. If `@view-transition` gains new modes (`types`, `from`, etc.), apps can adopt them without waiting for a framework update.
- **Positive:** no JS bundle weight. A framework-side router-wrapping helper would add bytes; this adds none.
- **Constraint accepted:** apps that need same-document (SPA-style) view transitions and don't want cross-document navigation still have to call `document.startViewTransition` themselves. We don't ship a helper because:
  - Hash-router and history-router transitions are app-specific routing concerns.
  - Adding one helper invites the rest of Astro's `<ClientRouter />` surface to follow.
  - If a future workload wants this, the trigger is "first commonplace-shaped app that uses view transitions for hash-router navigation"; ship a `withViewTransition(fn)` async helper at that point — small and orthogonal.
- **Compose with existing primitives:** `<ClientOnly>` and `<Deferred>` (ADR-pending in the C1b cut) interact correctly with view transitions because deferred mounts happen outside the captured `startViewTransition` frame — the snapshot captures the placeholder, the mount happens after, which is the right sequence. Document this as a usage note rather than engineering around it.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| `<ClientRouter />`-shaped wrapper (Astro) | Multiplies maintenance; the community is migrating away from this shape now that cross-document VT is Baseline |
| Per-page meta field (Nuxt's `definePageMeta`) | Couples meta API to a CSS feature; per-page granularity is achievable via per-route CSS selectors anyway |
| Default-on with `viewTransitions: false` opt-out | Not every app wants navigation animation; opt-in respects user-of-framework intent |
| JS-side `withViewTransition()` helper for client routers | Out of scope for this cut. Ship if a concrete consumer demands it; the trigger is named in "Consequences" above |
| Inline `<script>` setting up `document.startViewTransition` for cross-route nav | Adds JS bundle weight + CSP nonce dance; the CSS at-rule covers cross-document MPA-style nav with zero JS |

## Sources

- [Chrome cross-document view transitions (Chrome 126+)](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document)
- [Chrome same-document view transitions](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)
- [SvelteKit `onNavigate` blog post](https://svelte.dev/blog/view-transitions)
- [Astro's `<ClientRouter />` docs](https://docs.astro.build/en/guides/view-transitions/) and the community pivot to standards-first
- Internal: [research-img-vt-cli.md](../../research-img-vt-cli.md) for the full pain-point survey

## How to adopt

```ts
// server.tsx
import { serve } from '@place/component'

await serve({
  port: 5174,
  routes: { '/': home, '/posts/:id': post },
  viewTransitions: true,
})
```

```css
/* app's CSS — Tailwind via @layer or a plain stylesheet */
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 200ms;
  animation-fill-mode: forwards; /* fixes image-flicker on shared images */
}
```

That's the entire surface.
