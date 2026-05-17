// `<Dialog>` — native `<dialog>` element wrapped in reactive open/close
// state with motion-aware enter/exit transitions.
//
// Native-first design (see charter):
//   - Native `<dialog>` element → top-layer rendering (escapes
//     `overflow:hidden` / `transform` parents, which break every
//     framework's portal-based modal).
//   - `showModal()` → automatic focus trap, automatic `Esc` to close,
//     `::backdrop` pseudo for the overlay, scroll lock.
//   - `@starting-style` + `transition-behavior: allow-discrete` → CSS
//     handles the discrete display:none ↔ display:block transition so
//     the dialog can fade/scale in and out. Universal browser support
//     since FF 129 (Aug 2024).
//   - `inert` attribute on the page-background siblings — handled by
//     `showModal()` natively.
//
// The framework adds:
//   - Reactive `open` prop (boolean state) — flip it to open/close.
//   - Backdrop-click-to-close (opt-in via `closeOnBackdrop`, default
//     true).
//   - `onClose` callback fired after the dialog closes (either via
//     Esc, backdrop, or programmatic close).
//   - Named children via `Dialog.Header`, `Dialog.Body`, `Dialog.Footer`
//     for layout — no `asChild` polymorphism.
//
// What we DON'T re-implement (because the browser does it):
//   - Portal — `showModal()` puts the dialog in the top layer.
//   - Focus trap — `showModal()` manages focus inside the dialog.
//   - Scroll lock — `showModal()` locks scroll on `<body>`.
//   - Esc-to-close — native `<dialog>` handles `Esc` as `close()`.
//   - Backdrop element — native `::backdrop` pseudo-element.

import { cls, recipe } from '@place/component'
import type { Children, View } from '@place/component'
import { state, watch } from '@place/reactivity'

// ===== Recipe =====
//
// The dialog's outer chrome lives here. The `@starting-style` rules
// for enter/exit transitions live in the global stylesheet (because
// they need to declare what the "starting state" is for the discrete
// transition — that's CSS-only, not a class string).

// Dialog-specific layout constraints (`max-w-[min(Npx,92vw)]`,
// `max-h-[85vh]`) are component-design decisions allowed under the
// NN#6 clarification (Tier 15-D): consumers would otherwise re-
// specify these on every Dialog call site. Three tiered sizes; the
// `min(Npx, 92vw)` pattern caps at a comfortable reading width on
// desktop while letting mobile use 92% of the viewport.
const dialogRecipe = recipe({
  base:
    'place-dialog ' + // semantic class for the global @starting-style rules
    'rounded-xl border border-border bg-card text-fg shadow-2xl ' +
    'p-0 w-full max-h-[85vh] overflow-hidden ' +
    'backdrop:bg-bg/65 backdrop:backdrop-blur-sm',
  variants: {
    size: {
      sm: 'max-w-[min(420px,92vw)]',
      md: 'max-w-[min(560px,92vw)]',
      lg: 'max-w-[min(720px,92vw)]',
    },
  },
  defaults: { size: 'md' },
})

// ===== Dialog =====

export type DialogSize = 'sm' | 'md' | 'lg'

/**
 * Part anatomy for `<Dialog>` (Tier 17-D / ADR 0050).
 *
 *   - `backdrop` — additive classes that target the `::backdrop`
 *                  pseudo of the dialog. Tokens you pass here get
 *                  the `[&::backdrop]:` Tailwind variant
 *                  automatically applied (so you write
 *                  `{ backdrop: 'bg-red-500/40' }` not
 *                  `{ backdrop: '[&::backdrop]:bg-red-500/40' }`).
 *
 * **Root is NOT a part** — use the standalone `class` prop for
 * additive root classes. One spelling per concept.
 *
 * Slot-level styling (header/body/footer) lives on the per-slot
 * components: `<Dialog.Header class="...">`. Full uniform classNames
 * threading across slots lands when we layer a per-instance capability
 * for it; not in this cut.
 */
