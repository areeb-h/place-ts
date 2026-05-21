// `<Sheet>` — edge-anchored drawer (T16-D, ADR 0046).
//
// Same native foundation as `<Dialog>` — built on `<dialog>` +
// `showModal()` — but anchored to a viewport edge so it reads as a
// slide-in drawer rather than a centered modal. The variant ladder
// (`side` + `size`) is the only difference from Dialog at the API
// level. Underneath we get all the same wins:
//
//   - Top-layer rendering (escapes `overflow:hidden` / `transform`
//     parents that break every framework's portal-based drawer)
//   - Automatic focus trap + scroll lock + Esc-to-close
//   - `::backdrop` pseudo for the overlay
//   - Reactive `open` prop drives `showModal()` / `close()`
//
// Use a Sheet for: filter sidebars, mobile-nav drawers, quick-edit
// panels, notification streams, secondary navigation. Use a Dialog
// for: centered alerts, confirmation prompts, focused single-task
// modals.
//
// The Sheet renders ITS OWN inner backdrop area inside the dialog
// element — clicks on the unoccupied region trigger close
// (opt-out via `closeOnBackdrop={false}`). Same backdrop-click
// detection trick as Dialog (`event.target === dialogEl`).
//
// **Why not a separate primitive built on `popover="auto"`?** The
// popover API doesn't currently expose a scroll-lock primitive, and
// its focus-trap behavior on macOS Safari < 17.4 was inconsistent.
// `<dialog>` + `showModal()` is the reliable substrate today; switch
// can happen later behind the same `<Sheet>` API if it pays off.

import type { Children, View } from '@place-ts/component'
import { cls, recipe } from '@place-ts/component'
import { state, watch } from '@place-ts/reactivity'

// ===== Recipe =====
//
// Edge-anchor + slide-in transform per side. The `place-sheet`
// semantic class hooks into the global stylesheet for
// `@starting-style` + `transition-behavior: allow-discrete` — the
// CSS-only mechanism that animates the discrete display:none ↔
// display:block transition.
//
// Component-layout constraints (`max-w-[min(Npx,92vw)]`,
// `max-h-[min(Npx,92vh)]`) are justified per NN#6 (Tier 15-D):
// consumers would otherwise re-specify them on every Sheet call
// site, and the edge-anchored shape is a design decision, not a
// styling escape hatch.

const sheetRecipe = recipe({
  base:
    'place-sheet ' +
    'border border-border bg-card text-fg shadow-2xl ' +
    'p-0 overflow-hidden ' +
    'backdrop:bg-bg/65 backdrop:backdrop-blur-sm',
  variants: {
    side: {
      // `m-0` overrides the browser's default centering for
      // `<dialog>` so the edge anchoring takes effect. `h-full` /
      // `w-full` makes the sheet span the perpendicular dimension.
      right: 'm-0 ml-auto h-full rounded-l-xl',
      left: 'm-0 mr-auto h-full rounded-r-xl',
      top: 'm-0 mb-auto w-full rounded-b-xl',
      bottom: 'm-0 mt-auto w-full rounded-t-xl',
    },
    size: {
      sm: '',
      md: '',
      lg: '',
    },
  },
  compound: [
    // Width sizes on side: 'left' | 'right' (vertical sheet).
    { side: 'left', size: 'sm', class: 'max-w-[min(320px,92vw)]' },
    { side: 'left', size: 'md', class: 'max-w-[min(420px,92vw)]' },
    { side: 'left', size: 'lg', class: 'max-w-[min(560px,92vw)]' },
    { side: 'right', size: 'sm', class: 'max-w-[min(320px,92vw)]' },
    { side: 'right', size: 'md', class: 'max-w-[min(420px,92vw)]' },
    { side: 'right', size: 'lg', class: 'max-w-[min(560px,92vw)]' },
    // Height sizes on side: 'top' | 'bottom' (horizontal sheet).
    { side: 'top', size: 'sm', class: 'max-h-[min(280px,80vh)]' },
    { side: 'top', size: 'md', class: 'max-h-[min(400px,80vh)]' },
    { side: 'top', size: 'lg', class: 'max-h-[min(560px,80vh)]' },
    { side: 'bottom', size: 'sm', class: 'max-h-[min(280px,80vh)]' },
    { side: 'bottom', size: 'md', class: 'max-h-[min(400px,80vh)]' },
    { side: 'bottom', size: 'lg', class: 'max-h-[min(560px,80vh)]' },
  ],
  defaults: { side: 'right', size: 'md' },
})

// ===== Sheet =====

