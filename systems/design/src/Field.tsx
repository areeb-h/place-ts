// `<Field>` + `<Input>` + `<Textarea>` — native-first form controls.
//
// Built on the platform's native validation surface:
//
//   - `<input>` / `<textarea>` with HTML5 validity (`required`, `pattern`,
//     `type="email"`, `minlength`, etc.) — no JS validation engine.
//   - `:user-invalid` / `:user-valid` pseudo-classes — match only AFTER
//     the user has interacted with the field (not the moment the page
//     loads with empty required inputs). Universal browser support
//     since Safari 16.4 (Mar 2023).
//   - `ValidityState` API for reactive error messages.
//   - `aria-describedby` for screen-reader linkage; the framework wires
//     it automatically from the `error`/`hint` props.
//
// The library adds:
//   - Recipe variants for visual treatment (size + intent + invalid skin)
//   - Reactive `error` prop driving the displayed message
//   - Reactive `value` (cookie-state / app-state binding)
//   - Composition: `<Field>` is the labeled wrapper; `<Input>` /
//     `<Textarea>` are the bare controls — apps can use either.
//
// Anti-patterns deliberately avoided:
//   - No JS validation library wrapping the input — apps use native
//     `required` / `pattern` / `type` and read `ValidityState` for
//     custom messages.
//   - No `asChild` polymorphism. `<Field>` renders `<label>` +
//     `<input>` directly. Apps that need a different element use
//     `<Input>` (or `<Textarea>`) directly inside their own structure.
//   - No `forwardRef` ceremony. The framework's `ref` prop is the
//     contract.

import type { Children, RefCallback, View } from '@place/component'
import { cls, el, recipe } from '@place/component'

// ===== Recipe =====

const inputRecipe = recipe({
  base:
    'w-full rounded-md border bg-bg text-fg text-sm placeholder:text-muted ' +
    'transition-[border-color,box-shadow,background-color] duration-150 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
    // `:user-invalid` only matches AFTER the user has interacted. This
    // is the key UX difference from `:invalid` (which fires on initial
    // load for empty required inputs — bad first impression).
    'user-invalid:border-destructive user-invalid:focus-visible:ring-destructive/60 ' +
    'disabled:opacity-60 disabled:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-2 py-1 text-xs',
      md: 'px-3 py-1.5',
      lg: 'px-3.5 py-2',
    },
  },
  defaults: { size: 'md' },
})

// ===== Input =====

export type InputSize = 'sm' | 'md' | 'lg'

export interface InputProps {
  readonly id?: string
  readonly name?: string
  readonly type?:
    | 'text'
    | 'email'
    | 'password'
    | 'url'
    | 'tel'
    | 'number'
    | 'search'
    | 'date'
    | 'time'
    | 'datetime-local'
  readonly size?: InputSize
  /** Static or reactive value. Reactive form binds via `value={() => state()}`. */
  readonly value?: string | (() => string)
  /** Fired on every input event. */
  readonly onInput?: (e: Event) => void
  /** Fired on change (commit) — e.g. blur or Enter. */
  readonly onChange?: (e: Event) => void
  /** Native required. Triggers `:user-invalid` after touch + empty. */
  readonly required?: boolean
  /** Native validation pattern (regex source). */
  readonly pattern?: string
  /** Native min/max length. */
  readonly minLength?: number
  readonly maxLength?: number
  /** Native disabled. */
  readonly disabled?: boolean | (() => boolean)
  /** Placeholder text. */
  readonly placeholder?: string
  /** Auto-complete hint (`'off'`, `'email'`, `'new-password'`, etc.). */
  readonly autocomplete?: string
  /** `aria-describedby` — wired automatically by `<Field>` when used as a child. */
  readonly 'aria-describedby'?: string
  /** Additive classes. */
  readonly class?: string
  /** Native ref. */
  readonly ref?: RefCallback<HTMLInputElement>
}

export const Input = (props: InputProps): View => {
  const baseClasses = inputRecipe(
    props.size !== undefined ? { size: props.size } : {},
  )
  const finalClass = props.class ? cls(baseClasses, props.class) : baseClasses
  // Build the props object conditionally so `exactOptionalPropertyTypes`
  // doesn't reject `ref: undefined` / `pattern: undefined` etc. The
  // framework's element factory accepts `undefined` for missing values
  // but the type contract for `ref` is the bivariance-helper shape
  // which doesn't allow `undefined` literal at the call site.
  return el('input', {
    type: props.type ?? 'text',
    class: finalClass,
    ...(props.id !== undefined ? { id: props.id } : {}),
    ...(props.name !== undefined ? { name: props.name } : {}),
    ...(props.value !== undefined ? { value: props.value } : {}),
    ...(props.onInput !== undefined ? { onInput: props.onInput } : {}),
    ...(props.onChange !== undefined ? { onChange: props.onChange } : {}),
    ...(props.required === true ? { required: true } : {}),
    ...(props.pattern !== undefined ? { pattern: props.pattern } : {}),
    ...(props.minLength !== undefined ? { minlength: props.minLength } : {}),
    ...(props.maxLength !== undefined ? { maxlength: props.maxLength } : {}),
    ...(props.disabled !== undefined ? { disabled: props.disabled } : {}),
    ...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {}),
    ...(props.autocomplete !== undefined ? { autocomplete: props.autocomplete } : {}),
    ...(props['aria-describedby'] !== undefined
      ? { 'aria-describedby': props['aria-describedby'] }
      : {}),
    ...(props.ref !== undefined ? { ref: props.ref } : {}),
  })
}

