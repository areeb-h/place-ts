# ADR 0014: CSP-safe inline style writes via `CSSStyleDeclaration.setProperty`

**Status:** accepted
**Date:** 2026-05-13
**Affects:** `systems/component/src/index.ts` `setAttr` style branch + the
new `applyStyleStringSafe` / `applyStyleObjectSafe` / `removeAllInlineStyle`
helpers; `systems/component/tests/unit/style-csp.test.ts`

## Context

The docs site's reactivity demo writes a reactive CSS custom property on
every animation frame:

```tsx
<div class="reactivity-node" style={() => `--flash-age: ${age()};`} />
```

Under the framework's default `security: 'standard'` preset (CSP
`style-src 'self' 'sha256-…' 'sha256-…' 'sha256-…'`), the browser logged:

> Applying inline style violates the following Content Security Policy
> directive 'style-src 'self' 'sha256-…' 'sha256-…' 'sha256-…''. Either
> the 'unsafe-inline' keyword, a hash, or a nonce is required to enable
> inline execution. Note that hashes do not apply to event handlers,
> style attributes and javascript: navigations unless the 'unsafe-hashes'
> keyword is present. The action has been blocked.

Traced to `setAttr`'s style branch in `index.ts`:

```ts
if (key === 'style') {
  if (typeof value === 'string') node.setAttribute('style', value)
  else if (value && typeof value === 'object') Object.assign(node.style, value)
  else node.removeAttribute('style')
  return
}
```

`setAttribute('style', …)` and `node.style.cssText = …` are both
classified by CSP as inline-style application. Without `'unsafe-inline'`
or a `'unsafe-hashes'` allowance, every runtime style write was being
rejected.

This is correctness-critical: the framework promises reactive props
work, and the default security posture must NOT require apps to relax
CSP to use the framework.

## Options considered

1. **Document a CSP escape hatch.** Tell users to override
   `security.csp.styleSrcAttr` to include `'unsafe-hashes'` + the per-
   write hash. Rejected: pushes complexity to every app, violates
   "framework primitives must work under our default CSP," and the
   per-write hash for every reactive frame would mean updating CSP
   headers per render — infeasible.

2. **Use a CSP nonce on style attributes.** Nonces on `<style>` blocks
   are standard, but nonces don't apply to inline `style="…"`
   attributes — only to `<style>` elements. Rejected: the spec
   forbids this; no path forward.

3. **Switch to `CSSStyleDeclaration.setProperty` / `.removeProperty`.**
   These API methods on `node.style` are programmatic mutation — CSP
   does not classify them as inline-style application and does NOT
   block them. The browser still updates the inline `style` attribute
   for visual + serialization purposes (so getters like
   `getAttribute('style')` continue to read what was written), but the
   blocked path (`setAttribute('style', …)`) is bypassed entirely.

## Decision

Option 3. `setAttr`'s style branch routes every write through three
helpers built on `node.style.setProperty` / `.removeProperty`. The
helpers handle string, object, and clearing forms; preserve
`!important` priority; correctly remove dropped properties on
reactive updates; and treat CSS custom properties (`--flash-age`)
identically to standard properties.

### Implementation

```ts
if (key === 'style') {
  if (value == null || value === false) return removeAllInlineStyle(node)
  if (typeof value === 'string') return applyStyleStringSafe(node, value)
  if (typeof value === 'object') return applyStyleObjectSafe(node, value)
  return
}
```

`applyStyleStringSafe` parses CSS declarations (`name: value[!important];`),
diffs against `node.style.item(i)` to drop missing properties, and
writes each remaining property via `setProperty(name, value, priority)`.
`applyStyleObjectSafe` does the same for object-shape style props
(camelCase → kebab-case for standard names; pass-through for
`--custom-*`). `removeAllInlineStyle` iterates backwards (the live
list shortens) and removes every property — never calls
`removeAttribute('style')` because that has the same CSP profile as
`setAttribute('style', …)`.

### Tests

`systems/component/tests/unit/style-csp.test.ts` (7 tests):

1. **Source check** — grep the framework source for
   `setAttribute('style', …)` and `style.cssText = …`; both must be
   zero. Catches regression at the lexical level (happy-dom's
   `setProperty` indirectly invokes `setAttribute` under the hood, so
   runtime DOM spying isn't reliable; static check is the right tool).
2. Static string style applies and `getPropertyValue` reads back.
3. Reactive `() => string` updates flow through across re-renders.
4. Object style maps camelCase → kebab-case and supports custom props.
5. Dropped properties are removed when reactive style swaps.
6. `null` / `false` clears every inline property.
7. `!important` priority preserved.

952/952 framework tests green.

### Verified end-to-end

After the fix:
- Strict-CSP docs site, `/concepts/reactivity` route, fresh build.
- `.reactivity-node` element's `style.cssText` reads back the
  reactive value (was empty under the broken implementation —
  proving CSP was rejecting the writes).
- Console: 0 CSP violation logs across navigation, interaction, hot
  state updates.

## Consequences

### User-visible

- Reactive style props work under the default `security: 'standard'`
  preset — no app-level CSP override needed.
- Apps shipping `security: 'strict'` (the locked-down preset) also
  benefit: their CSP gets even tighter without breaking the
  framework.
- The visible side-effect is unchanged: `getAttribute('style')` still
  returns the current cssText; the runtime just gets there via a
  CSP-tolerant API.

### Trade-offs

- Parsing a CSS string per write costs a touch more than the previous
  bulk `setAttribute`. For the demo's per-frame writes (~60 Hz), this
  is sub-millisecond — invisible. Compared to layout cost of an
  attribute mutation, parser cost is in the noise.
- The string parser is intentionally tolerant: trailing semicolons,
  missing semicolons on the last decl, `:` inside values
  (`url(data:…)`). Tested via the regression suite.

### Architectural

- Reinforces the "default CSP must be tight enough that apps don't
  feel pressure to loosen it" position. Every framework-level DOM
  mutation goes through CSP-tolerant APIs by construction.
- The `style-src-attr` directive (CSP-3) explicitly governs inline
  style attributes. Real browsers' `setProperty` is not subject to
  that directive — verified by the framework's runtime behavior
  matching what specs prescribe. (happy-dom's implementation is an
  artifact of how it serializes back to the attribute; not
  representative of real-browser CSP enforcement.)

## Out of scope

- Type-side narrowing of the `style` prop. `Reactive<string | Partial<CSSStyleDeclaration> | undefined>`
  is unchanged; further tightening (e.g. a typed `StyleObject` with
  camelCase + custom-property keys) is a separate ergonomics pass.
- Bulk apply via `node.style.cssText = …`. Could be faster for large
  static style strings, but is blocked by the same CSP layer as
  `setAttribute('style', …)`. We don't reach for it.
- CSP-3 `unsafe-hashes` support. We don't need it; per-write hashes
  for reactive frames would be infeasible anyway.

## Notes

- Spec references: [CSP-3 §6.3](https://www.w3.org/TR/CSP3/#style-src),
  [WHATWG `CSSStyleDeclaration.setProperty`](https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-setproperty).
- happy-dom's `style.setProperty` calls `element.setAttribute('style', cssText)` internally
  (verified via a spy harness during ADR work). Real browsers do NOT
  do this. The test suite uses a source-grep check rather than a
  runtime spy to avoid that false positive.
