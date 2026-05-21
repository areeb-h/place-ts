// <Prose> — opinionated long-form reading container.
//
// Sugar for `<article class="prose">...</article>`. Renders an
// `<article>` (default) with the design library's `.prose` typography
// applied. The heavy lifting is in `base.css` (and the mirror block
// in `styles.ts`); this component is just a typed wrapper.
//
// Usage:
//
//   import { Prose } from '@place-ts/design'
//
//   <Prose id="post-body" aria-labelledby="post-title">
//     <h1 id="post-title">Title</h1>
//     <p>Body gets perfect typography automatically.</p>
//   </Prose>
//
// Arbitrary HTML/ARIA/data attributes pass through to the rendered
// element. `as="div" | "section" | "main"` swaps the root tag — the
// `.prose` styles only key off the class, not the tag.

import type { Child, View } from '@place-ts/component'

export interface ProseProps {
  /** Optional extra classes appended after `.prose`. */
  class?: string
  /** Root tag. Default: `'article'`. */
  as?: 'article' | 'div' | 'section' | 'main'
  /** Children. */
  children?: Child | Child[]
  /** Any other HTML attribute (id, aria-*, data-*, role, lang, …) flows through. */
  [attr: string]: unknown
}

export const Prose = (props: ProseProps): View => {
  // Pull out the wrapper-specific fields; the rest spread to the
  // rendered element so consumers can attach `id`, `aria-*`, `data-*`,
  // `role`, etc. without us needing to enumerate every HTML attr.
  const { as, class: userClass, children, ...rest } = props
  const tag = as ?? 'article'
  const cls = userClass ? `prose ${userClass}` : 'prose'
  switch (tag) {
    case 'div':
      return (
        <div class={cls} {...rest}>
          {children}
        </div>
      )
    case 'section':
      return (
        <section class={cls} {...rest}>
          {children}
        </section>
      )
    case 'main':
      return (
        <main class={cls} {...rest}>
          {children}
        </main>
      )
    default:
      return (
        <article class={cls} {...rest}>
          {children}
        </article>
      )
  }
}