export type DialogPart = 'backdrop'

export interface DialogProps {
  /** Reactive open state. Flipping this drives `showModal()` / `close()`. */
  readonly open: () => boolean
  /**
   * Fired AFTER the dialog finishes opening (Tier 17-E). Use to
   * focus a specific input, kick off an animation, etc. Fires once
   * per open→closed→open cycle, after `showModal()` returns.
   */
  readonly onOpen?: () => void
  /**
   * Fired AFTER the dialog finishes closing. Use to clear form state,
   * etc. The framework only calls this when the dialog transitions
   * from open → closed; it does not fire on initial render.
   */
  readonly onClose?: () => void
  /**
   * Close when the user clicks the backdrop (outside the dialog box).
   * Native `<dialog>` doesn't do this by default; we wire it via a
   * click handler that checks if the event target IS the dialog
   * element (the backdrop is technically the same element, so
   * `event.target === dialogEl` indicates a backdrop click).
   * Default: `true`.
   */
  readonly closeOnBackdrop?: boolean
  /** Visual size variant. Default: `'md'`. */
  readonly size?: DialogSize
  /** Accessible label for the dialog. Required for screen readers. */
  readonly 'aria-label'?: string
  /** ID of an element labeling the dialog (alternative to `aria-label`). */
  readonly 'aria-labelledby'?: string
  /** Additive classes on the `<dialog>` element. */
  readonly class?: string
  /**
   * Typed per-subpart class overrides (Tier 17-D / ADR 0050). The
   * `backdrop` key applies through Tailwind's `[&::backdrop]:`
   * pseudo variant — tokens are automatically prefixed so call sites
   * read as plain utilities.
   */
  readonly classNames?: Partial<Record<DialogPart, string>>
  readonly children?: Children
}

// **Native `closedby` attribute support detect** (Tier 17-E v2 fix).
// Chrome 134+ / Edge 134+ ship `<dialog closedby="any|closerequest|none">`
// for declarative dismiss behavior. When present, `closedby="any"`
// makes the browser close on backdrop click natively — AND the
// browser already implements the mousedown-on-content-don't-close
// behavior we hand-rolled in Tier 17-E. One attribute, the bug
// class disappears.
//
// Browsers without `closedby` fall back to our JS mousedown/click
// tracking. Detect once at module load.
const SUPPORTS_CLOSEDBY: boolean = (() => {
  if (typeof document === 'undefined' || typeof HTMLDialogElement === 'undefined') {
    return false
  }
  try {
    const el = document.createElement('dialog')
    el.setAttribute('closedby', 'any')
    // The IDL attribute reflects the value if the browser knows it.
    return (el as HTMLDialogElement & { closedBy?: string }).closedBy === 'any'
  } catch {
    return false
  }
})()

