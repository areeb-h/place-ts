# ADR 0031: Page directive ergonomics — string `meta`, title templates, `<h1>` auto-title

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/component/src/index.ts` (PageDef + LayoutDef +
AnyPage + AnyLayout `meta` type widened; auto-title hook in
`renderPage`); `systems/component/src/meta.ts` (PageMeta adds
`titleTemplate` + `titleAbsolute`; `renderMeta` applies template
substitution); `examples/docs/src/layouts/docs.layout.tsx` (template
declared at the root); 17 docs pages migrated.

## Context

Across the docs site, every page repeats the same boilerplate:

```ts
export default page('/why', {
  meta: { title: 'Why place · place docs' },
  view: () => (
    <article class="prose max-w-3xl">
      <h1>Why place</h1>
      …
    </article>
  ),
})
```

The `meta:` line carries three smells:

1. **Duplication of `<h1>`.** The page already declares `<h1>Why place</h1>`
   structurally; the `meta.title` repeats it.
2. **Repeated site suffix.** Every page glues ` · place docs` onto its
   title manually — a fact that belongs in the layout, not on every
   leaf page.
3. **Object literal for a single string.** `{ title: 'Why place' }` is
   verbose for what 90 % of callers actually want.

The Next.js answer is a `metadata` export that supports a
`titleTemplate` config; the SvelteKit answer is a `<svelte:head>`
slot that authors fill in by hand. Neither does what we want, which
is to let the framework *derive* the title from the content the
author already wrote.

## Decision

Three additive changes to the page/layout directives. None are
breaking; all old shapes continue to work.

### 1. String `meta` shorthand

`PageDef.meta` and `LayoutDef.meta` now accept a plain string:

```ts
meta: 'Why place'   // equivalent to { title: 'Why place' }
```

Functions returning strings are normalized too:

```ts
meta: ({ post }) => post.title   // returns string → { title }
meta: ({ post }) => ({ title: post.title, og: { … } })  // object — full PageMeta
```

The normalization lives in a single internal helper `resolveMeta()`
called wherever meta is evaluated (sync and streaming render paths,
both the error fall-back render and the normal render).

### 2. `PageMeta.titleTemplate` (with `titleAbsolute` opt-out)

The layout declares the template once:

```ts
layout({
  meta: { titleTemplate: '%s · place docs' },
  view: …,
})
```

`%s` is the placeholder. `renderMeta` substitutes the leaf title
into the template when emitting `<title>`. Pages with a `title`
field automatically inherit the template; pages with no `title`
field inherit the template AND combine with the auto-title (item 3)
to produce a final composed title from `<h1>` text alone.

Opt-out for pages that want a verbatim title (typically the
landing page):

```ts
page('/', {
  meta: { title: 'place', titleAbsolute: true },
  view: …,
})
```

### 3. Auto-title from the first `<h1>` inside `<main>`

When a page has no `meta.title` (and `titleAbsolute` is not set), the
framework promotes the text of the first `<h1>` rendered inside
`<main>` to the document title. Combined with item 2, content pages
need no `meta:` field at all:

```ts
page('/why', {
  view: () => (
    <article>
      <h1>Why place</h1>
      …
    </article>
  ),
})
// → <title>Why place · place docs</title>
```

The h1 text harvest reuses the existing `_beginHeadingCollection()` /
`elementToHtml` heading-collector plumbing (originally built for the
ToC island's `ssrProps`). h1 is captured in a separate channel
(`currentFirstH1Text`) from the h2/h3 array, so consumers that only
want TOC entries don't have to filter by level.

## How it stacks with the charter ("magic with clarity")

ADR 0026 reframed non-negotiable #7 around three criteria. Each of
the three changes passes those criteria:

| Criterion | Check |
|---|---|
| **Discoverable in source** | Each call site shows `meta: …` (or its absence). Hover the `meta` field in your editor → JSDoc enumerates the three shapes. Auto-title behaviour is documented inline on `PageDef.meta`. |
| **Traceable in tooling** | The framework's build report shows the resolved `<title>` per page in the existing `view-manifest.json`. Removing the `meta:` field is a non-event in the manifest — the title field still resolves. |
| **Faithful to performance** | Auto-title costs O(1) per render: one extra string assignment in `elementToHtml` when an h1 inside `<main>` is reached. Template substitution is a single `String.replace('%s', …)` at SSR meta emission. Zero client-side cost. |

## Consequences

**Positive:**
- 17 docs pages dropped or shortened their `meta:` line; the layout
  owns the suffix, the framework reads the h1.
- The "DRY content title" pattern surfaces without a generated file,
  without a slot/portal mechanism, and without authoring a
  `<svelte:head>`-style block.
- The fundamentals layer below (`page()` ergonomics) is now smaller
  and matches the small DSL the user expects on a content site.

**Trade-offs:**
- Streaming pages do not yet auto-title: the heading collector is
  opened only around the sync `renderToString` call, not inside
  `renderToStream`. Streaming pages must declare `meta:` (string
  shorthand still works). A future cut can wire the collector
  through `renderToStream`; not in this round to keep the change
  surface tight.
- The "first h1" rule is deliberately first-h1-wins. If a page
  contains multiple h1's (rare; usually an authoring mistake), only
  the first is used. The render-time collector skips h1 outside
  `<main>` so layout-level h1's (e.g. a site brand) don't shadow the
  page's title.

**Non-goals:**
- We do not derive `description` from the first `<p>`. Description
  semantics are too varied (some pages want a curated summary; some
  want the lead paragraph; some want a hand-written marketing line)
  and prior art (Next, SvelteKit, Astro) all leave this to the
  author. Auto-derivation here would pick wrong on most pages.
- We do not support `titleTemplate` as a function. `String.replace`
  with `%s` covers every observed use; the function-arity dance
  (which props does it see? layout's? merged?) would multiply the
  surface for a niche win.

## Migration

Pre-publish: no compatibility shim, no deprecation. Pages keeping
their old `meta: { title: '…' }` blocks still work — the change is
purely additive. The docs site migration in this round is the
canonical demonstration:

- Landing → `meta: { title: 'place — a TS-first web platform', titleAbsolute: true }`
- 19 content pages → no `meta:` field (auto-title)
- 2 search-friendly title pages → `meta: '…'` (string shorthand)
- 1 streaming page → `meta: 'Streaming SSR'` (string shorthand;
  auto-title doesn't fire in streaming pipeline)

## Verification

- 1136 tests pass (baseline 1129 + 7 new tests covering: string
  shorthand, function returning string, auto-title from h1,
  `titleTemplate` composition, `titleAbsolute` opt-out, explicit
  `meta.title` taking precedence over auto-derivation, layout
  template + page string-shorthand composition).
- 14 typecheck projects clean.
- Live docs site curl-check: all 25 routes return the expected
  `<title>` (15 auto-derived, 8 string-shorthand, 1 absolute, 1
  streaming-with-explicit).

## Related ADRs

- **0026** — "magic with clarity": the criteria this change passes.
- **0019** — typed island marker (`island="…"` prop vs string
  directive); same "typed-shorthand-over-magic-string" pattern.
- **0030** — unified hydration: the view-classifier reads typed
  effect kinds off primitives without authors writing manifest
  entries. Same shape: framework infers from typed structure.
