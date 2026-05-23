// Inline SPA-navigation runtime for islands-only apps.
//
// Background: in the islands model (no full-page hydration), no
// JavaScript intercepts link clicks by default. Every `<Link>` falls
// through to native anchor-follow → full page reload. This runtime
// restores SPA-style navigation:
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

import { minifyInline } from './utils/minify-inline.ts'

export interface PlaceSpaNavOptions {
  /**
   * Wrap the `<main>` swap in `document.startViewTransition()` when
   * the browser supports it. Adds a ~250 ms cross-fade by default.
   * Set `false` (the default) for instant nav — the actual swap is
   * sub-frame-budget on the measured docs site.
   */
  readonly viewTransitions?: boolean
  /**
   * Theme choice-name → `<html>` class map (e.g.
   * `{ dark: 'theme-dark', light: 'theme-light' }`). Used to PRESERVE
   * the user's live theme across a SPA `<html class>` swap.
   *
   * Without this, navigating to another page applies that page's
   * build-time-baked `<html>` class — which carries the DEFAULT
   * theme — and silently reverts the user's choice. The runtime
   * strips every mapped theme class from the destination's class and
   * re-adds the one matching the live `data-place-theme` choice.
   *
   * Empty (the default) when the app has no `theme` configured.
   */
  readonly themeClassMap?: Readonly<Record<string, string>>
  /**
   * Prefetch destination HTML on link hover / focus so the click
   * resolves with zero network wait. Default `true`.
   *
   * Prefetch requests are marked with an `X-Place-Prefetch: 1`
   * header — server `load()` sees `ctx.prefetch === true` and must
   * skip side effects (analytics, counters) while rendering the same
   * content. Set `false` for an app whose GET routes can't be made
   * speculation-safe; individual links opt out with `data-no-prefetch`.
   */
  readonly prefetch?: boolean
  /**
   * Hover-intent delay (ms) before a `pointerover` fires a prefetch.
   * Distinguishes "deliberate hover" from "mouse passing over while
   * scrolling / sweeping to another target." Default `65` (the
   * Quicklink / Astro / Next.js shared default).
   *
   * `pointerdown` / `focusin` prefetches always fire immediately —
   * those are explicit commitment signals. Set `0` to fire on every
   * pointerover with no delay.
   */
  readonly prefetchHoverDelayMs?: number
  /**
   * Soft cap on cached prefetch entries (per session). Default `24`.
   * When the cache reaches this many entries, the LEAST-RECENTLY-ADDED
   * entry is evicted to make room — its in-flight fetch is aborted
   * if still pending. Pre-0.10.5 the cap leaked into a permanent
   * shutoff after the 24th hover (counter never decremented). Now an
   * LRU eviction with proper size tracking.
   */
  readonly prefetchMax?: number
  /**
   * TTL for a cached prefetch entry (ms). Default `30_000`. After
   * this a click on the corresponding link refetches live so stale
   * data can't be served as the destination. The cache also sweeps
   * opportunistically — entries past TTL are dropped on the next
   * prefetch attempt, not only on navigate().
   */
  readonly prefetchTtlMs?: number
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
  const ENABLE_PREFETCH = options.prefetch !== false
  const themeClassMap = options.themeClassMap ?? {}
  // Coerce to safe positive integers. Negative / NaN inputs would
  // otherwise produce permanent shutoff (cap=0) or undefined sleeps.
  const hoverDelayMs = Math.max(0, Math.floor(options.prefetchHoverDelayMs ?? 65))
  const prefetchMax = Math.max(1, Math.floor(options.prefetchMax ?? 24))
  const prefetchTtlMs = Math.max(1000, Math.floor(options.prefetchTtlMs ?? 30000))
  return minifyInline(`(function(){
if(window.__place_spa)return;window.__place_spa=1;
var ENABLE_VT=${ENABLE_VT ? 'true' : 'false'};
var ENABLE_PREFETCH=${ENABLE_PREFETCH ? 'true' : 'false'};
var HOVER_DELAY_MS=${hoverDelayMs};
var PREFETCH_MAX=${prefetchMax};
var PREFETCH_TTL_MS=${prefetchTtlMs};
var THEME_CLASS_MAP=${JSON.stringify(themeClassMap)};
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
// Monotonic navigation token. A newer navigate() bumps it so a slower
// in-flight (or prefetched) response can never swap in late over a
// destination the user has since moved past.
var navSeq=0;
// **Prefetch cache** — url-key -> { at, p:Promise<string html> }.
// Warmed on link hover / focus so that by the time the user clicks,
// the destination HTML is already in hand and the swap waits on ZERO
// network — instant nav on a CDN regardless of edge-cache state.
//
// Correctness guarantees (so this is safe for dynamic / authed apps,
// not just static content):
//   - Every prefetch request carries the X-Place-Prefetch:1 header.
//     Server load() sees ctx.prefetch===true and MUST skip side
//     effects (analytics, view counts, logging) while rendering the
//     SAME content — a speculative load must not mutate state.
//   - priority:'low' — a prefetch never contends with the current
//     page's own resources. Zero perf regression on the page you're on.
//   - TTL — a cached entry older than PREFETCH_TTL_MS is discarded;
//     the click does a fresh fetch. Bounds staleness for live data.
//   - Redirected responses are NOT cached (an auth-expiry redirect to
//     /login must not be swapped in as the destination) — the click
//     re-fetches live and follows the redirect properly.
//   - Per-link data-no-prefetch opts a link out entirely; the whole
//     mechanism is gated on the ENABLE_PREFETCH app option.
// LRU-ordered prefetch cache. prefetchCache is the URL-key to entry
// map; prefetchOrder is the insertion order, used for eviction when
// the size reaches PREFETCH_MAX. Pre-0.10.5 tracked size via a
// monotonic counter that never decremented — after 24 hovers in a
// session the cap turned into a permanent shutoff. Now the actual
// cache size is the cap check (prefetchOrder.length), and removal
// sites (evictKey, TTL miss, error .catch) keep both structures
// consistent.
//
// Entry shape:
//   { at: Number      — Date.now() when the prefetch fired
//   , p: Promise<string> — resolves to the destination HTML
//   , ctl: AbortController — so an eviction can cancel the in-flight
//                            fetch instead of leaking the request to
//                            completion (wasted bandwidth).
//   }
var prefetchCache=Object.create(null);
var prefetchOrder=[];
// Canonical cache key for a URL — path + search, hash-stripped (a
// hash anchor targets the same document). Same key from click-href,
// popstate, and hover so warm hits actually hit.
function navKey(u){
  try{var p=new URL(u,location.href);return p.pathname+p.search;}catch(_){return u;}
}
// Validate a Response + resolve its HTML text. Shared by prefetch and
// the live fetch so both apply identical same-origin / content-type /
// size guards.
//
// Errors include the target URL + a one-line "what to try" hint so
// the user can act on them — anonymous "http 404" / "not html" alone
// is a known DX paper cut (fixed in 0.5.1).
function readHtml(r){
  var url=r.url||'';
  if(!r.ok)throw new Error('SPA nav: '+url+' returned HTTP '+r.status+' — check the route exists');
  try{
    if(new URL(r.url).origin!==location.origin)throw new Error('SPA nav: '+url+' redirected to a different origin — SPA nav only handles same-origin');
  }catch(_){throw new Error('SPA nav: '+url+' has an unparseable response URL');}
  if((r.headers.get('content-type')||'').indexOf('text/html')!==0)throw new Error('SPA nav: '+url+' returned non-HTML ('+(r.headers.get('content-type')||'no Content-Type')+') — falling back to full reload');
  return r.text().then(function(html){
    if(html.length>MAX_BYTES)throw new Error('SPA nav: '+url+' response exceeded '+MAX_BYTES+' bytes — falling back to full reload');
    return html;
  });
}
// Two paths normalise to the "same logical page" — used to classify
// redirects so a trailing-slash normaliser (Cloudflare Pages' default)
// is treated as a successful prefetch, while a real path change
// (auth-expiry -> /login) still aborts the cache.
function samePath(a,b){
  try{
    var pa=new URL(a,location.href).pathname.replace(/\\/+$/,'');
    var pb=new URL(b,location.href).pathname.replace(/\\/+$/,'');
    return pa===pb;
  }catch(_){return false;}
}
// Drop a single entry by key. Aborts the in-flight fetch (if any),
// removes from the order array and the cache map. Idempotent — calling
// twice on the same key after the first removal is a safe no-op.
function evictKey(k){
  var e=prefetchCache[k];
  if(!e)return;
  delete prefetchCache[k];
  for(var i=0;i<prefetchOrder.length;i++){
    if(prefetchOrder[i]===k){prefetchOrder.splice(i,1);break;}
  }
  if(e.ctl){try{e.ctl.abort();}catch(_){}}
}
// Opportunistic TTL sweep: scan from oldest end of the order array,
// dropping entries past TTL. Stops at the first non-stale entry — the
// array is insertion-ordered, so anything after a fresh entry is also
// fresh. Runs at the top of every prefetch() call.
function sweepStale(){
  var now=Date.now();
  while(prefetchOrder.length){
    var k=prefetchOrder[0];
    var e=prefetchCache[k];
    if(!e){prefetchOrder.shift();continue;}
    if(now-e.at<PREFETCH_TTL_MS)break;
    evictKey(k);
  }
}
// Warm the cache for a likely-next destination. No-ops when already
// cached, on a connection where speculation would be rude (Data Saver
// or 2g/slow-2g — burning the user's expensive bytes on a page they
// might never visit is the wrong default), or under heavy memory
// pressure (deviceMemory < 1 GB). When at cap, evicts the oldest
// entry to make room (LRU) instead of dropping the new prefetch — a
// stale hover from 5 minutes ago shouldn't block a fresh one.
function prefetch(url){
  sweepStale();
  var k=navKey(url);
  if(prefetchCache[k])return;
  var c=navigator.connection;
  if(c){
    if(c.saveData)return;
    var et=c.effectiveType;
    if(et==='slow-2g'||et==='2g')return;
  }
  if(typeof navigator.deviceMemory==='number'&&navigator.deviceMemory<1)return;
  if(prefetchOrder.length>=PREFETCH_MAX){
    evictKey(prefetchOrder[0]);
  }
  var ctl;try{ctl=new AbortController();}catch(_){ctl=null;}
  var fetchOpts={
    headers:{'Accept':'text/html','X-Place-Prefetch':'1'},
    credentials:'same-origin',
    redirect:'follow',
    priority:'low'
  };
  if(ctl)fetchOpts.signal=ctl.signal;
  var p=fetch(k,fetchOpts)
    .then(function(r){
      if(r.redirected && !samePath(k,r.url)){
        throw new Error('prefetch redirected');
      }
      return readHtml(r);
    })
    .catch(function(err){evictKey(k);throw err;});
  p.catch(function(){});
  prefetchCache[k]={at:Date.now(),p:p,ctl:ctl};
  prefetchOrder.push(k);
}
function navigate(url,push){
  if(inflight)inflight.abort();
  var myseq=++navSeq;
  var timer=null;
  var k=navKey(url);
  var entry=prefetchCache[k];
  var htmlPromise;
  if(entry&&(Date.now()-entry.at)<PREFETCH_TTL_MS){
    // Warm hit — a hover/focus prefetch fetched this recently. No new
    // request, no abort controller; the swap is immediate.
    htmlPromise=entry.p;
    inflight=null;
  }else{
    // Stale (past TTL) or never prefetched — fetch live so the
    // content is current. Drop a stale entry so it can't be reused;
    // evictKey aborts the in-flight (if still pending) and keeps
    // the order array consistent with the cache map.
    if(entry)evictKey(k);
    var ctl=new AbortController();inflight=ctl;
    timer=setTimeout(function(){ctl.abort();},TIMEOUT_MS);
    htmlPromise=fetch(k,{
      headers:{'Accept':'text/html'},
      credentials:'same-origin',
      redirect:'follow',
      signal:ctl.signal
    }).then(function(r){if(timer)clearTimeout(timer);return readHtml(r);});
  }
  htmlPromise
    .then(function(html){
      // Superseded by a newer navigation — drop this stale swap.
      if(myseq!==navSeq)return;
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
      // **Preserve the live theme across the class swap.** The fetched
      // page's <html> class carries the build-time DEFAULT theme; the
      // user's choice lives in the (untouched) data-place-theme attr.
      // Strip every mapped theme class the destination baked, then
      // re-add the class for the live choice. data-place-theme itself
      // survives — we only ever rewrite 'class'.
      var themeKeys=Object.keys(THEME_CLASS_MAP);
      if(themeKeys.length){
        var liveChoice=document.documentElement.getAttribute('data-place-theme')||'';
        var keep=newCls.split(/\\s+/).filter(function(tok){
          if(!tok)return false;
          for(var z=0;z<themeKeys.length;z++){if(THEME_CLASS_MAP[themeKeys[z]]===tok)return false;}
          return true;
        });
        var liveThemeCls=THEME_CLASS_MAP[liveChoice];
        if(liveThemeCls)keep.push(liveThemeCls);
        newCls=keep.join(' ');
      }
      if(newCls!==(document.documentElement.getAttribute('class')||''))document.documentElement.setAttribute('class',newCls);
      var swap=function(){oldMain.replaceWith(newMain);};
      // Default is INSTANT (just swap). Opt into View Transitions via
      // \`viewTransitions: true\` on \`app()\` / \`serve()\` — the wrap
      // costs a frame and adds a ~250 ms cross-fade, which defeated
      // the framework's actual sub-5 ms swap perf.
      if(ENABLE_VT&&document.startViewTransition){document.startViewTransition(swap);}else{swap();}
      // **Focus management.** Move focus to the freshly-swapped <main>.
      // This is the correct SPA a11y behaviour — keyboard + screen-
      // reader users land IN the new page rather than stranded on the
      // nav link — and it also clears the :focus-visible ring that
      // would otherwise linger on the link the user just clicked
      // (the "glitter" left behind on the previous nav item).
      // tabindex=-1 makes <main> programmatically focusable without
      // entering the tab order; preventScroll defers to scrollTo below.
      try{
        newMain.setAttribute('tabindex','-1');
        // No focus outline on the <main> landmark itself — an outline
        // there would just be a new glitter. (CSSOM write, not an
        // inline style attribute — unaffected by strict style-src CSP.)
        newMain.style.outline='none';
        newMain.focus({preventScroll:true});
      }catch(_){}
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
      if(timer)clearTimeout(timer);
      // A newer navigation already took over — don't hard-reload over it.
      if(myseq!==navSeq)return;
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
// **Prefetch on intent.** Three signals, three latencies:
//   pointerover  — hover-intent (deferred by HOVER_DELAY_MS).
//   pointerdown  — explicit commitment (fires immediately).
//   focusin      — keyboard nav (fires immediately).
function findLink(el){
  while(el&&el.nodeType===1&&el.tagName!=='A')el=el.parentNode;
  if(!el||el.tagName!=='A'||!el.hasAttribute('data-place-link'))return null;
  if(el.closest&&el.closest('[data-no-prefetch]'))return null;
  var u;try{u=new URL(el.href);}catch(_){return null;}
  if(u.origin!==location.origin)return null;
  if(u.pathname===location.pathname&&u.search===location.search)return null;
  return el;
}
var hoverTimers=(typeof WeakMap!=='undefined')?new WeakMap():null;
function clearHoverTimer(el){
  if(!hoverTimers)return;
  var t=hoverTimers.get(el);
  if(t!==undefined){clearTimeout(t);hoverTimers.delete(el);}
}
function onPointerOver(e){
  if(!ENABLE_PREFETCH)return;
  var a=findLink(e.target);
  if(!a)return;
  if(HOVER_DELAY_MS===0){prefetch(a.href);return;}
  if(!hoverTimers)return;
  if(hoverTimers.has(a))return;
  var href=a.href;
  var t=setTimeout(function(){hoverTimers.delete(a);prefetch(href);},HOVER_DELAY_MS);
  hoverTimers.set(a,t);
}
function onPointerOut(e){
  if(!ENABLE_PREFETCH||!hoverTimers)return;
  var a=findLink(e.target);
  if(!a)return;
  var rt=e.relatedTarget;
  if(rt&&rt.nodeType===1&&a.contains(rt))return;
  clearHoverTimer(a);
}
function onPointerDownOrFocus(e){
  if(!ENABLE_PREFETCH)return;
  var a=findLink(e.target);
  if(!a)return;
  clearHoverTimer(a);
  prefetch(a.href);
}
if(ENABLE_PREFETCH){
  document.addEventListener('pointerover',onPointerOver,{passive:true});
  document.addEventListener('pointerout',onPointerOut,{passive:true});
  document.addEventListener('pointerdown',onPointerDownOrFocus,{passive:true});
  document.addEventListener('focusin',onPointerDownOrFocus);
}
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
})();`)
}
