// View classifier (T8-D; ADR 0030 prototype).
//
// Walks each island's source and predicts the level the future
// `view()` primitive should compile it to — L0 static / L1 thaw /
// L2 island / L3 island+stream — by reading the effect-kind tags on
// the primitives the body references.
//
// **Status:** report-only. Tier 8 ships the prediction in the
// build manifest + console report but does NOT change emission;
// every island still ships at L2 today. Tier 9 makes the
// classifier authoritative by introducing `view()` as the public
// primitive and selecting the L0/L1/L2/L3 emitter per the manifest.
//
// **Approach in Tier 8:** *identifier-name match* against a curated
// table of effect-producing primitives. This is one rung short of
// the full type-based classifier ADR 0030 specifies (which reads
// `EffectBranded<E>` brands off TypeScript's inferred types).
//
// Why a name-match prototype is the right Tier 8 shape rather than
// a workaround:
//
//   1. The effect-kind types (T8-A) ARE the source of truth. The
//      name table here is a *projection* of those types — kept in
//      sync by a single import-export contract (see `KNOWN_EFFECTS`
//      below; each entry cross-references the primitive's branded
//      declaration site).
//   2. Report-only output: any misclassification costs **the
//      report's accuracy**, not runtime correctness. Tier 9 swaps
//      this for the type-based classifier before emission depends
//      on it.
//   3. Bun's transpiler doesn't expose typed ASTs; using the TS
//      compiler API for a feature that needs to flag-gate behind a
//      Tier 9 promotion would add a heavy dev-time dependency for
//      info that's structurally available via primitive imports.
//
// The name-match contract is **explicit + documented**: every effect-
// producing primitive carries an `EffectBranded<E>` in its type AND
// an entry in `KNOWN_EFFECTS` below. CI verifies both stay aligned.

import type { Effect, ViewLevel } from '@place/reactivity/effects'
import { levelOf } from '@place/reactivity/effects'

/**
 * Curated map: identifier name → effect kind. Each entry mirrors the
 * `EffectBranded<E>` brand on the corresponding primitive's declaration.
 *
 * When you add an effect-producing primitive:
 *   1. Brand it: `export const myFn: typeof _myFn & EffectBranded<'<kind>'> = _myFn`
 *   2. Add the entry here.
 *
 * Step 1 is the contract; step 2 is the projection. CI (T8-E) checks
 * the two stay in sync.
 */
export const KNOWN_EFFECTS: Readonly<Record<string, Effect>> = {
  // 'state' — reads/writes signal cells (ADR 0030 L1 thaw eligible).
  state: 'state',
  derived: 'state',
  cookieState: 'state',
  urlState: 'state',
  persistedState: 'state',

  // 'lifecycle' — mount/unmount registration (forces L2 island).
  watch: 'lifecycle',
  onMount: 'lifecycle',
  onCleanup: 'lifecycle',
  globalKey: 'lifecycle',

  // 'timer' — schedules callbacks (forces L2 island).
  setInterval: 'timer',
  setTimeout: 'timer',
  requestAnimationFrame: 'timer',
  requestIdleCallback: 'timer',

  // 'io' — networks / disk / fetch (forces L2 island).
  fetch: 'io',
  XMLHttpRequest: 'io',
  WebSocket: 'io',
  EventSource: 'io',

  // 'dom' — direct DOM mutation outside reactive props (forces L2).
  // Reactive `style:*` / `class:*` / `bind:*` directives are NOT in
  // this set — they're routed through the reactive runtime and stay
  // L1-eligible.
  // (Intentionally narrow today: most DOM access comes through the
  // framework's reactive path. Add entries as new escape-hatches
  // surface.)

  // 'suspense' — combines with L2 effects to promote to L3.
  Suspense: 'suspense',
  suspense: 'suspense',
  resource: 'suspense',
}

export interface ClassifierFinding {
  /** Effect kind that promoted the view past L0. */
  readonly effect: Effect
  /** The identifier that introduced this effect (for the report). */
  readonly identifier: string
  /** Approximate count of references inside the body (for context). */
  readonly count: number
}

