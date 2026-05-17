// `motion(when, opts)` — delay unmount + emit a `phase` signal so
// CSS transitions complete before the DOM is torn down.
//
// The framework's `<Show when={…}>` and `<Activity mode="hidden">`
// mount/unmount instantly. CSS transitions need the leaving element
// to STAY in the DOM long enough for `transition-duration` to elapse.
// `motion()` is the bridge:
//
//   const fade = motion(() => isOpen(), { duration: 200 })
//   <Show when={fade.shouldRender}>
//     {() => (
//       <div
//         data-motion={fade.phase()}
//         class="transition-opacity duration-200
//                data-[motion=enter]:opacity-0
//                data-[motion=entered]:opacity-100
//                data-[motion=exit]:opacity-0"
//       >…</div>
//     )}
//   </Show>
//
// Lifecycle:
//   exited  → (when→true)  → enter  → (rAF next frame) → entered
//   entered → (when→false) → exit   → (setTimeout duration) → exited
//
// The `enter` → `entered` rAF flip is what lets CSS see the
// "from" state before "to" — without it, the browser would
// collapse them and never animate.
//
// Server-side: `phase` resolves to `'exited'` or `'entered'` per
// the initial `when()` value; `shouldRender` resolves matching that.
// No rAF, no setTimeout — animations are render-time fluff and the
// SSR snapshot ships the resting shape.
//
// Compared to writing this dance by hand at every call site:
//   - One primitive instead of a state+watch+rAF+setTimeout quartet.
//   - The cleanup contract is owned by `motion()` (clears its own
//     timer on dispose) — call sites can't leak a pending exit
//     timer by forgetting an onCleanup.
//   - The phase string is data-bindable, so the CSS contract is
//     plain Tailwind/utility classes; no JS class swap.

import { state, watch, untrack, type Derived } from '../index.ts'

/**
 * Lifecycle phases emitted by `motion()`. Bind to an element via
 * `data-motion={phase()}` and target the four phases with CSS:
 *
 *   - `enter`   — first frame after the element mounts (use as
 *                 the "from" state for the enter transition)
 *   - `entered` — steady-state visible (the "to" state)
 *   - `exit`    — leaving; mounted but transitioning out (the
 *                 "from-on-leave" state mirrors `enter` typically)
 *   - `exited`  — gone; `shouldRender` is false in this phase
 */
export type MotionPhase = 'enter' | 'entered' | 'exit' | 'exited'

export interface MotionOptions {
  /**
   * Exit duration in milliseconds. Must match (or exceed) the CSS
   * transition's longest leg or the element will be removed mid-
   * animation. Default `200`.
   */
  readonly duration?: number
}

export interface Motion {
  /**
   * Current phase. Reactive — emit on an element via
   * `data-motion={motion.phase()}`.
   */
  readonly phase: Derived<MotionPhase>
  /**
   * Whether the element should be in the DOM right now. True from
   * `enter` through `exit`; false in `exited`. Pass to `<Show when>`.
   */
  readonly shouldRender: Derived<boolean>
}

/**
 * Wire CSS-transition-aware enter/exit timing for a `<Show>` / `<Activity>`
 * boundary. Keeps the leaving element in the DOM for `duration`
 * milliseconds AFTER `when()` flips to false, so the exit transition
 * has time to complete.
 *
 * @param when      Reactive boolean driving the visible state.
 * @param opts      `{ duration }` — exit linger time. Default 200ms.
 */
export function motion(
  when: () => boolean,
  opts: MotionOptions = {},
): Motion {
  const duration = opts.duration ?? 200
  // Initial: whatever `when()` says, render fully entered (avoids
  // animating on the very first paint — that's lifecycle for mounts
  // that happened AFTER initial render, not the initial render itself).
  // If you want first-paint to animate, set `when()` to false then
  // flip it after onMount.
  const initial = untrack(when) ? 'entered' : 'exited'
  const phase = state<MotionPhase>(initial)
  let exitTimer: ReturnType<typeof setTimeout> | null = null
  let enterFrame: ReturnType<typeof requestAnimationFrame> | null = null

  const clearTimers = (): void => {
    if (exitTimer !== null) {
      clearTimeout(exitTimer)
      exitTimer = null
    }
    if (enterFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(enterFrame)
      enterFrame = null
    }
  }

  let firstFire = true
  watch(() => {
    const want = when()
    if (firstFire) {
      firstFire = false
      return
    }
    const p = untrack(phase)
    if (want) {
      // Entering. If we were mid-exit, cancel the unmount timer.
      clearTimers()
      if (p === 'exited' || p === 'exit') {
        phase.set('enter')
        // rAF next frame to let the browser paint the `enter` state
        // before flipping to `entered` — without this two-step,
        // there's no `from` state and no transition fires.
        if (typeof requestAnimationFrame === 'function') {
          enterFrame = requestAnimationFrame(() => {
            enterFrame = null
            phase.set('entered')
          })
        } else {
          phase.set('entered')
        }
      }
    } else {
      // Exiting. Schedule unmount after `duration`.
      clearTimers()
      if (p === 'entered' || p === 'enter') {
        phase.set('exit')
        exitTimer = setTimeout(() => {
          exitTimer = null
          phase.set('exited')
        }, duration)
      }
    }
  })

  const shouldRender = (() => phase() !== 'exited') as Derived<boolean>
  return {
    phase: phase as unknown as Derived<MotionPhase>,
    shouldRender,
  }
}
