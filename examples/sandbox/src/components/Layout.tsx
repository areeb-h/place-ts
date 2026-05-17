import type { Child, View } from '@place/component'
import { Nav } from './Nav.tsx'

// Two-column layout: sticky sidebar on the left, current page on the right.
// On narrow screens the sidebar collapses below the content so the nav is
// still reachable but doesn't squeeze the demo.

export function Layout(props: { children: Child }): View {
  return (
    <div class="min-h-screen">
      <div class="max-w-6xl mx-auto px-4 py-8 sm:py-12 grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] gap-8">
        <aside class="lg:sticky lg:top-8 lg:self-start space-y-4">
          <header class="space-y-2 px-1">
            <div class="flex items-baseline gap-2">
              <h1 class="text-xl font-bold text-accent tracking-tight">place</h1>
              <span class="text-xs text-muted">— sandbox</span>
            </div>
            <p class="text-[11px] text-muted leading-snug">
              Live demos of <code class="text-fg/90">@place/reactivity</code>,{' '}
              <code class="text-fg/90">@place/component</code>, and{' '}
              <code class="text-fg/90">@place/routing</code>.
            </p>
          </header>
          <Nav />
        </aside>

        <main class="min-w-0 space-y-6">
          {props.children}
          <footer class="mt-12 pt-6 border-t border-border/60 text-xs text-muted/60">
            place-ts · v0.0.0 · MIT
          </footer>
        </main>
      </div>
    </div>
  )
}
