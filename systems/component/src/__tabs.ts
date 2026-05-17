// Inline tabs-controller runtime.
//
// The framework's `<Tabs>` primitive renders its triggers + panels
// server-side (so first paint shows the active panel correctly), then
// relies on ONE delegated click handler on the document to wire
// interactivity. This module returns that handler as a string the
// framework inlines via `<script nonce>` once per page when any
// `<Tabs>` is rendered.
//
// **Why inline + delegated, not an island:**
//   - A `<Tabs>` group is dozens of bytes of JS at most — wiring it
//     through the per-island bundler would ship ~5 KB of framework
//     runtime for what's effectively three event listeners.
//   - Delegation: one document-level listener handles every Tabs
//     group on the page, regardless of count.
//   - SSR already painted the correct active tab via cookie read.
//     The client just needs to handle subsequent clicks + persist
//     the new active value to the cookie.
//
// **Wire format expected on the DOM** (emitted by `<Tabs>` in
// `index.ts`):
//
//   <div data-tabs-group="<groupId>"
//        data-tabs-cookie="<cookie key OR empty for ephemeral>">
//     <div role="tablist">
//       <button role="tab" data-tabs-trigger="<value>"
//               aria-selected="true|false">label</button>
//       ...
//     </div>
//     <div role="tabpanel" data-tabs-panel="<value>"
//          hidden?>panel content</div>
//     ...
//   </div>
//
// **Cookie:** when `data-tabs-cookie` is non-empty, the runtime
// writes the chosen value to that cookie with `path=/; sameSite=Lax`
// so the next SSR pass renders the correct active panel. Ephemeral
// Tabs (no `group` prop on the server) omit the cookie attribute and
// behave as in-memory only.

export interface PlaceTabsOptions {
  /** Reserved for future per-app config. Currently unused. */
  readonly _placeholder?: never
}

/**
 * Build the inline tabs runtime as a single IIFE string. Idempotent
 * on re-entry — the runtime sets `window.__placeTabs = 1` on its
 * first run and bails on subsequent inclusions (which is how SPA-nav
 * page swaps that re-emit the same `<script>` block won't double-wire
 * the listener).
 */
export function placeTabs(_opts?: PlaceTabsOptions): string {
  // Hand-written IIFE. Inline + single-statement so size stays minimal
  // and CSP-nonce friendly (no further compile pass needed).
  return `
(function(){
  if (window.__placeTabs === 1) return;
  window.__placeTabs = 1;
  function escAttr(v){
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(v);
    return String(v).replace(/[^a-zA-Z0-9_-]/g, function(c){return '\\\\' + c;});
  }
  function activate(group, value){
    var root = document.querySelector('[data-tabs-group="' + escAttr(group) + '"]');
    if (!root) return;
    var triggers = root.querySelectorAll('[data-tabs-trigger]');
    for (var i = 0; i < triggers.length; i++){
      var t = triggers[i];
      var on = t.getAttribute('data-tabs-trigger') === value;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) t.setAttribute('data-tabs-active','');
      else t.removeAttribute('data-tabs-active');
    }
    var panels = root.querySelectorAll('[data-tabs-panel]');
    for (var j = 0; j < panels.length; j++){
      var p = panels[j];
      if (p.getAttribute('data-tabs-panel') === value) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    }
    var cookieKey = root.getAttribute('data-tabs-cookie');
    if (cookieKey){
      document.cookie = cookieKey + '=' + encodeURIComponent(value) + '; path=/; sameSite=Lax; max-age=' + (60*60*24*365);
    }
    root.dispatchEvent(new CustomEvent('place:tabs', { bubbles: true, detail: { group: group, value: value } }));
  }
  document.addEventListener('click', function(e){
    var el = e.target;
    while (el && el.nodeType === 1){
      if (el.hasAttribute && el.hasAttribute('data-tabs-trigger')){
        var value = el.getAttribute('data-tabs-trigger');
        var groupRoot = el.closest('[data-tabs-group]');
        if (groupRoot && value !== null){
          e.preventDefault();
          activate(groupRoot.getAttribute('data-tabs-group') || '', value);
        }
        return;
      }
      el = el.parentNode;
    }
  });
  // Keyboard nav: ArrowLeft / ArrowRight on a focused trigger moves
  // focus + activates the sibling trigger. Standard ARIA tabs pattern.
  document.addEventListener('keydown', function(e){
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-tabs-trigger')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    var groupRoot = el.closest('[data-tabs-group]');
    if (!groupRoot) return;
    var triggers = Array.prototype.slice.call(groupRoot.querySelectorAll('[data-tabs-trigger]'));
    var idx = triggers.indexOf(el);
    if (idx < 0) return;
    var nextIdx = idx;
    if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + triggers.length) % triggers.length;
    else if (e.key === 'ArrowRight') nextIdx = (idx + 1) % triggers.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = triggers.length - 1;
    e.preventDefault();
    var next = triggers[nextIdx];
    if (next){
      next.focus();
      activate(groupRoot.getAttribute('data-tabs-group') || '', next.getAttribute('data-tabs-trigger') || '');
    }
  });
})();
`.trim()
}
