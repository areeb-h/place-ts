// `<Toaster>` + `toast()` — singleton notification queue.
//
// API:
//   1. Mount `<Toaster />` ONCE at the app root (next to other layout-level
//      primitives like `<SearchPalette />`).
//   2. Anywhere in the app, call `toast('Saved!')` to enqueue a toast.
//      Variants: `toast.success(msg)`, `toast.warn(msg)`, `toast.error(msg)`,
//      `toast.info(msg)`. Each accepts an options bag for `duration` and
//      `kind` overrides.
//
// Native-first design:
//   - `popover="manual"` puts the toaster in the browser's TOP LAYER.
//     Toasts escape `overflow:hidden`, `transform`, and `z-index`
//     parents that would otherwise clip them — the bane of every
//     framework's notification system. Universal browser support since
//     mid-2024.
//   - The toaster element is shown on first toast via `showPopover()`.
//     When the queue empties (animation completes), we leave it shown
//     (cheap) — it has no backdrop and zero visual footprint when
//     empty.
//
// Motion:
//   - Each toast's `animate()` reads its lifecycle state (visible/dismissing)
//     and produces opacity + transform values. Slide-in from the bottom-
//     right corner with a snap spring; fade-out + slide-down on dismiss.
//   - Auto-dismiss uses a per-toast setTimeout (cleared on manual close).
//
// Anti-patterns avoided:
//   - No `useToast()` hook. The framework's reactive primitives are
//     module-scoped; a singleton queue is just `state([])` exported
//     from this module.
//   - No imperative `controls` API. Each toast's open/close state is
//     a derivation of its presence in the queue + lifecycle stage.

import type { View } from '@place/component'
import { cls, keyed, onMount, recipe, Show } from '@place/component'
import { state, watch } from '@place/reactivity'
import { animate } from '@place/reactivity/motion'
import { openPopover } from './_popover.ts'

// ===== Toast queue (module singleton) =====

export type ToastKind = 'info' | 'success' | 'warn' | 'error'

interface ToastRecord {
  readonly id: number
  readonly message: string
  readonly kind: ToastKind
  readonly createdAt: number
  /** Total lifespan in ms (default 4000). 0 = no auto-dismiss. */
  readonly duration: number
  /** Reactive flag — flipped to false to trigger the exit animation. */
  readonly visible: ReturnType<typeof state<boolean>>
}

const queue = state<readonly ToastRecord[]>([])
let nextId = 0

export interface ToastOptions {
  /** Visual kind. Drives the icon + border color. Default depends on caller. */
  readonly kind?: ToastKind
  /** Lifespan in ms before auto-dismiss. Default 4000. 0 disables auto-dismiss. */
  readonly duration?: number
}

/**
 * Enqueue a toast. Returns a dismiss function for manual close.
 *
 *   toast('Saved!')
 *   toast.success('Account created')
 *   toast.error('Network error', { duration: 0 })  // sticky
 *
 *   const dismiss = toast('Working…', { duration: 0 })
 *   // …later
 *   dismiss()
 */
export function toast(message: string, opts: ToastOptions = {}): () => void {
  const id = ++nextId
  const record: ToastRecord = {
    id,
    message,
    kind: opts.kind ?? 'info',
    createdAt: Date.now(),
    duration: opts.duration ?? 4000,
    visible: state(true),
  }
  queue.set([...queue(), record])
  const dismiss = (): void => {
    record.visible.set(false)
    // Wait for the exit animation, then remove from queue.
    setTimeout(() => {
      queue.set(queue().filter((t) => t.id !== id))
    }, 220)
  }
  if (record.duration > 0) {
    setTimeout(dismiss, record.duration)
  }
  return dismiss
}

toast.info = (message: string, opts: Omit<ToastOptions, 'kind'> = {}): (() => void) =>
  toast(message, { ...opts, kind: 'info' })
toast.success = (message: string, opts: Omit<ToastOptions, 'kind'> = {}): (() => void) =>
  toast(message, { ...opts, kind: 'success' })
toast.warn = (message: string, opts: Omit<ToastOptions, 'kind'> = {}): (() => void) =>
  toast(message, { ...opts, kind: 'warn' })
toast.error = (message: string, opts: Omit<ToastOptions, 'kind'> = {}): (() => void) =>
  toast(message, { ...opts, kind: 'error' })

/** Test helper: drain the queue synchronously. Internal underscore prefix. */
export const _clearToastsForTest = (): void => {
  queue.set([])
}

// ===== Toaster — the component mounted once at the app root =====

const toastRecipe = recipe({
  base:
    'pointer-events-auto flex items-start gap-3 ' +
    // min/max widths are component-specific layout constraints
    // (toasts must be readable but not span the screen) — allowed
    // per NN#6 clarification in Tier 15-D.
    'min-w-[280px] max-w-[420px] ' +
    'px-3.5 py-3 rounded-lg border bg-card text-fg ' +
    'shadow-xl shadow-bg/40',
  variants: {
    kind: {
      info: 'border-border/80',
      // Token-bound border colors (success/warn/destructive are
      // first-class theme tokens since Tier 15-D).
      success: 'border-success/40',
      warn: 'border-warn/50',
      error: 'border-destructive/50',
    },
  },
})

