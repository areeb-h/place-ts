// `colorMix(a, b, t)` — interpolate two CSS colors via the browser's
// native `color-mix()` function. Returns a string suitable for any
// CSS color slot (`color`, `background-color`, `border-color`, etc.).
//
// Why a wrapper instead of inlining `color-mix(in oklch, …)` at the
// call site:
//   1. The interpolation t value is usually a *reactive* signal (a
//      spring, tween, scroll-progress, etc.). The natural call site
//      shape `style:color={() => colorMix(a, b, progress())}` keeps
//      the reactive plumbing identical to numeric animations.
//   2. We always emit `oklch` color space (perceptually uniform
//      interpolation). Avoids the "muddy purple-grey at t=0.5" bug
//      sRGB interpolation produces between complementary colors.
//   3. t is clamped to [0,1] and quantized to a 0.001 step so the
//      generated string is stable enough for the browser's style
//      cache to short-circuit identical-frame reads.
//
// Compared to writing the spring on a tuple of color channels:
//   - `color-mix()` works on ANY CSS color shape (hex, rgb, hsl,
//     oklch, named, currentColor, var(--token), light-dark(...))
//     without parsing. Zero JS color math.
//   - The browser handles `currentColor` resolution + `var(--token)`
//     resolution + theme switching automatically.
//   - Browser-native, GPU-friendly.
//
// Browser support: Chrome 111+ (Mar 2023), Safari 16.2+ (Dec 2022),
// Firefox 113+ (May 2023). Universal across our evergreen targets.
//
// Usage:
//   const t = tween(() => target(), { duration: 200 })
//   <div style:color={() => colorMix('var(--color-fg)', 'var(--color-accent)', t())} />
//
//   // Spring-driven theme tint:
//   const tint = animate(() => active() ? 1 : 0, 'gentle')
//   <div style:background={() => colorMix('transparent', 'var(--color-accent)', tint() * 0.15)} />

/**
 * Color interpolation space. `oklch` is perceptually uniform — use it
 * for any animation where smooth perceived brightness matters.
 *
 * - `'oklch'` (default) — perceptual brightness + chroma + hue.
 *   The right answer for almost every UI interpolation.
 * - `'oklab'` — perceptual L, a, b. Slightly different hue paths
 *   than oklch; pick if you've measured a specific need.
 * - `'srgb'` — legacy linear-in-sRGB. Faster but produces the
 *   classic "muddy mid-point" between hues.
 */
export type ColorSpace = 'oklch' | 'oklab' | 'srgb'

/**
 * Interpolate `a` and `b` at fraction `t`, returning a CSS
 * `color-mix(...)` string the browser resolves natively.
 *
 *   colorMix('red', 'blue', 0.5)
 *   → 'color-mix(in oklch, red 50%, blue 50%)'
 *
 *   colorMix('var(--bg)', 'var(--accent)', 0)  → returns 'var(--bg)'  (short-circuit)
 *   colorMix('var(--bg)', 'var(--accent)', 1)  → returns 'var(--accent)' (short-circuit)
 *
 * The short-circuit at t=0/1 keeps the resolved value identical to a
 * direct token reference — important for theme switching, which the
 * browser only re-evaluates on the resolved value's *string* change.
 *
 * @param a    Any CSS color (hex, rgb, hsl, oklch, named, var(...), currentColor, transparent)
 * @param b    Any CSS color
 * @param t    Mix fraction in [0,1]. NaN / out-of-range values clamp to [0,1].
 * @param space Interpolation color space. Default `'oklch'`.
 */
export function colorMix(
  a: string,
  b: string,
  t: number,
  space: ColorSpace = 'oklch',
): string {
  // Clamp + quantize. NaN, ±Infinity, and out-of-range values fall
  // into [0,1]. The Math.round-to-thousandths step keeps the output
  // string stable across sub-pixel reactive updates so the browser's
  // computed-style cache short-circuits unchanged frames.
  const clamped = t !== t ? 0 : t < 0 ? 0 : t > 1 ? 1 : t
  const tq = Math.round(clamped * 1000) / 1000
  // Hot-path short-circuits — when the mix collapses to a single
  // endpoint, return the endpoint string verbatim. Matters for theme
  // switching: `var(--token)` resolution + style invalidation only
  // re-fires when the string identity changes.
  if (tq === 0) return a
  if (tq === 1) return b
  const aPct = (1 - tq) * 100
  const bPct = tq * 100
  return `color-mix(in ${space}, ${a} ${aPct}%, ${b} ${bPct}%)`
}
