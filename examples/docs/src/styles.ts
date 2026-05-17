// Docs site stylesheet — Tailwind v4 input CSS.
//
// This file is the SINGLE home for everything that genuinely needs CSS
// (vs. Tailwind utility classes on elements). Concatenated to the
// theme tokens' base via `app({ tailwind: { base: tokens.base + styles } })`
// in `app.ts`, then processed by Tailwind. Per ADR 0007, layouts and
// components hold pure JSX + Tailwind utility class names — no inline
// `css\`\`` blocks, no `<style>` tags.
//
// What lives here:
//   - Body globals (selection, scrollbar, html scroll-behavior)
//   - Fixed-position decorative overlays (body::before radial gradient)
//   - `.prose` typography (until @tailwindcss/typography is wired)
//   - Anchor-heading hash-on-hover
//   - Per-component class blocks the components consume as semantic
//     class names: `.callout`, `.code-block`, `.tabs`, `.compare`,
//     `.bench-*`, `.reactivity-*`, `.hero-*`, `.roadmap-*`
//   - Syntax-highlighting tokens (`.tok-*`) — emitted by the static
//     tokenizer in CodeBlock's server-side output
//   - `@keyframes` animations
//
// Why a `.ts` file (not `.css`): TS source is in the build graph, so
// renames + ref-counting flow through normal import tooling, no
// separate watcher. The string concat in `app.ts` is the wiring.
//
// CLIENT-BUNDLE LEAK PROTECTION (T5-B-2): the styles string is
// server-side Tailwind input — the client doesn't need it. The
// expression uses `typeof X !== 'undefined' && X` rather than bare
// `__PLACE_BROWSER__` so it's safe to evaluate even when the build-
// time `define` is NOT applied (e.g. running `bun src/app.ts` directly
// to start the dev server). Bundler still constant-folds the whole
// expression on browser builds → empty string + ~10 KB raw / ~3 KB
// gzipped of CSS literal drop out.

declare const __PLACE_BROWSER__: boolean

