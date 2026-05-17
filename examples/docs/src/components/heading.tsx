// Heading with an anchor link on hover. SSR-emits the id so the ToC
// scan picks it up immediately; the hover affordance is pure CSS, no
// JS required. Use inside <article class="prose">.

import type { Children } from '@place/component'

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

interface HeadingProps {
  readonly id?: string
  readonly children?: Children
  readonly text: string
}

export const H2 = ({ id, text, children }: HeadingProps) => {
  const headingId = id ?? slug(text)
  return (
    <h2 id={headingId} class="anchor-heading">
      <a class="anchor-link" href={`#${headingId}`} aria-label={`Link to ${text}`}>
        #
      </a>
      {children ?? text}
    </h2>
  )
}

export const H3 = ({ id, text, children }: HeadingProps) => {
  const headingId = id ?? slug(text)
  return (
    <h3 id={headingId} class="anchor-heading">
      <a class="anchor-link" href={`#${headingId}`} aria-label={`Link to ${text}`}>
        #
      </a>
      {children ?? text}
    </h3>
  )
}
