// Inline page runtime for the framework's viewport reactivity
// primitive. Emitted once per page in islands mode (alongside
// `placeEarly`, `placeSpaNav`, `placeTabs`, `placeHmr`,
// `placeDeferredIslands`, `placeCodeBlockCopy`). ~350 bytes raw.
//
// **What it does**
//
//   - On load, writes initial `width`, `height`,
//     `prefersReducedMotion`, `prefersDark` into a single global
//     bucket `window.__placeViewport` (an object the framework's
//     boot.ts reads on hydrate to seed the reactive state cells).
//   - Listens to `window.resize` (rAF-throttled — coalesces the
//     initial-layout cascade and the rapid drag-resize stream) and
//     dispatches a `place:viewport` CustomEvent on `window` with the
//     fresh values.
//   - Listens to `(prefers-reduced-motion)` and
//     `(prefers-color-scheme: dark)` matchMedia events with the same
//     dispatch shape.
//
// **Re-entry safety**: `window.__placeViewport === 1` guard prevents
// double-installation on SPA-nav.
//
// **Why this isn't an island**: every page needs viewport awareness
// whether it has interactive islands or not; an island bundle would
// be ~3 KB gzipped for what reduces to ~250 bytes inline.
//
// **Why a CustomEvent rather than direct state writes**: the runtime
// stays leaf (zero imports), so it CAN'T reach the state cells
// directly without coupling to module-level state in the framework.
// Listening from `viewport.ts` keeps the boundary clean and lets
// non-framework consumers also subscribe to the same channel.

/**
 * Inline JS source for the viewport runtime. Returned as a string so
 * `renderPage` can wrap it in `<script>` with the per-response nonce.
 * Hand-written ES5 — no template literals, no arrow funcs, no
 * optional chaining — runs everywhere without bundling.
 */
export function placeViewport(): string {
  return (
    '(function(){' +
    'if(window.__placeViewport===1)return;' +
    'window.__placeViewport=1;' +
    // Bucket holds latest values so any late-mounting consumer can
    // read the current state synchronously without waiting for an
    // event. `boot.ts` reads this on initial hydration too.
    'var b={w:window.innerWidth,h:window.innerHeight,' +
    'rm:window.matchMedia("(prefers-reduced-motion: reduce)").matches,' +
    'd:window.matchMedia("(prefers-color-scheme: dark)").matches};' +
    'window.__placeViewportState=b;' +
    'function emit(){window.dispatchEvent(new CustomEvent("place:viewport",{detail:b}));}' +
    // rAF throttle: coalesces a burst of resize events (browsers
    // fire dozens during drag) into one dispatch per frame.
    'var pending=false;' +
    'function onResize(){' +
    'if(pending)return;pending=true;' +
    'requestAnimationFrame(function(){' +
    'pending=false;' +
    'b.w=window.innerWidth;b.h=window.innerHeight;emit();' +
    '});' +
    '}' +
    'window.addEventListener("resize",onResize,{passive:true});' +
    'var mqm=window.matchMedia("(prefers-reduced-motion: reduce)");' +
    'var mqd=window.matchMedia("(prefers-color-scheme: dark)");' +
    'function onMq(){b.rm=mqm.matches;b.d=mqd.matches;emit();}' +
    'mqm.addEventListener("change",onMq);' +
    'mqd.addEventListener("change",onMq);' +
    // Emit once after install so any consumer waiting on the event
    // gets the initial values without having to read the bucket
    // manually. (Consumers can also read window.__placeViewportState
    // for synchronous initial reads.)
    'emit();' +
    '})();'
  )
}