// ===== Textarea =====

export interface TextareaProps extends Omit<InputProps, 'type' | 'pattern' | 'ref'> {
  readonly rows?: number
  readonly ref?: RefCallback<HTMLTextAreaElement>
}

export const Textarea = (props: TextareaProps): View => {
  const baseClasses = inputRecipe(
    props.size !== undefined ? { size: props.size } : {},
  )
  // **`field-sizing: content`** (Tier 17-E v2 fix) — Chromium 129+
  // auto-grows the textarea to fit its content with zero JS or
  // ResizeObserver. Browsers without `field-sizing` see the
  // `resize-y min-h-[5rem]` fallback (current behavior — fixed
  // starting height + manual resize handle).
  //
  // We apply both: `place-textarea-grow` is a semantic class hooked
  // by an `@supports (field-sizing: content)` rule in the design
  // stylesheet. Where supported, `field-sizing: content` overrides
  // `min-h` / `resize-y`. Where not, the Tailwind utilities take
  // over.
  const finalClass = props.class
    ? cls(baseClasses, 'place-textarea-grow resize-y min-h-[5rem]', props.class)
    : cls(baseClasses, 'place-textarea-grow resize-y min-h-[5rem]')
  return el('textarea', {
    class: finalClass,
    rows: props.rows ?? 4,
    ...(props.id !== undefined ? { id: props.id } : {}),
    ...(props.name !== undefined ? { name: props.name } : {}),
    ...(props.value !== undefined ? { value: props.value } : {}),
    ...(props.onInput !== undefined ? { onInput: props.onInput } : {}),
    ...(props.onChange !== undefined ? { onChange: props.onChange } : {}),
    ...(props.required === true ? { required: true } : {}),
    ...(props.minLength !== undefined ? { minlength: props.minLength } : {}),
    ...(props.maxLength !== undefined ? { maxlength: props.maxLength } : {}),
    ...(props.disabled !== undefined ? { disabled: props.disabled } : {}),
    ...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {}),
    ...(props.autocomplete !== undefined ? { autocomplete: props.autocomplete } : {}),
    ...(props['aria-describedby'] !== undefined
      ? { 'aria-describedby': props['aria-describedby'] }
      : {}),
    ...(props.ref !== undefined ? { ref: props.ref } : {}),
  })
}

// ===== Field — labeled wrapper =====

let _fieldIdCounter = 0
const nextFieldId = (): string => `place-field-${++_fieldIdCounter}`

/**
 * Part anatomy for `<Field>` (Tier 17-D / ADR 0050).
 *   - `label` — the `<label>` element.
 *   - `hint`  — the hint OR error paragraph (same slot; reactive
 *               swap by content).
 * Root uses the standalone `class` prop.
 */
export type FieldPart = 'label' | 'hint'

export interface FieldProps {
  /** Label text. Renders as `<label>` linked to the control via `for`. */
  readonly label: string
  /**
   * Optional ID — auto-generated if not provided. Set explicitly when
   * apps need to programmatically focus the field or reference it from
   * `aria-controls`/`aria-describedby` elsewhere.
   */
  readonly id?: string
  /**
   * Help text shown below the input. Always visible when `error` is
   * empty; replaced by the error message when validation fails.
   * Static OR reactive — pass a function for live updates.
   */
  readonly hint?: string | (() => string | null | undefined)
  /**
   * Reactive error message. When non-empty, replaces `hint` and the
   * input gets the `:user-invalid` visual treatment via the recipe.
   * Apps drive this from their validation logic (typically a watch on
   * the input's `ValidityState`).
   */
  readonly error?: string | (() => string | null | undefined)
  /**
   * The control. Use `<Input>` / `<Textarea>` / `<Select>` (or any
   * native form element). The `id` + `aria-describedby` props are
   * automatically threaded so screen readers announce the label and
   * hint/error.
   */
  readonly children?: Children
  /** Additive classes on the wrapper. */
  readonly class?: string
  /** Typed per-subpart class overrides (Tier 17-D / ADR 0050). */
  readonly classNames?: Partial<Record<FieldPart, string>>
}

