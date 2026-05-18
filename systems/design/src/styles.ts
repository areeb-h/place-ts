// @place/design library stylesheet — kept TINY by design.
//
// Most styling lives in Tailwind utility classes inside each
// component. This file holds ONLY what Tailwind utilities can't
// express:
//
//   - `@starting-style` rules for native <dialog>/popover transitions.
//     The browser's open/close switches `display` between block/none,
//     which can't be transitioned directly. `@starting-style` declares
//     the from-state for the discrete transition.
//   - `transition-behavior: allow-discrete` on the same properties
//     so the discrete-property transition fires.
//
// Apps wire this into their Tailwind base via the framework's
// `styles` option:
//
//   import { styles as designStyles } from '@place/design/styles'
//   app({ ..., styles: designStyles })
//
// Apps that also have their own globals concatenate:
//
//   app({ ..., styles: designStyles + '\n' + myAppStyles })
//
// The framework's `styles` option already concatenates onto the
// theme's Tailwind base (ADR 0016), so this string just gets glued
// in at the end.
//
// CLIENT-BUNDLE LEAK PROTECTION (T5-B-2): the string is server-side
// Tailwind input — the client doesn't need it. We gate via
// `typeof __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__`
// (not bare `__PLACE_BROWSER__`) so the expression is SAFE at runtime
// in non-bundled execution paths (e.g. `bun src/app.ts` directly) where
// the build-time `define` isn't applied. The bundler still constant-
// folds the whole condition on client builds (define makes it
// `true === true && true` → `true`); the server keeps the real string.

declare const __PLACE_BROWSER__: boolean