export type SheetSide = 'right' | 'left' | 'top' | 'bottom'
export type SheetSize = 'sm' | 'md' | 'lg'

/**
 * Part anatomy for `<Sheet>` (Tier 17-D / ADR 0050). Mirrors Dialog —
 * structural shape is the same (native `<dialog>` + showModal).
 *
 * **Root is NOT a part** — use the standalone `class` prop. Slot-
 * level styling (header/body/footer) lives on the per-slot components
 * (`<Sheet.Header class="...">`).
 */
export type SheetPart = 'backdrop'

export interface SheetProps {
  /** Reactive open state. Flipping this drives `showModal()` / `close()`. */
  readonly open: () => boolean
  /**
   * Fired AFTER the sheet finishes closing. Use to clear form state,
   * reset filter input, etc. The framework only calls this when the
   * sheet transitions from open → closed; not on initial render.
   */
  readonly onClose?: () => void
  /**
   * Close when the user clicks the backdrop (outside the sheet
   * panel). Same detection as Dialog — strict `e.target === dialogEl`.
   * Default: `true`.
   */
  readonly closeOnBackdrop?: boolean
  /** Edge to anchor the sheet to. Default: `'right'`. */
  readonly side?: SheetSide
  /** Visual size variant (width for left/right, height for top/bottom).
   *  Default: `'md'`. */
  readonly size?: SheetSize
  /** Accessible label for the sheet. Required for screen readers. */
  readonly 'aria-label'?: string
  /** ID of an element labeling the sheet (alternative to `aria-label`). */
  readonly 'aria-labelledby'?: string
  /** Additive classes on the `<dialog>` element. */
  readonly class?: string
  /** Typed per-subpart class overrides (Tier 17-D / ADR 0050). The
   *  `backdrop` key auto-prefixes each token with Tailwind's
   *  `[&::backdrop]:` variant. */
  readonly classNames?: Partial<Record<SheetPart, string>>
  readonly children?: Children
}

const SheetImpl = (props: SheetProps): View => {
  // Reactive ref-state so the open/close sync watch subscribes to
  // BOTH the element's existence AND the open state. Same pattern
  // as Dialog.
  const dialogRef = state<HTMLDialogElement | null>(null)

  const onClick = (e: MouseEvent): void => {
    if (props.closeOnBackdrop === false) return
    const el = dialogRef()
    if (!el) return
    if (e.target === el) el.close()
  }

  const onNativeClose = (): void => {
    props.onClose?.()
  }

  watch(() => {
    const el = dialogRef()
    const wantOpen = props.open()
    if (!el) return
    if (wantOpen && !el.open) {
      try {
        el.showModal()
      } catch {
        // Already-open errors are benign.
      }
    } else if (!wantOpen && el.open) {
      el.close()
    }
  })

  // `class` = additive on the `<dialog>` element; `classNames.backdrop`
  // = additive on the `::backdrop` pseudo (auto-prefixed via
  // Tailwind's `[&::backdrop]:` variant). Mirrors Dialog.
  const rootExtra = props.class ?? ''
  const backdropExtra = props.classNames?.backdrop ?? ''
  const backdropClasses = backdropExtra
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `[&::backdrop]:${t}`)
    .join(' ')

  const baseClasses = sheetRecipe({
    ...(props.side !== undefined ? { side: props.side } : {}),
    ...(props.size !== undefined ? { size: props.size } : {}),
  })
  const finalClass = cls(baseClasses, rootExtra, backdropClasses)

  // `data-side="..."` lets the global stylesheet pick the right
  // `@starting-style` per anchor edge (Tier 17-E). Previously only
  // the default right-edge slide animated; left/top/bottom snapped.
  const side: SheetSide = props.side ?? 'right'

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: native <dialog> handles Escape via the browser — the JS click handler exists only for backdrop dismiss
    <dialog
      class={finalClass}
      data-side={side}
      // Match Dialog.tsx — explicit aria-modal for older AT.
      aria-modal="true"
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
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
//
// Same pattern as Dialog.Header / .Body / .Footer. Pre-styled
// wrappers with no parent ↔ child coupling.

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
  <div class={cls('flex-1 px-5 py-4 overflow-y-auto', props.class ?? '')}>{props.children}</div>
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

/**
 * @provisional — shipped in Tier 16 (ADR 0046). Surface stable for
 * the side+size variants and the named-children slot shape. May grow
 * a `motion` prop later to coordinate enter/exit transitions with
 * `@place-ts/reactivity/motion` once the use case triggers it.
 */
export const Sheet = Object.assign(SheetImpl, {
  Header,
  Body,
  Footer,
})
