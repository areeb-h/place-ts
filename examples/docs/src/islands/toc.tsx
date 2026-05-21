// Right-side table of contents. ISLAND.
//
// **SSR-populated, framework-native.** The island declares an
// `ssrProps` resolver at the bottom of this file — the framework's
// render pipeline collects every `<h2>` / `<h3>` inside `<main>` as
// the JSX tree serializes (auto-injecting stable `id="…"` attrs at
// the same time), then calls the resolver with the typed heading
// list. The resolver returns the islands's initial props; the
// framework re-renders this island with those props and splices the
// result into the SSR'd marker. First paint shows the fully
// populated outline — no empty-to-filled blip, no app-level glue.
//
// Hydration runs the same scan on the client as a defense-in-depth
// step (handles SPA-nav, where the new body's headings need to be
// re-discovered after a `<main>` swap). The initial mount sees its
// own SSR-populated list before doing anything else, so the visual
// state is correct from frame zero.

import { state, view, watch } from '@place/component'
import { RouterCap } from '@place/routing'

interface Heading {
  readonly id: string
  readonly text: string
  readonly level: 2 | 3
}

interface ToCProps {
  readonly initialHeadings?: readonly Heading[]
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const ToCImpl = (props: ToCProps) => {
  const router = RouterCap.use()
  const initialList = props.initialHeadings ?? []
  const headings = state<readonly Heading[]>(initialList)
  const activeId = state(initialList[0]?.id ?? '')
  let observer: IntersectionObserver | null = null

  const rescan = (): void => {
    if (typeof document === 'undefined') return
    observer?.disconnect()
    const root = document.querySelector('main')
    if (!root) {
      headings.set([])
      return
    }
    const nodes = root.querySelectorAll<HTMLHeadingElement>('h2, h3')
    const list: Heading[] = []
    const seen = new Set<string>()
    nodes.forEach((n) => {
      const text = n.textContent ?? ''
      if (!text) return
      let id = n.id || slug(text)
      let candidate = id
      let i = 2
      while (seen.has(candidate)) {
        candidate = `${id}-${i}`
        i++
      }
      id = candidate
      seen.add(id)
      n.id = id
      list.push({ id, text, level: n.tagName === 'H2' ? 2 : 3 })
    })
    headings.set(list)
    activeId.set(list[0]?.id ?? '')

    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            activeId.set((e.target as HTMLElement).id)
            break
          }
        }
      },
      { rootMargin: '0px 0px -70% 0px' },
    )
    for (const n of nodes) observer.observe(n)
  }

  // The initial scan runs once on first mount — props.initialHeadings
  // already populated the visual state, this just attaches the
  // IntersectionObserver against the live DOM. On SPA-nav (router
  // path change), re-scan via microtask so the just-swapped <main>
  // is in the DOM by the time we query.
  let initial = true
  watch(() => {
    router.path()
    if (initial) {
      initial = false
      rescan()
    } else {
      queueMicrotask(rescan)
    }
  })

  return (
    <div class="sticky top-6 text-[13px]">
      <div
        class="px-3 mb-2 text-[10px] uppercase tracking-[0.09em] text-muted font-semibold"
        hidden={() => headings().length === 0}
      >
        On this page
      </div>
      <ul class="list-none p-0 m-0 relative before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-border/60">
        {() =>
          headings().map((h) => {
            const base = `block py-1 pr-3 ${h.level === 3 ? 'pl-6' : 'pl-3'} no-underline rounded-r-md relative transition-[color,background-color,box-shadow] duration-150 hover:bg-card/50`
            return (
              <li>
                <a
                  href={`#${h.id}`}
                  class={() =>
                    activeId() === h.id
                      ? `${base} text-accent hover:text-accent shadow-[inset_2px_0_0_0_var(--color-accent)]`
                      : `${base} text-muted hover:text-fg`
                  }
                >
                  {h.text}
                </a>
              </li>
            )
          })
        }
      </ul>
    </div>
  )
}

// The island declares its own SSR contract. The framework collects
// every h2/h3 inside <main> *during render* (via the element factory,
// not regex on output), auto-injects stable `id="…"` attrs, and
// passes the list to this resolver as `ctx.headings`. No string
// parsing, no HTML manipulation, no app-level glue.
export default view(ToCImpl, {
  ssrProps: ({ headings }) =>
    headings.length === 0 ? null : { props: { initialHeadings: headings } },
})
