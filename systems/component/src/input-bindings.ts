// Input + keyboard helpers — `wire`, `onKey`, `globalKey`, `urlState`.
//
// Pure leaf module: depends on reactivity + routing, depended on by no
// other framework module (only by user code via the barrel). Extracted
// from the main index so the file size shrinks without changing the
// dependency graph.

import {
  type Disposer,
  type State,
  state,
  untrack,
  watch,
} from '../../reactivity/src/index.ts'
import { RouterCap } from '../../routing/src/index.ts'
import { onCleanup } from './_internal/cleanup.ts'

// ===== wire — two-way binding helper for inputs =====
//
//   wire(stringState)              — text input / textarea
//   wire(numberState)              — number input (parses .value, ignores NaN)
//   wire(booleanState)             — checkbox / radio (uses .checked)
//   wire(get, set)                 — derived string field with a custom
//                                    setter (e.g. store.update)
//
// String and derived forms return `{ value, onInput }`. Number form is
// the same shape; onInput parseFloats and silently ignores NaN so a
// number spinner dragged past empty doesn't clobber state with NaN.
// Boolean form returns `{ checked, onChange }` — the right pair for
// HTML checkboxes / radios.
//
// Runtime dispatch on the state's current value type. One name, three
// input shapes; the namespace stays small.

export interface WiredText {
  value: () => string
  onInput: (event: Event) => void
}
export interface WiredNumber {
  value: () => number
  onInput: (event: Event) => void
}
export interface WiredBoolean {
  checked: () => boolean
  onChange: (event: Event) => void
}

export function wire(s: State<string>): WiredText
export function wire(s: State<number>): WiredNumber
export function wire(s: State<boolean>): WiredBoolean
export function wire(get: () => string, set: (value: string) => void): WiredText
export function wire(
  a: State<string> | State<number> | State<boolean> | (() => string),
  b?: (value: string) => void,
): WiredText | WiredNumber | WiredBoolean {
  // (get, set) form — explicit string binding to a derived field.
  if (b !== undefined) {
    const get = a as () => string
    return {
      value: get,
      onInput: (e: Event) => b((e.target as HTMLInputElement).value),
    }
  }
  // State<T> form: sample to dispatch on the runtime type. Booleans /
  // numbers / strings are exhaustive for v0.1.
  const s = a as State<unknown>
  const sample = s.read()
  if (typeof sample === 'boolean') {
    const sb = s as State<boolean>
    return {
      checked: sb.read,
      onChange: (e: Event) => sb.write((e.target as HTMLInputElement).checked),
    }
  }
  if (typeof sample === 'number') {
    const sn = s as State<number>
    return {
      value: sn.read,
      onInput: (e: Event) => {
        const v = Number.parseFloat((e.target as HTMLInputElement).value)
        if (!Number.isNaN(v)) sn.write(v)
      },
    }
  }
  const ss = s as State<string>
  return {
    value: ss.read,
    onInput: (e: Event) => ss.write((e.target as HTMLInputElement).value),
  }
}

// ===== onKey — keyboard handler for one specific key =====
//
//   onKeyDown={(e) => {
//     if ((e as KeyboardEvent).key === 'Enter') {
//       e.preventDefault()
//       addTag()
//     }
//   }}
//
// becomes:
//
//   onKeyDown={onKey('Enter', addTag, { preventDefault: true })}

export interface OnKeyOptions {
  /** Call event.preventDefault() before invoking the handler. */
  preventDefault?: boolean
  /** Call event.stopPropagation() before invoking the handler. */
  stopPropagation?: boolean
}

export function onKey(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options?: OnKeyOptions,
): (event: KeyboardEvent) => void {
  return (event) => {
    if (event.key !== key) return
    if (options?.preventDefault) event.preventDefault()
    if (options?.stopPropagation) event.stopPropagation()
    handler(event)
  }
}

// ===== globalKey — document-level keyboard shortcut =====
//
// Registers a `keydown` listener on `document` that fires only when the
// chord matches exactly. Auto-disposes via `onCleanup` when called
// inside a component body; outside one, the returned disposer is the
// only way to remove it.
//
//   globalKey('mod+k', focusSearch, { preventDefault: true })
//   globalKey('mod+shift+z', redo)
//   globalKey('Escape', clearFilter)
//
// Chord syntax: `[mod+][shift+][alt+]<Key>`. Modifiers match strictly —
// `globalKey('k', ...)` does NOT fire on Cmd+K. `mod` is Cmd on Mac and
// Ctrl elsewhere (reads `event.metaKey || event.ctrlKey`).
//
// The trailing `<Key>` is matched against `event.key` verbatim. So bare
// 'k' fires on the K key alone; 'shift+K' fires on capital K (which is
// what shift produces). For non-letter keys use the standard names:
// 'Escape', 'Enter', 'ArrowUp', 'Backspace', etc.

export interface GlobalKeyOptions {
  preventDefault?: boolean
  stopPropagation?: boolean
  /**
   * Skip the handler when an editable element is focused (input,
   * textarea, select, or contenteditable). Use this for bare-letter
   * shortcuts and arrow-key navigation that shouldn't interfere with
   * typing. Defaults to false — most modifier shortcuts (Cmd+K, Esc)
   * should fire regardless of focus.
   */
  skipInInput?: boolean
}

function isEditableElement(target: Element | null): boolean {
  if (target === null) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (target as HTMLElement).isContentEditable === true
}

interface ParsedChord {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}

