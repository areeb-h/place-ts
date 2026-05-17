// Inline SPA-navigation runtime for islands-only apps.
//
// Background: when an app uses `islands` (T5-D phase 2) and skips
// `clientEntry` (no full-page hydration), no JavaScript intercepts
// link clicks by default. Every `<Link>` falls through to native
// anchor-follow → full page reload. This runtime restores SPA-style
// navigation:
//
//   1. Intercept `<a data-place-link>` clicks
//   2. Fetch the destination HTML
//   3. Swap `<main>` content (preserve header/footer/sidebar)
//   4. Update history + scroll
//   5. Dispatch `place:nav` so:
//        - pathRouter's listener updates RouterCap.path()
//        - each island's auto-mount wrapper re-scans for new markers
//   6. For browser back/forward (real popstate), fetch + swap too
//   7. Same-page `#hash` clicks: explicitly `scrollIntoView()` the
//      target. Native browser behaviour for in-page anchors is
//      unreliable when `<main>` is a non-root scroll container (as in
//      docs sites that pin a sticky header). The explicit handler
//      guarantees ToC + jump-link clicks always move the content.
//
// Size: ~1.4 KB raw / ~700 B gzipped. Inline (non-module) so it runs
// synchronously before any island bundle loads.
//
// **Default is instant.** Cross-fade page transitions are an opt-in:
// pass `viewTransitions: true` to `app({...})` / `serve({...})` and
// the runtime wraps the `<main>` swap in `document.startViewTransition()`.
// The unconditional view-transition wrap that previously sat on this
// codepath made every navigation feel laggy compared with the actual
// 1–5 ms fetch + parse + swap; the user's bar is "faster than Next 16",
// and the default cross-fade defeated that on every click.

export interface PlaceSpaNavOptions {
  /**
   * Wrap the `<main>` swap in `document.startViewTransition()` when
   * the browser supports it. Adds a ~250 ms cross-fade by default.
   * Set `false` (the default) for instant nav — the actual swap is
   * sub-frame-budget on the measured docs site.
   */
  readonly viewTransitions?: boolean
}

/**
 * Build the inline SPA-navigation runtime as a single IIFE string,
 * baking the supplied options into the generated source. `serve()`
 * injects this via `<script nonce>${placeSpaNav({…})}</script>` on
 * every page when `islands` (or `islandsDir`) is configured.
 *
 * The function shape (vs. the previous static `PLACE_SPA_NAV`
 * constant) is what lets per-app config like `viewTransitions` bake
 * cleanly into the bytes the browser parses — no `window.__place_spa_*`
 * global to read at runtime, no extra <script> tag to pre-seed config.
 */
