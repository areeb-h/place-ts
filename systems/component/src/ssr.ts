// @place/component — server-side rendering pipeline.
//
// Extracted from index.ts (Tier 20 decomposition, cut 5) — the SSR
// surface: the synchronous renderer `renderToString`, the streaming
// renderer `renderToStream`, the `suspense()` boundary primitive, and
// `Static` (the opt-out-of-hydration wrapper).
//
// `index.ts` re-exports the public surface. This module touches
// `index.ts`-resident symbols only inside runtime functions, so the
// ssr ⇄ index cycle stays benign — same shape as element.ts / mount.ts.

import { type EffectBranded, type Resource, untrack, watch } from '@place/reactivity'
import { stringify as devalueStringify } from 'devalue'
import { PLACE_RUNTIME } from './__place_runtime.ts'
import { resetHydrationSeq } from './_internal/hydrationSeq.ts'
import { Fragment } from './mount.ts'
import type { Child, Children, View } from './types.ts'
import { escapeHtmlAttrFull } from './utils/escape.ts'

// ===== renderToString — server-side render =====
//
// Mounts `view` into a fresh detached element, reads its `innerHTML`,
// disposes the mount. Returns the rendered HTML string. The foundational
// piece for SSR — a server hands the HTML to the browser, the client
// hydrates (TBD) and reactivity takes over.
//
// Works anywhere `document` exists:
//   - tests (vitest with `@vitest-environment happy-dom`)
//   - browser (just renders into a detached node — useful for snapshot tests)
//   - Bun / Node servers (install happy-dom's Window globally first)
//
// Why mount-then-serialize instead of a separate string-emitter pipeline:
//   - A single rendering path means SSR + CSR + tests all exercise the
//     same code; no two-implementations-of-everything to keep in sync.
//   - The DOM mount path already handles every JSX construct; a string
//     emitter would have to be re-implemented per element shape.
//   - Performance: a separate emitter would be faster, but happy-dom
//     handles ~10K renders/sec which is plenty for "render a page on
//     request." Optimize if a workload demands it.
//
// Caveats (all addressed in the SSR story but not by this primitive):
//   - Reactive subscriptions are torn down via `dispose()`. Effects with
//     side-channels (analytics fires, etc.) still run during render —
//     handlers should be guarded if they shouldn't fire on the server.
//   - Hydration markers are not emitted. The client's hydrate() (future)
//     will need agreed-upon markers to map server DOM to client mount.
//   - `<script>` and `<style>` content is left as-is; sanitize at the
//     source if rendering untrusted markup.

export function renderToString(view: View): string {
  // Fast path: views built from `el()` / `Fragment` / `component()`
  // implement `toHtml`, which doesn't need a DOM at all. This is the
  // path the Bun-direct sync-server takes; happy-dom isn't required.
  if (view.toHtml) {
    resetHydrationSeq()
    return view.toHtml()
  }
  // Fallback: a custom View without toHtml. Mount into a detached DOM
  // node and serialize. Requires `document` (happy-dom in Bun, real DOM
  // in browser, vitest's @vitest-environment in tests).
  if (typeof document === 'undefined') {
    throw new Error(
      'renderToString: this view has no `toHtml` and no `document` is in scope. ' +
        'Either implement `toHtml()` on the view, or in Bun / Node install happy-dom and ' +
        'register its Window globally — e.g.\n' +
        "  import { Window } from 'happy-dom'\n" +
        '  const w = new Window()\n' +
        '  globalThis.document = w.document as unknown as Document',
    )
  }
  const root = document.createElement('div')
  const dispose = view.mount(root, null)
  try {
    // Strip empty comment nodes — `mountReactiveChild` uses
    // `document.createComment('')` as anchors for swap-in/swap-out,
    // mount-time bookkeeping that shouldn't appear in server output.
    const empties: Comment[] = []
    const walk = (n: Node): void => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType === 8 /* Comment */ && (c as Comment).data === '') {
          empties.push(c as Comment)
        } else {
          walk(c)
        }
      }
    }
    walk(root)
    for (const c of empties) c.remove()
    return root.innerHTML
  } finally {
    dispose()
  }
}

