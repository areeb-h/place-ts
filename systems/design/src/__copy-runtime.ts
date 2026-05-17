// Inline page runtime for `<Copy>` (and components that compose it,
// including `<CodeBlock>`).
//
// **Why not an island.** Copy-to-clipboard is one event listener,
// one async call, and a tiny "copied!" visual feedback that returns
// to "idle" after 1.4 s. Shipping a per-instance island bundle is
// ~3 KB gzipped for what reduces to ~250 bytes of vanilla JS.
//
// **Contract.**
//   - Each copy-able element carries `data-place-copy=""` and
//     `data-place-copy-text="<url-encoded>"`. The text is encoded
//     server-side so quotes / backticks / newlines round-trip safely.
//   - On click anywhere in the document, the runtime checks
//     `e.target.closest('[data-place-copy]')` — finds the nearest
//     copy button (or no-op).
//   - On match: decode the text, call `navigator.clipboard.writeText`,
//     toggle `data-state` to `copied` for 1.4 s, then back to `idle`.
//   - The CSS in `styles.ts` keys off `data-state` to swap the visual
//     label ("copy" → "copied"). No reactive runtime needed.
//   - `window.__placeCopy === 1` guard prevents double-install when
//     multiple `<Copy>` components emit the runtime in the same
//     response (gzip dedupes the bytes anyway).
//
// **Backward-compat aliases.** The previous CodeBlock-specific
// markers (`data-place-code-copy` + `data-place-code-copy-text` +
// `__placeCodeCopy` guard) are no longer emitted by the design
// library. The runtime supports BOTH attribute names for one release
// so any in-flight test or external consumer doesn't break.

/**
 * Returns the inline JS source for the copy runtime. Hand-written
 * ES5 — no template literals, no arrow funcs — runs everywhere
 * without bundling. ~480 bytes raw.
 *
 * **Two-tier copy strategy** (T13+ fix):
 *
 *   1. Try `navigator.clipboard.writeText(code)` — modern API,
 *      works in secure contexts (https + localhost).
 *   2. On rejection (permission denied, insecure context, or no
 *      Clipboard API at all): fall back to a temporary `<textarea>`
 *      + `document.execCommand("copy")` — the classic fallback that
 *      works in every browser back to ~2014.
 *
 * The fallback is the difference between "copy silently failed
 * and the user thought it worked" (the old bug) and "copy worked
 * everywhere with a visible tick." The visible state always flips
 * to `copied` when EITHER path succeeds; on dual-failure (rare —
 * means browser blocked both clipboard surfaces) it flips to
 * `failed` for ~1.4 s so the user knows.
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
    // Match the new generic attribute first; fall back to the legacy
    // CodeBlock-specific attribute for a one-release deprecation
    // window. Both carry their text on the corresponding `*-text`
    // attribute.
    'var b=t.closest("[data-place-copy]")||t.closest("[data-place-code-copy]");' +
    'if(!b)return;' +
    'var raw=b.getAttribute("data-place-copy-text")||b.getAttribute("data-place-code-copy-text")||"";' +
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

// Legacy alias — older CodeBlock code path expects this symbol. Re-
// export the new runtime so a single browser install handles both
// the legacy `data-place-code-copy` attr and the new `data-place-copy`.
export const placeCodeBlockCopy = placeCopyRuntime
