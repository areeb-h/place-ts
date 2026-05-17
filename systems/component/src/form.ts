// `<Form action={...}>` JSX helper — typed form submission for `action()`.
//
// Wraps the noisy `<form onSubmit={(e) => { e.preventDefault(); … }}>`
// pattern: extracts FormData, calls `action.call(input)`, fires lifecycle
// callbacks (onSubmitting/onSuccess/onError/onDone). The browser's
// fallback POST to `action.path` works without JS too (since
// `action.handler` accepts both JSON and form-encoded bodies).
//
// Why the pattern matters: Next/SvelteKit/Remix all converged on
// "form is the unit of mutation" for progressive enhancement. Place-ts
// has the typed `action()` primitive; this wrapper closes the loop.
//
// Compared to Next's Server Actions:
//   - No `'use server'` directive, no Babel/SWC pass.
//   - The action is a typed value, imported like any other module.
//   - Form posts work without JS (graceful degradation), AND the JS
//     path uses fetch + JSON for the optimistic-update story.
//
// Compared to Remix's `<Form>`:
//   - Similar shape; `action` is a typed value reference instead of a
//     route file path string.
//   - Lifecycle hooks (onSubmitting, onSuccess, onError, onDone) are
//     explicit instead of relying on the route-data revalidation.

import type { Action, ActionError } from './action.ts'
import { type Child, component, el, type View } from './index.ts'

export interface FormProps<I, R> {
  /** The action to submit to. */
  action: Action<I, R>
  /**
   * Map FormData → action input. Default: `Object.fromEntries(formData)`.
   * Override when input fields don't map 1:1 to action input keys, or
   * when type-coercion is needed (e.g. `count` should be a number, not
   * a string from the form).
   */
  input?: (formData: FormData) => I
  /**
   * CSRF token, when the action has `csrf:` enabled. Sent as both:
   *   1. `X-CSRF-Token` header on the JS-path fetch (preferred)
   *   2. A `csrf` form field for the no-JS form-submission path
   *      (the action handler falls back to the body when the header
   *      is absent — same defense, two delivery channels)
   *
   * Mint via `csrfToken().generate(audience)` from `@place/security`,
   * embed in the page's load data, and pass here. Same secret +
   * audience used to verify on the server.
   */
  csrfToken?: string
  /** Fires before the action call (set a `pending` state here). */
  onSubmitting?: () => void
  /** Fires on successful action.call(). */
  onSuccess?: (result: R) => void
  /** Fires on error (network failure, validation error, action throw). */
  onError?: (error: ActionError | Error) => void
  /** Fires regardless of outcome — pair with onSubmitting for cleanup. */
  onDone?: () => void
  /** Reset the form's inputs after a successful submit. Default: true. */
  resetOnSuccess?: boolean
  /** Static or reactive className. */
  class?: string | (() => string)
  /** Standard form attribute pass-through. */
  id?: string
  /** Inline style. */
  style?: string | Record<string, string>
  children?: Child | Child[]
}

/**
 * Typed form-submission helper. Reads inputs by name, calls
 * `action.call(input)`, fires lifecycle callbacks. The underlying
 * `<form>` keeps `method="post"` and `action={action.path}` so a
 * no-JS browser still submits successfully (the action handler
 * accepts form-encoded bodies as well as JSON).
 *
 * ```tsx
 * <Form action={likePost}>
 *   <input name="id" />
 *   <button>Like</button>
 * </Form>
 *
 * // With pending state + error display:
 * const pending = state(false)
 * const error = state<string | null>(null)
 * <Form
 *   action={likePost}
 *   onSubmitting={() => { pending.write(true); error.write(null) }}
 *   onSuccess={(result) => console.log('liked:', result)}
 *   onError={(e) => error.write(e.message)}
 *   onDone={() => pending.write(false)}
 * >
 *   <input name="id" required />
 *   <button disabled={() => pending.read()}>Like</button>
 *   {() => error.read() ? <p class="text-destructive">{error.read()}</p> : ''}
 * </Form>
 * ```
 */
export const Form = component(<I, R>(props: FormProps<I, R>): View => {
  const onSubmit = (event: Event): void => {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const data = new FormData(form)
    const input = props.input ? props.input(data) : (Object.fromEntries(data) as I)
    props.onSubmitting?.()
    // CSRF token resolution: explicit `csrfToken` prop wins; otherwise
    // auto-read `<meta name="csrf-token">` (the framework auto-injects
    // this when the page's load() returns a `csrf` field). Dev never
    // wires the token transmission — just the mint at load time.
    let csrfToken = props.csrfToken
    if (!csrfToken && typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="csrf-token"]')
      csrfToken = meta?.getAttribute('content') ?? undefined
    }
    // CSRF path: bypass action.call() and do a direct fetch so we can
    // attach the X-CSRF-Token header. action.call's typed signature
    // doesn't carry headers; this is the dedicated escape hatch for
    // protected mutations. (action.call() also auto-reads the meta tag
    // — but Form prefers an explicit prop or the meta when bypassing
    // the typed call's signature constraints.)
    const submission = csrfToken
      ? fetch(props.action.path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify(input),
        }).then(async (res) => {
          if (!res.ok) {
            const text = await res.text()
            throw new Error(`HTTP ${res.status}: ${text}`)
          }
          const ct = res.headers.get('content-type') ?? ''
          return ct.includes('application/json')
            ? ((await res.json()) as R)
            : ((await res.text()) as unknown as R)
        })
      : props.action.call(input)
    submission
      .then((result) => {
        props.onSuccess?.(result as R)
        if (props.resetOnSuccess !== false) form.reset()
      })
      .catch((e: unknown) => {
        props.onError?.(e instanceof Error ? e : new Error(String(e)))
      })
      .finally(() => {
        props.onDone?.()
      })
  }
  // HTML forms only support GET + POST natively; we emit POST since
  // action() defaults to POST. Apps wanting a no-JS fallback for a
  // PUT/DELETE action need their handler to also accept POST (or just
  // skip the no-JS path).
  // `data-place-form=""` marks the form so the pre-boot capture runtime
  // (`__place_runtime.ts`) calls `preventDefault()` on submits that fire
  // before hydration — otherwise the browser does a plain POST to
  // `action` and the page navigates away before the SPA submit handler
  // (which fetch()es and stays in-page) gets attached.
  return el(
    'form',
    {
      method: 'post',
      action: props.action.path,
      onSubmit: onSubmit as unknown as (e: Event) => void,
      'data-place-form': '',
      ...(props.class ? { class: props.class } : {}),
      ...(props.id ? { id: props.id } : {}),
      ...(props.style ? { style: props.style } : {}),
    },
    props.children ?? [],
  )
})
