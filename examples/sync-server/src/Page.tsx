import type { View } from '@place/component'
import { state } from '@place/reactivity'

// A plain JSX component — same shape you'd write for the client.
// `renderToString(<Page name={…} now={…} />)` server-renders it; the
// browser bundle hydrates the same JSX against the SSR'd DOM. One
// source of truth for the markup, one mental model for SSR vs CSR.
//
// The counter is the hydration-canary: server renders count=0 in the
// markup; after hydrate() runs, clicking +1 makes it tick. If the
// page is purely SSR (no hydration), the button does nothing — that
// asymmetry is what proves hydration worked.
//
// Styling uses Tailwind classes. The classes are scanned out of this
// file by `tailwind()` at server startup (see home.page.tsx) and
// compiled into the inlined CSS shipped in the SSR'd <head>.

export interface PageProps {
  /** Display name. Both server and client read from `?name=`. */
  name: string
  /** Server's view of "now" — preserved across hydration via the load
   *  data script in the SSR'd HTML. */
  now: string
}

export function Page(props: PageProps): View {
  // Counter state lives in the View's closure. Server constructs Page,
  // calls toHtml (count=0 rendered as a number); client constructs Page,
  // calls hydrate (a fresh count=0 state, attached to the existing
  // button + reactive child).
  const count = state(0)
  return (
    <div class="min-h-screen bg-white p-8 font-sans text-sm leading-relaxed text-neutral-800">
      <div class="mx-auto max-w-2xl">
        <h1 class="text-2xl font-semibold text-neutral-900">hello, {props.name}</h1>
        <p class="mt-1 text-xs text-neutral-400">
          SSR'd at <span class="font-mono">{props.now}</span>
        </p>
        <div class="my-6 flex items-center gap-4">
          <button
            type="button"
            class="rounded border border-neutral-300 bg-neutral-50 px-3 py-1 font-inherit cursor-pointer hover:bg-neutral-200 active:bg-neutral-300"
            onClick={() => count.update((c: number) => c + 1)}
          >
            +1
          </button>
          <span class="font-mono text-lg">count: {() => count()}</span>
        </div>
        <p class="mt-8 text-xs leading-relaxed text-neutral-500">
          SSR rendered count=0. After hydration, the +1 button is interactive. Refresh the page and
          the count resets — proves the server doesn't carry client state. If the page didn't
          hydrate, +1 wouldn't fire.
        </p>
      </div>
    </div>
  )
}
