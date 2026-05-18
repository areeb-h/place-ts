// Inline page runtime for click-to-copy buttons.
//
// Lives in `@place/component` (not `@place/design`) so the framework
// can emit it ONCE per page with the per-request CSP nonce —
// mirroring how `placeViewport`, `placeHmr`, `placeTabs` work.
// Components in `@place/design` (`<Copy>`, `<CodeBlock>`) mark the
// flag via `markCopyUsedOnThisRequest()`; `renderPage` consumes the
// flag and emits the runtime alongside the other inline scripts so
// it gets the same nonce treatment.
//
// **Two-tier copy strategy:**
//
//   1. Try `navigator.clipboard.writeText(code)` — modern API,
//      works in secure contexts (https + localhost) with a user
//      gesture.
//   2. On rejection (permission denied, insecure context, or no
//      Clipboard API at all): fall back to a temporary `<textarea>`
//      + `document.execCommand("copy")` — the classic fallback that
//      works in every browser back to ~2014.
//
// The visible state flips to `copied` when EITHER path succeeds; on
// dual-failure it flips to `failed` so the user knows.
//
// **Contract.**
//   - Each copy-able button carries `data-place-copy=""` and
//     `data-place-copy-text="<url-encoded>"`. The text is encoded
//     server-side so quotes / backticks / newlines round-trip safely.
//   - On click anywhere in the document, the runtime checks
//     `e.target.closest('[data-place-copy]')` — finds the nearest
//     copy button (or no-op).
//   - On match: decode the text, attempt clipboard write, toggle
//     `data-state` to `copied` (or `failed`) for 1.4 s, then back to
//     `idle`. CSS in `@place/design/styles.ts` keys off `data-state`
//     to swap the visible label + show a tick.
//   - `window.__placeCopy === 1` guard prevents double-install when
//     the runtime is emitted multiple times (e.g. SPA-nav between
//     pages that both have copy buttons).
//
// Both `<Copy>` and `<CodeBlock>` emit the same `data-place-copy` +
// `data-place-copy-text` marker pair, so the listener matches one
// attribute name.

/**
 * Returns the inline JS source for the copy runtime. Hand-written
 * ES5 — no template literals, no arrow funcs — runs everywhere
 * without bundling. ~480 bytes raw.
 */
export function placeCopyRuntime(): string {
  return (
    '(function(){' +
    'if(window.__placeCopy===1)return;' +
    'window.__placeCopy=1;' +
    'function fallback(code){' +
    'try{' +
    'var ta=document.createElement("textarea");' +
    'ta.value=code;' +
    'ta.style.position="fixed";' +
    'ta.style.left="-9999px";' +
    'ta.style.top="0";' +
    'ta.setAttribute("readonly","");' +
    'document.body.appendChild(ta);' +
    'ta.select();' +
    'var ok=document.execCommand("copy");' +
    'document.body.removeChild(ta);' +
    'return ok;' +
    '}catch(_){return false;}' +
    '}' +
    'function flip(b,state){' +
    'b.setAttribute("data-state",state);' +
    'setTimeout(function(){b.setAttribute("data-state","idle");},1400);' +
    '}' +
    'document.addEventListener("click",function(e){' +
    'var t=e.target;' +
    'if(!t||!t.closest)return;' +
    'var b=t.closest("[data-place-copy]");' +
    'if(!b)return;' +
    'var raw=b.getAttribute("data-place-copy-text")||"";' +
    'var code;try{code=decodeURIComponent(raw);}catch(_){return;}' +
    'if(navigator&&navigator.clipboard&&navigator.clipboard.writeText){' +
    'navigator.clipboard.writeText(code).then(function(){flip(b,"copied");}).catch(function(){' +
    'flip(b,fallback(code)?"copied":"failed");' +
    '});' +
    '}else{' +
    'flip(b,fallback(code)?"copied":"failed");' +
    '}' +
    '},{passive:true});' +
    '})();'
  )
}

// ===== Per-render flag: did this page render any copy button? =====

let _copyUsedFlag = false

/**
 * Mark this request as having rendered at least one copy-able
 * element. `renderPage` checks the flag after SSR and emits
 * `placeCopyRuntime()` with the request's CSP nonce if true.
 *
 * Idempotent — multiple calls in the same render mark the same flag.
 *
 * @provisional — shipped in Tier 13 (ADR 0036). Public to allow
 * design-library components to opt into the framework-managed copy
 * runtime, but the cross-package signaling shape may consolidate
 * before v0.1 publish.
 */
export function markCopyUsedOnThisRequest(): void {
  _copyUsedFlag = true
}

/** Drain the flag. Returns the value, then resets to false. */
export function _consumeCopyUsedFlag(): boolean {
  const v = _copyUsedFlag
  _copyUsedFlag = false
  return v
}