/**
 * Labeled form field. Wraps `<Input>` (or any control) with a `<label>`
 * and reactive hint/error text.
 *
 * Composition note: the field auto-generates an ID and threads it via
 * the `for` attribute on the label. The control inside (`<Input>`)
 * accepts an `id` prop — if you pass one explicitly, the field uses
 * yours; otherwise it generates one. The control should be passed as
 * `children`, not as a `ref`-coupled prop, so the framework's normal
 * children flow works.
 *
 * Apps that need to read the input's ID for `aria-controls` etc. set
 * it explicitly:
 *
 *   <Field id="email" label="Email">
 *     <Input id="email" type="email" required />
 *   </Field>
 *
 * **Auto-validity styling (Tier 17-A.5).** The wrapper carries the
 * `place-field` class which a `:has()` rule in the design library's
 * stylesheet uses to turn the label + hint destructive when the
 * wrapped input matches `:user-invalid` (native HTML5 validation,
 * AFTER user interaction). Apps that supply a custom `error` prop
 * override the visual; apps that just use native validation
 * (`required`, `type="email"`, `pattern`, `minlength`) get the
 * destructive treatment for free. Zero JS state cell.
 */
export const Field = (props: FieldProps): View => {
  const fieldId = props.id ?? nextFieldId()
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`
  // **`place-field` semantic class** hooks the wrapper into a
  // `:has(:user-invalid)` rule in styles.ts that turns the label +
  // hint destructive when the wrapped input fails native HTML5
  // validation — no app-supplied `error` prop needed for the
  // common case. Apps that pass an explicit `error` override this.
  const wrapperClass = props.class
    ? cls('place-field flex flex-col gap-1.5', props.class)
    : 'place-field flex flex-col gap-1.5'
  const hasError = (): boolean => {
    const e = props.error
    if (e === undefined) return false
    const v = typeof e === 'function' ? e() : e
    return v !== null && v !== undefined && v !== ''
  }
  const errorText = (): string => {
    const e = props.error
    if (e === undefined) return ''
    const v = typeof e === 'function' ? e() : e
    return v ?? ''
  }
  const hintText = (): string => {
    const h = props.hint
    if (h === undefined) return ''
    const v = typeof h === 'function' ? h() : h
    return v ?? ''
  }
  const hasHint = (): boolean => hintText() !== ''
  const labelClass = cls('text-sm font-medium text-fg', props.classNames?.label ?? '')
  const hintBaseClass = 'place-field-hint text-xs'

  // **Auto-thread id + aria-describedby to the child control** (Tier
  // 17-E). Find the first form control under our root and write the
  // attributes. One-shot DOM mutation — no per-render listener.
  // Idempotent (sets the same attrs to the same values).
  //
  // **Timing**: ref callbacks fire on wrapper-element creation
  // BEFORE children are appended. Defer via `queueMicrotask` so
  // the DOM walk runs after the synchronous mount stack unwinds
  // — children are then in place. (We don't use `onMount` because
  // it waits for the framework's hydration flag, which doesn't
  // flip for components mounted via `mount()` outside the boot
  // pipeline.)
  const wireChildAttrs = (rootEl: HTMLElement | null): void => {
    if (!rootEl || typeof document === 'undefined') return
    queueMicrotask(() => {
      const ctrl = rootEl.querySelector('input, textarea, select') as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null
      if (!ctrl) return
      // Only set `id` if the consumer didn't already give the control
      // an explicit id — we never overwrite user intent.
      if (!ctrl.id) ctrl.id = fieldId
      // `aria-describedby` points at hint OR error. We list both IDs;
      // the browser silently ignores any that don't currently resolve
      // (so toggling between hint and error stays correct without
      // re-wiring the attribute).
      const existing = ctrl.getAttribute('aria-describedby') ?? ''
      const ids = new Set(existing.split(/\s+/).filter(Boolean))
      ids.add(hintId)
      ids.add(errorId)
      ctrl.setAttribute('aria-describedby', Array.from(ids).join(' '))
    })
  }

  return (
    <div
      class={wrapperClass}
      ref={(el: HTMLElement) => wireChildAttrs(el)}
    >
      <label for={fieldId} class={labelClass}>
        {props.label}
      </label>
      {props.children}
      {() =>
        hasError() ? (
          <p
            id={errorId}
            role="alert"
            class={cls(hintBaseClass, 'text-destructive font-medium', props.classNames?.hint ?? '')}
          >
            {() => errorText()}
          </p>
        ) : hasHint() ? (
          <p id={hintId} class={cls(hintBaseClass, 'text-muted', props.classNames?.hint ?? '')}>
            {() => hintText()}
          </p>
        ) : null
      }
    </div>
  )
}
