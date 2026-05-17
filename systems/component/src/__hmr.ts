// Dev-mode HMR runtime — typed-envelope WebSocket client.
//
// Connects to `/__place_hmr` on every dev page load. Two protocols:
//
//   - **Per-island swap** (the new path, ADR 0028 phase 2). Server
//     pushes `{ t: 'swap', updates }` after rebuilding island bundles
//     in place. For each update the client (a) disposes the existing
//     instances on the page via the island's `window.__placeIslandRegistry[name]`
//     entry, (b) injects a fresh `<script type="module">` pointing at
//     the new content-hashed bundle URL — its module-init re-mounts
//     the markers with the new render fn. No page reload; parent-scope
//     signal state is preserved.
//
//   - **Full reload** (legacy + fallback). Server pushes the bare
//     string `'reload'` (slow-path: page/layout/framework edits triggered
//     a child-process restart) OR `{ t: 'reload' }` envelope. Client
//     calls `location.reload()`. Also the fallback for any swap that
//     can't apply cleanly — better a reload than a wedged page.
//
// **Reconnect behaviour.** On any `onclose`, retry with exponential
// backoff (100 → 200 → 400 → 800 → 1500 ms cap). The supervisor
// respawn cycle is typically ~700 ms, so the second or third retry
// usually wins. Once a connection has been seen and then dropped, the
// next successful `onopen` reloads — the server is fresh and any
// in-memory state may be incompatible with the new build.
//
// **Why not a server-sent events stream?** WS is already wired for
// future bidirectional traffic (client acks per ADR 0028 phase 3).
// Symmetry > minimal-bytes-this-cut.

/** Path of the WebSocket endpoint. Reserved + framework-internal. */
export const HMR_WS_PATH = '/__place_hmr'

/**
 * Inline JS source for the HMR client. Returned as a string so
 * `renderPage` can wrap it in `<script>` with the per-response nonce.
 * ES5-flavoured, no template literals — runs everywhere without
 * compilation. ~1.3 kB raw.
 */
export function placeHmr(): string {
  // The runtime is one IIFE. We keep ES5 dialect to avoid Bun-side
  // transpile concerns when the inline script ships under strict CSP
  // (where any transform must be byte-for-byte reproducible for the
  // hash-based fallback to work).
  return (
    '(function(){' +
    'if(window.__placeHmr===1)return;' +
    'window.__placeHmr=1;' +
    'var seenOpen=false;' +
    'var retry=100;' +
    'function bump(){retry=Math.min(retry*2,1500);}' +
    // Apply a single island swap. Returns true on success, false on
    // any failure (the caller falls back to reload).
    'function applyOne(u){' +
    'var reg=(window.__placeIslandRegistry||{})[u.name];' +
    'if(!reg||typeof reg.disposeAll!=="function")return false;' +
    'try{reg.disposeAll();}catch(_){return false;}' +
    // Inject a fresh <script type="module"> with the new bundle URL.
    // Content-hashed URLs mean the browser fetches fresh code, never
    // a stale cache entry. The new bundle's module-init scans markers
    // (without viewMounted, just cleared by disposeAll) and rehydrates.
    'var s=document.createElement("script");' +
    's.type="module";' +
    's.src=u.url;' +
    's.async=false;' +
    's.setAttribute("data-place-island",u.name);' +
    // SRI: the server ships the raw base64 digest (matching its
    // internal storage convention); the algorithm prefix is an HTML-
    // attribute concern that lives here. Without "sha384-" the
    // browser refuses to load the script — the silent failure mode
    // that wedged the swap path before this prefix was added.
    'if(u.integrity)s.integrity="sha384-"+u.integrity;' +
    's.crossOrigin="anonymous";' +
    'document.head.appendChild(s);' +
    'return true;' +
    '}' +
    'function applySwap(updates){' +
    'if(!Array.isArray(updates)||updates.length===0)return false;' +
    'for(var i=0;i<updates.length;i++){if(!applyOne(updates[i]))return false;}' +
    'return true;' +
    '}' +
    'function handle(data){' +
    // Legacy bare-string shape — slow-path reload signal from the
    // child-process supervisor restart cycle.
    'if(data==="reload"){location.reload();return;}' +
    'var msg;try{msg=JSON.parse(data);}catch(_){return;}' +
    'if(!msg||typeof msg.t!=="string")return;' +
    'if(msg.t==="swap"){' +
    'if(!applySwap(msg.updates))location.reload();' +
    'return;' +
    '}' +
    'if(msg.t==="reload"){location.reload();return;}' +
    '}' +
    'function connect(){' +
    'var proto=location.protocol==="https:"?"wss:":"ws:";' +
    'var ws;' +
    'try{ws=new WebSocket(proto+"//"+location.host+"' +
    HMR_WS_PATH +
    '");}' +
    'catch(e){bump();setTimeout(connect,retry);return;}' +
    'ws.onopen=function(){' +
    'if(seenOpen){location.reload();return;}' +
    'seenOpen=true;' +
    'retry=100;' +
    '};' +
    'ws.onmessage=function(e){handle(e.data);};' +
    'ws.onclose=function(){bump();setTimeout(connect,retry);};' +
    'ws.onerror=function(){try{ws.close();}catch(_){}};' +
    '}' +
    'connect();' +
    '})();'
  )
}
