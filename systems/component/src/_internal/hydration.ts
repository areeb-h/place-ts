// Hydration state + dev-only audit registry.
//
// Two concerns colocated because they share the same lifecycle (the
// island hydrate path flips the flag and drains the deltas) and the
// same audience (the hydrate path on the client):
//
//   1. `_isHydratedState` — module-level reactive flag, false until
//      the island runtime finishes hydrating the SSR'd DOM. Used by
//      `onMount` and the internal `clientOnly`-capability placeholder
//      to decide "is it now safe to run browser-only work?" Lives on
//      the reactivity graph so subscribing to it is automatic.
//
//   2. The hydration auditor — dev-only mismatch detector. The framework
//      already throws on tag mismatches at hydrate time; this catches the
//      silent class / style / attr divergences that would otherwise adopt
//      the wrong DOM and produce subtle visual bugs. NODE_ENV-gated so
//      the prod build dead-code-eliminates the entire path.

import { state } from '@place-ts/reactivity'

// ===== Hydration-complete flag =====

const _isHydratedState = state(false)

/**
 * Internal — flip the hydration-complete flag. Called by the island
 * hydrate path once hydration finishes; exposed (underscore prefix) so
 * unit tests can simulate post-hydrate state.
 */
export function _setHydrated(value: boolean): void {
  _isHydratedState.write(value)
}

/**
 * Internal — read the current hydration-complete flag. Used by
 * `onMount` and the internal `clientOnly`-capability placeholder.
 * Exported (underscore-prefixed) for tests that assert on it.
 */
export function _readHydrated(): boolean {
  return _isHydratedState.read()
}

/** Internal — reactive accessor used by primitives that subscribe to
 *  the flag (e.g. `onMount`'s one-shot watch firing when the flag
 *  flips). Not part of the public API; the underscore prefix marks it. */
export function _readHydratedReactive(): boolean {
  return _isHydratedState()
}

/** Internal — the reactive state itself, exposed for callers that need
 *  to thread it into a reactive context (e.g. `onMount`'s one-shot
 *  watch on the flag flip). */
export const _isHydratedSignal = _isHydratedState

// ===== Hydration audit (dev-only) =====
//
// Detects mismatches between SSR'd HTML and client-side props at
// hydrate time. The framework already throws on tag mismatches; this
// catches the silent class/style/attr divergences that would otherwise
// adopt the wrong DOM and produce subtle visual bugs.
//
// Two delta kinds:
//   - `extension` — server has an attribute not in props matching a
//     known browser-extension prefix (Grammarly, Colorzilla, etc.).
//     Informational; safe to ignore.
//   - `mismatch`  — anything else. The user's view rendered different
//     output server-side vs client-side. Common causes: `Date.now()` or
//     `Math.random()` in render, `typeof window` branches, locale-
//     dependent formatting. Fix by moving browser-only dynamic
//     content into an island().

export interface HydrationDelta {
  selector: string
  attribute: string
  server: string
  client: string
  kind: 'extension' | 'mismatch'
  fixHint: string
}

const _hydrationDeltas: HydrationDelta[] = []

/**
 * Test/inspection helper — read the accumulated deltas without
 * draining them. Internal; intended for the hydrate.test.ts unit tests
 * and the delta flush at end of island hydration.
 */
export function _readHydrationDeltas(): readonly HydrationDelta[] {
  return _hydrationDeltas
}

/**
 * Test helper — drain accumulated deltas. The hydrate-end flush calls
 * this after warn-summarizing.
 */
export function _drainHydrationDeltas(): HydrationDelta[] {
  const out = _hydrationDeltas.slice()
  _hydrationDeltas.length = 0
  return out
}

// Known browser-extension attribute prefixes. Server has these because
// the FIRST request's response may have been touched by the user's
// extensions before our serialization (in dev-with-extensions setups);
// or — more commonly — the extension injects them post-mount AND post-
// SSR-string-capture. Either way: not the user's render bug.
const EXTENSION_PREFIXES = [
  'data-gramm', // Grammarly
  'data-grammarly',
  'cz-shortcut-listen', // Colorzilla
  'data-lt-', // LanguageTool
  'bis_skin_checked', // ByteDance ad blocker quirk
  'data-bitwarden', // Bitwarden
  'data-1p-ignore', // 1Password
  'data-lastpass-icon', // LastPass
  'data-darkreader', // Dark Reader
]