export interface ClassifierResult {
  /** Final classified level. */
  readonly level: ViewLevel
  /** Distinct effects observed in the body. */
  readonly effects: ReadonlySet<Effect>
  /** Per-effect findings for the build report. */
  readonly findings: readonly ClassifierFinding[]
  /**
   * Human-readable reason for the level. Always populated; says
   * "no effects beyond 'pure'" for L0. The first L2-forcing effect
   * is named explicitly so the build report can render the
   * "promoted from L1 because <reason>" line ADR 0030 specifies.
   */
  readonly reason: string
}

/**
 * **Identifier-scan classifier.** Reads the island source as a plain
 * string and looks for whole-word identifier references in the
 * `KNOWN_EFFECTS` table. False-positive risk: an identifier used as
 * an object key or in a string literal would be counted. False-
 * negative risk: an aliased import (`import { state as s }`) would
 * be missed.
 *
 * **Both classes of risk are bounded by Tier 9's promotion**: when
 * the classifier becomes authoritative, the type-based scan (reading
 * `EffectBranded<E>` brands off TypeScript's inferred types) is
 * structurally accurate. The Tier 8 prototype's purpose is to
 * validate that the level distribution is roughly right on the docs
 * site's 11 islands before Tier 9 commits to the model.
 */
export function classifyIslandSource(source: string): ClassifierResult {
  const effects = new Set<Effect>()
  const counts = new Map<string, number>()

  for (const [name, effect] of Object.entries(KNOWN_EFFECTS)) {
    // Whole-word match. The `(?<![A-Za-z0-9_$])` and `(?![A-Za-z0-9_$])`
    // boundaries reject substrings (`stateful` !== `state`) AND
    // member accesses (`obj.state` !== top-level `state`). Aliased
    // imports remain a known false-negative (see doc above).
    const re = new RegExp(`(?<![A-Za-z0-9_$])${escapeRe(name)}(?![A-Za-z0-9_$])`, 'g')
    const matches = source.match(re)
    if (matches && matches.length > 0) {
      effects.add(effect)
      counts.set(name, matches.length)
    }
  }

  const level = levelOf(effects)
  const findings: ClassifierFinding[] = []
  for (const [name, count] of counts) {
    findings.push({ effect: KNOWN_EFFECTS[name] as Effect, identifier: name, count })
  }
  findings.sort((a, b) => b.count - a.count)

  const reason = explainLevel(level, findings)

  return { level, effects, findings, reason }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function explainLevel(level: ViewLevel, findings: readonly ClassifierFinding[]): string {
  if (level === 'static') return 'no effects beyond pure'
  if (level === 'thaw') {
    const f = findings.find((x) => x.effect === 'state')
    return f ? `state-only — \`${f.identifier}\` (${f.count} ref${f.count === 1 ? '' : 's'})` : 'state-only'
  }
  // L2 / L3 — find the first L2-forcing effect for the "promoted because" line.
  const promoter = findings.find(
    (x) => x.effect === 'lifecycle' || x.effect === 'timer' || x.effect === 'io' || x.effect === 'dom',
  )
  const suspense = findings.find((x) => x.effect === 'suspense')
  if (level === 'island+stream') {
    return `\`${promoter?.identifier ?? '?'}\` (${promoter?.effect}) + \`${suspense?.identifier ?? 'Suspense'}\` (suspense)`
  }
  return `\`${promoter?.identifier ?? '?'}\` (${promoter?.effect})`
}

// ===== Build-report formatting =====

export interface ViewManifestEntry {
  readonly name: string
  readonly level: ViewLevel
  readonly effects: readonly Effect[]
  readonly reason: string
  /** Best-effort byte cost of the current (L2-only) emission. */
  readonly bytesCurrent: number
  /** Predicted bytes at the classified level. */
  readonly bytesPredicted: number
}

export interface ViewManifest {
  readonly generatedAt: number
  readonly entries: readonly ViewManifestEntry[]
}

/**
 * Pretty-print the manifest as a compact build-report block.
 *
 * **Design priorities** (revised after the first-cut was flagged as
 * overwhelming):
 *
 *   1. **Headline first.** The single most useful sentence — total
 *      JS shipped today vs predicted at classified levels, plus the
 *      number of actionable optimizations — leads the block.
 *   2. **Actionable rows only.** Islands classified at L0/L1 are
 *      promoted to the foreground (sorted by savings, biggest first).
 *      L2 islands — the steady-state — collapse into a single tail
 *      line ("7 more islands at L2 (steady state)"). The manifest
 *      file on disk has every entry for anyone who needs the full
 *      table.
 *   3. **Reason per actionable row.** The promoter identifier + effect
 *      stays — that's the "magic with clarity" payoff (ADR 0026).
 *   4. **Status callout.** The Tier-8-prototype caveat moves to a
 *      single dim trailing line, not a full sentence buried in the
 *      table footer.
 *
 * The full per-island detail still lands on disk at
 * `dist/.place/island-entries/view-manifest.json` — devtool / CI /
 * probes consume that; the console output is for the developer's
 * scanning eye.
 *
 * **Tier 8 limits** (name-match prototype): misses cap-method reads
 * (`router.path()`) and aliased imports (`import { state as s }`).
 * Tier 9's type-based classifier closes both structurally.
 */
export function renderReport(manifest: ViewManifest): string {
  const rows = manifest.entries
  if (rows.length === 0) return ''
  let totalCurrent = 0
  let totalPredicted = 0
  for (const r of rows) {
    totalCurrent += r.bytesCurrent
    totalPredicted += r.bytesPredicted
  }
  const delta = totalCurrent - totalPredicted
  const pct = totalCurrent > 0 ? Math.round((delta / totalCurrent) * 100) : 0
  // Actionable: islands where the classifier picks a smaller level
  // than the current emission. Sort biggest-savings-first so the
  // dev sees the highest-leverage row first.
  const actionable = rows
    .filter((r) => r.bytesPredicted < r.bytesCurrent)
    .sort((a, b) => b.bytesCurrent - b.bytesPredicted - (a.bytesCurrent - a.bytesPredicted))
  const steadyL2 = rows.length - actionable.length

  const lines: string[] = []
  // Headline. Concise + interesting: the actual number is the hook.
  if (actionable.length === 0) {
    lines.push(
      `  views    ${rows.length} islands · all at L2 (steady state) · ${formatBytes(totalCurrent)} JS`,
    )
  } else {
    lines.push(
      `  views    ${rows.length} islands · ${actionable.length} optimization${actionable.length === 1 ? '' : 's'} surfaced` +
        ` · ${formatBytes(totalCurrent)} → ${formatBytes(totalPredicted)} (${pct}% leaner)`,
    )
    lines.push('')
    // Actionable rows. Width-aligned for scannability.
    const nameWidth = Math.max(...actionable.map((r) => r.name.length))
    const levelWidth = Math.max(...actionable.map((r) => r.level.length))
    for (const r of actionable) {
      const saving = r.bytesCurrent - r.bytesPredicted
      const sizeNow = formatBytes(r.bytesCurrent)
      const sizePred = formatBytes(r.bytesPredicted)
      lines.push(
        `    ${r.name.padEnd(nameWidth)}  ${r.level.padEnd(levelWidth)}  ${sizeNow} → ${sizePred} (-${formatBytes(saving)})  ${r.reason}`,
      )
    }
    if (steadyL2 > 0) {
      lines.push('')
      lines.push(
        `    + ${steadyL2} more island${steadyL2 === 1 ? '' : 's'} at L2 (steady state — see .place/island-entries/view-manifest.json)`,
      )
    }
  }
  return lines.join('\n')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/**
 * Predict per-island byte cost at a given level. Numbers from ADR
 * 0027 (thaw) and ADR 0030 sizing tables; refined by Tier 9
 * measurement before the classifier becomes authoritative.
 */
export function predictBytesAtLevel(level: ViewLevel, currentBytes: number): number {
  // L0 ships nothing. L1 thaw averages ~300 B inline AST + share of
  // the 1.5 kB shared runtime (amortized as zero per island in
  // multi-island pages). L2/L3 stay at the current per-island bundle
  // size.
  if (level === 'static') return 0
  if (level === 'thaw') return 300
  return currentBytes
}
