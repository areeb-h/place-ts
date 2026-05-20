// Tag-name typed factories.
//
// Thin wrappers that fix the tag name + element type. Each factory is
// typed against its specific HTMLElement subtype via `HtmlFactory<E>`,
// so `ref` callbacks narrow at the call site (`input({ ref: (el) => el.focus() })`
// types `el` as `HTMLInputElement`, not `HTMLElement`).
//
// The JSX runtime maps `'div'` (string literal) to `el('div', ...)`;
// these factories let non-JSX consumers write `div({ ... })` directly,
// with the same call shape both call-pathways agree on:
//
//     div()                              // empty
//     div({ class: 'x' })                // props only
//     div({ class: 'x' }, [child])       // props + children
//     div('a', 'b')                      // children only (props-omitted form)
//     div(child1, child2, child3)        // multi-child
//
// We don't generate per-tag prop interfaces yet (input.value, etc.) —
// `ElementProps`'s open index signature still accepts them. Per-tag
// prop narrowing is a future cut (element typings package); the ref
// narrowing here is the highest-value typing today.
//
// Implementation note: imports from `./index.ts` until the `el()`
// factory moves to `./element/factory.ts` (Tier 1-A Cut 3). When that
// cut lands, only the import line changes.

import { el } from './index.ts'
import type { Child, ElementProps, RefCallback, View } from './types.ts'

type ElementArg<E extends HTMLElement> =
  | (Omit<ElementProps, 'ref'> & { ref?: RefCallback<E> })
  | Child
  | Child[]

/**
 * Typed per-tag factory. The `E` type parameter narrows the `ref`
 * callback so `button({ ref: (el) => el.focus() })` types `el` as
 * `HTMLButtonElement` rather than `HTMLElement`. Props can be any
 * `ElementProps` subset; arrays/children pass through to `el()`.
 */
export type HtmlFactory<E extends HTMLElement = HTMLElement> = (...args: ElementArg<E>[]) => View

const make =
  <E extends HTMLElement>(tag: string): HtmlFactory<E> =>
  (...args) =>
    el(tag, ...(args as Parameters<typeof el>[1][]))

// ===== Document sectioning =====
export const article: HtmlFactory = make('article')
export const aside: HtmlFactory = make('aside')
export const footer: HtmlFactory = make('footer')
export const header: HtmlFactory = make('header')
export const h1: HtmlFactory<HTMLHeadingElement> = make('h1')
export const h2: HtmlFactory<HTMLHeadingElement> = make('h2')
export const h3: HtmlFactory<HTMLHeadingElement> = make('h3')
export const h4: HtmlFactory<HTMLHeadingElement> = make('h4')
export const h5: HtmlFactory<HTMLHeadingElement> = make('h5')
export const h6: HtmlFactory<HTMLHeadingElement> = make('h6')
export const main: HtmlFactory = make('main')
export const nav: HtmlFactory = make('nav')
export const section: HtmlFactory = make('section')

// ===== Text content =====
export const div: HtmlFactory<HTMLDivElement> = make('div')
export const p: HtmlFactory<HTMLParagraphElement> = make('p')
export const span: HtmlFactory<HTMLSpanElement> = make('span')
export const pre: HtmlFactory<HTMLPreElement> = make('pre')
export const code: HtmlFactory = make('code')
export const strong: HtmlFactory = make('strong')
export const em: HtmlFactory = make('em')
export const small: HtmlFactory = make('small')
export const hr: HtmlFactory<HTMLHRElement> = make('hr')
export const br: HtmlFactory<HTMLBRElement> = make('br')

// ===== Lists =====
export const ul: HtmlFactory<HTMLUListElement> = make('ul')
export const ol: HtmlFactory<HTMLOListElement> = make('ol')
export const li: HtmlFactory<HTMLLIElement> = make('li')
export const dl: HtmlFactory<HTMLDListElement> = make('dl')
export const dt: HtmlFactory = make('dt')
export const dd: HtmlFactory = make('dd')

// ===== Links + inline =====
export const a: HtmlFactory<HTMLAnchorElement> = make('a')

// ===== Forms =====
export const button: HtmlFactory<HTMLButtonElement> = make('button')
export const form: HtmlFactory<HTMLFormElement> = make('form')
export const input: HtmlFactory<HTMLInputElement> = make('input')
export const label: HtmlFactory<HTMLLabelElement> = make('label')
export const output: HtmlFactory<HTMLOutputElement> = make('output')
export const textarea: HtmlFactory<HTMLTextAreaElement> = make('textarea')
export const select: HtmlFactory<HTMLSelectElement> = make('select')
export const option: HtmlFactory<HTMLOptionElement> = make('option')
export const fieldset: HtmlFactory<HTMLFieldSetElement> = make('fieldset')
export const legend: HtmlFactory<HTMLLegendElement> = make('legend')

// ===== Embedded media =====
export const picture: HtmlFactory = make('picture')
export const source: HtmlFactory<HTMLSourceElement> = make('source')
export const video: HtmlFactory<HTMLVideoElement> = make('video')
export const audio: HtmlFactory<HTMLAudioElement> = make('audio')

// ===== Tabular data =====
export const table: HtmlFactory<HTMLTableElement> = make('table')
export const caption: HtmlFactory<HTMLTableCaptionElement> = make('caption')
export const thead: HtmlFactory<HTMLTableSectionElement> = make('thead')
export const tbody: HtmlFactory<HTMLTableSectionElement> = make('tbody')
export const tfoot: HtmlFactory<HTMLTableSectionElement> = make('tfoot')
export const tr: HtmlFactory<HTMLTableRowElement> = make('tr')
export const th: HtmlFactory<HTMLTableCellElement> = make('th')
export const td: HtmlFactory<HTMLTableCellElement> = make('td')

// ===== Interactive =====
export const details: HtmlFactory<HTMLDetailsElement> = make('details')
export const summary: HtmlFactory = make('summary')
export const dialog: HtmlFactory<HTMLDialogElement> = make('dialog')
