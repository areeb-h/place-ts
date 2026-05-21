// TypingCode — code block with a character-by-character typing reveal.
//
// **History.** Three iterations got us here:
//
//   v1 — JS-driven loop. A `setTimeout` mutated text nodes every ~18 ms
//     to slice the code string char-by-char. Looked right; cost too
//     much: ~46 ms of forced reflow (text-node mutation triggers
//     layout), non-composited animation, and a blip on first paint
//     (SSR rendered the empty slice, the animation started only post-
//     hydration).
//
//   v2 — clip-path wipe. A CSS `clip-path: inset(0 100% 0 0) →
//     inset(0 0 0 0)` cubic-bezier reveal over 2.5 s. Fixed the perf
//     flags (GPU-composited, zero reflow, full content rendered at
//     SSR) but visually wrong — the wipe revealed all lines at the
//     same X position simultaneously, reading as a curtain sliding
//     open, not typing.
//
//   v3 — clip-path top-down with `steps()`. Replaced the horizontal
//     wipe with a vertical one and discrete timing. Each step
//     revealed one line of content — closer to typing but still
//     line-by-line, not character-by-character.
//
//   **v4 (this file) — per-character span reveal with staggered CSS
//   animation-delay.** SSR pre-renders every character of the code as
//   its own `<span class="char" style="--i:N">C</span>`. A single CSS
//   keyframe animates `opacity: 0 → 1` over 30 ms; each span's
//   `animation-delay: calc(var(--i) * 15ms)` staggers them in
//   document order. The eye reads it as the original char-by-char
//   typing — because that is what it is — but the DOM never mutates
//   and every frame is GPU-composited (opacity changes don't trigger
//   layout). SSR is the full code with every span styled
//   `opacity: 0` via the animation's `backwards` fill mode, so even
//   the very first paint is correct. No JS runs to drive the reveal;
//   the entire effect is the CSS animation engine doing its job.
//
// **Why not delegate to CodeBlock anymore.** CodeBlock renders each
// token as a single `<span class="tok-X">{text}</span>` — its
// optimization for inline highlighting. Per-character animation needs
// each char as its own span; the smallest disruption is to share the
// `tokenize()` function (now exported from `code-block.tsx`) and
// render the chrome inline here. No copy button (a typing demo
// doesn't need it), no language switcher — the typing block stays
// purpose-built for the landing hero.

import type { Child } from '@place-ts/component'

// Reuse the design library's tokenizer registry. `getTokenizer('ts')`
// returns the built-in TS/JSX tokenizer; the typing demo doesn't need
// the chrome / copy / line features that the design CodeBlock adds,
// so we render the chars directly.
import { getTokenizer, type Tok } from '@place-ts/design'

const tokenize = (src: string): readonly Tok[] => getTokenizer('ts')(src)

export interface TypingCodeProps {
  readonly code: string
  readonly lang?: string
  readonly filename?: string
  /** Reserved — speed is controlled via `--typing-char-stagger` in
   *  `styles.ts` (default 15ms/char). Kept for API stability. */
  readonly speed?: number
}

/**
 * Render one token as a list of per-character spans. Each char gets a
 * `--i` CSS custom property holding its global index across the whole
 * code — the CSS animation reads `--i` to compute its delay, so the
 * chars reveal in document order regardless of which token they
 * belong to.
 *
 * Plain tokens skip the wrapper span (saves bytes; the char spans
 * inherit color from the parent `<code>`). Highlighted tokens
 * (keyword, string, comment, etc.) wrap their chars in the matching
 * `tok-X` class span so the color cascades down.
 */
function renderTokenChars(t: Tok, startIndex: number): { view: Child; nextIndex: number } {
  const chars: Child[] = []
  let i = startIndex
  // Iterate code points rather than UTF-16 code units so multi-byte
  // characters (em-dash, emoji) render as one visual unit. Most TS
  // sources stay in the BMP but defense-in-depth costs nothing.
  for (const ch of t.text) {
    chars.push(
      <span class="char" style={`--i:${i}`}>
        {ch}
      </span>,
    )
    i++
  }
  const view: Child = t.kind === 'plain' ? chars : <span class={`tok-${t.kind}`}>{chars}</span>
  return { view, nextIndex: i }
}

export const TypingCode = (props: TypingCodeProps) => {
  const lang = props.lang ?? 'ts'
  const tokens = tokenize(props.code)
  const pieces: Child[] = []
  let charIndex = 0
  for (const t of tokens) {
    const { view, nextIndex } = renderTokenChars(t, charIndex)
    pieces.push(view)
    charIndex = nextIndex
  }
  return (
    <div class="typing-code-reveal code-block group relative my-4 mb-6 border border-border rounded-[10px] overflow-hidden bg-card/95">
      <div class="flex items-center gap-2 py-2 px-3.5 border-b border-border/60 bg-bg/60 font-mono text-[11px] leading-none text-muted">
        {props.filename ? <span class="mr-auto text-fg">{props.filename}</span> : null}
        <span class="ml-auto lowercase tracking-[0.05em]">{lang}</span>
      </div>
      <pre class="code-block-pre m-0 py-4 px-5 overflow-x-auto font-mono text-[13px] leading-[1.65] bg-transparent border-0">
        <code>{pieces}</code>
      </pre>
    </div>
  )
}
