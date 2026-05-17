// Inline page runtime for interaction-strategy islands whose bundles
// are pre-fetched via `<link rel="modulepreload">` but **not yet
// executed**. The framework emits this script (always, when islands
// mode is active) alongside `placeSpaNav` and `placeTabs`. Cost: ~600
// bytes raw, ~350 bytes gzipped.
//
// **Contract**
//
//   - The renderPage SSR emits per-page modulepreload hints for every
//     island whose page-instances all declared `client="interaction"`.
//     The hints carry no nonce + don't execute (modulepreload is fetch-
//     only). The bundle url(s) ride along on `data-place-deferred-url`
//     attributes attached to the matching markers.
//
//   - This runtime walks `[data-view="island"][data-place-deferred-url]`,
//     attaches lightweight `pointerenter` / `focusin` / `click`
//     listeners (passive, once-per-marker), and on first trigger
//     appends a `<script type="module" src="…">` to body. The script's
//     fetch is an instant cache hit (browser already preloaded it via
//     the modulepreload), so first interaction has zero added latency
//     even on slow networks.
//
//   - The loaded bundle is the same per-island auto-mount wrapper any
//     other island uses. It scans `[data-view-id="<name>"]` markers
//     and hydrates them — no special-case "deferred" code path inside
//     the bundle. The deferral is purely a fetch-strategy concern.
//
// **SPA navigation.** `__spa_nav.ts` dispatches `place:nav` after each
// `<main>` swap. We re-scan on that event so deferred islands on the
// destination page get their listeners wired up.
//
// **Re-entry safety.** The flag-on-window guard prevents double-
// installation if the runtime is emitted twice (e.g. inline + a
// hot-reloaded copy). Each marker is processed at most once via a
// `dataset.placeDeferredHooked = '1'` sentinel.
//
// **Stays leaf.** No imports from index.ts or any other framework
// module. The script is a string returned by `placeDeferredIslands()`
// and emitted inline by renderPage — never imported from a wrapper
// or user code, so no chunk-graph leakage concern.

/**
 * Inline JS source for the deferred-islands runtime. Returned as a
 * string so renderPage can wrap it in `<script>` with the per-
 * response nonce.
 *
 * The source is hand-written (not transpiled) ES5-flavoured JS so it
 * runs in every modern browser without bundling. No template
 * literals, no arrow functions, no optional chaining — small,
 * portable, zero-tooling.
 */
export function placeDeferredIslands(): string {
  return (
    '(function(){' +
    'if(window.__placeDeferredIslands===1)return;' +
    'window.__placeDeferredIslands=1;' +
    'var ATTR="data-place-deferred-url";' +
    'var TRIGGERS=["pointerenter","focusin","click","touchstart"];' +
    'function load(el){' +
    'var url=el.getAttribute(ATTR);if(!url)return;' +
    // **Promote strategy to `load` BEFORE the script executes.** The
    // user's interaction (the one that just fired) IS the interaction
    // the wrapper would have hydrated on; without this flip the
    // wrapper sees `data-view-strategy="interaction"` and waits for
    // ANOTHER click/hover, effectively making the first user
    // interaction a no-op. Setting `data-view-strategy="load"` makes
    // the wrapper's `scanAndSchedule` hydrate this marker
    // immediately when the script runs.
    'el.setAttribute("data-view-strategy","load");' +
    'var s=document.createElement("script");' +
    's.type="module";s.src=url;' +
    'document.body.appendChild(s);' +
    'el.removeAttribute(ATTR);' + // single-shot — drop the attr so a re-scan ignores us
    '}' +
    'function hook(el){' +
    'if(el.dataset.placeDeferredHooked==="1")return;' +
    'el.dataset.placeDeferredHooked="1";' +
    'var fire=function(){' +
    'for(var i=0;i<TRIGGERS.length;i++)el.removeEventListener(TRIGGERS[i],fire);' +
    'load(el);' +
    '};' +
    'for(var i=0;i<TRIGGERS.length;i++){' +
    'el.addEventListener(TRIGGERS[i],fire,{passive:true,once:true});' +
    '}' +
    '}' +
    'function scan(){' +
    'var nodes=document.querySelectorAll("["+ATTR+"]");' +
    'for(var i=0;i<nodes.length;i++)hook(nodes[i]);' +
    '}' +
    'scan();' +
    'window.addEventListener("place:nav",scan);' +
    '})();'
  )
}
