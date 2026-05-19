// @place/component — dev error overlay.
//
// Extracted from index.ts (Tier 20 decomposition). Fully self-contained
// HTML string-building: a render-time throw becomes a pretty page with
// stack trace + source preview in dev, and a minimal text/plain 500 in
// production. Server-only — invoked by handler()/serve() when a page's
// view() or load() throws.
//
// `renderRouteError` is the entry point. `isProductionRuntime` is the
// dev/prod switch (also consumed by serve()'s SRI gate). The stack-frame
// parser surface (`parseStackFrames`, `frameEditorHref`, `StackFrame`)
// is exported for unit tests.

import { escapeHtmlAttrFull } from './utils/escape.ts'

// When `view()` or `load()` throws during render, dev mode returns an
// HTML page with the stack trace + offending URL. Production returns a
// minimal `text/plain` 500 (no stack leakage) — same shape as the
// pre-overlay default. Switch via `NODE_ENV`.
//
// Why this matters: every framework I checked (Vite, Next, SvelteKit,
// SolidStart) ships an error overlay. Without one, a render-time throw
// produces a blank 500 page and the dev hits the terminal/log to find
// the problem. The browser overlay is where dev attention already is.

export const isProductionRuntime = (): boolean =>
  typeof process !== 'undefined' && process.env && process.env['NODE_ENV'] === 'production'

