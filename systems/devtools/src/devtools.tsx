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

import { onCleanup, onMount, type View } from '@place/component'
import {
  _beginDevtoolsNodes,
  _endDevtoolsNodes,
  type GraphNodeSnapshot,
  type GraphSnapshot,
  inspectGraph,
  onGraphTick,
  type State,
  state,
} from '@place/reactivity'
import { type Router, RouterCap } from '@place/routing'
import { devtoolsCss } from './styles.ts'

// True in a development build — the build injects `__PLACE_DEV__`.
// Used to caveat dev-only measurements (sourcemap-inflated bundles).
declare const __PLACE_DEV__: boolean | undefined
const IS_DEV: boolean = typeof __PLACE_DEV__ !== 'undefined' && __PLACE_DEV__ === true

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

type TabId = 'graph' | 'islands' | 'routes' | 'console' | 'perf'

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'graph', label: 'Graph' },
  { id: 'islands', label: 'Islands' },
  { id: 'routes', label: 'Routes' },
  { id: 'console', label: 'Console' },
  { id: 'perf', label: 'Perf' },
]

/** One captured console / error entry for the Console panel. */
interface LogEntry {
  readonly level: 'error' | 'warn' | 'info' | 'log'
  readonly text: string
  /** Monotonic id — newest entries have the highest seq. */
  readonly seq: number
}

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

/** Render one console argument to a string, defensively. */
function fmtArg(a: unknown): string {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`
  if (typeof a === 'function') return `ƒ ${(a as { name?: string }).name ?? ''}`.trimEnd()
  try {
    return typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)
  } catch {
    return String(a)
  }
}

function countKind(snap: GraphSnapshot, kind: GraphNodeSnapshot['kind']): number {
  let n = 0
  for (const node of snap.nodes) if (node.kind === kind) n++
  return n
}

// ===== panel: Graph =====
//
// A reactive graph's meaning is its *structure* — what feeds what.
// The panel renders that, not a flat value list:
//
//   1. Nodes are grouped into CONNECTED COMPONENTS ("clusters") —
//      union-find over every edge. Each cluster is one independent
//      reactive sub-graph; on an islands page that maps cleanly to
//      "one cluster per island", which is the developer's mental
//      model.
//   2. Within a cluster, nodes read top-to-bottom in flow order
//      (state → derived → watch) and each shows its real edges
//      (`← #3` sources, `→ #7` dependents) so a chain is traceable.
//   3. `watch` nodes are shown, not collapsed to a count — they are
//      the leaves of every cluster (the actual effects); hiding them
//      hid the whole point of a graph.

/** One connected component of the reactive graph. */
interface GraphCluster {
  readonly nodes: readonly GraphNodeSnapshot[]
}

const KIND_RANK: Record<GraphNodeSnapshot['kind'], number> = { state: 0, derived: 1, watch: 2 }

/**
 * Partition a snapshot into connected components (clusters) via
 * union-find over the undirected edge set. Single-node components are
 * split out as `loose` — isolated cells nobody reads yet — so they
 * don't each become a one-row card.
 */
function clusterGraph(snap: GraphSnapshot): {
  clusters: GraphCluster[]
  loose: GraphNodeSnapshot[]
} {
  const present = new Set<number>()
  for (const n of snap.nodes) present.add(n.id)
  const parent = new Map<number, number>()
  for (const n of snap.nodes) parent.set(n.id, n.id)
  const find = (x: number): number => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) as number
    let c = x
    while (c !== r) {
      const next = parent.get(c) as number
      parent.set(c, r)
      c = next
    }
    return r
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const n of snap.nodes) {
    for (const s of n.sources) if (present.has(s)) union(n.id, s)
    for (const d of n.dependents) if (present.has(d)) union(n.id, d)
  }
  const groups = new Map<number, GraphNodeSnapshot[]>()
  for (const n of snap.nodes) {
    const root = find(n.id)
    const g = groups.get(root)
    if (g) g.push(n)
    else groups.set(root, [n])
  }
  const byFlow = (a: GraphNodeSnapshot, b: GraphNodeSnapshot): number =>
    KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id - b.id
  const clusters: GraphCluster[] = []
  const loose: GraphNodeSnapshot[] = []
  for (const g of groups.values()) {
    if (g.length === 1) loose.push(g[0] as GraphNodeSnapshot)
    else clusters.push({ nodes: [...g].sort(byFlow) })
  }
  clusters.sort((a, b) => b.nodes.length - a.nodes.length)
  loose.sort(byFlow)
  return { clusters, loose }
}

