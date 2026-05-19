// Dev-mode HMR runtime — typed-envelope WebSocket client.
//
// Connects to `/__place_hmr` on every dev page load. Protocols:
//
//   - **Hello** (`{ t: 'hello', boot }`). Sent by the server the
//     moment the socket opens. `boot` is unique per server process.
//     The client stores it in `sessionStorage`; on a later connect it
//     reloads ONLY if `boot` differs from the stored value — i.e. the
//     server genuinely restarted. A bare reconnect to the same server
//     (flaky socket, proxied dev env, sleep/wake) carries the same
//     `boot` and is a no-op. This is what keeps a flapping WebSocket
//     from turning into a reload loop.
//
//   - **Per-island swap** (`{ t: 'swap', updates }`, ADR 0028 phase 2).
//     The server rebuilt island bundles in place. For each update the
//     client disposes the live instances via
//     `window.__placeIslandRegistry[name]` and injects a fresh
//     `<script type="module">` at the new content-hashed URL. No page
//     reload; parent-scope signal state is preserved.
//
//   - **Full reload** (`'reload'` bare string, or `{ t: 'reload' }`).
//     Explicit reload signal. Also the fallback for a swap that can't
//     apply cleanly.
//
// **Reconnect behaviour.** On any `onclose`, retry with exponential
// backoff (100 → 200 → 400 → 800 → 1500 ms cap). Reconnecting never
// reloads on its own — only a changed `boot` does.

/** Path of the WebSocket endpoint. Reserved + framework-internal. */
export const HMR_WS_PATH = '/__place_hmr'

/**
 * Inline JS source for the HMR client. Returned as a string so
 * `renderPage` can wrap it in `<script>` with the per-response nonce.
 * ES5-flavoured, no template literals — runs everywhere without
 * compilation. ~1.4 kB raw.
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
    // Compare the server's boot id against the last one we saw. A
    // changed id means the server restarted → reload once. Same id
    // (or first ever) → just remember it; do NOT reload.
    'function onHello(boot){' +
    'if(typeof boot!=="string")return;' +
    'var prev=null;' +
    'try{prev=sessionStorage.getItem("__place_boot");}catch(_){}' +
    'try{sessionStorage.setItem("__place_boot",boot);}catch(_){}' +
    'if(prev!==null&&prev!==boot){location.reload();}' +
    '}' +
    'function handle(data){' +
    // Legacy bare-string reload signal.
    'if(data==="reload"){location.reload();return;}' +
    'var msg;try{msg=JSON.parse(data);}catch(_){return;}' +
    'if(!msg||typeof msg.t!=="string")return;' +
    'if(msg.t==="hello"){onHello(msg.boot);return;}' +
    'if(msg.t==="swap"){if(!applySwap(msg.updates))location.reload();return;}' +
    'if(msg.t==="reload"){location.reload();return;}' +
    '}' +
    'function connect(){' +
    'var proto=location.protocol==="https:"?"wss:":"ws:";' +
    'var ws;' +
    'try{ws=new WebSocket(proto+"//"+location.host+"' +
    HMR_WS_PATH +
    '");}' +
    'catch(e){bump();setTimeout(connect,retry);return;}' +
    // Opening the socket is NOT a reload trigger — only a changed
    // boot id (handled in `onHello`) is. Reset the backoff on a
    // clean open.
    'ws.onopen=function(){retry=100;};' +
    'ws.onmessage=function(e){handle(e.data);};' +
    'ws.onclose=function(){bump();setTimeout(connect,retry);};' +
    'ws.onerror=function(){try{ws.close();}catch(_){}};' +
    '}' +
    'connect();' +
    '})();'
  )
}