export const styles =
  typeof __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__
    ? ''
    : `
/* ===== Cascade layer scaffolding (Tier 17-E v2 / ADR 0051) =====
 *
 * Declare layer order so the design library's default styles compose
 * predictably with Tailwind v4 utilities + consumer overrides:
 *
 *   place.tokens     — theme tokens / typography (lowest precedence)
 *   place.components — design library default styles (.place-dialog etc.)
 *   utilities        — Tailwind utilities (consumer + recipe-emitted)
 *   place.user       — consumer overrides (highest layered precedence)
 *
 * Later layers in the list win over earlier. Un-layered rules win
 * over ALL layered rules.
 *
 * Why this matters: it eliminates the entire class of
 * "my Tailwind utility doesn't override the library default"
 * problems that shadcn + Mantine + Radix all paper over with
 * \`tailwind-merge\` (15KB gzipped runtime patch). Tailwind v4 emits
 * its utilities in \`@layer utilities\`; we put our defaults in
 * \`@layer place.components\`, so consumer utilities composed onto
 * any component class always win via the cascade. No JS, no
 * !important, no runtime class-merging.
 */
@layer place.tokens, place.components, utilities, place.user;

@layer place.components {
/* ===== Dialog enter/exit transitions =====
 * Universal browser support: Chrome 117+ (Aug 2023), Safari 17.5+
 * (May 2024), FF 129+ (Aug 2024). The framework targets evergreen
 * browsers — these are safe baseline as of late 2024.
 *
 * The discrete-property transition pattern:
 *   1. \`transition-behavior: allow-discrete\` lets \`display\` (and
 *      \`overlay\`, for the top layer) participate in transitions.
 *   2. \`@starting-style\` declares the FROM state for the open
 *      transition. Without this, the dialog would snap-in because
 *      the rendered state IS the open state.
 *   3. The base rule declares the OPEN state; an explicit closed
 *      rule (\`[open]\` not present) inherits the from-state. We use
 *      the \`:not([open])\` selector to be explicit.
 */
.place-dialog {
  opacity: 0;
  transform: scale(0.96);
  transition:
    opacity 180ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
    overlay 180ms allow-discrete,
    display 180ms allow-discrete;
}
.place-dialog[open] {
  opacity: 1;
  transform: scale(1);
}
@starting-style {
  .place-dialog[open] {
    opacity: 0;
    transform: scale(0.96);
  }
}
.place-dialog::backdrop {
  opacity: 0;
  transition:
    opacity 180ms cubic-bezier(0.16, 1, 0.3, 1),
    overlay 180ms allow-discrete,
    display 180ms allow-discrete;
}
.place-dialog[open]::backdrop {
  opacity: 1;
}
@starting-style {
  .place-dialog[open]::backdrop {
    opacity: 0;
  }
}

/* ===== Sheet (edge-anchored drawer) =====
 *
 * Same discrete-display transition trick as Dialog, but the
 * starting-style is a per-edge translate so the sheet slides in from
 * its anchored side rather than scaling. The recipe attaches one of
 * \`data-side\` from "right" | "left" | "top" | "bottom" via the
 * variant class names \`ml-auto\` / \`mr-auto\` / \`mb-auto\` /
 * \`mt-auto\` — but those are positioning, not animation. The slide-in
 * animation is keyed off a \`data-side\` attribute the Sheet
 * component sets so this stylesheet doesn't need to know which Tailwind
 * class won. Default (no \`data-side\`) is right-edge.
 */
.place-sheet {
  opacity: 0;
  transition:
    opacity 220ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 260ms cubic-bezier(0.16, 1, 0.3, 1),
    overlay 260ms allow-discrete,
    display 260ms allow-discrete;
}
.place-sheet[open] {
  opacity: 1;
  transform: translate(0, 0);
}
/* Per-side slide-in (Tier 17-E). The Sheet component emits
 * data-side="..." on the dialog element so each anchor gets the
 * matching starting transform. Universal @starting-style lets us
 * declare the FROM state per side without JS measurement.
 */
@starting-style {
  .place-sheet[open] {
    opacity: 0;
  }
  .place-sheet[data-side="right"][open] {
    transform: translateX(100%);
  }
  .place-sheet[data-side="left"][open] {
    transform: translateX(-100%);
  }
  .place-sheet[data-side="top"][open] {
    transform: translateY(-100%);
  }
  .place-sheet[data-side="bottom"][open] {
    transform: translateY(100%);
  }
}
.place-sheet::backdrop {
  opacity: 0;
  transition:
    opacity 220ms cubic-bezier(0.16, 1, 0.3, 1),
    overlay 220ms allow-discrete,
    display 220ms allow-discrete;
}
.place-sheet[open]::backdrop {
  opacity: 1;
}
@starting-style {
  .place-sheet[open]::backdrop {
    opacity: 0;
  }
}

/* ===== Combobox popover transition =====
 *
 * Subtle scale + fade on open/close so the dropdown reads as
 * "appeared near the input" rather than teleported. Uses the same
 * @starting-style + allow-discrete trick as Dialog/Sheet — the
 * popover toggles between display:none and display:block, and we
 * declare the FROM state so the transition is observable.
 *
 * Transform origin top-center: the dropdown grows down from where
 * it visually originates (the input's bottom edge).
 */
.place-combobox-popover {
  opacity: 0;
  transform: translateY(-4px) scale(0.985);
  transform-origin: top center;
  transition:
    opacity 120ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 140ms cubic-bezier(0.16, 1, 0.3, 1),
    overlay 140ms allow-discrete,
    display 140ms allow-discrete;
}
.place-combobox-popover:popover-open {
  opacity: 1;
  transform: translateY(0) scale(1);
}
@starting-style {
  .place-combobox-popover:popover-open {
    opacity: 0;
    transform: translateY(-4px) scale(0.985);
  }
}

/* ===== Generic token-coloured-text primitives =====
 *
 * Semantic color roles for any "syntax-coloured text" surface —
 * CodeBlock, future Terminal viewer, log viewer, inline highlighted
 * tokens, etc. Defaults reference the consumer's theme tokens
 * (color-fg, color-accent); per-instance overrides via inline style:
 *
 *   <CodeBlock style={{ '--tok-keyword': '#ff79c6' }} />
 *
 * Names dropped the cb- prefix in T13-C — the primitives are now
 * generic; CodeBlock is one consumer.
 */
.place-code,
.place-lines {
  --tok-comment: oklch(0.6 0 0 / 0.7);
  --tok-string: oklch(0.78 0.13 145);
  --tok-keyword: oklch(0.78 0.18 320);
  --tok-type: oklch(0.83 0.13 200);
  --tok-number: oklch(0.85 0.13 60);
  --tok-tag: oklch(0.83 0.13 200);
  --tok-tag-component: oklch(0.85 0.13 60);
  --tok-attr: oklch(0.78 0.18 320);
  --tok-punct: oklch(0.55 0 0);
  --tok-plain: var(--color-fg, oklch(0.92 0 0));
  --lines-hl-bg: color-mix(in oklch, var(--color-accent, oklch(0.7 0.2 240)) 12%, transparent);
  --lines-hl-bar: var(--color-accent, oklch(0.7 0.2 240));
  --lines-diff-add-bg: color-mix(in oklch, oklch(0.7 0.18 145) 10%, transparent);
  --lines-diff-rm-bg: color-mix(in oklch, oklch(0.65 0.22 25) 10%, transparent);
}
.place-code .tok-comment, .place-lines .tok-comment { color: var(--tok-comment); font-style: italic; }
.place-code .tok-string, .place-lines .tok-string { color: var(--tok-string); }
.place-code .tok-keyword, .place-lines .tok-keyword { color: var(--tok-keyword); }
.place-code .tok-type, .place-lines .tok-type { color: var(--tok-type); }
.place-code .tok-number, .place-lines .tok-number { color: var(--tok-number); }
.place-code .tok-tag, .place-lines .tok-tag { color: var(--tok-tag); }
.place-code .tok-tag-component, .place-lines .tok-tag-component { color: var(--tok-tag-component); }
.place-code .tok-attr, .place-lines .tok-attr { color: var(--tok-attr); }
.place-code .tok-punct, .place-lines .tok-punct { color: var(--tok-punct); }
.place-code .tok-plain, .place-lines .tok-plain { color: var(--tok-plain); }
/* Optional regex highlighting — distinct from string. */
.place-code .tok-regex, .place-lines .tok-regex { color: var(--tok-string); font-style: italic; }

/* Line-level row layout: gutter for numbers + content. Each line is
 * one row; this lets line-highlight + diff backgrounds extend across
 * the full row including the gutter. Generic: also used by future
 * Terminal / Log / Diff components.
 */
/* Line container. Two layouts behind one class name:
   - Default (no line numbers): plain block flow — each line span is
     its own row by virtue of a trailing newline plus white-space:pre.
     The prior display:grid + grid-template-columns:auto 1fr packed
     two lines into one row (col1 + col2) when there was no gutter.
   - With line numbers: switch to grid via data-numbered=1 on the
     container — gutter cell + content cell per row. */
.place-code-lines,
.place-lines-rows {
  display: block;
  width: max-content;
  min-width: 100%;
}
.place-code-lines[data-numbered="1"],
.place-lines-rows[data-numbered="1"] {
  display: grid;
  grid-template-columns: auto 1fr;
}
.place-code-ln,
.place-lines-gutter {
  user-select: none;
  text-align: right;
  padding-right: 1rem;
  color: var(--tok-comment);
  font-variant-numeric: tabular-nums;
}
.place-code-line,
.place-lines-row {
  padding-right: 1rem;
  white-space: pre;
}
.place-code-line[data-hl="1"],
.place-lines-row[data-hl="1"] {
  background: var(--lines-hl-bg);
  box-shadow: inset 2px 0 0 var(--lines-hl-bar);
}
.place-code-ln[data-hl="1"],
.place-lines-gutter[data-hl="1"] {
  background: var(--lines-hl-bg);
  color: var(--tok-plain);
}
.place-code-line[data-diff="+"], .place-lines-row[data-diff="+"] { background: var(--lines-diff-add-bg); }
.place-code-line[data-diff="-"], .place-lines-row[data-diff="-"] { background: var(--lines-diff-rm-bg); }
.place-code-ln[data-diff="+"], .place-lines-gutter[data-diff="+"] { background: var(--lines-diff-add-bg); }
.place-code-ln[data-diff="-"], .place-lines-gutter[data-diff="-"] { background: var(--lines-diff-rm-bg); }

/* Copy button label state — driven by data-state set by the inline
 * copy runtime. CSS does the visual swap; no reactive runtime needed.
 * Copy and CodeBlock both emit the generic [data-place-copy] marker
 * plus [data-copy-idle] / [data-copy-done] label children.
 *
 * data-state values:
 *   - "idle" (initial): show the idle label.
 *   - "copied": show the done label with a leading tick (via ::before)
 *     for visual confirmation, accent-coloured.
 *   - "failed": show the done label with a cross — only fires when
 *     BOTH the Clipboard API and execCommand fallback failed.
 */
[data-place-copy] [data-copy-idle] { display: inline; }
[data-place-copy] [data-copy-done] { display: none; }
[data-place-copy][data-state="copied"] [data-copy-idle],
[data-place-copy][data-state="failed"] [data-copy-idle] { display: none; }
[data-place-copy][data-state="copied"] [data-copy-done],
[data-place-copy][data-state="failed"] [data-copy-done] { display: inline; }
[data-place-copy][data-state="copied"] [data-copy-done]::before {
  content: "✓ ";
  color: var(--color-accent, currentColor);
  font-weight: 600;
}
[data-place-copy][data-state="copied"] {
  color: var(--color-accent, currentColor) !important;
  border-color: color-mix(in oklab, var(--color-accent, currentColor) 50%, transparent) !important;
}
[data-place-copy][data-state="failed"] [data-copy-done]::before {
  content: "✗ ";
  color: var(--color-destructive, currentColor);
  font-weight: 600;
}
[data-place-copy][data-state="failed"] {
  color: var(--color-destructive, currentColor) !important;
}

/* Wrap mode: switch from horizontal scroll to soft wrap. */
.place-code[data-wrap="wrap"] .place-code-line { white-space: pre-wrap; word-break: break-word; }
.place-code[data-wrap="wrap"] .place-code-lines { width: 100%; }
.place-lines[data-wrap="wrap"] .place-lines-row { white-space: pre-wrap; word-break: break-word; }
.place-lines[data-wrap="wrap"] .place-lines-rows { width: 100%; }

/* ===== Browser-native primitives we let do the work =====
 *
 * (Tier 17-A.5) Each rule below replaces ~10-100 LOC of JS or
 * CSS-in-JS that other libraries hand-roll.
 */

/* :has()-driven Field validity styling. The Field component carries
 * \`place-field\` on its wrapper + \`place-field-hint\` on the hint
 * paragraph. When the wrapped <input>/<textarea>/<select> matches
 * :user-invalid (i.e. fails native HTML5 validation AFTER user
 * interaction), the label + hint turn destructive automatically —
 * no JS state cell, no \`error\` prop needed for native-validity
 * cases. Apps that supply a custom \`error\` prop override this. */
.place-field:has(input:user-invalid, textarea:user-invalid, select:user-invalid) > label {
  color: var(--color-destructive, currentColor);
}
.place-field:has(input:user-invalid, textarea:user-invalid, select:user-invalid) .place-field-hint {
  color: var(--color-destructive, currentColor);
}
/* Form-level: dim the submit button when ANY field in the form is
 * invalid. Pure CSS; no per-field tracking. */
form:has(:user-invalid) [type="submit"]:not([data-allow-invalid]) {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Typography: better line wrapping. text-wrap: balance gives
 * headings even line distribution (no orphan words); text-wrap:
 * pretty gives paragraphs intelligent last-line wrapping (no
 * one-word last lines). Universal browser support since 2024.
 * Applies to ALL content rendered in apps using @place/design —
 * consumers don't need to remember per-element. */
h1, h2, h3, h4, h5, h6 {
  text-wrap: balance;
}
p, li, dd, dt, blockquote, figcaption {
  text-wrap: pretty;
}

/* Reserve scrollbar space so the page doesn't shift when a
 * <dialog>.showModal() removes the scrollbar (or any other
 * overflow:hidden transition). Universal browser support: Chrome
 * 94+, Safari 18.2+, Firefox 97+. */
html {
  scrollbar-gutter: stable;
  /* **accent-color** (Tier 17-E v2 fix) — native form-control theming.
   * <input type=checkbox|radio|range> automatically picks up the
   * page accent color without ::-webkit-* hacks. Universal: Chrome
   * 93+, Safari 15.4+, Firefox 92+. Future-proofs the checkbox /
   * radio / range primitives when they ship; existing native form
   * controls in consumer apps re-skin for free. */
  accent-color: var(--color-accent, currentColor);
}

/* **field-sizing: content** (Tier 17-E v2 fix) — auto-grow textareas
 * to fit content without ResizeObserver / JS measurement. Chromium
 * 129+ only (Firefox + Safari pending). Behind @supports so older
 * browsers keep the fixed-height + resize-handle fallback (the
 * resize-y min-h-[5rem] utilities on the same element). */
@supports (field-sizing: content) {
  .place-textarea-grow {
    field-sizing: content;
    /* When field-sizing handles growth, disable the manual resize
     * handle (otherwise we get both, which is confusing). */
    resize: none;
    /* Drop the fixed min-height — content drives it. We keep one
     * row's worth so empty textareas don't collapse to 0px. */
    min-height: calc(1lh + 2 * var(--input-py, 0.375rem));
  }
}

/* ===== Disclosure (<details>) animations =====
 *
 * Three native features compose here:
 *
 *   1. interpolate-size: allow-keywords — lets height transition
 *      to/from 'auto' natively. Chrome 129+, Safari 18.2+, Firefox
 *      in progress.
 *   2. transition-behavior: allow-discrete — discrete-property
 *      transitions on the [content-visibility] generated box.
 *   3. ::details-content — pseudo-element wrapping the collapsed
 *      content. Chrome 131+, Safari 18.4+. Without it, we'd have
 *      to animate the details box itself which clips the summary
 *      during the animation.
 *
 * All three behind @supports so older browsers keep instant open/close.
 *
 * For browsers WITHOUT ::details-content, the .place-disclosure-content
 * div we always render is the animation target instead. That gives
 * a partial-anim baseline everywhere; the perfect anim only fires
 * on the modern stack. */
.place-disclosure[open] .place-disclosure-chevron {
  transform: rotate(90deg);
}
@supports (interpolate-size: allow-keywords) {
  :root {
    interpolate-size: allow-keywords;
  }
}
@supports selector(::details-content) {
  .place-disclosure::details-content {
    block-size: 0;
    overflow: clip;
    transition:
      block-size 200ms ease,
      content-visibility 200ms ease allow-discrete;
  }
  .place-disclosure[open]::details-content {
    block-size: auto;
  }
}

} /* end @layer place.components */
`