// ===== suspense() — streaming SSR boundary =====
//
// Wraps a subtree that depends on async `resource()` data. While the
// resources are pending, the SSR'd HTML emits a `fallback`; the renderer
// holds the response stream open. Once the resources resolve, the real
// children are rendered and pushed to the stream as a `<template>` swap
// chunk that an inline runtime (`__place.swap(N)`) splices into place.
//
//   import { suspense } from '@place/component'
//   import { resource } from '@place/reactivity'
//
//   const note = resource(
//     (signal) => fetch(`/api/notes/${id}`, { signal }).then(r => r.json()),
//     { hydrationKey: `note:${id}` },  // enables client-side cache lookup
//   )
//
//   <suspense fallback={<Skeleton />} on={[note]}>
//     {() => {
//       const s = note.status()
//       if (s.state === 'ready') return <NoteView note={s.value} />
//       return null
//     }}
//   </suspense>
//
// Wire format (compatible-ish with React Fizz, simpler):
//
//   Initial flush:
//     <!--p:N--><template id="pl-N"></template>${fallback}<!--/p:N-->
//   Later flush, when all `on` resolve:
//     <template id="c-N">${rendered children}</template>
//     <script>__place.r['key1']=…;__place.swap(N)</script>
//
// Why comment markers: `__place.swap(N)` needs to remove a *range* of
// nodes (the fallback subtree). Comments delimit the range; element IDs
// alone don't.
//
// Why plain `<script>` (not `type="module"`): module scripts are
// async/deferred per spec. Plain scripts run synchronously as parsed,
// so the swap fires immediately when the chunk arrives — same order as
// the stream.
//
// Why values are devalue-encoded: devalue handles Date/Map/Set/cycles/
// undefined, is JSON-shaped (CSP-clean — no eval needed; small client
// bundle), and round-trips loudly on unsupported input. Picked over
// seroval (which requires `eval` and would break our `security: 'strict'`).

export interface SuspenseProps {
  /** Rendered while `on` resources are pending. Should be cheap & static. */
  fallback: View
  /** Rendered once all `on` resources resolve. Function-as-child so the
   *  body re-evaluates with the resolved values. */
  children: () => Child
  /** Resources to wait for. Suspense suspends until ALL resolve. */
  on: Resource<unknown>[]
  /**
   * When `false`, the renderer waits synchronously for resources before
   * flushing — works without JS, slower TTFB. Default: `true` (streaming).
   */
  requireJs?: boolean
}

let suspenseSeq = 0
const resetSuspenseSeq = (): void => {
  suspenseSeq = 0
}
const nextSuspenseId = (): number => suspenseSeq++

/**
 * Streaming render context. The renderer sets a module-level reference
 * before walking the View tree; `suspense()`'s `toHtml` reads this to
 * switch between sync rendering (no streaming) and emit-markers-and-
 * register-continuation (streaming). The reference is cleared after the
 * walk so subsequent non-streaming `renderToString` calls aren't
 * accidentally captured.
 */
interface StreamCtx {
  /** Boundaries pending resolution. Drained before the stream closes. */
  pending: PendingBoundary[]
  /** Resource hydration values to emit alongside swap chunks. */
  hydrate: Map<string, unknown>
}

interface PendingBoundary {
  id: number
  resources: Resource<unknown>[]
  /** Re-renders `children` to a string when resources are ready. */
  render: () => string
}

const makeStreamCtx = (): StreamCtx => ({ pending: [], hydrate: new Map() })

let currentStreamCtx: StreamCtx | null = null