function parseChord(chord: string): ParsedChord {
  const parts = chord.split('+')
  const key = parts[parts.length - 1]
  if (key === undefined || key === '') {
    throw new Error(`globalKey: invalid chord '${chord}' — must end with a key name`)
  }
  let mod = false
  let shift = false
  let alt = false
  for (let i = 0; i < parts.length - 1; i++) {
    const m = parts[i]
    if (m === 'mod') mod = true
    else if (m === 'shift') shift = true
    else if (m === 'alt') alt = true
    else throw new Error(`globalKey: unknown modifier '${m}' in chord '${chord}'`)
  }
  return { key, mod, shift, alt }
}

export function globalKey(
  chord: string,
  handler: (event: KeyboardEvent) => void,
  options?: GlobalKeyOptions,
): Disposer {
  const { key, mod: wantMod, shift: wantShift, alt: wantAlt } = parseChord(chord)
  const skipInInput = options?.skipInInput === true

  const listener = (event: KeyboardEvent): void => {
    if (event.key !== key) return
    const hasMod = event.metaKey || event.ctrlKey
    if (hasMod !== wantMod) return
    if (event.shiftKey !== wantShift) return
    if (event.altKey !== wantAlt) return
    if (skipInInput && isEditableElement(document.activeElement)) return
    if (options?.preventDefault) event.preventDefault()
    if (options?.stopPropagation) event.stopPropagation()
    handler(event)
  }
  document.addEventListener('keydown', listener)
  const dispose: Disposer = () => document.removeEventListener('keydown', listener)
  onCleanup(dispose)
  return dispose
}

// ===== urlState — URL-bound reactive state =====
//
// `State<T>` whose value is read from and written to a single query
// parameter on the current router. Bidirectional: writes update the
// URL, external URL changes (browser back/forward, deep links) flow
// back into the state reactively.
//
//   const tag = urlState('tag', '')
//   const page = urlState('page', 1, { parse: (raw) => raw ? Number(raw) : 1 })
//   const sort = urlState('sort', 'asc' as const, {
//     parse: (raw) => raw === 'desc' ? 'desc' : 'asc',
//   })
//
//   tag.read()                  // current value (from URL)
//   tag.write('react')          // → ?tag=react
//   <input {...wire(tag)} />    // two-way input binding to URL
//
// When the value equals `defaultValue`, the param is omitted from the
// URL (clean shareable URLs). Default behavior uses `replace` so filter
// UI doesn't grow the back stack; pass `push: true` for navigation-like
// uses where each change should be a real history entry.
//
// Auto-disposes via `onCleanup` when called inside a component scope.
// Outside one, the internal watch will leak — reach for `router.param()`
// directly there.

export interface UrlStateOptions<T> {
  /** Parse the raw query value into T. Default: `raw ?? defaultValue`. */
  parse?: (raw: string | null) => T
  /**
   * Serialize T back into a query value. Return `null` to delete the
   * key from the URL. Default: omit when value === defaultValue, else
   * `String(v)`.
   */
  serialize?: (value: T) => string | null
  /** Use push (new history entry) instead of replace. Default: replace. */
  push?: boolean
}

export function urlState<T = string>(
  key: string,
  defaultValue: T,
  options?: UrlStateOptions<T>,
): State<T> {
  const router = RouterCap.use()
  const parse = options?.parse
  const serialize = options?.serialize
  const navOptions = options?.push === true ? undefined : { replace: true }

  const fromUrl = (raw: string | null): T => (parse ? parse(raw) : ((raw ?? defaultValue) as T))

  const toUrl = (v: T): string | null => {
    if (serialize) return serialize(v)
    return Object.is(v, defaultValue) ? null : String(v)
  }

  const internal = state<T>(fromUrl(router.param(key)))

  // URL → state: any external URL change (browser back/forward, manual
  // navigate elsewhere) syncs back to the internal state. The watch
  // subscribes only to `router.param` — internal is read inside
  // `untrack` so writing it (in this watch OR in `urlState.write`)
  // doesn't re-trigger us. Object.is dedupe avoids redundant writes.
  const stopSync = watch(() => {
    const fresh = fromUrl(router.param(key))
    const current = untrack(() => internal())
    if (!Object.is(current, fresh)) {
      internal.set(fresh)
    }
  })
  onCleanup(stopSync)

  // Build a callable State<T> that wraps internal but also writes to URL.
  const read = (): T => internal()
  const writeBoth = (value: T | ((prev: T) => T)): void => {
    if (typeof value === 'function') internal.update(value as (prev: T) => T)
    else internal.set(value)
    router.updateQuery({ [key]: toUrl(internal()) }, navOptions)
  }
  // biome-ignore lint/suspicious/noExplicitAny: runtime method attachment
  const s = read as any
  s.set = (next: T) => writeBoth(next)
  s.update = (fn: (prev: T) => T) => writeBoth(fn)
  s.peek = () => untrack(() => internal())
  s.map = <U>(transform: (value: T) => U): (() => U) => {
    const m = internal.map(transform)
    return m
  }
  s.read = read
  s.write = writeBoth
  // Narrowed methods — forward to internal (which has them at runtime).
  s.toggle = () => {
    writeBoth(((v: unknown) => !v) as never)
  }
  s.push = (...items: unknown[]) => {
    writeBoth(((arr: unknown) => (Array.isArray(arr) ? [...arr, ...items] : arr)) as never)
  }
  s.remove = (predicate: (item: unknown, index: number) => boolean) => {
    writeBoth(((arr: unknown) =>
      Array.isArray(arr) ? arr.filter((it, idx) => !predicate(it, idx)) : arr) as never)
  }
  s.clear = () => {
    writeBoth([] as never)
  }
  s.replace = (index: number, value: unknown) => {
    writeBoth(((arr: unknown) => {
      if (!Array.isArray(arr)) return arr
      const next = arr.slice()
      next[index] = value
      return next
    }) as never)
  }
  return s as State<T>
}