const DialogImpl = (props: DialogProps): View => {
  // `dialogRef` is a reactive ref-state so the open/close sync watch
  // can subscribe to BOTH the element's existence AND the open state.
  // The watch re-fires on either change — letting initial sync happen
  // the moment the ref callback runs (after DOM mount), and on every
  // subsequent open-state flip.
  const dialogRef = state<HTMLDialogElement | null>(null)

  // Native `closedby` handles backdrop close + mousedown-on-content
  // bug for us when supported. Older browsers fall back to JS
  // mousedown/click tracking (same logic as the v1 implementation).
  let mousedownOnBackdrop = false
  const onMouseDown = (e: MouseEvent): void => {
    if (SUPPORTS_CLOSEDBY) return // native handles it
    if (props.closeOnBackdrop === false) {
      mousedownOnBackdrop = false
      return
    }
    const el = dialogRef()
    mousedownOnBackdrop = !!el && e.target === el
  }
  const onClick = (e: MouseEvent): void => {
    if (SUPPORTS_CLOSEDBY) return // native handles it
    if (props.closeOnBackdrop === false) return
    const el = dialogRef()
    if (!el) return
    if (e.target === el && mousedownOnBackdrop) {
      el.close()
    }
    mousedownOnBackdrop = false
  }
  // The `closedby` value to apply when the browser supports it.
  // Maps to consumer's `closeOnBackdrop` prop:
  //   - true (default) / missing → 'any' (Esc + backdrop close it)
  //   - false → 'closerequest' (only Esc / programmatic close)
  const closedByAttr = props.closeOnBackdrop === false ? 'closerequest' : 'any'

  // Close event — fires for any close path (Esc, backdrop, programmatic).
  const onNativeClose = (): void => {
    props.onClose?.()
  }

  // Open/close sync. The watch tracks dialogRef + props.open(). First
  // run: element may be null (rendered later in the same tick) — skip.
  // Once the ref callback fires, dialogRef updates and this watch
  // re-runs with the element available. From there, every flip of
  // props.open() re-syncs. `onOpen` fires AFTER `showModal()` returns
  // so consumers can focus a specific input / start animations / etc.
  watch(() => {
    const el = dialogRef()
    const wantOpen = props.open()
    if (!el) return
    if (wantOpen && !el.open) {
      try {
        el.showModal()
        props.onOpen?.()
      } catch {
        // Already-open errors are benign; close+reopen would flicker.
      }
    } else if (!wantOpen && el.open) {
      el.close()
    }
  })

  const baseClasses = dialogRecipe(
    props.size !== undefined ? { size: props.size } : {},
  )
  // Resolve `class` (root) + `classNames.backdrop` (Tier 17-D
  // contract; ADR 0050). The backdrop tokens are auto-prefixed
  // with Tailwind's `[&::backdrop]:` variant so the call site reads
  // as plain utility classes.
  const rootExtra = props.class ?? ''
  const backdropExtra = props.classNames?.backdrop ?? ''
  const backdropClasses = backdropExtra
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `[&::backdrop]:${t}`)
    .join(' ')
  const finalClass = cls(baseClasses, rootExtra, backdropClasses)

  return (
    <dialog
      class={finalClass}
      // **`closedby`** is set only when the browser supports it.
      // Older browsers see no attribute → JS handlers below take over.
      {...(SUPPORTS_CLOSEDBY ? { closedby: closedByAttr } : {})}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      onMouseDown={onMouseDown as unknown as (e: Event) => void}
      onClick={onClick as unknown as (e: Event) => void}
      onClose={onNativeClose}
      ref={(el: HTMLElement) => {
        dialogRef.set(el as HTMLDialogElement)
      }}
    >
      {props.children}
    </dialog>
  )
}

// ===== Named children — layout slots =====

interface SlotProps {
  readonly class?: string
  readonly children?: Children
}

const Header = (props: SlotProps): View => (
  <header
    class={cls(
      'flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-border/60',
      props.class ?? '',
    )}
  >
    {props.children}
  </header>
)

const Body = (props: SlotProps): View => (
  <div class={cls('px-5 py-4 overflow-y-auto', props.class ?? '')}>
    {props.children}
  </div>
)

const Footer = (props: SlotProps): View => (
  <footer
    class={cls(
      'flex items-center justify-end gap-2 px-5 py-3 border-t border-border/60 bg-bg/40',
      props.class ?? '',
    )}
  >
    {props.children}
  </footer>
)

// Named-children pattern: attach the slot components as static
// properties of `Dialog`. Consumers write `<Dialog.Header>` for
// discoverability. The slots are plain components — no parent ↔ child
// coupling, no context, no `asChild`. They're just three pre-styled
// wrappers with no special behavior. `Object.assign` is the only way
// to mix function + static-properties under strict TS.
export const Dialog = Object.assign(DialogImpl, {
  Header,
  Body,
  Footer,
})