// Suspense factory. The View has both `toHtml` (synchronous: just emits
// the rendered children, blocking on resources) and `toStream` (async:
// emits fallback + marker + queues a continuation).
export function suspense(props: SuspenseProps): View & {
  __isSuspense: true
  toStream(ctx: StreamCtx): string
} {
  const requireJs = props.requireJs !== false

  // Resolve children once into a View by calling the function-as-child.
  // The child function is called fresh on each render attempt — important
  // because resource status changes between attempts.
  const renderChildren = (): View => {
    const child = props.children()
    if (child == null || child === false || child === true) {
      return Fragment({ children: '' })
    }
    if (typeof child === 'string' || typeof child === 'number') {
      return Fragment({ children: String(child) })
    }
    if (typeof child === 'function') {
      return Fragment({ children: child as () => Child })
    }
    if (Array.isArray(child)) {
      return Fragment({ children: child as Child[] })
    }
    return child as View
  }

  const allReady = (): boolean => props.on.every((r) => untrack(() => r.status()).state === 'ready')

  const anyError = (): unknown =>
    props.on.map((r) => untrack(() => r.status())).find((s) => s.state === 'error')

  // Suspense's behavior depends on whether we're in a streaming render.
  // Static SSR (renderToString): just emit fallback or children
  // synchronously. Streaming SSR (renderToStream): emit markers + register
  // a continuation that fires when resources resolve.
  const renderForStream = (ctx: StreamCtx): string => {
    // All resources already ready: emit children directly, no marker.
    if (allReady()) {
      const v = renderChildren()
      return v.toHtml?.() ?? ''
    }
    // requireJs:false — streaming opt-out. The renderer awaits this
    // boundary BEFORE flushing the shell; the inline:N sentinel gets
    // string-replaced by the resolved content.
    if (!requireJs) {
      const id = nextSuspenseId()
      ctx.pending.push({
        id,
        resources: props.on,
        render: () => {
          const e = anyError()
          if (e !== undefined) return props.fallback.toHtml?.() ?? ''
          return renderChildren().toHtml?.() ?? ''
        },
      })
      return `<!--inline:${id}-->`
    }
    // Standard streaming path: fallback + comment-marker boundary.
    const id = nextSuspenseId()
    const fallbackHtml = props.fallback.toHtml?.() ?? ''
    ctx.pending.push({
      id,
      resources: props.on,
      render: () => {
        const e = anyError()
        if (e !== undefined) return props.fallback.toHtml?.() ?? ''
        // After resolve, harvest hydration values from each resource.
        for (const r of props.on) {
          const key = r.hydrationKey()
          if (key === undefined) continue
          const s = untrack(() => r.status())
          if (s.state === 'ready') {
            ctx.hydrate.set(key, s.value)
          }
        }
        return renderChildren().toHtml?.() ?? ''
      },
    })
    return `<!--p:${id}--><template id="pl-${id}"></template>${fallbackHtml}<!--/p:${id}-->`
  }

  return {
    __isSuspense: true,
    toHtml: () => {
      // If a streaming render is active, route to the marker-emitting
      // path; otherwise fall back to synchronous fallback-or-children.
      if (currentStreamCtx !== null) {
        return renderForStream(currentStreamCtx)
      }
      if (anyError()) return props.fallback.toHtml?.() ?? ''
      if (!allReady()) return props.fallback.toHtml?.() ?? ''
      const v = renderChildren()
      return v.toHtml?.() ?? ''
    },
    // Kept for the `viewToStreamHtml` helper's type-narrowing path. Same
    // semantics as toHtml when streaming.
    toStream: (ctx) => renderForStream(ctx),
    mount: (parent, anchor) => {
      // Client-side mount: just delegate to children (suspense is a
      // server-side concept; on the client the resources hydrate-or-fetch
      // and components react via their normal `status()` reads).
      const v = renderChildren()
      return v.mount(parent, anchor)
    },
    hydrate: (slot) => {
      const v = renderChildren()
      return v.hydrate?.(slot) ?? (() => {})
    },
  }
}

// JSX-friendly wrapper around suspense(). The internal `suspense()`
// requires `children: () => Child` (a thunk) because the children
// re-evaluate after resources resolve. JSX naturally produces View or
// View[] children via `children` prop; this wrapper wraps the View
// children in a thunk for you so:
//
//     <Suspense fallback={<Skeleton/>} on={[r]}>
//       <PostBody />
//     </Suspense>
//
// works without the function-as-children dance. If you DO need
// per-render reactivity in children (re-evaluate on resolve to read
// `r.read()`), pass a function explicitly:
//
//     <Suspense fallback={<Skeleton/>} on={[r]}>
//       {() => <span>{r.read()}</span>}
//     </Suspense>
//
// The wrapper handles both: if children is a function, it's used
// as-is; otherwise the children are wrapped in `() => children`.

export interface SuspenseJSXProps {
  /** Rendered while `on` resources are pending. */
  fallback: View
  /** Resources to wait for. Suspense suspends until ALL resolve. */
  on: Resource<unknown>[]
  /** Children to render once resources resolve. Pass a function for
   *  reactive re-evaluation; otherwise a static View works. */
  children: View | (() => Child)
  /** When `false`, the renderer waits synchronously for resources
   *  before flushing. Default: `true` (streaming). */
  requireJs?: boolean
}

