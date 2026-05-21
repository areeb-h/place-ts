// /api/motion — @place-ts/reactivity/motion. Spring / tween / sequence /
// curve as derived state over time. The framework's animation primitive
// is a function that returns a Derived<number> — no <motion.div>, no
// parallel runtime.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const IMPORT = `import {
  animate, tween, sequence, curve, delay, motionValue,
  colorMix, motion, flip,
} from '@place-ts/reactivity/motion'
import { state } from '@place-ts/reactivity'`

const ANIMATE = `// animate(target, opts) — spring-driven derived state.
// Reads the target signal; returns a signal that tracks the target
// through a spring solver.

const target = state(0)

// Shorthand: pass the preset name directly (Tier 17-E v2 DX).
const x = animate(target, 'gentle')

// Or the explicit form:
const y = animate(target, { spring: { mass: 1, tension: 170, friction: 26 } })

// Read in a reactive prop and the element animates:
<div style:transform={() => \`translateX(\${x()}px)\`} />

// Update the target — the spring takes over:
target.set(100)`

const MULTI_VALUE = `// animate.values({...}) — animate a named record in one call.
// Returns the same shape with each value as Derived<number>.

const pos = animate.values({
  x: () => mouseX(),
  y: () => mouseY(),
  opacity: () => visible() ? 1 : 0,
}, 'gentle')

<div
  style:transform={() => \`translate(\${pos.x()}px, \${pos.y()}px)\`}
  style:opacity={() => String(pos.opacity())}
/>

// All values share the same spring. For mixed timing per axis,
// call animate() per-value.

// tween.values mirrors the same pattern for time-based animations:
const dims = tween.values({ w: targetW, h: targetH }, 200)`

const MOTION_VALUE = `// motionValue(initial, opts) — writable + spring-animated signal.
// Combines state() + animate() for imperative drive (pointer / scroll
// / gesture handlers).

const x = motionValue(0, 'gentle')

// Read the SMOOTH animated value:
<div style:transform={() => \`translateX(\${x()}px)\`} />

// Write the target imperatively:
window.addEventListener('pointermove', (e) => x.set(e.clientX))

// Read the un-smoothed target (e.g. for layout calcs):
const finalX = x.target()`

const DELAY = `// delay(source, ms) — debounced reactive read.
// Useful for "show after a beat" patterns without setTimeout +
// state ceremony. Symmetric — both edges delay equally.

const loading = state(false)
const showSpinner = delay(() => loading(), 200)
// Spinner only appears if loading stays true for ≥ 200ms.
// Sub-100ms work doesn't flash a spinner.

<Show when={showSpinner}><Spinner /></Show>`

const SPRING_PRESETS = `// Five named spring presets (Motion One tuning):
//   'gentle'   — smooth, settles in ~1s, 5% overshoot
//   'wobbly'   — playful, ~30% overshoot
//   'stiff'    — fast, ~0.5s settle, minimal overshoot
//   'molasses' — slow, ~3s, no overshoot
//   'snap'     — instant feel, ~0.15s, no overshoot

// Or pass raw params:
animate(() => target(), {
  spring: { mass: 1, tension: 170, friction: 26 },
})`

const TWEEN = `// tween(target, opts) — duration + easing.
// Same return shape (Derived<number>) but time-based.

// Shorthand: pass duration as a bare number (Tier 17-E v2 DX).
const x = tween(target, 600)

// Or the explicit form with custom easing:
const y = tween(target, { duration: 600, easing: 'easeOutCubic' })`

const SEQUENCE = `// sequence(keyframes, opts) — keyframe interpolation over time.
// Reads its own internal clock; returns a signal that visits each
// keyframe.value at keyframe.at (ms from sequence start).

const opacity = sequence([
  { at: 0,    value: 0 },
  { at: 300,  value: 1, easing: 'easeOutCubic' },
  { at: 2000, value: 1 },        // hold
  { at: 2300, value: 0 },        // fade
])

<Toast style:opacity={() => String(opacity())} />`

const CURVE = `// curve(source, fn) — arbitrary signal-to-signal interpolation.
// Read the source; emit a transformed version per frame. Useful for
// non-time-based animations (scroll-driven, gesture-driven).

const scrollY = state(0)
const headerScale = curve(
  () => scrollY(),
  (y) => 1 - Math.min(y / 200, 0.2),  // 1.0 at top → 0.8 at 200px
)`

const COLOR_MIX = `// colorMix(a, b, t) — interpolate two CSS colors via the browser's
// native color-mix(). Returns a string for any CSS color slot.
// Always emits oklch space for perceptually-uniform interpolation.

const t = tween(() => target(), { duration: 200 })

// Spring-driven theme tint:
<div style:background={() =>
  colorMix('transparent', 'var(--color-accent)', t() * 0.15)
} />

// t=0 / t=1 short-circuit to endpoint strings — keeps theme-token
// resolution stable when the tween settles.`

const MOTION_LIFECYCLE = `// motion(when, opts) — delays unmount + emits a phase signal so
// CSS transitions complete before the DOM is torn down. Bridges
// <Show>/<Activity> mount-unmount with CSS-driven enter/exit.

const fade = motion(() => isOpen(), { duration: 200 })

<Show when={fade.shouldRender}>
  {() => (
    <div
      data-motion={fade.phase()}
      class="transition-opacity duration-200
             data-[motion=enter]:opacity-0
             data-[motion=entered]:opacity-100
             data-[motion=exit]:opacity-0"
    >…</div>
  )}
</Show>

// Phases: enter (initial frame) → entered (steady) →
//         exit (leaving) → exited (gone — shouldRender flips false).`

const FLIP = `// flip(container, opts) — animate child reorders + layout changes
// via FLIP (First-Last-Invert-Play) using Web Animations API.
// MutationObserver watches the container; positions are captured in
// container-relative space (immune to page scroll).

<ul ref={(el) => flip(el, { duration: 220 })} class="space-y-2">
  {keyed(items, i => i.id, item => <li>{item.label}</li>)}
</ul>

// Respects prefers-reduced-motion automatically. Runs on the
// compositor (GPU transform) — no layout thrash per frame.
// Returns a disposer; the framework's keyed() preserves element
// identity across reorders so the WeakMap finds the old position.`

const SSR = `// SSR resolves animations to rest immediately. The clock signal is
// gated on __PLACE_BROWSER__; on the server, animate() returns the
// target value with no frame ticks. So the SSR'd HTML reflects the
// animation's settled state, not its starting state.

// No flicker on hydration — the client picks up at "rest" and starts
// animating from there if the target changes.`

const NOT_MOTION_DIV = `// place's motion is a function returning a signal — NOT a parallel
// component runtime. There is no <motion.div>. Any element that reads
// a reactive value can animate; the framework treats motion values
// exactly like any other Derived<T>.

// Compare Framer Motion's 34KB tree-shake floor (per their docs):
// → place's motion is ~1.5KB for the spring solver, pay-per-feature.

// Compare Framer's React-only API + Motion One's separate runtime:
// → place's motion works anywhere reactivity does (server, worker,
//   client). One API surface.`

export default page('/motion', {
  // No `meta:` — auto-title from `<h1><code>motion</code></h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>motion</code>
      </h1>
      <p>
        <code>@place-ts/reactivity/motion</code> ships four primitives. Each takes a target signal
        (or keyframes), and returns a <code>Derived&lt;number&gt;</code>. The framework treats the
        returned signal exactly like any other reactive value — there is no parallel "motion
        components" runtime, no <code>&lt;motion.div&gt;</code>, no two-API split between
        declarative and imperative.
      </p>

      <CodeBlock code={IMPORT} />

      <h2>
        <code>animate(target, opts)</code>
      </h2>
      <p>
        Spring-driven derived state. The returned signal tracks the target through a spring solver
        (semi-implicit Euler integrator) — so changing the target re-targets the spring from its
        current velocity.
      </p>
      <CodeBlock code={ANIMATE} />

      <h3>Spring presets</h3>
      <CodeBlock code={SPRING_PRESETS} />

      <h2>
        <code>animate.values()</code> / <code>tween.values()</code>
      </h2>
      <p>
        Multi-property animation in one call. Returns the same shape with each value as a{' '}
        <code>Derived&lt;number&gt;</code>.
      </p>
      <CodeBlock code={MULTI_VALUE} />

      <h2>
        <code>motionValue(initial, opts)</code>
      </h2>
      <p>
        Writable + spring-animated signal — combines <code>state()</code> + <code>animate()</code>{' '}
        for imperative drive (pointer / scroll / gesture handlers).
      </p>
      <CodeBlock code={MOTION_VALUE} />

      <h2>
        <code>delay(source, ms)</code>
      </h2>
      <p>
        Debounced reactive read. Useful for "show after a beat" patterns without{' '}
        <code>setTimeout</code> ceremony.
      </p>
      <CodeBlock code={DELAY} />

      <h2>
        <code>tween(target, opts)</code>
      </h2>
      <p>Duration + easing instead of physics. Same return shape.</p>
      <CodeBlock code={TWEEN} />

      <h2>
        <code>sequence(keyframes, opts)</code>
      </h2>
      <CodeBlock code={SEQUENCE} />

      <h2>
        <code>curve(source, fn)</code>
      </h2>
      <CodeBlock code={CURVE} />

      <h2>
        <code>colorMix(a, b, t)</code>
      </h2>
      <p>
        Native <code>color-mix()</code> wrapper for color interpolation. Works on any CSS color
        (hex, rgb, oklch, named, <code>var()</code>,<code>currentColor</code>,{' '}
        <code>transparent</code>). Always interpolates in <code>oklch</code> by default for
        perceptual uniformity.
      </p>
      <CodeBlock code={COLOR_MIX} />

      <h2>
        <code>motion(when, opts)</code> — lifecycle bridge
      </h2>
      <p>
        Delay unmount + emit a phase signal so CSS transitions complete before the DOM is torn down.
        Bridges <code>&lt;Show&gt;</code> /<code>&lt;Activity&gt;</code> with CSS-driven enter /
        exit animations.
      </p>
      <CodeBlock code={MOTION_LIFECYCLE} />

      <h2>
        <code>flip(container, opts)</code> — layout animations
      </h2>
      <p>
        FLIP-style layout animation for list reorders. Runs on the compositor via Web Animations
        API; respects <code>prefers-reduced-motion</code> automatically.
      </p>
      <CodeBlock code={FLIP} />

      <h2>SSR behavior</h2>
      <CodeBlock code={SSR} />

      <Callout kind="note" title="Why motion lives in @place-ts/reactivity, not its own system">
        Motion IS interpolated derived state over time — same primitive everything else reactive
        composes from. No new top-level system; no parallel component tree. See{' '}
        <a href="https://github.com/anthropics/place-ts/blob/main/docs/decisions/0015-motion-as-reactivity-submodule.md">
          ADR 0015
        </a>{' '}
        for the failure modes deliberately avoided (Framer's 34KB tree-shake floor,
        layoutId-measure-every-render, GSAP's Webflow license, Motion One's two-runtime split).
      </Callout>

      <h2>What you DON'T do</h2>
      <CodeBlock code={NOT_MOTION_DIV} />

      <h2>Related</h2>
      <ul>
        <li>
          <Link to="/api/state">
            <code>state · watch · derived</code> — the reactive primitives motion composes from
          </Link>
        </li>
        <li>
          <Link to="/api/design">
            <code>@place-ts/design</code> — design library (Button spinner uses motion internally)
          </Link>
        </li>
      </ul>
    </article>
  ),
})
