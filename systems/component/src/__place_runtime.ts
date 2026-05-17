// Inline browser runtime for streaming SSR + (future) listener delegation.
//
// Emitted as a single <script> block in the SSR'd shell. Plain script (NOT
// type="module") so it runs synchronously as parsed — critical because
// suspense swap chunks arrive in the same stream and depend on this being
// installed by the time they execute.
//
// Surface:
//   __place.swap(id)       — replace the comment-marker range <!--p:id-->…<!--/p:id-->
//                            with the content of <template id="c-id">.
//   __place.r              — resource value cache; client-side resource()
//                            checks this before running its loader.
//   __place.q              — pre-boot event buffer (clicks/submits/inputs
//                            that fired before hydration finished). Phase
//                            4.8 wires the replay; 4.5 just installs the
//                            capture so events aren't lost during the
//                            streaming window.
//
// Why no module: <script type="module"> is async/deferred per the HTML
// spec, so the swap script that follows would race against it. Plain
// <script> blocks execute in document order, no race.

/**
 * The runtime's source code as a string. `serve()` injects this into the
 * SSR shell via `<script>${PLACE_RUNTIME}</script>`. Kept as a string
 * (not a real module) so it stays out of the server bundle's import
 * graph and gets shipped exactly once per page.
 *
 * Intentionally compact — every byte ships on every page. Avoid library
 * deps; avoid TypeScript-specific syntax (this is hand-readable JS).
 */
export const PLACE_RUNTIME = `(function(){
var P=window.__place=window.__place||{r:{},q:[]};
// Idempotency guard. The runtime is shipped exactly once per page by
// serve()'s SSR shell, but a dev-tools re-eval or a third-party that
// re-injects scripts would otherwise replace P.swap mid-stream and
// re-bind capture handlers. Cheap insurance.
if(P._i)return;P._i=1;
P.swap=function(id){
  var tpl=document.getElementById('c-'+id);
  if(!tpl)return;
  // Find the comment markers <!--p:id--> and <!--/p:id-->.
  var start=null,end=null,walker=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT);
  var n;while((n=walker.nextNode())){
    if(!start&&n.data==='p:'+id)start=n;
    else if(start&&n.data==='/p:'+id){end=n;break;}
  }
  if(!start||!end)return;
  var parent=end.parentNode;if(!parent)return;
  // Remove nodes between start and end (exclusive).
  var c=start.nextSibling;
  while(c&&c!==end){var next=c.nextSibling;parent.removeChild(c);c=next;}
  // Insert the template's content before end.
  parent.insertBefore(tpl.content,end);
  // Clean up: remove the now-empty <template> AND the two comment
  // markers. Leaving the markers in place would let a stale future
  // call to swap(id) match them again (templates only exist once, so
  // it would no-op — but freeing the nodes keeps subsequent treeWalker
  // scans smaller).
  if(tpl.parentNode)tpl.parentNode.removeChild(tpl);
  parent.removeChild(start);parent.removeChild(end);
};
// Pre-boot event capture: buffer click/submit events that fire before
// hydration. boot() calls __place.replay() after hydration to dispatch
// each one against the now-attached listeners. We only replay clicks
// + submits because they're the events with idempotent semantics —
// re-dispatching a captured 'click' fires the listener once. 'input'
// and 'change' are NOT replayed: the input's value is already in the
// DOM at hydrate time, so reactive bindings pick it up via initial
// value reads. Re-dispatching would double-count.
//
// Capture-time preventDefault: framework-managed surfaces are tagged
// at SSR time with data-place-link (Link's anchor) and data-place-form
// (Form's form). When a click/submit fires before hydration, the
// browser's native default action (anchor follow / native POST) would
// otherwise run AND the SPA handler would never see it — the page
// navigates away before replay() gets the chance to dispatch against
// the now-attached listener. Suppressing default only on tagged
// elements keeps plain user anchor and form elements working natively.
//
// We do NOT preventDefault on every click/submit indiscriminately:
// that would break ordinary HTML the framework doesn't manage.
var H={};
var capture=function(t){return function(e){
  // Only capture trusted user events. Synthesised events (from replay
  // itself) carry isTrusted=false and would loop.
  if(!e.isTrusted)return;
  var tgt=e.target;
  if(t==='click'){
    // Modifier-clicks + non-left buttons must defer to the browser
    // (open-in-new-tab/window, middle-click new tab, context menu).
    // Hydrated onClick in routing/src does the same check; mirror it
    // here so pre-hydration behavior matches post-hydration behavior.
    if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    if(e.button!==0&&e.button!==undefined)return;
    var link=tgt&&tgt.closest&&tgt.closest('[data-place-link]');
    if(!link)return;
    e.preventDefault();
    P.q.push({type:'click',target:link,clientX:e.clientX,clientY:e.clientY,timeStamp:e.timeStamp});
  }else if(t==='submit'){
    var form=tgt&&tgt.matches&&tgt.matches('[data-place-form]')?tgt:(tgt&&tgt.closest?tgt.closest('[data-place-form]'):null);
    if(!form)return;
    e.preventDefault();
    // Preserve submitter so multi-submit-button forms replay against
    // the right control (button name/value, formaction, formmethod).
    P.q.push({type:'submit',target:form,submitter:e.submitter||null,timeStamp:e.timeStamp});
  }
}};
['click','submit'].forEach(function(t){
  H[t]=capture(t);document.addEventListener(t,H[t],true);
});
P.replay=function(){
  // Detach the pre-boot capture handlers. After hydration, real
  // listeners are bound to the actual DOM nodes — keeping these alive
  // would just pile every real user event onto P.q forever (small
  // memory leak + dead work). Detach is idempotent: a second replay()
  // call is a no-op because H is empty.
  for(var t in H){document.removeEventListener(t,H[t],true);delete H[t];}
  if(!P.q||!P.q.length)return;
  var events=P.q.slice();
  P.q.length=0;
  events.forEach(function(rec){
    if(!rec.target||!rec.target.isConnected)return;
    var ev;
    if(rec.type==='click'){
      ev=new MouseEvent('click',{bubbles:true,cancelable:true,clientX:rec.clientX||0,clientY:rec.clientY||0});
    }else if(rec.type==='submit'){
      // Pass submitter (may be null) so the hydrated onSubmit handler
      // can read event.submitter to disambiguate multi-button forms.
      var init={bubbles:true,cancelable:true};
      if(rec.submitter&&rec.submitter.isConnected)init.submitter=rec.submitter;
      ev=new SubmitEvent('submit',init);
    }else return;
    rec.target.dispatchEvent(ev);
  });
};
})();`