function isExtensionAttr(name: string): boolean {
  for (const pfx of EXTENSION_PREFIXES) {
    if (name.startsWith(pfx)) return true
  }
  return false
}

function cssSelectorFor(node: Element): string {
  // Best-effort selector for the warn output. tagName + nth-of-type
  // gives unambiguous identification within siblings; we don't need a
  // full DOM-path engine here.
  const tag = node.tagName.toLowerCase()
  const id = node.id ? `#${node.id}` : ''
  return `${tag}${id}`
}

function normalizeClassList(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).sort().join(' ')
}

/**
 * Compare the prop-derived expected attribute value for a key against
 * the actual server-rendered attribute. Returns true if they DIFFER
 * (i.e., a delta should be recorded). Class/style get whitespace-
 * insensitive comparison; everything else is exact-string.
 *
 * Reactive (functional) prop values are intentionally skipped — they
 * may resolve differently on every read; comparing the first resolved
 * value to the SSR'd value would flag legitimate static-then-reactive
 * patterns as false positives.
 */
function attrDiffers(key: string, expectedValue: unknown, actualValue: string | null): boolean {
  if (typeof expectedValue === 'function') return false // reactive — skip
  if (expectedValue === true) return actualValue === null
  if (expectedValue === false || expectedValue == null) return actualValue !== null
  const expected = String(expectedValue)
  const actual = actualValue ?? ''
  if (key === 'class' || key === 'className') {
    return normalizeClassList(expected) !== normalizeClassList(actual)
  }
  return expected !== actual
}

/**
 * Audit a single element's props against its server-rendered DOM
 * attributes. Pushes any deltas to the module-level accumulator.
 * Called from the hydrate path on every element adoption when
 * NODE_ENV !== 'production'.
 *
 * Reads from the DOM only — never mutates.
 */
export function _auditHydrationFrame(node: Element, props: Record<string, unknown>): void {
  const selector = cssSelectorFor(node)
  // Pass 1: declared props that differ from DOM.
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'ref') continue
    if (key.length > 2 && key.startsWith('on') && key[2] === key[2]?.toUpperCase()) continue
    const actual = node.getAttribute(key === 'className' ? 'class' : key)
    if (attrDiffers(key, value, actual)) {
      _hydrationDeltas.push({
        selector,
        attribute: key,
        server: actual ?? '(absent)',
        client: typeof value === 'function' ? '(reactive)' : String(value),
        kind: 'mismatch',
        fixHint:
          'Move browser-only dynamic content into an island() so it renders ' +
          'a stable placeholder on the server and hydrates on the client.',
      })
    }
  }
  // Pass 2: server-only attrs (DOM has them, props don't). Skip our own
  // hydration marker. Classify extensions vs unknown.
  const declaredKeys = new Set(
    Object.keys(props).map((k) => (k === 'className' ? 'class' : k.toLowerCase())),
  )
  for (const attr of node.getAttributeNames()) {
    if (attr === 'data-h') continue
    if (declaredKeys.has(attr.toLowerCase())) continue
    const value = node.getAttribute(attr) ?? ''
    if (isExtensionAttr(attr)) {
      _hydrationDeltas.push({
        selector,
        attribute: attr,
        server: value,
        client: '(absent)',
        kind: 'extension',
        fixHint:
          'Browser-extension injection. Safe to ignore. ' +
          'Set <html spellcheck="false"> to suppress some Grammarly attrs.',
      })
    } else {
      _hydrationDeltas.push({
        selector,
        attribute: attr,
        server: value,
        client: '(absent)',
        kind: 'mismatch',
        fixHint:
          'Server emitted an attribute the client did not declare. ' +
          'Check view definition and any post-SSR HTML transforms.',
      })
    }
  }
}

/**
 * Flush deltas to console at end of hydrate. Called once at the end
 * of island hydration. No-op in production (the entire path is
 * dead-code-eliminated when NODE_ENV is "production").
 */
export function _flushHydrationDeltas(): void {
  const deltas = _drainHydrationDeltas()
  if (deltas.length === 0) return
  for (const _d of deltas) {
    // Intentionally empty — console.warn formatting was removed during
    // an earlier round. Restore here if/when we want dev surfacing.
  }
}