/** One-line shape of a cluster, e.g. `2 state → 1 derived → 3 watch`. */
function clusterShape(nodes: readonly GraphNodeSnapshot[]): string {
  let s = 0
  let d = 0
  let w = 0
  for (const n of nodes) {
    if (n.kind === 'state') s++
    else if (n.kind === 'derived') d++
    else w++
  }
  const parts: string[] = []
  if (s > 0) parts.push(`${s} state`)
  if (d > 0) parts.push(`${d} derived`)
  if (w > 0) parts.push(`${w} watch`)
  return parts.join(' → ')
}

/** Compact edge line for a node — its sources and dependents by id. */
function edgeText(n: GraphNodeSnapshot): string {
  const parts: string[] = []
  if (n.sources.length > 0) parts.push(`← ${n.sources.map((i) => `#${i}`).join(' ')}`)
  if (n.dependents.length > 0) parts.push(`→ ${n.dependents.map((i) => `#${i}`).join(' ')}`)
  return parts.length > 0 ? parts.join('     ') : 'no edges'
}

function nodeRow(n: GraphNodeSnapshot): View {
  return (
    <li class="place-dt-gnode">
      <div class="place-dt-gnode-head">
        <span class="place-dt-badge" data-kind={n.kind}>
          {n.kind}
        </span>
        <span class="place-dt-gnode-val">{n.kind === 'watch' ? 'effect' : (n.value ?? '—')}</span>
        <span class="place-dt-status" data-s={n.status}>
          {n.status}
        </span>
        <span class="place-dt-id">#{String(n.id)}</span>
      </div>
      <div class="place-dt-gnode-edges">{edgeText(n)}</div>
    </li>
  )
}

function clusterCard(nodes: readonly GraphNodeSnapshot[], loose: boolean): View {
  return (
    <section class="place-dt-cluster" data-loose={loose ? '1' : '0'}>
      <header class="place-dt-cluster-head">
        <span class="place-dt-cluster-shape">
          {loose ? 'unconnected cells' : clusterShape(nodes)}
        </span>
        <span class="place-dt-id">{`${nodes.length} node${nodes.length === 1 ? '' : 's'}`}</span>
      </header>
      <ul class="place-dt-glist">{nodes.map(nodeRow)}</ul>
    </section>
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
      {() => {
        const snap = graph()
        if (snap.nodes.length === 0) {
          return [<div class="place-dt-empty">No reactive nodes on this page.</div>]
        }
        const { clusters, loose } = clusterGraph(snap)
        const out: View[] = clusters.map((c) => clusterCard(c.nodes, false))
        if (loose.length > 0) out.push(clusterCard(loose, true))
        return out
      }}
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
        return [
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
          </dl>,
          IS_DEV ? (
            <div class="place-dt-note">
              Dev build — “JS shipped” includes inline sourcemaps; production bundles are far
              smaller. Timing reflects the initial document load.
            </div>
          ) : null,
        ]
      }}
    </div>
  )
}

// ===== panel: Console =====

function logRow(e: LogEntry) {
  return (
    <li class="place-dt-row place-dt-log">
      <span class="place-dt-badge" data-kind={e.level}>
        {e.level}
      </span>
      <span class="place-dt-row-main">
        <div class="place-dt-log-text">{e.text}</div>
      </span>
      <span class="place-dt-id" />
    </li>
  )
}

function consolePane(logs: State<LogEntry[]>) {
  const count = (lvl: LogEntry['level']): number => logs().filter((l) => l.level === lvl).length
  return (
    <div>
      <div class="place-dt-summary">
        <span>
          <b>{() => String(count('error'))}</b> errors
        </span>
        <span>
          <b>{() => String(count('warn'))}</b> warnings
        </span>
        <span>
          <b>{() => String(logs().length)}</b> total
        </span>
      </div>
      <ul class="place-dt-list">
        {() =>
          logs().length === 0
            ? [<li class="place-dt-empty">Console is quiet — nothing captured yet.</li>]
            : logs().map(logRow)
        }
      </ul>
    </div>
  )
}

// ===== the devtools view =====

/**
 * The devtools component — the floating launcher + tabbed panel.
 *
 * Exported as a plain view, not a pre-wrapped `island()`: the island
 * bundler requires an island's source file to live under the
 * consuming app's project tree, so the `island()` call belongs in the
 * app, not in this package. Wrap it in a one-line island file:
 *
 * ```tsx
 * // src/islands/devtools.tsx
 * import { island } from '@place/component'
 * import { devtoolsView } from '@place/devtools'
 * export default island(import.meta.url, devtoolsView)
 * ```
 *
 * then render `<Devtools />` once in a root layout (behind a dev gate).
 */