function _Suspense(props: SuspenseJSXProps): View {
  const childrenFn: () => Child =
    typeof props.children === 'function' ? props.children : () => props.children
  return suspense({
    fallback: props.fallback,
    on: props.on,
    children: childrenFn,
    ...(props.requireJs !== undefined ? { requireJs: props.requireJs } : {}),
  })
}

/**
 * Carries the `'suspense'` effect brand (T8-A; ADR 0030). A `view()`
 * body that returns JSX containing `<Suspense>` reading an unresolved
 * resource gets promoted to L3 (island+stream) — the L2 island
 * runtime ships AND the per-suspense streaming wiring is attached.
 */
export const Suspense: typeof _Suspense & EffectBranded<'suspense'> = _Suspense

// Walk a view's `toStream` if it has one (suspense), else fall back to
// `toHtml`. Static elements implement only `toHtml`; the wrapping suspense
// is the thing that knows about streaming.
function viewToStreamHtml(view: View, ctx: StreamCtx): string {
  const maybeSuspense = view as Partial<{ __isSuspense: true; toStream(ctx: StreamCtx): string }>
  if (maybeSuspense.__isSuspense && maybeSuspense.toStream) {
    return maybeSuspense.toStream(ctx)
  }
  // For non-suspense views, render via toHtml. Children that contain
  // suspense() are still handled because suspense's toHtml falls back
  // to fallback-or-children synchronously (see toHtml above) — meaning
  // a suspense inside a non-streaming render becomes a no-stream sync
  // render, which is the correct behavior for static-build use cases.
  // For a TRUE in-tree suspense walk inside a streaming render, the
  // user should place suspense() at the level they want streamed; the
  // renderer reaches it via toHtml's recursion through children.
  return view.toHtml?.() ?? ''
}

// ===== renderToStream — streaming SSR with resource() suspension =====

export interface RenderToStreamOptions {
  /** Same shape as handler()'s document option — wraps the body fragment. */
  document?: boolean | ((body: string) => string)
  /**
   * Per-request CSP script nonce. When set, every inline `<script>` the
   * renderer emits (the `__place` runtime + suspense swap chunks) gets
   * `nonce="${nonce}"`. The same nonce must be added to the response's
   * CSP `script-src` (use `generateScriptNonce()` once and pass the
   * value to both `renderToStream` and `renderSecurityHeaders`).
   *
   * Without a nonce, scripts are emitted without the attribute and rely
   * on `'unsafe-inline'` in the CSP — fine for development but rejected
   * by strict-CSP deployments.
   */
  scriptNonce?: string
}

