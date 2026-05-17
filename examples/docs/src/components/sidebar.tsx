// Sidebar nav. `<Link>` reads the universal RouterCap (installed on
// the server by `renderPage` with a request-scoped impl) and emits
// `aria-current="page"` on the matching anchor during SSR. The active
// highlight ships in the first paint — no post-hydration DOM walk, no
// flicker on hard refresh.
//
// Active treatment uses `aria-[current=page]:` to drive both the
// pill background and the inset left bar (box-shadow). The bar is
// drawn INSIDE the link's box (inset shadow) so it can never leak
// outside the aside boundary — a regression we hit when an earlier
// design used `border-left + margin-left: -2px`.

import { Link } from '@place/component'

export interface SidebarSection {
  readonly title: string
  readonly links: readonly { readonly to: string; readonly label: string }[]
}

interface SidebarProps {
  sections: readonly SidebarSection[]
}

const LINK =
  'block px-3 py-1.5 rounded-md text-muted text-[13px] leading-snug no-underline ' +
  'transition-[color,background-color,box-shadow] duration-150 ' +
  'hover:text-fg hover:bg-card/55 ' +
  'aria-[current=page]:text-accent ' +
  'aria-[current=page]:bg-accent/10 ' +
  'aria-[current=page]:shadow-[inset_2px_0_0_0_var(--color-accent)] ' +
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-accent)_60%,transparent)]'

export const Sidebar = (props: SidebarProps) => (
  <nav aria-label="Documentation navigation" class="space-y-6">
    {props.sections.map((section) => (
      <div>
        <div class="px-3 mb-1.5 text-[10px] uppercase tracking-[0.09em] text-muted font-semibold">
          {section.title}
        </div>
        <ul class="list-none p-0 m-0">
          {section.links.map((link) => (
            <li>
              <Link to={link.to} class={LINK}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ))}
  </nav>
)