export const devtoolsView = () => {
  // **Client-only surface.** The devtools has no server-side
  // rendering — it observes a *running* app. Touching `document` here
  // throws a `ReferenceError` on the server, which the island runtime
  // recovers from by emitting an empty marker and mounting the view
  // fresh on the client. Two bugs that buys us:
  //   - No flash of unstyled content — nothing devtools-shaped is in
  //     the SSR'd HTML, so there is nothing to show before the
  //     stylesheet is adopted.
  //   - No SSR/client hydration mismatch — the panels render
  //     differently on server vs client (RouterCap is client-only;
  //     the graph is empty until hydrate), and an empty SSR marker
  //     sidesteps the mismatch entirely.
  if (typeof document === 'undefined') {
    throw new ReferenceError('document is not defined')
  }
  // Adopt the stylesheet before the panel's first paint — no FOUC.
  adoptStyles()

  // The devtool's own panel-state cells are reactive nodes too — flag
  // them so the Graph panel excludes them and shows only the app's
  // graph. The scope is synchronous (just these six `state()` calls),
  // so nothing else can land in it.
  _beginDevtoolsNodes()
  const open = state(false)
  const tab = state<TabId>('graph')
  const graph = state<GraphSnapshot>({ nodes: [], capturedAt: 0 })
  const islands = state<IslandInfo[]>([])
  const perf = state<PerfInfo | null>(null)
  const logs = state<LogEntry[]>([])
  _endDevtoolsNodes()

  // Routing cap is resolved synchronously — installed before islands hydrate.
  const router = RouterCap.tryUse()

  onMount(() => {
    // Graph — snapshot now, then re-snapshot on every settled tick.
    graph.set(inspectGraph())
    const offTick = onGraphTick(() => graph.set(inspectGraph()))

    // Islands — re-scan the DOM periodically (visible/idle islands
    // hydrate after first paint).
    const scan = (): void => islands.set(scanIslands())
    scan()
    const scanTimer = setInterval(scan, 800)

    // Perf — collect now; re-collect when `load` fires (the island
    // can hydrate before the load event, leaving `loadEventEnd` at 0)
    // and on every SPA navigation, so the panel tracks the current
    // route instead of going stale on the first paint.
    const refreshPerf = (): void => perf.set(collectPerf())
    refreshPerf()
    if (document.readyState !== 'complete') {
      window.addEventListener('load', refreshPerf, { once: true })
    }
    window.addEventListener('place:nav', refreshPerf)

    // Console — mirror console.{error,warn,info,log} plus uncaught
    // errors + unhandled rejections into the Console panel. The
    // originals are always still called; restored on cleanup.
    const LEVELS: ReadonlyArray<LogEntry['level']> = ['error', 'warn', 'info', 'log']
    let logSeq = 0
    const pushLog = (level: LogEntry['level'], text: string): void => {
      logs.update((prev) => {
        const next: LogEntry[] = [{ level, text, seq: logSeq++ }, ...prev]
        return next.length > 150 ? next.slice(0, 150) : next
      })
    }
    const originalConsole: Partial<Record<LogEntry['level'], (...a: unknown[]) => void>> = {}
    for (const lvl of LEVELS) {
      // Patching `console` is the Console panel's whole purpose — it
      // mirrors console output into the panel. The originals are kept
      // and always still called; restored on cleanup.
      const target = console
      const orig = target[lvl] as (...a: unknown[]) => void
      originalConsole[lvl] = orig
      target[lvl] = ((...args: unknown[]): void => {
        try {
          pushLog(lvl, args.map(fmtArg).join(' '))
        } catch (_) {
          // Capture must never break the app's own logging.
        }
        orig.apply(target, args)
      }) as typeof console.log
    }
    const onWindowError = (e: ErrorEvent): void => {
      pushLog('error', `${e.message}${e.filename ? `  (${e.filename}:${e.lineno})` : ''}`)
    }
    const onRejection = (e: PromiseRejectionEvent): void => {
      pushLog('error', `Unhandled rejection: ${fmtArg(e.reason)}`)
    }
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onRejection)

    onCleanup(() => {
      offTick()
      clearInterval(scanTimer)
      window.removeEventListener('load', refreshPerf)
      window.removeEventListener('place:nav', refreshPerf)
      for (const lvl of LEVELS) {
        const o = originalConsole[lvl]
        if (o) console[lvl] = o as typeof console.log
      }
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onRejection)
    })
  })

  return (
    <div class="place-dt" data-open={() => (open() ? '1' : '0')} data-tab={() => tab()}>
      <button
        type="button"
        class="place-dt-launch"
        aria-label="Open place devtools"
        title="place devtools"
        onClick={() => open.set(true)}
      >
        <span class="place-dt-mark">▲</span>
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
          <div class="place-dt-pane" data-pane="console">
            {consolePane(logs)}
          </div>
          <div class="place-dt-pane" data-pane="perf">
            {perfPane(perf)}
          </div>
        </div>
      </section>
    </div>
  )
}
