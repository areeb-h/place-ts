// @place/devtools — the devtools island.
//
// One island: a floating launcher that expands into a tabbed panel.
// Dogfoods the framework — built with `@place/component` +
// `@place/reactivity`, registered like any other island.
//
// Architecture:
//   - All reactive state + every browser-API touch lives in the
//     island body / its single `onMount`. The four panels are pure
//     `(state) => View` render functions — no lifecycle of their own.
//   - The stylesheet is adopted as a constructable `CSSStyleSheet`
//     (CSP-safe, collision-free). See `styles.ts`.
//   - The launcher / panel / active-tab visibility is pure CSS keyed
//     off `data-open` / `data-tab` on the root — no conditional
//     mounting, so panel subscriptions stay alive across tab switches.

import { island, onCleanup, onMount } from '@place/component'
import {
  type GraphNodeSnapshot,
  type GraphSnapshot,
  inspectGraph,
  onGraphTick,
  type State,
  state,
} from '@place/reactivity'
import { type Router, RouterCap } from '@place/routing'
import { devtoolsCss } from './styles.ts'

// ===== self-contained stylesheet =====

let stylesAdopted = false

/** Adopt the devtool's stylesheet once, via a constructable sheet. */
function adoptStyles(): void {
  if (stylesAdopted || typeof document === 'undefined') return
  stylesAdopted = true
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(devtoolsCss)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  } catch {
    // Constructable stylesheets unsupported — fall back to <style>.
    const el = document.createElement('style')
    el.textContent = devtoolsCss
    document.head.appendChild(el)
  }
}

// ===== panel data shapes =====

type TabId = 'graph' | 'islands' | 'routes' | 'perf'

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'graph', label: 'Graph' },
  { id: 'islands', label: 'Islands' },
  { id: 'routes', label: 'Routes' },
  { id: 'perf', label: 'Perf' },
]

interface IslandInfo {
  readonly id: string
  readonly strategy: string
  readonly mounted: boolean
}

interface PerfInfo {
  readonly ttfb: number
  readonly domReady: number
  readonly load: number
  readonly scripts: number
  readonly jsBytes: number
}

// ===== data collectors =====

/** Read every island marker in the live DOM. */
function scanIslands(): IslandInfo[] {
  if (typeof document === 'undefined') return []
  const out: IslandInfo[] = []
  for (const el of document.querySelectorAll('[data-view="island"]')) {
    out.push({
      id: el.getAttribute('data-view-id') ?? '?',
      strategy: el.getAttribute('data-view-strategy') ?? 'load',
      mounted: (el as HTMLElement).dataset['viewMounted'] === '1',
    })
  }
  return out
}

/** Read navigation + resource timing for the Perf panel. */
function collectPerf(): PerfInfo {
  if (typeof performance === 'undefined') {
    return { ttfb: 0, domReady: 0, load: 0, scripts: 0, jsBytes: 0 }
  }
  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  let scripts = 0
  let jsBytes = 0
  for (const r of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    if ((r.name.split('?')[0] ?? '').endsWith('.js')) {
      scripts++
      jsBytes += r.transferSize || r.encodedBodySize || 0
    }
  }
  return {
    ttfb: nav ? Math.round(nav.responseStart) : 0,
    domReady: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
    load: nav ? Math.round(nav.loadEventEnd) : 0,
    scripts,
    jsBytes,
  }
}

// ===== formatting helpers =====