const DEFAULT_DOC_SHELL = (body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${body}</body></html>`

/**
 * Render a View to a streamed Response body. The shell flushes
 * immediately; pending suspense boundaries hold the connection open
 * until their resources resolve, at which point a swap chunk is
 * appended (`<template id="c-N">…</template><script>__place.swap(N)</script>`).
 *
 * If the View tree has no `suspense()` boundaries, this emits one
 * chunk and closes — equivalent to `renderToString` wrapped in a
 * stream.
 */
export function renderToStream(
  view: View,
  options?: RenderToStreamOptions,
): ReadableStream<Uint8Array> {
  const shell =
    options?.document === false
      ? null
      : typeof options?.document === 'function'
        ? options.document
        : DEFAULT_DOC_SHELL
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        resetHydrationSeq()
        resetSuspenseSeq()
        const ctx = makeStreamCtx()
        // Set the module-level streaming context so any `suspense()`
        // anywhere in the View tree (including nested inside elements)
        // routes to the marker-emit path. Cleared in finally so static
        // renders after streaming aren't accidentally captured.
        currentStreamCtx = ctx
        let body: string
        try {
          // Initial render — collects pending boundaries + emits markers.
          // We just call view.toHtml() because all element factories
          // recursively traverse children via toHtml; suspense's toHtml
          // checks currentStreamCtx and switches behavior.
          body = view.toHtml?.() ?? viewToStreamHtml(view, ctx)
        } finally {
          currentStreamCtx = null
        }

        // Resolve any `requireJs:false` boundaries before flushing — they
        // need their content inlined into the shell, not streamed.
        const inlineBoundaries = ctx.pending.filter((b) => body.includes(`<!--inline:${b.id}-->`))
        if (inlineBoundaries.length > 0) {
          for (const b of inlineBoundaries) {
            try {
              await Promise.all(b.resources.map((r) => waitForResource(r)))
            } catch {
              // The boundary's render() handles error → fallback; nothing
              // for us to do here.
            }
            const rendered = b.render()
            body = body.replace(`<!--inline:${b.id}-->`, rendered)
          }
        }

        // Streaming boundaries (the ones we'll swap in later). Compute
        // upfront so we know whether to inject the inline runtime.
        const streaming = ctx.pending.filter((b) => !inlineBoundaries.includes(b))

        // Build the nonce attribute fragment once. Empty string when
        // no nonce is configured — those deployments rely on
        // 'unsafe-inline' or aren't streaming under CSP.
        const nonceAttr = options?.scriptNonce
          ? ` nonce="${escapeHtmlAttrFull(options.scriptNonce)}"`
          : ''

        // Inject the inline runtime at the start of body when there are
        // streaming boundaries to swap. Plain <script> (NOT module) so
        // it runs synchronously as parsed — guarantees __place.swap is
        // defined before any swap chunks arrive.
        if (streaming.length > 0) {
          body = `<script${nonceAttr}>${PLACE_RUNTIME}</script>${body}`
        }

        // Flush the shell. Chunk the initial HTML into ~16KB pieces so
        // the browser sees bytes incrementally — head + opening body
        // tags arrive in the first frame, browser starts parsing
        // CSS/scripts immediately, body content arrives in subsequent
        // frames. Reduces perceived TTFB on larger pages.
        //
        // True per-element streaming (yield per <tag>) would only help
        // if rendering itself were async; ours is synchronous string
        // concat. Chunking captures most of the perceptible benefit
        // without changing the View contract.
        const initialHtml = shell ? shell(body) : body
        const initialBytes = encoder.encode(initialHtml)
        const CHUNK_SIZE = 16 * 1024
        if (initialBytes.byteLength <= CHUNK_SIZE) {
          controller.enqueue(initialBytes)
        } else {
          for (let i = 0; i < initialBytes.byteLength; i += CHUNK_SIZE) {
            const end = Math.min(i + CHUNK_SIZE, initialBytes.byteLength)
            controller.enqueue(initialBytes.subarray(i, end))
          }
        }
        if (streaming.length > 0) {
          await Promise.all(
            streaming.map(async (b) => {
              try {
                await Promise.all(b.resources.map((r) => waitForResource(r)))
              } catch {
                // Render-time will fall back; no extra handling.
              }
              const rendered = b.render()
              const hydrationScript = emitHydrationCache(ctx.hydrate, nonceAttr)
              ctx.hydrate.clear()
              const chunk =
                `<template id="c-${b.id}">${rendered}</template>` +
                `${hydrationScript}<script${nonceAttr}>__place.swap(${b.id})</script>`
              controller.enqueue(encoder.encode(chunk))
            }),
          )
        }
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    },
  })
}

// Emit a `<script>__place.r[key]=…</script>` chunk for the resources
// that have resolved since the last drain. Devalue is CSP-clean and
// handles Date/Map/Set/cycles. The values are escaped so a `</script>`
// in the data can't close the tag prematurely. The `nonceAttr` is the
// pre-built ` nonce="..."` fragment (may be empty string).
function emitHydrationCache(values: Map<string, unknown>, nonceAttr = ''): string {
  if (values.size === 0) return ''
  const parts: string[] = []
  for (const [key, value] of values) {
    const encoded = devalueStringify(value)
    // Escape closing-tag sequences that JSON might contain.
    const safeEncoded = encoded.replace(/<\//g, '<\\/')
    const safeKey = key.replace(/[\\']/g, (c) => `\\${c}`)
    parts.push(`__place.r['${safeKey}']=JSON.parse(${JSON.stringify(safeEncoded)})`)
  }
  return `<script${nonceAttr}>${parts.join(';')};</script>`
}

// Subscribe-and-wait for a resource. Returns when status is 'ready' OR
// 'error'. The renderer awaits these in parallel during the drain phase.
function waitForResource(r: Resource<unknown>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | null = null
    let settled = false
    const dispose = (): void => {
      if (stop) {
        const s = stop
        stop = null
        s()
      }
    }
    // The watch reads `r.status()` reactively (no untrack) so it re-fires
    // when the resource transitions out of 'loading'. Once we resolve or
    // reject, we tear down via queueMicrotask to avoid disposing a watch
    // from inside its own first run.
    stop = watch(() => {
      const s = r.status()
      if (settled) return
      if (s.state === 'ready') {
        settled = true
        resolve()
        queueMicrotask(dispose)
      } else if (s.state === 'error') {
        settled = true
        reject(s.error)
        queueMicrotask(dispose)
      }
    })
  })
}

// ===== Static — opt out of hydration for a subtree =====
//
// Wrap a subtree that's purely visual (no event handlers, no reactive
// bindings) to skip hydration's recursion + listener-attach work. The
// DOM stays exactly as the server rendered it; no event listeners get
// attached, no watches get created.
//
//   <Static>
//     <header>...static page header...</header>
//   </Static>
//   <Counter />  {/* this DOES get hydrated */}
//
// Why this matters:
//   - Faster hydration on mostly-static pages — no per-element walk
//     into the static subtree
//   - Cheaper memory: no event listeners + watches for content that
//     would never use them
//   - Astro-style "islands of interactivity" without a build pipeline
//     or magic file convention. Default-hydrate, opt-out via Static —
//     simpler than React's "everything hydrates by default" + the new
//     `'use client'` magic-string boundary marker.
//
// What `<Static>` does NOT do:
//   - It still emits the children's HTML on the server (SSR works)
//   - It does NOT remove children from the View tree on the client —
//     the View is still constructed; only `hydrate()` skips recursion
//   - It does NOT prevent reactive children inside from re-rendering
//     on `mount` (used in CSR-only contexts) — `Static` is a hydration
//     opt-out, not a "this is static forever" marker

export const Static = (props: { children?: Children }): View => {
  const inner = Fragment(props)
  return {
    // SSR: identical to children. Static is a hydration-only marker.
    toHtml: () => inner.toHtml?.() ?? '',
    // CSR mount: identical to children. Static doesn't change runtime
    // mount behavior; it ONLY changes hydrate.
    mount: (parent, anchor) => inner.mount(parent, anchor),
    // Hydrate: consume one slot per element child but DO NOT recurse.
    // The SSR'd DOM stays exactly as rendered — no listener attach,
    // no watches, no content swap.
    hydrate(slot) {
      if (props.children !== undefined) {
        const list: Child[] = Array.isArray(props.children)
          ? (props.children as Child[])
          : [props.children as Child]
        for (const child of list) {
          if (child != null && typeof child === 'object' && 'mount' in child) {
            // Consume one element from the parent's slot. We don't
            // recurse — the SSR'd subtree stays untouched. Its data-h
            // markers stay too (cosmetic; invisible to users).
            slot.nextElement()
          }
        }
      }
      return () => {}
    },
  }
}

// ===== hydrate — client adoption of server-rendered DOM =====
//
// The companion to `renderToString`/`renderToStream`: on the client,
// instead of rebuilding the DOM via `mount` (which would briefly clear
// the SSR'd content and re-create it), `hydrate` walks the same View
// tree and adopts the existing DOM nodes — attaching event listeners
// and reactive watches without recreating the structure.
//
// Match contract: server's `data-h="<seq>"` markers + DFS order. Client
// walks View tree in the same DFS order; each `el()` View consumes the
// next element from a sibling cursor and verifies the tag matches.
// On mismatch, throws with the offending tag for fast debugging.
//
// State strategy — V0:
//   - URL-driven state (urlState) needs no serialization. Both sides
//     read the URL on mount and arrive at the same value. This is the
//     recommended pattern.
//   - Local component state (`state(0)`) defaulting identically on
//     both sides also matches.
//   - For diverging state (random initial values, post-mutation state),
//     a future cut adds a `<script type="place/state">` payload that
//     the client deserializes before hydrate. Not in V0.
//
// Children handling — V0:
//   - Element children are matched + adopted by their own `hydrate`.
//   - Text / function children are CLEARED and re-mounted fresh inside
//     the adopted parent. Cheap (text nodes only) and avoids the
//     adjacent-text-children boundary problem (the browser merges
//     `'hi, ' + name + '!'` into one text node and we can't recover
//     boundaries without explicit markers).
//   - Trade-off: brief flicker on text content for elements with
//     reactive children. Element structure + listeners are preserved,
//     so layout doesn't shift and clicks during hydration still work.
//   - Future: emit invisible boundary markers between adjacent text
//     children to enable per-child adoption.

// `hydrate` lives in `./_client-mount.ts` and is re-exported next to
// `mount` (see the re-export block above for the rationale).