export const styles =
  typeof __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__
    ? ''
    : `
::selection {
  background-color: var(--color-accent);
  color: var(--color-accent-fg);
}
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: color-mix(in oklab, var(--color-muted) 30%, transparent);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklab, var(--color-muted) 50%, transparent);
}
html { scroll-behavior: smooth; }
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background:
    radial-gradient(circle at 8% 12%, color-mix(in oklab, var(--color-accent) 7%, transparent), transparent 45%),
    radial-gradient(circle at 92% 88%, color-mix(in oklab, var(--color-accent) 5%, transparent), transparent 50%);
}

/* ===== Prose tone for body content. ===== */
.prose { color: var(--color-fg); }
.prose h1 {
  font-size: 2.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0 0 0.75rem;
  line-height: 1.15;
}
.prose h2 {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 2.5rem 0 0.75rem;
  padding-top: 0.5rem;
  scroll-margin-top: 5rem;
}
.prose h3 {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 1.75rem 0 0.5rem;
  scroll-margin-top: 5rem;
}
.prose p {
  margin: 0 0 1rem;
  line-height: 1.65;
  color: color-mix(in oklab, var(--color-fg) 90%, var(--color-muted));
}
.prose a {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}
.prose code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em;
  background: color-mix(in oklab, var(--color-card) 80%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid color-mix(in oklab, var(--color-border) 70%, transparent);
}
.prose pre {
  background: color-mix(in oklab, var(--color-card) 95%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace;
  margin: 1rem 0 1.5rem;
}
.prose pre code {
  background: transparent;
  border: 0;
  padding: 0;
  font-size: inherit;
}
.prose blockquote {
  border-left: 2px solid color-mix(in oklab, var(--color-accent) 60%, transparent);
  padding-left: 1rem;
  color: color-mix(in oklab, var(--color-fg) 80%, var(--color-muted));
  font-style: italic;
  margin: 1rem 0;
}
.prose ul, .prose ol {
  margin: 0 0 1rem;
  padding-left: 1.5rem;
  line-height: 1.65;
}
.prose li { margin: 0.25rem 0; }
.prose hr {
  border: 0;
  border-top: 1px solid var(--color-border);
  margin: 2rem 0;
}

/* Anchor heading — hash glyph appears on hover. */
.anchor-heading { position: relative; }
.anchor-heading .anchor-link {
  position: absolute;
  left: -1.5rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-muted);
  opacity: 0;
  text-decoration: none;
  font-weight: 400;
  transition: opacity 120ms ease, color 120ms ease;
}
.anchor-heading:hover .anchor-link,
.anchor-heading .anchor-link:focus { opacity: 1; }
.anchor-heading .anchor-link:hover { color: var(--color-accent); }

/* ===== Syntax highlighting tokens (emitted by CodeBlock's server tokenizer). ===== */
/* Tok-comment uses the muted token at FULL opacity. The previous
   color-mix-to-transparent variant dropped effective contrast below
   WCAG AA (4.5:1) in light mode against the codeblock bg. Comments
   still read as visually subordinate because keyword/string/type
   tokens are saturated and stand out by hue, not by opacity. */
.tok-comment { color: var(--color-muted); font-style: italic; }
.tok-string  { color: oklch(0.78 0.13 145); }
.tok-keyword { color: oklch(0.74 0.16 290); }
.tok-type    { color: oklch(0.78 0.13 200); }
.tok-number  { color: oklch(0.78 0.13 70); }
.tok-tag     { color: oklch(0.75 0.12 35); }
.tok-tag-component { color: var(--color-accent); }

/* CodeBlock chrome — zero out the prose pre rule when a CodeBlock
   sits inside body prose. Both the legacy code-block-pre class
   (TypingCode + any old consumers) AND the new place-code-pre
   (design-library CodeBlock since T13-C) are neutralized. Without
   this the prose pre rule layers on top and adds a second border
   inside the CodeBlock's own chrome. */
.prose .code-block-pre,
.prose .place-code-pre {
  border: 0;
  background: transparent;
  padding: 1rem 1.25rem;
  margin: 0;
}

/* CodeBlock inside a Tabs card-variant panel: the Tabs root already
   owns the outer border + radius. Drop the CodeBlock's own chrome
   inside that wrapper so the two cards don't double up. */
[data-tabs-group] .place-code {
  border: 0;
  border-radius: 0;
  margin: 0;
  background: transparent;
}

/* ===== Search palette modal chrome. ===== */
.search-palette { position: relative; z-index: 100; }
.search-backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in oklab, var(--color-bg) 65%, transparent);
  backdrop-filter: blur(6px);
  border: 0;
  padding: 0;
  cursor: pointer;
}
.search-modal {
  position: fixed;
  top: 12vh;
  left: 50%;
  transform: translateX(-50%);
  width: min(580px, 92vw);
  max-height: 72vh;
  border-radius: 12px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  box-shadow: 0 30px 60px -20px rgb(0 0 0 / 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.search-input-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid color-mix(in oklab, var(--color-border) 60%, transparent);
}
.search-icon { font-size: 1.1rem; color: var(--color-muted); }
.search-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--color-fg);
  font-size: 0.95rem;
  padding: 0.25rem 0;
}
.search-input::placeholder { color: var(--color-muted); }
.search-hint {
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--color-card) 70%, transparent);
  color: var(--color-muted);
}
.search-results { flex: 1; overflow-y: auto; padding: 0.4rem; }
.search-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
  color: var(--color-fg);
  transition: background-color 80ms ease;
}
.search-row.active { background: color-mix(in oklab, var(--color-accent) 14%, transparent); }
.search-row-label { font-size: 0.875rem; }
.search-row-section {
  font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
}
.search-empty {
  padding: 1.5rem;
  text-align: center;
  color: var(--color-muted);
  font-size: 0.875rem;
}
.search-footer {
  display: flex;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid color-mix(in oklab, var(--color-border) 60%, transparent);
  font-size: 0.75rem;
  color: var(--color-muted);
}
.search-footer kbd {
  font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 5px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--color-card) 70%, transparent);
  border: 1px solid color-mix(in oklab, var(--color-border) 60%, transparent);
  margin-right: 0.2rem;
}

/* CodeBlock-in-Tabs: when a CodeBlock is a direct child of a Tabs
   panel, the panel ALREADY provides the outer border + rounding via
   the framework's Tabs chrome. Strip the CodeBlock's own outer chrome
   so the two don't stack visually. Targets the framework's data-tabs
   wire format directly — no class name to keep in sync. */
[role="tabpanel"][data-tabs-panel] > .code-block,
[role="tabpanel"][data-tabs-panel] > .code-block-wrap > .code-block {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
[role="tabpanel"][data-tabs-panel] > .code-block > .code-block-pre {
  padding-top: 0.6rem;
}

/* ===== Platform-conditional spans. =====
 *
 * The framework's early-paint script sets
 *   <html data-place-platform="mac"> or "other"
 * BEFORE the body parses. These rules render the right kbd label on
 * first paint with zero JS state — no post-hydration flicker.
 *
 * Hide BOTH by default so a CSS-disabled / pre-script viewer doesn't
 * see double labels for the same shortcut. The framework guarantees
 * the data attribute is set on every islands-mode page.
 */
.place-platform-mac,
.place-platform-other { display: none; }
[data-place-platform="mac"] .place-platform-mac { display: inline; }
[data-place-platform="other"] .place-platform-other { display: inline; }

/* ===== ComparisonTable. ===== */
.compare-wrap { overflow-x: auto; margin: 1.25rem 0 2rem; }
.compare { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.compare th, .compare td {
  padding: 0.55rem 0.85rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid color-mix(in oklab, var(--color-border) 60%, transparent);
}
.compare thead th {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
}
.compare thead th.primary { color: var(--color-accent); }
.compare tbody th { font-weight: 500; color: var(--color-fg); }
.compare-feature { display: block; }
.compare-hint { display: block; font-size: 0.7rem; color: var(--color-muted); margin-top: 2px; }
.compare-cell.yes { color: oklch(0.78 0.14 145); font-weight: 600; }
.compare-cell.yes.primary { color: var(--color-accent); }
.compare-cell.no { color: var(--color-muted); }
.compare-cell.text.primary { color: var(--color-accent); font-weight: 500; }

/* ===== Benchmark chart. ===== */
.bench-chart { margin: 1.25rem 0 2rem; }
.bench-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
  margin-bottom: 0.75rem;
}
.bench-row {
  display: grid;
  grid-template-columns: 140px 1fr 110px;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0;
}
.bench-label { font-size: 0.8125rem; color: var(--color-muted); }
.bench-track {
  height: 8px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--color-card) 80%, transparent);
  overflow: hidden;
}
.bench-fill {
  height: 100%;
  background: color-mix(in oklab, var(--color-muted) 60%, transparent);
  transition: width 200ms ease;
}
.bench-row.best .bench-label { color: var(--color-accent); font-weight: 600; }
.bench-row.best .bench-fill { background: var(--color-accent); }
.bench-value {
  font: 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--color-fg);
  text-align: right;
}
.bench-unit { color: var(--color-muted); }

/* Reactivity demo: layout migrated to component file (Tailwind
   utilities). The flash keyframe stays here, registered as a
   Tailwind v4 animation token so 'animate-reactivity-flash' on
   each node element works without an inline @keyframes. */
@theme {
  --animate-reactivity-flash: reactivity-flash 600ms ease-out;
}
@keyframes reactivity-flash {
  0%   { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 25%, var(--color-bg)); }
  100% { border-color: var(--color-border); background: var(--color-bg); }
}

/* Hero layout migrated to landing page (Tailwind utilities with
   arbitrary radial-gradient + linear-gradient values). Keyframes
   stay here registered as Tailwind animation tokens. */
@theme {
  --animate-hero-drift: hero-drift 18s ease-in-out infinite alternate;
  --animate-hero-shimmer: hero-shimmer 4s linear infinite;
}
@keyframes hero-drift {
  0%   { transform: translate(0, 0) scale(1); }
  100% { transform: translate(-40px, 40px) scale(1.1); }
}
@keyframes hero-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* TypingCode reveal — character-by-character via per-span CSS
   animation. The TypingCode component (see components/typing-code.tsx)
   pre-renders every character of the code as its own
   <span class="char" style="--i:N">, with N being the char's global
   index across the whole code. The animation below fades each span
   from opacity 0 to 1 over 30 ms, with animation-delay computed from
   --i so that chars reveal in document order at one every 15 ms.

   **animation-fill-mode: backwards** keeps each char at the from
   state (opacity: 0) BEFORE its delay elapses, so SSR + first paint
   show the chars invisible until their stagger time. Without the
   backwards fill, every char would render at its default opacity
   (1) until the delay fires — defeating the typing effect.

   **GPU compositing.** Opacity animations run on the compositor
   thread; no main-thread work, no reflow, no layout. The DOM is
   built once at SSR and never mutated. Lighthouse's non-composited-
   animation + forced-reflow flags stay green.

   **Pacing.** 8 ms/char — fast enough to read as fluent typing on a
   short snippet without a 4-second wait. For a ~250-char APP_SHAPE
   snippet that totals ~2s of reveal. Tune via the
   --typing-char-stagger property below if a different code length
   needs a different speed.

   **Reduced motion.** Override the animation off and snap to fully
   visible — accessibility per WCAG 2.3.3 / prefers-reduced-motion. */
.typing-code-reveal {
  --typing-char-stagger: 8ms;
  --typing-char-duration: 20ms;
}
.typing-code-reveal .char {
  opacity: 1;
  animation: typing-char var(--typing-char-duration) backwards;
  animation-delay: calc(var(--i) * var(--typing-char-stagger));
}
@keyframes typing-char {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .typing-code-reveal .char { animation: none; opacity: 1; }
}

/* Roadmap layout migrated to roadmap page (Tailwind utilities with
   recipe variants for marker + status pill). The pulse keyframe for
   the active "now" milestone is registered here as a Tailwind v4
   animation token. */
@theme {
  --animate-roadmap-pulse: roadmap-pulse 1.5s ease-in-out infinite;
}
@keyframes roadmap-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 color-mix(in oklab, var(--color-accent) 40%, transparent); }
  50%      { opacity: 0.85; box-shadow: 0 0 0 6px transparent; }
}

/* Theme-toggle pressed state — driven purely by the <html data-place-theme>
   attribute that themeEarlyScript() sets BEFORE first paint. No
   reactive aria-pressed in the CSS path, so there is no SSR/hydration
   mismatch and no blip when the page hard-refreshes. */
[data-place-theme="light"]  .place-theme-opt[data-choice="light"],
[data-place-theme="dark"]   .place-theme-opt[data-choice="dark"],
[data-place-theme="system"] .place-theme-opt[data-choice="system"] {
  color: var(--color-accent);
  background-color: color-mix(in oklab, var(--color-accent) 12%, transparent);
}
`
