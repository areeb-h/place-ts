// Viewport-reactivity demo island. Renders a live readout of the
// framework's `viewport.*` accessors — width, height, breakpoint,
// prefers-reduced-motion, prefers-dark — so visitors can resize the
// window or change their OS preferences and watch the values
// reactively update.
//
// Pure consumer of the framework primitive: no matchMedia or
// ResizeObserver wiring of its own. The `viewport` namespace + the
// inline runtime emitted by `serve()` do all the work.

import { type View, viewport } from '@place/component'

const ViewportDemoImpl = (): View => {
  return (
    <div class="not-prose my-4 grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 rounded-lg border border-border bg-card/60 font-mono text-sm">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted uppercase tracking-wide">width</span>
        <span class="text-fg text-base tabular-nums">{() => `${viewport.width()}px`}</span>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted uppercase tracking-wide">height</span>
        <span class="text-fg text-base tabular-nums">{() => `${viewport.height()}px`}</span>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted uppercase tracking-wide">breakpoint</span>
        <span class="text-accent text-base font-semibold">{() => viewport.breakpoint()}</span>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted uppercase tracking-wide">reduced motion</span>
        <span class="text-fg text-base">
          {() => (viewport.prefersReducedMotion() ? 'yes' : 'no')}
        </span>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted uppercase tracking-wide">prefers dark</span>
        <span class="text-fg text-base">{() => (viewport.prefersDark() ? 'yes' : 'no')}</span>
      </div>
    </div>
  )
}

const ViewportDemo = view(ViewportDemoImpl)
export default ViewportDemo