export async function renderRouteError(
  error: unknown,
  req: Request,
  phase: 'load' | 'render',
): Promise<Response> {
  const err = error instanceof Error ? error : new Error(String(error))
  if (isProductionRuntime()) {
    // Production: minimal-info 500. Don't leak the stack to the browser.
    return new Response(`Internal Server Error: ${err.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  // Dev: pretty HTML overlay with stack + request URL.
  //
  // **Set the overlay's own CSP.** The overlay contains a large inline
  // `<style>` block + a tiny inline copy-to-clipboard `<script>`. The
  // dispatcher's `mergeHeaders` merges the request's baseHeaders CSP
  // onto every response (page-wins-on-conflict). If the overlay's
  // response leaves CSP unset, baseHeaders' CSP — which has a tight
  // `style-src 'self' 'sha256-...'` whose hashes were computed for
  // the FAILED render's inline-style attrs (probably none) — wins
  // and blocks the overlay's own styling. Result: an unstyled error
  // page in dev, exactly the bug the user reported.
  //
  // We set `'unsafe-inline'` on `style-src` + `script-src` here
  // because the overlay is FRAMEWORK-CONTROLLED HTML in DEV ONLY
  // (prod returns text/plain). No user-input renders unsafely (every
  // error field is escaped via `escapeHtmlAttrFull`), so the relaxed
  // policy is safe AND keeps the overlay readable. Other security
  // headers (frame-ancestors, X-Content-Type-Options, etc.) stay
  // tight via the merged baseHeaders.
  const body = await formatDevErrorOverlay(err, req, phase)
  return new Response(body, {
    status: 500,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        "frame-ancestors 'none'; base-uri 'self'",
    },
  })
}

/**
 * Parsed stack frame. Source paths come from the runtime's source-map
 * resolution (Bun maps bundled positions back to original source via
 * the inline source maps emitted by A1's `sourcemap: 'inline'` build
 * option) — this function only converts the stack-string format into
 * structured data, not source-map positions.
 *
 * `scope`:
 *   - `user` — path under cwd, not in node_modules
 *   - `framework` — under node_modules or a `systems/` sibling
 *   - `unknown` — couldn't classify (no path, native frame, etc.)
 *
 * Exported for unit testing. Real consumers don't import this directly.
 */
export interface StackFrame {
  fn: string | null
  file: string
  line: number
  col: number
  raw: string
  scope: 'user' | 'framework' | 'unknown'
}

/**
 * Parse a V8/Firefox-shaped stack into structured frames.
 *
 * V8 (Node, Bun, Chromium): `    at fn (file:///path:line:col)` and
 * the anonymous form `    at file:///path:line:col`.
 * Firefox: `fn@file:///path:line:col`.
 *
 * Both formats have been stable for years; the contract is the
 * format itself, not heuristic matching. Returns `[]` if the stack
 * is null/empty or contains no recognizable frames (callers fall
 * through to the raw stack as a `<details>` block).
 *
 * Exported for unit testing.
 */
export function parseStackFrames(stack: string | undefined, cwd: string): StackFrame[] {
  if (!stack) return []
  const lines = stack.split('\n')
  const out: StackFrame[] = []
  // V8 with fn name: "    at fnName (file:///path:line:col)"
  const v8Named = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/
  // V8 anonymous: "    at file:///path:line:col"
  const v8Anon = /^\s*at\s+(.+):(\d+):(\d+)\s*$/
  // Firefox: "fnName@file:///path:line:col"  (or "@file:..." for anon)
  const firefox = /^(.*?)@(.+):(\d+):(\d+)\s*$/
  for (const line of lines) {
    let m = line.match(v8Named)
    if (m) {
      out.push(makeFrame(m[1] ?? null, m[2] ?? '', toNum(m[3]), toNum(m[4]), line, cwd))
      continue
    }
    m = line.match(v8Anon)
    if (m) {
      out.push(makeFrame(null, m[1] ?? '', toNum(m[2]), toNum(m[3]), line, cwd))
      continue
    }
    m = line.match(firefox)
    if (m) {
      const fn = m[1] ?? ''
      out.push(makeFrame(fn === '' ? null : fn, m[2] ?? '', toNum(m[3]), toNum(m[4]), line, cwd))
    }
    // Lines that don't match (the leading "Error: msg" line, native
    // frames, etc.) are skipped — the raw stack <details> still
    // shows them verbatim.
  }
  return out
}

function toNum(s: string | undefined): number {
  return s === undefined ? 0 : Number.parseInt(s, 10)
}

function makeFrame(
  fn: string | null,
  file: string,
  line: number,
  col: number,
  raw: string,
  cwd: string,
): StackFrame {
  // Strip file:// prefix for path classification + display.
  const cleaned = file.replace(/^file:\/\//, '')
  return { fn, file: cleaned, line, col, raw, scope: classifyScope(cleaned, cwd) }
}

function classifyScope(file: string, cwd: string): 'user' | 'framework' | 'unknown' {
  if (!file) return 'unknown'
  // node:* and native frames are framework.
  if (file.startsWith('node:')) return 'framework'
  // Anything under node_modules is framework regardless of its location.
  if (file.includes('/node_modules/')) return 'framework'
  // The platform's own systems/ tree is framework noise for app devs.
  if (file.includes('/systems/')) return 'framework'
  // Under cwd → user code. We don't require a strict match because cwd
  // can have symlinks; checking the suffix is good enough for grouping.
  if (file.startsWith(cwd) || file.includes(cwd)) return 'user'
  return 'unknown'
}

/**
 * Build the editor-link href for a frame (vscode:// for VSCode, falls
 * back to a plain path otherwise). Browsers without a vscode:// handler
 * just show it as a non-functional link — the file path is still
 * visible. Exported for tests.
 */
export function frameEditorHref(frame: StackFrame): string {
  if (!frame.file) return ''
  // VSCode protocol — Cursor/Codium honor the same scheme.
  return `vscode://file/${frame.file}:${frame.line}:${frame.col}`
}

/**
 * Categorize an error so the overlay can pick an accent color, icon, and
 * a tailored "how to fix" hint. Default category is `runtime` (red) which
 * matches the previous overlay's vibe.
 */
interface ErrorCategory {
  /** Display label shown in the overlay status strip. */
  label: string
  /** Accent color (oklch) used by the hero + tag + caret. */
  accent: string
  /** Inline SVG path data (24x24 viewBox) for the category icon. */
  iconPath: string
}

function categorizeError(err: Error): ErrorCategory {
  const msg = err.message
  const name = err.name
  // Capability errors are common in dev; pull them out specifically.
  if (/capability ['"][^'"]+['"] (?:not provided|required but not installed)/.test(msg)) {
    return {
      label: 'Capability missing',
      // Amber — capability errors are usually config gaps, not bugs.
      accent: 'oklch(0.78 0.16 65)',
      iconPath:
        // Plug icon outline
        'M9 2v6M15 2v6M5 8h14v3a7 7 0 0 1-14 0V8zM12 18v4',
    }
  }
  if (name === 'TypeError') {
    return {
      label: 'Type error',
      accent: 'oklch(0.71 0.19 13)',
      iconPath:
        'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    }
  }
  if (name === 'ReferenceError') {
    return {
      label: 'Reference error',
      accent: 'oklch(0.71 0.19 13)',
      iconPath: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 9h6v6H9z',
    }
  }
  if (name === 'SyntaxError') {
    return {
      label: 'Syntax error',
      accent: 'oklch(0.78 0.16 65)',
      iconPath: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
    }
  }
  if (/notFound|404/i.test(msg) || /^NotFound/.test(name)) {
    return {
      label: 'Not found',
      accent: 'oklch(0.72 0.14 240)',
      iconPath: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
    }
  }
  if (/timeout|timed out|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return {
      label: 'Network',
      accent: 'oklch(0.72 0.14 240)',
      iconPath: 'M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07',
    }
  }
  // Default: red runtime error.
  return {
    label: `${name} thrown`,
    accent: 'oklch(0.71 0.19 13)',
    iconPath:
      'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  }
}

/**
 * Extract a "Try this" structured hint from a capability error message.
 * Returns null for any other error shape (the overlay falls back to its
 * default copy in that case). Capability errors compose three concrete
 * fixes — surfacing them as a checklist beats burying them in prose.
 */
function extractCapabilityHint(
  err: Error,
): { name: string; suggestions: { code: string; note: string }[] } | null {
  const m = /capability ['"]([^'"]+)['"]/.exec(err.message)
  if (!m) return null
  const capName = m[1] ?? 'Cap'
  return {
    name: capName,
    suggestions: [
      {
        code: `${capName}.provide(impl, () => …)`,
        note: 'Scoped install — disposes when the inner block returns. Right answer inside request handlers.',
      },
      {
        code: `${capName}.install(impl)`,
        note: 'Module-level install — keep the returned disposer alive. Right answer for browser-only app entries.',
      },
      {
        code: `${capName}.tryUse()`,
        note: 'Returns null when the cap is absent — lets render-time code degrade gracefully (e.g. SSR shells).',
      },
    ],
  }
}

/**
 * Read a window of source lines around the failing line. Returns null
 * if the file isn't readable (path missing, bundled-only file, etc.) so
 * the overlay can skip the source-preview card cleanly.
 */
async function readSourceWindow(
  filePath: string,
  centerLine: number,
  context: number,
): Promise<{ start: number; lines: string[] } | null> {
  if (!filePath || centerLine < 1) return null
  try {
    let text: string | null = null
    if (typeof Bun !== 'undefined' && typeof Bun.file === 'function') {
      const f = Bun.file(filePath)
      if (!(await f.exists())) return null
      text = await f.text()
    } else {
      const { readFile } = await import('node:fs/promises')
      text = await readFile(filePath, 'utf8')
    }
    if (text === null) return null
    const all = text.split('\n')
    const start = Math.max(1, centerLine - context)
    const end = Math.min(all.length, centerLine + context)
    const lines = all.slice(start - 1, end)
    return { start, lines }
  } catch {
    return null
  }
}

/** Tiny syntax-aware highlighter for the source preview. */
function highlightTsSource(src: string, esc: (s: string) => string): string {
  // Strategy: tokenize comments + strings first (so keywords inside them
  // are not re-styled), then mark keywords + literals on the remainder.
  // Tokens are emitted as <span class="t-…"> wrapping HTML-escaped text.
  const KEYWORDS = new Set([
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'new',
    'class',
    'extends',
    'implements',
    'interface',
    'type',
    'enum',
    'namespace',
    'import',
    'export',
    'from',
    'as',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'instanceof',
    'in',
    'of',
    'void',
    'delete',
    'this',
    'super',
    'public',
    'private',
    'protected',
    'readonly',
    'static',
    'yield',
  ])
  const LITERALS = new Set(['true', 'false', 'null', 'undefined'])
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i] ?? ''
    const next = src[i + 1] ?? ''
    // Line comment
    if (c === '/' && next === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      out += `<span class="t-c">${esc(src.slice(i, j))}</span>`
      i = j
      continue
    }
    // Block comment
    if (c === '/' && next === '*') {
      let j = i + 2
      while (j < n - 1 && !(src[j] === '*' && src[j + 1] === '/')) j++
      const end = Math.min(j + 2, n)
      out += `<span class="t-c">${esc(src.slice(i, end))}</span>`
      i = end
      continue
    }
    // String — '…' or "…" or `…` (template literals collapsed to one span
    // for simplicity; interpolations aren't re-highlighted).
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === quote) {
          j++
          break
        }
        j++
      }
      out += `<span class="t-s">${esc(src.slice(i, j))}</span>`
      i = j
      continue
    }
    // Number
    if (c >= '0' && c <= '9') {
      let j = i
      while (j < n && /[0-9_.xXeEn]/.test(src[j] ?? '')) j++
      out += `<span class="t-n">${esc(src.slice(i, j))}</span>`
      i = j
      continue
    }
    // Identifier-ish (keywords, literals, others)
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(src[j] ?? '')) j++
      const word = src.slice(i, j)
      if (KEYWORDS.has(word)) out += `<span class="t-k">${esc(word)}</span>`
      else if (LITERALS.has(word)) out += `<span class="t-l">${esc(word)}</span>`
      else out += esc(word)
      i = j
      continue
    }
    out += esc(c)
    i++
  }
  return out
}