export function placeSpaNav(options: PlaceSpaNavOptions = {}): string {
  const ENABLE_VT = options.viewTransitions === true
  return `(function(){
if(window.__place_spa)return;window.__place_spa=1;
var ENABLE_VT=${ENABLE_VT ? 'true' : 'false'};
function shouldIntercept(e,a){
  if(e.defaultPrevented)return false;
  if(e.button!==0)return false;
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return false;
  if(a.target&&a.target!=='_self')return false;
  var u;try{u=new URL(a.href);}catch(_){return false;}
  if(u.origin!==location.origin)return false;
  // Same-page #anchor — handled by the explicit hash branch in the
  // click listener (see below); skip cross-document intercept.
  if(u.pathname===location.pathname&&u.search===location.search&&u.hash)return false;
  return true;
}
// Explicitly scroll a same-page anchor target into view. Native
// browser anchor-scroll is inconsistent inside non-root scroll
// containers (e.g. the docs site's <main class="overflow-y-auto">).
// scrollIntoView walks the ancestor chain so a heading inside an
// arbitrarily-deep scroll context still ends up visible; the CSS
// 'scroll-margin-top' on the target absorbs sticky-header overlap.
function scrollHash(hash){
  if(!hash||hash.charAt(0)!=='#')return false;
  var id;try{id=decodeURIComponent(hash.slice(1));}catch(_){id=hash.slice(1);}
  if(!id)return false;
  var el=document.getElementById(id);
  if(!el){
    var named=document.getElementsByName(id);
    if(named&&named.length)el=named[0];
  }
  if(!el)return false;
  el.scrollIntoView({block:'start'});
  return true;
}
var inflight=null;
// Hard cap on response size (8 MiB). Defends against an attacker (or
// misconfigured server) serving an oversize body that would exhaust
// client memory parsing. Real docs pages are well under 1 MiB.
var MAX_BYTES=8*1024*1024;
// Hard timeout per nav. 10s is generous for the worst-case page;
// beyond that the user is better off seeing a hard reload.
var TIMEOUT_MS=10000;
function navigate(url,push){
  if(inflight)inflight.abort();
  var ctl=new AbortController();inflight=ctl;
  var timer=setTimeout(function(){ctl.abort();},TIMEOUT_MS);
  fetch(url,{
    headers:{'Accept':'text/html'},
    credentials:'same-origin',
    redirect:'follow',
    signal:ctl.signal
  })
    .then(function(r){
      clearTimeout(timer);
      if(!r.ok)throw new Error('http '+r.status);
      // Same-origin guard: a redirect to a different origin would
      // bypass our intercept policy. Fall back to full nav.
      try{
        var responseUrl=new URL(r.url);
        if(responseUrl.origin!==location.origin)throw new Error('cross-origin redirect');
      }catch(_){throw new Error('bad response URL');}
      // Content-type check: only swap text/html responses. Anything
      // else falls back to full nav so the browser can handle it
      // (downloads, JSON, etc.).
      var ct=r.headers.get('content-type')||'';
      if(ct.indexOf('text/html')!==0)throw new Error('not html');
      return r.text();
    })
    .then(function(html){
      if(ctl.signal.aborted)return;
      if(html.length>MAX_BYTES)throw new Error('response too large');
      inflight=null;
      var doc=new DOMParser().parseFromString(html,'text/html');
      var newMain=doc.querySelector('main');
      var oldMain=document.querySelector('main');
      if(!newMain||!oldMain){location.href=url;return;}
      if(doc.title)document.title=doc.title;
      // Same className-on-SVG hazard as setAttr(): documentElement is
      // <html> for HTML pages but can be <svg> for standalone SVG docs.
      // Use setAttribute('class', …) which works on both.
      var newCls=doc.documentElement.getAttribute('class')||'';
      if(newCls!==(document.documentElement.getAttribute('class')||''))document.documentElement.setAttribute('class',newCls);
      var swap=function(){oldMain.replaceWith(newMain);};
      // Default is INSTANT (just swap). Opt into View Transitions via
      // \`viewTransitions: true\` on \`app()\` / \`serve()\` — the wrap
      // costs a frame and adds a ~250 ms cross-fade, which defeated
      // the framework's actual sub-5 ms swap perf.
      if(ENABLE_VT&&document.startViewTransition){document.startViewTransition(swap);}else{swap();}
      // **Island-script reconciliation.** Per-route bundle splitting +
      // per-page \`<script src="/islands/*.js">\` emission means the
      // destination page may need scripts the originating page didn't
      // load. They live as siblings of <main> (end of body), so the
      // main-swap doesn't bring them in. Browsers also won't execute
      // <script> tags that came in via DOMParser — they're inert. We
      // reconcile: walk the destination doc's <script src=…> set,
      // compare to what's already in the live document, and append
      // any missing ones as real <script> elements (idempotent — same
      // src is module-cache deduped by the browser).
      var liveSrcs=Object.create(null);
      var existing=document.querySelectorAll('script[src]');
      for(var k=0;k<existing.length;k++){liveSrcs[existing[k].getAttribute('src')||'']=1;}
      var destScripts=doc.querySelectorAll('script[src]');
      for(var s=0;s<destScripts.length;s++){
        var ds=destScripts[s];
        var src=ds.getAttribute('src')||'';
        if(!src||liveSrcs[src])continue;
        var fresh=document.createElement('script');
        fresh.src=src;
        var t=ds.getAttribute('type');if(t)fresh.type=t;
        // **Don't copy the destination's CSP nonce.** Each request gets a
        // fresh nonce; the destination doc's nonce is foreign to the live
        // document's CSP. Same-origin scripts load under \`script-src 'self'\`
        // (always emitted by the framework's strict CSP) without a nonce,
        // so omitting it keeps the reconciliation working under both
        // permissive and strict policies. SRI integrity stays — pinned to
        // the bundle bytes regardless of nonce.
        var ig=ds.getAttribute('integrity');if(ig)fresh.setAttribute('integrity',ig);
        var co=ds.getAttribute('crossorigin');if(co)fresh.setAttribute('crossorigin',co);
        if(ds.hasAttribute('defer'))fresh.defer=true;
        if(ds.hasAttribute('async'))fresh.async=true;
        document.body.appendChild(fresh);
        liveSrcs[src]=1;
      }
      if(push){try{history.pushState(null,'',url);}catch(_){}}
      // T6-C: universal aria-current updater. Persistent chrome
      // (sidebar, breadcrumbs, tabs) renders ONCE at SSR; its <Link>
      // children compute aria-current="page" against that initial path
      // and bake it into the DOM. After SPA nav swaps <main>, the
      // chrome's links are stale. Walk every framework link in the
      // *whole document* and re-sync aria-current against the new path.
      // Zero per-app code, zero new island — the framework keeps active
      // state coherent across SPA nav by construction.
      var here=location.pathname;
      var links=document.querySelectorAll('a[data-place-link]');
      for(var i=0;i<links.length;i++){
        var a=links[i];
        try{
          var p=new URL(a.href).pathname;
          if(p===here)a.setAttribute('aria-current','page');
          else if(a.getAttribute('aria-current')==='page')a.removeAttribute('aria-current');
        }catch(_){}
      }
      // Tell the router + islands. pathRouter listens for 'place:nav'
      // and updates RouterCap.path() so subscribed islands re-render.
      // Each island's auto-mount wrapper listens too and re-scans for
      // new markers in the swapped <main>.
      window.dispatchEvent(new CustomEvent('place:nav',{detail:{url:url}}));
      // Land at the top of the destination, unless the URL has a hash
      // in which case the destination is that anchor (handled below).
      if(typeof url==='string'){
        var hashIdx=url.indexOf('#');
        if(hashIdx>=0){
          // Defer to give the swapped DOM a tick to settle before scroll.
          var anchor=url.slice(hashIdx);
          setTimeout(function(){scrollHash(anchor);},0);
          return;
        }
      }
      window.scrollTo(0,0);
    })
    .catch(function(err){
      clearTimeout(timer);
      inflight=null;
      if(err&&err.name==='AbortError')return;
      // Hard fallback so the user can always navigate even if SPA breaks.
      location.href=url;
    });
}
document.addEventListener('click',function(e){
  var t=e.target;
  while(t&&t.nodeType===1&&t.tagName!=='A')t=t.parentNode;
  if(!t||t.tagName!=='A')return;
  // Same-page hash click (ToC entries, jump links): explicit scroll
  // so the page navigates reliably even when <main> is a non-root
  // scroll container. Update history.hash so back/forward still works
  // without re-fetching. Skip if the click is modified (cmd/ctrl/etc.)
  // so users can still open in new tabs.
  if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){
    var hrefRaw=t.getAttribute('href');
    if(hrefRaw){
      var u;try{u=new URL(t.href);}catch(_){u=null;}
      if(u&&u.origin===location.origin&&u.pathname===location.pathname&&u.search===location.search&&u.hash){
        e.preventDefault();
        if(scrollHash(u.hash)){
          if(u.hash!==location.hash){
            try{history.pushState(null,'',u.hash);}catch(_){location.hash=u.hash;}
          }
        }
        return;
      }
    }
  }
  if(!t.hasAttribute('data-place-link'))return;
  if(!shouldIntercept(e,t))return;
  e.preventDefault();
  navigate(t.href,true);
},true);
// Browser back/forward — refetch + swap (URL already updated by browser).
window.addEventListener('popstate',function(){
  navigate(location.pathname+location.search+location.hash,false);
});
// Programmatic navigation hook. \`router.navigate('/x')\` (and any other
// code that wants a SPA-style content swap without a real link click)
// dispatches \`place:navigate\` on the window with \`{ url, replace }\`
// in detail. The runtime fetches + swaps + dispatches \`place:nav\`
// just like a link click. The runtime owns pushState — pairing the
// URL change with the content swap atomically (no "URL changed but
// content stale" gap, which was the search-palette result-click bug).
window.addEventListener('place:navigate',function(e){
  var detail=(e && e.detail)||{};
  var url=detail.url;
  if(typeof url!=='string')return;
  navigate(url,!detail.replace);
});
})();`
}

/**
 * Back-compat default: the previous default-true view-transition wrap
 * is now opt-in (see `placeSpaNav`). This constant remains for any
 * call site that imported the literal — it bakes in the new default
 * (instant, no fade).
 *
 * @deprecated Prefer `placeSpaNav({ viewTransitions })` so per-app
 * config flows into the generated source.
 */
export const PLACE_SPA_NAV: string = placeSpaNav()
