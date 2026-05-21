// <Prose> — opinionated long-form reading container.
//
// Sugar for `<article class="prose">...</article>`. Renders an
// `<article>` with the design library's `.prose` typography styles
// applied. All the heavy lifting is in `base.css` (and the mirror
// `.prose` block in `styles.ts`); this component is just a typed
// wrapper so consumers don't have to remember the class name.
//
// Usage:
//
//   import { Prose } from '@place-ts/design'
//
//   <Prose>
//     <h1>Title</h1>
//     <p>Body gets perfect typography automatically.</p>
//     <pre><code>// code blocks too</code></pre>
//   </Prose>
//
// Adds your own classes via `class`: <Prose class="my-extra">. Pass
// `as="div"` (or `'section'` / `'main'`) if you need a different root
// — the .prose styles only key off the class, not the tag.

import type { Child, View } from '@place-ts/component'

export interface ProseProps {
  /** Optional extra classes appended after `.prose`. */
  class?: string
  /** Root tag. Default: `'article'`. */
  as?: 'article' | 'div' | 'section' | 'main'
  /** Children. */
  children?: Child | Child[]
}

export const Prose = (props: ProseProps): View => {
  const tag = props.as ?? 'article'
  const cls = props.class ? `prose ${props.class}` : 'prose'
  switch (tag) {
    case 'div':
      return <div class={cls}>{props.children}</div>
    case 'section':
      return <section class={cls}>{props.children}</section>
    case 'main':
      return <main class={cls}>{props.children}</main>
    default:
      return <article class={cls}>{props.children}</article>
  }
}
