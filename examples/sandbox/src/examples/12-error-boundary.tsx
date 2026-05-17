import { cls, component, errorBoundary, type View } from '@place/component'
import { state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

// Two demos in this card. The first shows a body-throw caught at mount.
// The second shows a reactive child throwing on a state change AFTER
// the initial mount succeeded — boundary catches that too. Retry
// re-mounts the original children.

// A View whose body throws on the first N mounts. Each retry calls
// mount() again, incrementing the attempt counter.
function makeFlakyView(failCount: number): View {
  let attempt = 0
  const Flaky = component<Record<string, never>>(() => {
    attempt++
    if (attempt <= failCount) {
      throw new Error(`flaky: attempt ${attempt} of ${failCount + 1} failed`)
    }
    return <span class="text-emerald-300 font-mono text-sm">✓ recovered on attempt {attempt}</span>
  })
  return Flaky({})
}

export function ErrorBoundaryExample(): View {
  // Demo 1 — body throw at mount, retry recovers
  const flakyView = makeFlakyView(2)

  // Demo 2 — reactive child throw on state change
  const trigger = state(false)

  return (
    <ExampleCard
      id="error-boundary"
      phase={2}
      number="12"
      title="errorBoundary — catch throws from the wrapped subtree"
      description="Throws from a component body, a reactive child, or a keyed render are routed through an internal capability to the nearest boundary. Render a fallback in their place; retry re-mounts the originals. Async errors stay with resource()'s error channel — that's the right shape for them."
      note="Boundary nesting works; the innermost active boundary catches. Throws propagate up to the page if no boundary is installed (loud failure, not a silent swallow). Fallbacks must not themselves throw — the boundary suppresses re-entry to avoid an infinite remount loop."
    >
      <div class="space-y-4">
        <div>
          <h3 class="text-sm font-medium text-fg mb-2">Body throws on first two mounts</h3>
          <p class="text-xs text-muted mb-3">
            The `Flaky` component throws the first two times its body runs. Click retry until it
            recovers.
          </p>
          <div class="rounded-lg border border-border/60 bg-card/40 p-4">
            {errorBoundary({
              fallback: (e, retry) => (
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs text-destructive font-mono">{(e as Error).message}</span>
                  <Button variant="accent" onClick={retry}>
                    retry
                  </Button>
                </div>
              ),
              children: flakyView,
            })}
          </div>
        </div>

        <div>
          <h3 class="text-sm font-medium text-fg mb-2">Reactive child throws on a state change</h3>
          <p class="text-xs text-muted mb-3">
            Toggle the boom switch — the reactive child reads it and throws. The boundary catches
            and renders fallback. Toggle back, then retry.
          </p>
          <div class="flex items-center gap-3 mb-3">
            <button
              type="button"
              onClick={() => trigger.set(!trigger())}
              class={() =>
                cls(
                  'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                  trigger()
                    ? 'border-destructive/50 bg-destructive/15 text-destructive'
                    : 'border-border bg-card hover:bg-card',
                )
              }
            >
              {() => (trigger() ? '💥 boom = true' : 'boom = false')}
            </button>
            <span class="text-xs text-muted font-mono">{() => `state: ${String(trigger())}`}</span>
          </div>
          <div class="rounded-lg border border-border/60 bg-card/40 p-4">
            {errorBoundary({
              fallback: (e, retry) => (
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs text-destructive font-mono">
                    caught: {(e as Error).message}
                  </span>
                  <Button variant="accent" onClick={retry}>
                    retry (toggle boom = false first)
                  </Button>
                </div>
              ),
              children: (
                <div class="text-sm font-mono text-fg/90">
                  {() => {
                    if (trigger()) throw new Error('reactive throw')
                    return '✓ rendering normally'
                  }}
                </div>
              ),
            })}
          </div>
        </div>
      </div>
    </ExampleCard>
  )
}
