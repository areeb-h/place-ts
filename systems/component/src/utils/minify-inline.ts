// Lightweight minifier for the framework's hand-rolled inline runtime
// scripts (`placeSpaNav`, `placeTabs`, `placeViewport`, `placeCopy`,
// `placeDeferredIslands`, `placeEarly`). These are authored as
// readable, comment-rich template literals so the framework's own
// source is maintainable; the output is what the browser parses on
// every page load.
//
// **Why a hand-rolled stripper and not Bun.build minification:**
//
//   - The inline runtimes are STRING values produced by JS functions
//     that bake per-app config (`viewTransitions`, `prefetch`, theme
//     class map) directly into the source. Running them through
//     Bun.build would require either: (a) writing each runtime as its
//     own entry file and templating config in via `define:` — invasive
//     because most config is data, not constants; or (b) building once
//     per app boot — adds 50-100 ms to startup.
//
//   - The runtimes are PURE hand-written ES5 with no module imports,
//     no transformations needed beyond comment + whitespace stripping.
//     A regex pass at ~0.1 ms per call gives 95% of the savings of a
//     full minifier with zero infrastructure.
//
// **What this strips:**
//
//   - Leading whitespace on every line (the source indents for
//     readability; the browser doesn't care).
//   - `// ...` line comments (extremely common in the runtimes —
//     ~30-40% of the source bytes).
//   - Blank lines.
//   - Trailing whitespace.
//
// **What this PRESERVES:**
//
//   - Newlines between lines (used as statement separators by JS ASI).
//     Joining without newlines is unsafe — a multi-line `return\nfoo`
//     would collapse to `returnfoo`. The runtimes don't have such
//     constructs today, but the per-line approach is robust against
//     future edits.
//   - `/* ... */` block comments are LEFT IN — the runtimes don't use
//     them; if a future contributor adds one, it'll ship verbatim
//     (annoying, not broken). If that becomes a real problem we can
//     extend the stripper.
//   - Anything inside `"..."` or `'...'` strings — the regex matches
//     `//` only after a `;`, `{`, `}`, `(`, `)`, `,`, or start-of-line,
//     so a literal `'http://x'` inside a string isn't mistaken for a
//     comment.
//
// **Why not just `Bun.transpiler({ minifyWhitespace: true })`:**
//
//   - It DOES correctly minify — but Bun's transpiler is a heavy
//     dependency on every script emission. The hand-rolled stripper
//     is 20 lines + zero allocation outside the result.
//   - The transpiler also doesn't preserve our exact line structure
//     for source-mapping (we don't ship source maps for inline
//     runtimes, but it's a nice property).
//
// Numbers (measured on the docs site, May 2026):
//
//   - `placeSpaNav`:       17,865 bytes raw → ~10,400 bytes minified
//   - `placeTabs`:           3,051 bytes raw → ~ 1,850 bytes minified
//   - `placeViewport`:         853 bytes raw → ~   570 bytes minified
//   - `placeCopy`:           1,033 bytes raw → ~   720 bytes minified
//
// Total ~9 KB saved per page in the rendered HTML. Across the docs
// site's 29 pages: ~260 KB raw / ~50-60 KB gzipped — matches the
// Lighthouse "Minify JS — 58 KiB savings" estimate.

/**
 * Strip line comments + leading/trailing whitespace from a hand-written
 * inline runtime source. Returns a string suitable for direct emission
 * inside `<script>${...}</script>` — no semantic change, smaller bytes.
 */
export function minifyInline(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // Strip leading whitespace.
    let trimmed = line.replace(/^\s+/, '')
    // Strip a trailing `// ...` comment — only when the `//` is not
    // inside a string. The runtimes use `//` for comments and never
    // inside string literals (they're plain ES5 with double-quoted
    // strings and no URL literals containing `//`), so a simple
    // character scan suffices:
    let inStr: '"' | "'" | null = null
    let escape = false
    let commentAt = -1
    for (let j = 0; j < trimmed.length; j++) {
      const ch = trimmed.charAt(j)
      if (escape) {
        escape = false
        continue
      }
      if (inStr) {
        if (ch === '\\') {
          escape = true
        } else if (ch === inStr) {
          inStr = null
        }
        continue
      }
      if (ch === '"' || ch === "'") {
        inStr = ch
        continue
      }
      if (ch === '/' && trimmed.charAt(j + 1) === '/') {
        commentAt = j
        break
      }
    }
    if (commentAt >= 0) trimmed = trimmed.slice(0, commentAt).replace(/\s+$/, '')
    if (trimmed.length === 0) continue
    out.push(trimmed)
  }
  return out.join('\n')
}
