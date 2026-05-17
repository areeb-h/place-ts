// `<Copy>` — generic click-to-copy primitive.
//
// Extracted from `<CodeBlock>` as a reusable building block. Any
// component that needs a copy-to-clipboard button can compose
// `<Copy>` instead of rolling its own state machine. Examples:
//
//   - Inline "share link" badges
//   - Token/identifier copy buttons in API docs
//   - "Copy install command" boxes on landing pages
//   - Cell-content copy in tables
//
// **Why this isn't an island.** Copy is one event listener + one
// async call + a 1.4-second visual feedback that returns to "idle".
// Shipping a per-instance island bundle (~3 KB gzipped) is wasteful
// for what reduces to ~250 bytes of inline JS. The runtime is
// emitted once per `<Copy>` in the rendered HTML (idempotent via
// `window.__placeCopy === 1` guard); gzip dedupes per-instance
// emissions so N copies cost roughly the same as one.
//
// **DX**:
//
//   import { Copy } from '@place/design'
//
//   <Copy text="bun add @place/design" />
//
//   <Copy text="API_KEY_..." idleLabel="copy key" copiedLabel="copied!" />
//
//   <Copy text={longCode} class="my-styles">
//     <SomeIcon /> copy
//   </Copy>

import { type Children, markCopyUsedOnThisRequest, type View } from '@place/component'

export interface CopyProps {
  /** Text to write to the clipboard on click. Required. */
  readonly text: string
  /** Label / content shown when idle. Default: `'copy'`. Ignored when
   *  `children` is provided. */
  readonly idleLabel?: View | string
  /** Label / content shown for 1.4 s after a successful copy. Default:
   *  `'copied'`. Ignored when `children` is provided. */
  readonly copiedLabel?: View | string
  /** Custom button content. When provided, `idleLabel` / `copiedLabel`
   *  are ignored and the consumer owns the visual layout. The copy
   *  button still toggles `data-state="copied"` after a successful
   *  click, so consumers can style transitions off that attribute. */
  readonly children?: Children
  /** Additive classes on the button. Tailwind-aware merge happens
   *  upstream if consumers run the result through `cls()`. */
  readonly class?: string
  /** ARIA label override. Default: `'Copy to clipboard'`. */
  readonly 'aria-label'?: string
}

/**
 * @provisional — shipped in Tier 13 (ADR 0036). Public API but may
 * evolve (e.g. add `<Copy.Trigger>` / `<Copy.Indicator>` compound
 * shape; integrate with `<Tooltip>` for a "Copied!" affordance);
 * the stability covenant doesn't yet pin this surface.
 */
export const Copy = (props: CopyProps): View => {
  const idle = props.idleLabel ?? 'copy'
  const copied = props.copiedLabel ?? 'copied'
  // URL-encode so quotes / backticks / newlines round-trip safely
  // through the attribute value.
  const encoded = encodeURIComponent(props.text)
  // Signal renderPage that this page needs the copy runtime. The
  // framework emits the inline `<script>` ONCE per response with
  // the per-request CSP nonce — strict-CSP-safe and avoids
  // emitting N copies of the runtime body per page.
  markCopyUsedOnThisRequest()
  return (
    <button
      type="button"
      class={props.class}
      data-place-copy=""
      data-place-copy-text={encoded}
      data-state="idle"
      aria-label={props['aria-label'] ?? 'Copy to clipboard'}
    >
      {props.children ?? (
        <>
          <span data-copy-idle="">{idle}</span>
          <span data-copy-done="">{copied}</span>
        </>
      )}
    </button>
  )
}