const glyphRecipe = recipe({
  base: 'shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-mono font-bold text-xs mt-0.5',
  variants: {
    kind: {
      info: 'bg-muted text-bg',
      success: 'bg-success text-success-fg',
      warn: 'bg-warn text-warn-fg',
      error: 'bg-destructive text-destructive-fg',
    },
  },
})

const GLYPH: Record<ToastKind, string> = {
  info: 'i',
  success: '✓',
  warn: '!',
  error: '×',
}

interface ToastItemProps {
  readonly record: ToastRecord
  readonly onDismiss: () => void
  /** Additive class from `<Toaster classNames={{ item: '...' }}>`. */
  readonly extraClass?: string
}

const ToastItem = (props: ToastItemProps): View => {
  // Motion-driven enter/exit. `visible()` flips false → animator runs to 0.
  // We compose two animated values for the slide-in + fade.
  const opacity = animate(() => (props.record.visible() ? 1 : 0), { spring: 'snap' })
  const translateY = animate(() => (props.record.visible() ? 0 : 16), { spring: 'snap' })

  return (
    <div
      class={cls(toastRecipe({ kind: props.record.kind }), props.extraClass ?? '')}
      role={props.record.kind === 'error' ? 'alert' : 'status'}
      aria-live={props.record.kind === 'error' ? 'assertive' : 'polite'}
      style:opacity={() => String(opacity())}
      style:transform={() => `translateY(${translateY()}px)`}
    >
      <div class={glyphRecipe({ kind: props.record.kind })} aria-hidden="true">
        {GLYPH[props.record.kind]}
      </div>
      <div class="flex-1 text-sm leading-relaxed">{props.record.message}</div>
      <button
        type="button"
        class="shrink-0 -mt-0.5 -mr-1 w-6 h-6 rounded text-muted hover:text-fg hover:bg-card/60 transition-colors duration-150 inline-flex items-center justify-center"
        aria-label="Dismiss"
        onClick={props.onDismiss}
      >
        ×
      </button>
    </div>
  )
}

/**
 * Part anatomy for `<Toaster>` (Tier 17-D / ADR 0050).
 *   - `item` — each individual toast card. (The container is the
 *              root, addressed via the standalone `class` prop.)
 */
export type ToasterPart = 'item'

export interface ToasterProps {
  /**
   * Corner anchor. Default: `'bottom-right'`. The toaster is fixed-
   * positioned + uses the `popover` top-layer so it always sits above
   * everything.
   */
  readonly anchor?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  /** Additive classes on the toaster container. */
  readonly class?: string
  /** Typed per-subpart class overrides (Tier 17-D / ADR 0050). */
  readonly classNames?: Partial<Record<ToasterPart, string>>
}

// `max-w-[440px]` is the Toaster column's visual cap — wider than
// any individual toast (toasts cap at 420px), narrower than half a
// typical viewport. Component-specific layout constraint allowed
// per NN#6 clarification (Tier 15-D).
const anchorRecipe = recipe({
  base: 'fixed flex flex-col gap-2 max-w-[440px] pointer-events-none',
  variants: {
    anchor: {
      'bottom-right': 'bottom-4 right-4 items-end',
      'bottom-left': 'bottom-4 left-4 items-start',
      'top-right': 'top-4 right-4 items-end flex-col-reverse',
      'top-left': 'top-4 left-4 items-start flex-col-reverse',
    },
  },
  defaults: { anchor: 'bottom-right' },
})

export const Toaster = (props: ToasterProps = {}): View => {
  // Show the popover once the toaster mounts. The popover stays in
  // the top layer forever (cheap when the queue is empty). We don't
  // toggle showPopover/hidePopover because that would cause the
  // toaster to lose its top-layer position when the queue empties
  // briefly between toasts.
  let toasterEl: HTMLElement | null = null
  onMount(() => {
    // Browsers without popover support fall back to fixed positioning;
    // the toaster still renders, just not in the top layer.
    openPopover(toasterEl)
  })

  // Track whether the queue is non-empty so we can opt OUT of pointer
  // events when there are no toasts (the toaster div would otherwise
  // block clicks on the underlying corner of the page).
  watch(() => {
    if (!toasterEl) return
    const has = queue().length > 0
    toasterEl.style.setProperty('pointer-events', has ? 'auto' : 'none')
  })

  const baseClass = anchorRecipe(
    props.anchor !== undefined ? { anchor: props.anchor } : {},
  )
  const finalClass = props.class ? cls(baseClass, props.class) : baseClass

  return (
    <div
      class={finalClass}
      popover="manual"
      ref={(el: HTMLElement) => {
        toasterEl = el
      }}
    >
      <Show when={() => queue().length > 0}>
        {() =>
          keyed(
            () => queue(),
            (t: ToastRecord) => t.id,
            (t: ToastRecord) =>
              ToastItem({
                record: t,
                ...(props.classNames?.item ? { extraClass: props.classNames.item } : {}),
                onDismiss: () => {
                  t.visible.set(false)
                  setTimeout(() => {
                    queue.set(queue().filter((x) => x.id !== t.id))
                  }, 220)
                },
              }),
          )
        }
      </Show>
    </div>
  )
}
