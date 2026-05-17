import { Link, type View } from '@place/component'
import { PAGES } from '../pages.tsx'
import { PhaseTag } from './PhaseTag.tsx'

// Sidebar of pages. Each link uses the framework's typed `<Link>`:
//   - Sets href + onClick + reactive aria-current via RouterCap
//   - Cmd/Ctrl/middle-click stays native (open in new tab)
//   - Active styling is pure CSS via `aria-[current=page]:` and
//     `group-aria-[current=page]:` Tailwind variants — no JS class
//     composition, no `link.active()` reads in templates.

export function Nav(): View {
  return (
    <nav class="space-y-1">
      <Link
        to="/"
        class="block px-3 py-2 rounded-md text-sm font-medium transition-colors border border-transparent text-muted hover:bg-card/60 hover:text-fg aria-[current=page]:bg-accent/15 aria-[current=page]:text-accent aria-[current=page]:border-accent/30"
      >
        ← Index
      </Link>
      <div class="h-px bg-card/60 my-3" />
      <ul class="list-none p-0 m-0 space-y-1">
        {PAGES.map((p) => (
          <li>
            <Link
              to={`/${p.slug}`}
              class="group block px-3 py-2 rounded-md transition-colors border border-transparent hover:bg-card/60 aria-[current=page]:bg-accent/15 aria-[current=page]:border-accent/30"
            >
              <div class="flex items-center justify-between gap-2 mb-1">
                <span class="text-[10px] font-mono text-muted/60 group-aria-[current=page]:text-accent">
                  {p.number}
                </span>
                <PhaseTag phase={p.phase} />
              </div>
              <span class="block text-sm text-fg/90 group-aria-[current=page]:text-accent group-aria-[current=page]:font-medium">
                {p.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