function fmtBytes(n: number): string {
  if (n <= 0) return '—'
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

function fmtMs(n: number): string {
  return n > 0 ? `${n} ms` : '—'
}

function fmtQuery(q: URLSearchParams): string {
  const parts: string[] = []
  for (const [k, v] of q) parts.push(`${k}=${v}`)
  return parts.length > 0 ? parts.join('  ') : '—'
}

function countKind(snap: GraphSnapshot, kind: GraphNodeSnapshot['kind']): number {
  let n = 0
  for (const node of snap.nodes) if (node.kind === kind) n++
  return n
}

// ===== panel: Graph =====

function nodeRow(n: GraphNodeSnapshot) {
  const main = n.kind === 'watch' ? 'watch effect' : (n.value ?? '—')
  const edges =
    n.kind === 'watch'
      ? `reads ${n.sources.length}`
      : `${n.dependents.length} dep${n.dependents.length === 1 ? '' : 's'}`
  return (
    <li class="place-dt-row">
      <span class="place-dt-badge" data-kind={n.kind}>
        {n.kind}
      </span>
      <span class="place-dt-row-main">
        <div class="place-dt-row-val">{main}</div>
        <div class="place-dt-row-sub">
          <span class="place-dt-status" data-s={n.status}>
            {n.status}
          </span>
          {` · ${edges}`}
        </div>
      </span>
      <span class="place-dt-id">#{String(n.id)}</span>
    </li>
  )
}

function graphPane(graph: State<GraphSnapshot>) {
  return (
    <div>
      <div class="place-dt-summary">
        <span>
          <b>{() => String(countKind(graph(), 'state'))}</b> state
        </span>
        <span>
          <b>{() => String(countKind(graph(), 'derived'))}</b> derived
        </span>
        <span>
          <b>{() => String(countKind(graph(), 'watch'))}</b> watch
        </span>
      </div>
      <ul class="place-dt-list">
        {() =>
          graph().nodes.length === 0
            ? [<li class="place-dt-empty">No reactive nodes yet.</li>]
            : graph().nodes.map(nodeRow)
        }
      </ul>
    </div>
  )
}

// ===== panel: Islands =====

function islandRow(i: IslandInfo) {
  return (
    <li class="place-dt-row">
      <span class="place-dt-dot" data-on={i.mounted ? '1' : '0'} />
      <span class="place-dt-row-main">
        <div class="place-dt-row-val">{i.id}</div>
        <div class="place-dt-row-sub">{`${i.strategy} · ${i.mounted ? 'hydrated' : 'pending'}`}</div>
      </span>
      <span class="place-dt-id" />
    </li>
  )
}

function islandsPane(islands: State<IslandInfo[]>) {
  return (
    <div>
      <div class="place-dt-summary">
        <span>
          <b>{() => String(islands().length)}</b> islands
        </span>
        <span>
          <b>{() => String(islands().filter((i) => i.mounted).length)}</b> hydrated
        </span>
      </div>
      <ul class="place-dt-list">
        {() =>
          islands().length === 0
            ? [<li class="place-dt-empty">No islands on this page — 0 KB framework JS.</li>]
            : islands().map(islandRow)
        }
      </ul>
    </div>
  )
}

// ===== panel: Routes =====

function routesPane(router: Router | null) {
  if (router === null) {
    return <div class="place-dt-empty">No RouterCap installed on this page.</div>
  }
  return (
    <dl class="place-dt-kv">
      <div>
        <dt>path</dt>
        <dd>{() => router.path()}</dd>
      </div>
      <div>
        <dt>segments</dt>
        <dd>{() => router.segments().join(' / ') || '—'}</dd>
      </div>
      <div>
        <dt>query</dt>
        <dd>{() => fmtQuery(router.query())}</dd>
      </div>
    </dl>
  )
}

// ===== panel: Perf =====

function perfPane(perf: State<PerfInfo | null>) {
  return (
    <div>
      {() => {
        const p = perf()
        if (p === null) return <div class="place-dt-empty">measuring…</div>
        return (
          <dl class="place-dt-kv">
            <div>
              <dt>TTFB</dt>
              <dd>{fmtMs(p.ttfb)}</dd>
            </div>
            <div>
              <dt>DOM ready</dt>
              <dd>{fmtMs(p.domReady)}</dd>
            </div>
            <div>
              <dt>load</dt>
              <dd>{fmtMs(p.load)}</dd>
            </div>
            <div>
              <dt>scripts</dt>
              <dd>{String(p.scripts)}</dd>
            </div>
            <div>
              <dt>JS shipped</dt>
              <dd>{fmtBytes(p.jsBytes)}</dd>
            </div>
          </dl>
        )
      }}
    </div>
  )
}

// ===== the island =====

const DevtoolsImpl = () => {
  const open = state(false)
  const tab = state<TabId>('graph')
  const graph = state<GraphSnapshot>({ nodes: [], capturedAt: 0 })
  const islands = state<IslandInfo[]>([])
  const perf = state<PerfInfo | null>(null)
  // Routing cap is resolved synchronously — installed before islands hydrate.
  const router = RouterCap.tryUse()

  onMount(() => {
    adoptStyles()

    // Graph — snapshot now, then re-snapshot on every settled tick.
    graph.set(inspectGraph())
    const offTick = onGraphTick(() => graph.set(inspectGraph()))

    // Islands — re-scan the DOM periodically (visible/idle islands
    // hydrate after first paint).
    const scan = (): void => islands.set(scanIslands())
    scan()
    const scanTimer = setInterval(scan, 800)

    // Perf — collect now, and once more after `load` has had a chance
    // to fire (the island may hydrate before the load event).
    perf.set(collectPerf())
    const perfTimer = setTimeout(() => perf.set(collectPerf()), 700)

    onCleanup(() => {
      offTick()
      clearInterval(scanTimer)
      clearTimeout(perfTimer)
    })
  })

  return (
    <div class="place-dt" data-open={() => (open() ? '1' : '0')} data-tab={() => tab()}>
      <button
        type="button"
        class="place-dt-launch"
        aria-label="Open place devtools"
        onClick={() => open.set(true)}
      >
        <span class="place-dt-mark">▲</span>
        <span class="place-dt-launch-label">devtools</span>
      </button>

      <section class="place-dt-panel" role="dialog" aria-label="place devtools">
        <header class="place-dt-head">
          <span class="place-dt-title">
            <span class="place-dt-mark">▲</span>
            place
          </span>
          <nav class="place-dt-tabs">
            {TABS.map((t) => (
              <button
                type="button"
                class="place-dt-tab"
                data-active={() => (tab() === t.id ? '1' : '0')}
                onClick={() => tab.set(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            class="place-dt-close"
            aria-label="Close devtools"
            onClick={() => open.set(false)}
          >
            ✕
          </button>
        </header>

        <div class="place-dt-body">
          <div class="place-dt-pane" data-pane="graph">
            {graphPane(graph)}
          </div>
          <div class="place-dt-pane" data-pane="islands">
            {islandsPane(islands)}
          </div>
          <div class="place-dt-pane" data-pane="routes">
            {routesPane(router)}
          </div>
          <div class="place-dt-pane" data-pane="perf">
            {perfPane(perf)}
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * The place devtools island. Render it once in a root layout behind a
 * dev gate:
 *
 * ```tsx
 * {import.meta.env?.DEV ? <Devtools /> : null}
 * ```
 */
export const Devtools = island(import.meta.url, DevtoolsImpl)
