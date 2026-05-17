// Interactive reactivity demo. ISLAND.
//
// Two source states (a, b), a derived value c = a + b, and a watch
// effect that logs. Each node flashes when it recomputes — the user
// sees two-color propagation in action. The demo runs *the actual*
// framework primitives (`@place/reactivity`'s `state`, `derived`,
// `watch`), not a fake doc-only runtime.
//
// Was a plain component in `src/components/`; promoted to an island
// because (a) the buttons need client JS to fire, and (b) reactive
// inline `style={() => …}` writes were emitting `style="…"`
// attributes at SSR whose per-request hashes leaked into CSP and
// blocked SPA-nav into pages with different inline-style values.
// As an island the flash variable is written via
// `el.style.setProperty('--flash-age', …)` at runtime — CSP-safe
// (ADR 0014), no per-request hash plumbing needed.

import { derived, island, onMount, state, untrack, watch } from '@place/component'

const FLASH_MS = 600

const NODE_CLASS =
  'w-[90px] h-[60px] rounded-[10px] border-2 border-border bg-bg flex flex-col items-center justify-center gap-0.5 transition-[border-color,background-color] duration-[600ms] animate-reactivity-flash'

interface NodeProps {
  readonly label: string
  readonly value: () => string | number
  readonly flashKey: () => number
  readonly derived?: boolean
}

const Node = (props: NodeProps) => (
  <div
    class={`${NODE_CLASS} ${props.derived ? 'border-[color-mix(in_oklab,var(--color-accent)_50%,transparent)]' : ''}`}
    data-flash-key={() => String(props.flashKey())}
    // Reactive `style={fn}` — runtime path parses the string and writes
    // each declaration via `el.style.setProperty(...)` (the CSP-safe
    // `applyStyleStringSafe` codepath, ADR 0014). The SSR pass skips
    // emitting the inline `style="…"` attribute entirely for function-
    // shape style props (see `elementToHtml`'s `isReactive` branch),
    // so strict CSP stays intact under SPA-nav even though the
    // first-paint value is set client-side after hydration.
    style={() => `--flash-age: ${Math.max(0, Date.now() - props.flashKey()) / FLASH_MS};`}
  >
    <div class="font-mono text-[11px] leading-none text-muted">{props.label}</div>
    <div class="font-mono font-semibold text-[18px] leading-none text-fg">
      {() => String(props.value())}
    </div>
  </div>
)

const CONTROL_BUTTON =
  'w-7 h-[26px] rounded-[5px] border border-border bg-bg text-muted cursor-pointer text-sm transition-colors duration-150 hover:text-accent hover:border-accent'

const ReactivityDemoImpl = () => {
  const a = state(2)
  const b = state(3)
  const log = state<readonly string[]>([])

  // Track when each derived node last computed — flashKey is the time
  // of the most recent recomputation, used by CSS to drive the flash.
  const aFlash = state(Date.now())
  const bFlash = state(Date.now())
  const cFlash = state(Date.now())

  // Tick drives the flash CSS re-evaluation over time (decays).
  // SSR-safe: the interval only starts client-side via onMount.
  const tick = state(0)
  onMount(() => {
    const id = setInterval(() => tick.set(tick() + 1), 80)
    return () => clearInterval(id)
  })

  // c is a memoized derived value. `derived()` returns a () => T that
  // recomputes only when its dependencies (a and b) change.
  const c = derived(() => a() + b())

  watch(() => {
    const v = c()
    untrack(() => {
      cFlash.set(Date.now())
      const entry = `c = a + b = ${v}`
      log.set([entry, ...log()].slice(0, 6))
    })
  })

  const bump = (s: typeof a, delta: number, flash: typeof aFlash): void => {
    s.set(s() + delta)
    flash.set(Date.now())
  }

  return (
    <div class="my-6 p-6 rounded-xl border border-border bg-card/50 grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div class="flex flex-col items-center gap-2">
        <div class="flex gap-8">
          <div class="flex flex-col items-center gap-2">
            <Node label="a" value={() => a()} flashKey={() => aFlash() + tick() * 0} />
            <div class="flex gap-1">
              <button type="button" class={CONTROL_BUTTON} onClick={() => bump(a, -1, aFlash)}>
                −
              </button>
              <button type="button" class={CONTROL_BUTTON} onClick={() => bump(a, 1, aFlash)}>
                +
              </button>
            </div>
          </div>
          <div class="flex flex-col items-center gap-2">
            <Node label="b" value={() => b()} flashKey={() => bFlash() + tick() * 0} />
            <div class="flex gap-1">
              <button type="button" class={CONTROL_BUTTON} onClick={() => bump(b, -1, bFlash)}>
                −
              </button>
              <button type="button" class={CONTROL_BUTTON} onClick={() => bump(b, 1, bFlash)}>
                +
              </button>
            </div>
          </div>
        </div>
        <svg
          class="w-[200px] h-[50px] fill-none stroke-[color-mix(in_oklab,var(--color-muted)_50%,transparent)] stroke-[1.5]"
          viewBox="0 0 200 60"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M 50 0 Q 50 30 100 50" />
          <path d="M 150 0 Q 150 30 100 50" />
        </svg>
        <div class="mt-1">
          <Node label="c (a + b)" value={c} flashKey={() => cFlash() + tick() * 0} derived />
        </div>
      </div>
      <div class="flex flex-col gap-2" aria-live="polite">
        <div class="text-[10px] uppercase tracking-[0.08em] text-muted font-semibold">
          watch() effect log
        </div>
        <ul class="list-none p-3 m-0 rounded-lg bg-bg border border-border flex-1 min-h-[160px] font-mono text-[12px] leading-[1.55] text-muted">
          {() =>
            log().map((line, i) => (
              <li class={`py-0.5 ${i === 0 ? 'text-fg' : ''}`}>{line}</li>
            ))
          }
        </ul>
      </div>
    </div>
  )
}

export default island(ReactivityDemoImpl)
