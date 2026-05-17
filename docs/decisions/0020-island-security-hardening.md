# ADR 0020: Island security hardening

**Status:** accepted (T5-C security pass)
**Date:** 2026-05-14
**Affects:** `systems/component/src/index.ts` (the `island()` factory,
`<Island>` SSR marker, `safeStringifyIslandProps`);
`systems/component/src/build/island-bundler.ts` (auto-mount wrapper
template, name + src validation); `systems/component/src/meta.ts`
(CSP nonce on `extraScripts`).

## Context

T5-C (ADR 0019) shipped islands as the primary client-interactivity
boundary. Each island became a new attack surface: a per-island bundle
URL, an inline-serialized props attribute, a client-side auto-mount
runtime that reads and acts on DOM-supplied data. The user flagged
that **(a)** DX of the original `<Island name="x" props={...}>` was
clunky and **(b)** attack surface needs significant reduction.

This ADR documents the security hardening pass that landed alongside
the DX V2 (`island(srcUrl, fn)` factory + array form).

## Threat model (islands)

Surface | Threat | Mitigation
---|---|---
Island name string | XSS via attribute injection or CSS-selector injection if name contains `<`, `"`, `]`, `\` | Strict validation: name MUST match `/^[a-zA-Z0-9_-]+$/`, length ≤ 64, NOT in `{__proto__, constructor, prototype}`. Validated at three points: `island()` factory time, `<Island>` render time, island-bundler build time.
Island source path | Path traversal via `..` segments or absolute paths outside the project root | `validateIslandSrc()`: resolved path must start with `process.cwd()`. Rejects anything that resolves outside the project root.
SSR'd `data-place-island-props` attribute | Prototype-pollution payload (`{"__proto__":{...}}`) survives via JSON.parse | `safeStringifyIslandProps()` walks the input and STRIPS `__proto__` / `constructor` / `prototype` keys at every nesting level *before* embedding in the attribute. Defense-in-depth: the client's auto-mount runtime ALSO strips on read (`sanitizeProps()`).
Auto-mount wrapper template | Injection via interpolated `name`/path with hostile characters | All values embedded via `JSON.stringify` (handles `'`, `"`, `\`, newlines correctly). Combined with name validation, the wrapper template is injection-proof regardless of upstream input.
Auto-mount runtime `JSON.parse(raw)` | Prototype-pollution sentinel keys, malformed JSON | Try/catch + `sanitizeProps()` post-filter. Malformed JSON resolves to `{}`; sentinel keys are filtered out before passing to the island component.
Island bundle URL | CSP `script-src` rejection (no nonce → blocked under `'standard'` security preset) | `extraScripts` rendering now accepts a `scriptNonce` and applies it to every emitted `<script>` tag. The per-request nonce flows from `renderPage` options → `renderDocument` → island script tags.
File-system writes (`.place/island-entries/<name>.entry.ts`) | Writing files outside `.place/island-entries/` via crafted name | Names are restricted to `[a-zA-Z0-9_-]+`; no `..` or `/` allowed. The `resolve()` of `entriesDir + name + '.entry.ts'` cannot escape `entriesDir` given the name restriction.
Internal exports (`_beginIslandCollection` etc.) | Misuse by app code | Prefixed with `_` (existing convention). Future cut: extract to `_internal/` and remove from the public re-export list.

## Decision

Apply all six mitigations above. They compose:

1. **Name validation** (`validateIslandName`) at `island()` factory,
   `<Island>` render, AND `buildIslandBundles()` build — three layers.
2. **Src path validation** (`validateIslandSrc`) at build time.
3. **Server-side props sanitization** (`safeStringifyIslandProps`)
   strips sentinel keys before SSR write.
4. **Client-side props sanitization** (`sanitizeProps` in the auto-
   mount wrapper) strips sentinel keys after JSON.parse.
5. **CSP nonce** on every emitted `<script>` (bootstrap + island
   scripts) when `scriptNonce` is provided.
6. **JSON.stringify-based template interpolation** in the auto-mount
   wrapper so no upstream input can break out of a string literal.

The strict name rule is the keystone: it bounds what can flow into
HTML attributes, CSS selectors, file paths, and JS string literals.
Everything else is layered protection on top.

## Verification

Run the verification probe:

    bun examples/docs/probes/verify-t5c.tsx

Expected output:

- Test A (page without islands): 0 islands collected, 0 KB JS shipped
- Test B (page with `<Counter>`): typed JSX call, marker correctly
  emitted
- Test C (proto-pollution sanitization at SSR): serialized props
  contain `{"start":5}` only; `__proto__` and `constructor` keys
  stripped at serialization (✓ clean)
- Test D (per-island bundle): bundle includes auto-mount marker
  query AND the proto-key sweep (✓ both present)
- Test E (invalid name rejection):
  - `__proto__` as filename → "name '__proto__' is reserved"
  - `<script>alert(1)</script>` as filename → "name '<…>' contains
    invalid characters"

Run the full test suite:

    bun run typecheck   # 14 projects clean
    bun run test        # 1090 passed / 14 skipped / 0 failed

## Consequences

### Positive

- **Attack surface trimmed.** Each documented mitigation closes a
  specific class of vulnerability. The island system is now CSP-strict
  by default, proto-pollution-safe at both ends, and rejects malformed
  names at three layers.
- **DX improvement is non-negotiated.** The new `island(srcUrl, fn)`
  factory is shorter than the record form AND safer than the legacy
  `<Island name="...">` API (name is derived from filename, validated
  immediately).
- **Defense-in-depth.** Multiple validation passes mean any single-
  layer mistake (e.g., a future refactor that bypasses one check) is
  caught by the others.

### Cost

- **~1 KB added to per-island bundle.** The `sanitizeProps()` + try/
  catch in the auto-mount wrapper is unconditional overhead. Worth it
  for the proto-pollution defense.
- **Stricter naming rules.** Users can't name an island `my.cool.thing`
  or `my-island/v2`. The error message tells them why and what to do.
  This is a feature, not a bug — portable, safe, predictable names.
- **Bundle size on verify probe: 9.87 KB gzipped** (vs 7.64 KB pre-
  hardening). Still well under Astro's per-component bundle floor.

### What this does NOT do

- Doesn't audit user-written island components for XSS in their own
  rendered HTML. That's the user's responsibility; the framework
  provides escaping helpers (`escapeHtmlAttrFull`, `escapeHtmlText`)
  but can't enforce them.
- Doesn't sandbox the island module. If a user imports a malicious
  third-party module as an island, that module gets full access to
  `document` + framework runtime. Standard JS trust boundaries apply.
- Doesn't audit the framework runtime (`mount`, signal core) for
  vulnerabilities. That's a separate audit pass.

## Open follow-ups

- **Tier 5 follow-up: SRI** (subresource integrity) on per-island
  `<script>` tags. The framework already has the bundle's content
  hash from T5-B-1; emitting an `integrity="sha384-..."` attr would
  prevent CDN tampering on the bundle.
- **CSP `script-src` validation**: ensure the per-request nonce
  emitted in the script tag matches the one the security headers set.
  Today both are sourced from the same `scriptNonce` variable, but a
  conformance test should pin this contract.
- **Audit the `__PLACE_BROWSER__` define propagation** end-to-end:
  verify no server-only branch reaches a per-island bundle.
- **Reduce public surface**: move internal `_`-prefixed exports
  (`_beginIslandCollection`, `_setIslandRegistry`, etc.) into an
  internal module not re-exported from `@place/component`. Internal
  callers import via the internal path; external code can't reach
  them at all.