/** Render the source-frame preview card (when a user frame's file is readable). */
function renderSourcePreview(
  frame: StackFrame,
  window: { start: number; lines: string[] },
  esc: (s: string) => string,
): string {
  const fileName = frame.file.split('/').pop() ?? frame.file
  const rows = window.lines.map((rawLine, idx) => {
    const lineNo = window.start + idx
    const isErr = lineNo === frame.line
    const cls = isErr ? 'src-line src-line-err' : 'src-line'
    const gutter = isErr ? '▸' : ' '
    const codeHtml = highlightTsSource(rawLine, esc)
    let row = `<div class="${cls}"><span class="src-gutter">${gutter}</span><span class="src-lineno">${lineNo}</span><span class="src-code">${codeHtml || '&nbsp;'}</span></div>`
    if (isErr) {
      // Caret line — points at the failing column. Pad with non-breaking
      // spaces so the marker aligns under the column character.
      const pad = '&nbsp;'.repeat(Math.max(0, frame.col - 1))
      row += `<div class="src-caret"><span class="src-gutter">&nbsp;</span><span class="src-lineno">&nbsp;</span><span class="src-code">${pad}<span class="src-caret-mark">^</span></span></div>`
    }
    return row
  })
  const editorHref = esc(frameEditorHref(frame))
  const fnLabel = esc(frame.fn ?? '(anonymous)')
  return [
    '<section class="card src">',
    '<header class="src-head">',
    '<div class="src-head-l">',
    '<span class="src-fn">',
    fnLabel,
    '</span>',
    '<span class="src-sep">in</span>',
    `<a class="src-path" href="${editorHref}" title="Open in editor">`,
    esc(fileName),
    `<span class="src-pos">:${frame.line}:${frame.col}</span>`,
    '</a>',
    '</div>',
    `<button type="button" class="copy-btn" data-copy="${esc(`${frame.file}:${frame.line}:${frame.col}`)}" title="Copy path">`,
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    '</button>',
    '</header>',
    '<pre class="src-body">',
    rows.join(''),
    '</pre>',
    '</section>',
  ].join('')
}

function renderFrameRowPretty(frame: StackFrame, esc: (s: string) => string): string {
  const fn = esc(frame.fn ?? '(anonymous)')
  const file = esc(frame.file || '(unknown)')
  const fileName = (frame.file || '').split('/').pop() ?? ''
  const dir = file.slice(0, Math.max(0, file.length - fileName.length))
  const href = esc(frameEditorHref(frame))
  return [
    '<li class="frame">',
    `<div class="frame-fn">${fn}</div>`,
    `<a class="frame-file" href="${href}">`,
    dir ? `<span class="frame-dir">${dir}</span>` : '',
    `<span class="frame-base">${esc(fileName) || file}</span>`,
    `<span class="frame-pos">:${frame.line}:${frame.col}</span>`,
    '</a>',
    '</li>',
  ].join('')
}

async function formatDevErrorOverlay(
  err: Error,
  req: Request,
  phase: 'load' | 'render',
): Promise<string> {
  const url = new URL(req.url)
  const esc = escapeHtmlAttrFull
  const name = esc(err.name)
  const message = esc(err.message)
  const rawStack = err.stack ?? '(no stack)'
  const path = esc(url.pathname + url.search)
  const method = esc(req.method)
  const time = new Date().toLocaleTimeString([], { hour12: false })

  const cwd = typeof process !== 'undefined' ? process.cwd() : ''
  const frames = parseStackFrames(err.stack, cwd)
  const userFrames = frames.filter((f) => f.scope === 'user')
  const frameworkFrames = frames.filter((f) => f.scope !== 'user')

  const cat = categorizeError(err)
  const capHint = extractCapabilityHint(err)

  // Source preview: read a small window around the first user frame.
  // Falls back gracefully when the file isn't readable (e.g. bundled-only
  // frames, sandboxed environments, file outside cwd).
  const firstUserFrame = userFrames[0]
  const window = firstUserFrame
    ? await readSourceWindow(firstUserFrame.file, firstUserFrame.line, 4)
    : null
  const sourceCard =
    firstUserFrame && window ? renderSourcePreview(firstUserFrame, window, esc) : ''

  const userStack = userFrames.length
    ? `<ul class="frames">${userFrames.map((f) => renderFrameRowPretty(f, esc)).join('')}</ul>`
    : '<p class="frames-empty">No user frames in this stack — see raw stack below.</p>'

  const frameworkBlock = frameworkFrames.length
    ? [
        '<details class="card collapsible">',
        '<summary>',
        '<span class="sum-label">Framework / runtime</span>',
        `<span class="sum-count">${frameworkFrames.length}</span>`,
        '</summary>',
        '<ul class="frames">',
        ...frameworkFrames.map((f) => renderFrameRowPretty(f, esc)),
        '</ul>',
        '</details>',
      ].join('')
    : ''

  const rawBlock = [
    '<details class="card collapsible">',
    '<summary>',
    '<span class="sum-label">Raw stack</span>',
    `<button type="button" class="copy-btn copy-stack" data-copy="${esc(rawStack)}" title="Copy stack" onclick="event.stopPropagation()">`,
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    '</button>',
    '</summary>',
    `<pre class="raw">${esc(rawStack)}</pre>`,
    '</details>',
  ].join('')

  const hintCard = capHint
    ? [
        '<section class="card hint-card">',
        '<header class="hint-head">',
        '<svg class="hint-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"></path></svg>',
        `<span>Try one of these to install <code>${esc(capHint.name)}</code></span>`,
        '</header>',
        '<ol class="hint-list">',
        ...capHint.suggestions.map(
          (s) =>
            `<li><code>${esc(s.code)}</code><span class="hint-note">${esc(s.note)}</span></li>`,
        ),
        '</ol>',
        '</section>',
      ].join('')
    : ''

  // Tiny inline script: copy-to-clipboard buttons. CSP in dev is relaxed;
  // production never emits this overlay. The script is self-contained and
  // uses event delegation so collapsibles re-rendered later still work.
  const copyScript = `
document.addEventListener('click', function(e){
  const t = e.target.closest('.copy-btn');
  if (!t) return;
  e.preventDefault();
  const v = t.getAttribute('data-copy') || '';
  navigator.clipboard.writeText(v).then(function(){
    const orig = t.getAttribute('aria-label') || '';
    t.classList.add('copied');
    setTimeout(function(){ t.classList.remove('copied'); }, 1200);
  }).catch(function(){});
});
`

  // All inline — strict CSP doesn't apply in dev where this overlay
  // emits. The visual language is built on a small accent system so the
  // category color flows through the hero band, caret, and tag pill.
  // `--ac` is the accent oklch chosen by `categorizeError(err)`.
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    `<meta charset="utf-8">`,
    `<title>${esc(cat.label)} · ${name}</title>`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="color-scheme" content="light dark">`,
    '<style>',
    `:root{--ac:${cat.accent};--bg:oklch(0.13 0.006 286);--bg2:oklch(0.17 0.006 286);--card:oklch(0.18 0.006 286);--bd:oklch(0.27 0.006 286);--fg:oklch(0.97 0.001 286);--mu:oklch(0.62 0.012 286);--mu2:oklch(0.46 0.012 286);--str:oklch(0.78 0.14 145);--num:oklch(0.78 0.14 65);--key:oklch(0.74 0.16 295);--cmt:oklch(0.5 0.01 286);}`,
    `@media (prefers-color-scheme: light){:root{--bg:oklch(0.985 0.002 286);--bg2:oklch(0.97 0.003 286);--card:oklch(1 0 0);--bd:oklch(0.92 0.005 286);--fg:oklch(0.18 0.008 286);--mu:oklch(0.48 0.014 286);--mu2:oklch(0.62 0.012 286);--str:oklch(0.5 0.16 145);--num:oklch(0.55 0.16 65);--key:oklch(0.5 0.18 295);--cmt:oklch(0.7 0.008 286);}}`,
    `*,*::before,*::after{box-sizing:border-box;}`,
    `html,body{margin:0;padding:0;}`,
    `body{font:14px/1.55 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;}`,
    `.wrap{max-width:920px;margin:0 auto;padding:0 1.5rem 4rem;}`,
    /* Top status strip */
    `.strip{display:flex;align-items:center;gap:.75rem;padding:.65rem 1rem;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mu);background:color-mix(in oklab,var(--ac) 10%,var(--bg2));border-bottom:1px solid color-mix(in oklab,var(--ac) 25%,var(--bd));position:sticky;top:0;z-index:10;backdrop-filter:blur(8px);}`,
    `.strip .dot{width:8px;height:8px;border-radius:50%;background:var(--ac);box-shadow:0 0 0 3px color-mix(in oklab,var(--ac) 30%,transparent);animation:pulse 2.5s ease-in-out infinite;}`,
    `@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.55;}}`,
    `.strip .method{padding:1px 6px;border-radius:3px;background:var(--card);color:var(--fg);font-weight:600;}`,
    `.strip .req{color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}`,
    `.strip .meta{color:var(--mu2);}`,
    /* Hero */
    `.hero{padding:2.5rem 0 1.5rem;display:flex;gap:1.25rem;align-items:flex-start;}`,
    `.hero-icon{flex-shrink:0;width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:color-mix(in oklab,var(--ac) 18%,var(--card));color:var(--ac);box-shadow:0 0 0 1px color-mix(in oklab,var(--ac) 30%,transparent),0 6px 24px -8px color-mix(in oklab,var(--ac) 60%,transparent);}`,
    `.hero-text{min-width:0;flex:1;}`,
    `.cat{display:inline-block;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:color-mix(in oklab,var(--ac) 14%,var(--card));color:var(--ac);border:1px solid color-mix(in oklab,var(--ac) 30%,transparent);margin-bottom:.55rem;}`,
    `.hero h1{margin:0 0 .35rem;font-size:22px;font-weight:600;letter-spacing:-.01em;color:var(--fg);}`,
    `.hero .msg{margin:0;font-size:15px;color:var(--fg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg2);padding:.65rem .9rem;border-radius:8px;border:1px solid var(--bd);white-space:pre-wrap;word-break:break-word;}`,
    /* Card */
    `.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;margin:1rem 0;overflow:hidden;}`,
    /* Hint card */
    `.hint-card{border-color:color-mix(in oklab,var(--ac) 35%,var(--bd));}`,
    `.hint-head{display:flex;align-items:center;gap:.55rem;padding:.85rem 1rem;border-bottom:1px solid var(--bd);background:color-mix(in oklab,var(--ac) 8%,var(--card));color:var(--ac);font-size:13px;font-weight:500;}`,
    `.hint-head code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:color-mix(in oklab,var(--ac) 15%,var(--card));padding:1px 5px;border-radius:3px;color:var(--ac);}`,
    `.hint-icon{flex-shrink:0;}`,
    `.hint-list{margin:0;padding:.5rem 0;list-style:none;counter-reset:s;}`,
    `.hint-list li{padding:.55rem 1rem .55rem 2.6rem;position:relative;counter-increment:s;border-top:1px solid var(--bd);}`,
    `.hint-list li:first-child{border-top:0;}`,
    `.hint-list li::before{content:counter(s);position:absolute;left:1rem;top:.65rem;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;background:color-mix(in oklab,var(--ac) 18%,var(--card));color:var(--ac);}`,
    `.hint-list code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg);background:var(--bg2);padding:1px 6px;border-radius:4px;border:1px solid var(--bd);display:inline-block;margin-bottom:.2rem;}`,
    `.hint-note{display:block;color:var(--mu);font-size:12.5px;}`,
    /* Source preview */
    `.src .src-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.6rem 1rem;border-bottom:1px solid var(--bd);background:var(--bg2);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;}`,
    `.src-head-l{display:flex;align-items:center;gap:.55rem;min-width:0;flex:1;}`,
    `.src-fn{color:var(--fg);font-weight:600;}`,
    `.src-sep{color:var(--mu2);}`,
    `.src-path{color:var(--mu);text-decoration:none;display:inline-flex;align-items:baseline;gap:.15rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `.src-path:hover{color:var(--fg);}`,
    `.src-pos{color:color-mix(in oklab,var(--ac) 60%,var(--mu));}`,
    `.src-body{margin:0;padding:.6rem 0;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);overflow-x:auto;}`,
    `.src-line{display:grid;grid-template-columns:24px 48px 1fr;gap:0;padding:0 1rem;color:var(--fg);white-space:pre;}`,
    `.src-line-err{background:color-mix(in oklab,var(--ac) 14%,transparent);}`,
    `.src-line-err .src-gutter{color:var(--ac);font-weight:700;}`,
    `.src-gutter{user-select:none;color:transparent;}`,
    `.src-lineno{user-select:none;color:var(--mu2);text-align:right;padding-right:.85rem;}`,
    `.src-code{color:var(--fg);}`,
    `.src-caret{display:grid;grid-template-columns:24px 48px 1fr;gap:0;padding:0 1rem;color:var(--ac);font-weight:700;white-space:pre;line-height:1;background:color-mix(in oklab,var(--ac) 14%,transparent);}`,
    `.src-caret-mark{color:var(--ac);}`,
    /* Syntax tokens */
    `.t-k{color:var(--key);}`,
    `.t-s{color:var(--str);}`,
    `.t-n{color:var(--num);}`,
    `.t-l{color:var(--num);}`,
    `.t-c{color:var(--cmt);font-style:italic;}`,
    /* Frames lists */
    `h2.section{margin:1.8rem 0 .55rem;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--mu);}`,
    `ul.frames{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden;}`,
    `ul.frames .frame{display:flex;flex-direction:column;gap:.15rem;padding:.7rem 1rem;border-bottom:1px solid var(--bd);font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;}`,
    `ul.frames .frame:last-child{border-bottom:0;}`,
    `ul.frames .frame:hover{background:var(--bg2);}`,
    `.frame-fn{color:var(--fg);font-weight:500;}`,
    `.frame-file{display:flex;align-items:baseline;flex-wrap:wrap;text-decoration:none;color:var(--mu);font-size:11.5px;}`,
    `.frame-file:hover .frame-base{color:var(--ac);}`,
    `.frame-dir{color:var(--mu2);}`,
    `.frame-base{color:var(--fg);font-weight:500;}`,
    `.frame-pos{color:var(--mu2);}`,
    `.frames-empty{margin:.5rem 0;padding:1rem;background:var(--card);border:1px dashed var(--bd);border-radius:12px;color:var(--mu);font-size:13px;text-align:center;}`,
    /* Collapsibles */
    `.collapsible summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.85rem 1rem;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mu);transition:background .12s ease;}`,
    `.collapsible summary::-webkit-details-marker{display:none;}`,
    `.collapsible summary:hover{background:var(--bg2);color:var(--fg);}`,
    `.collapsible[open] summary{border-bottom:1px solid var(--bd);background:var(--bg2);color:var(--fg);}`,
    `.sum-label{display:flex;align-items:center;gap:.55rem;}`,
    `.sum-label::before{content:'';display:inline-block;width:0;height:0;border-left:5px solid currentColor;border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform .15s ease;}`,
    `.collapsible[open] .sum-label::before{transform:rotate(90deg);}`,
    `.sum-count{font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg2);padding:1px 7px;border-radius:999px;border:1px solid var(--bd);color:var(--mu);}`,
    `.collapsible[open] .sum-count{background:var(--card);}`,
    `pre.raw{margin:0;padding:1rem;font:11.5px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg);white-space:pre-wrap;word-break:break-word;background:var(--card);overflow-x:auto;}`,
    /* Copy button */
    `.copy-btn{background:transparent;border:1px solid var(--bd);color:var(--mu);width:26px;height:26px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:all .12s ease;flex-shrink:0;}`,
    `.copy-btn:hover{border-color:var(--ac);color:var(--ac);background:color-mix(in oklab,var(--ac) 8%,var(--card));}`,
    `.copy-btn.copied{border-color:var(--str);color:var(--str);background:color-mix(in oklab,var(--str) 12%,var(--card));}`,
    /* Footer */
    `.foot{margin-top:2rem;padding:1rem 1.1rem;font-size:12px;color:var(--mu);background:var(--card);border:1px solid var(--bd);border-radius:12px;display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;}`,
    `.foot code{font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg2);padding:1px 5px;border-radius:3px;color:var(--fg);}`,
    `.foot a{color:var(--ac);text-decoration:none;}`,
    `.foot a:hover{text-decoration:underline;}`,
    '</style>',
    '</head>',
    '<body>',
    '<div class="strip">',
    '<span class="dot" aria-hidden="true"></span>',
    `<span class="method">${method}</span>`,
    `<span class="req">${path}</span>`,
    `<span class="meta">place / ${esc(phase)} threw · ${esc(time)}</span>`,
    '</div>',
    '<div class="wrap">',
    '<header class="hero">',
    `<div class="hero-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${cat.iconPath}"></path></svg></div>`,
    '<div class="hero-text">',
    `<span class="cat">${esc(cat.label)}</span>`,
    `<h1>${name}</h1>`,
    `<pre class="msg">${message}</pre>`,
    '</div>',
    '</header>',
    hintCard,
    sourceCard,
    '<h2 class="section">Stack — your code</h2>',
    userStack,
    frameworkBlock,
    rawBlock,
    '<footer class="foot">',
    `<span>Dev overlay — emitted when <code>NODE_ENV</code> is not <code>production</code>.</span>`,
    '<span>Save a file to retry — the watcher will reload this page.</span>',
    '</footer>',
    '</div>',
    `<script>${copyScript}</script>`,
    '</body>',
    '</html>',
  ].join('')
}
