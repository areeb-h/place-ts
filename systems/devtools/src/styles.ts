// The devtool's self-contained stylesheet.
//
// Adopted at mount via a constructable `CSSStyleSheet` (see
// `devtools.tsx`) — never an inline `<style>`, so it is CSP-safe and
// cannot collide with the host app's styles. Every selector is scoped
// under `.place-dt`. Dark-only by design: a tool should look the same
// in every app it is dropped into.

export const devtoolsCss = `
.place-dt {
  --dt-bg: oklch(0.17 0.012 285 / 0.92);
  --dt-bg-solid: oklch(0.17 0.012 285);
  --dt-raise: oklch(0.225 0.013 285);
  --dt-line: oklch(0.32 0.014 285);
  --dt-fg: oklch(0.95 0.004 285);
  --dt-mut: oklch(0.66 0.012 285);
  --dt-dim: oklch(0.5 0.012 285);
  --dt-ac: oklch(0.72 0.17 305);
  --dt-ac-soft: oklch(0.72 0.17 305 / 0.16);
  --dt-ok: oklch(0.78 0.15 155);
  --dt-warn: oklch(0.8 0.15 75);
  --dt-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  --dt-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  color-scheme: dark;
  font-family: var(--dt-sans);
  font-size: 12px;
  line-height: 1.5;
}
.place-dt *, .place-dt *::before, .place-dt *::after { box-sizing: border-box; }

/* ----- launcher — a circular button, just the mark ----- */
.place-dt-launch {
  display: flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; padding: 0;
  color: var(--dt-fg);
  background: var(--dt-bg); border: 1px solid var(--dt-line);
  border-radius: 50%; cursor: pointer;
  backdrop-filter: blur(12px);
  box-shadow: 0 6px 24px -10px oklch(0 0 0 / 0.7), 0 0 0 1px oklch(1 0 0 / 0.02) inset;
  transition: border-color .14s ease, transform .14s ease, box-shadow .14s ease;
}
.place-dt-launch:hover {
  border-color: var(--dt-ac);
  transform: translateY(-2px);
  box-shadow: 0 12px 32px -10px oklch(0 0 0 / 0.8), 0 0 0 3px var(--dt-ac-soft);
}
.place-dt-launch .place-dt-mark { width: 22px; height: 22px; border-radius: 7px; font-size: 12px; }
.place-dt-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 5px;
  background: var(--dt-ac-soft); color: var(--dt-ac);
  font-size: 9px;
}

/* ----- panel ----- */
.place-dt-panel {
  display: none; flex-direction: column;
  width: 392px; max-width: calc(100vw - 32px);
  height: 460px; max-height: calc(100vh - 32px);
  background: var(--dt-bg); border: 1px solid var(--dt-line);
  border-radius: 14px; overflow: hidden;
  backdrop-filter: blur(16px);
  box-shadow: 0 24px 64px -16px oklch(0 0 0 / 0.78), 0 0 0 1px oklch(1 0 0 / 0.03) inset;
}
.place-dt[data-open="1"] .place-dt-launch { display: none; }
.place-dt[data-open="1"] .place-dt-panel { display: flex; }

/* ----- header ----- */
.place-dt-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 9px 9px 12px;
  border-bottom: 1px solid var(--dt-line);
  background: linear-gradient(to bottom, oklch(1 0 0 / 0.025), transparent);
}
.place-dt-title {
  display: flex; align-items: center; gap: 6px;
  font-weight: 600; letter-spacing: .01em; color: var(--dt-fg);
}
.place-dt-tabs { display: flex; gap: 2px; margin-left: auto; }
.place-dt-tab {
  padding: 5px 7px; font: 500 11px/1 var(--dt-sans);
  color: var(--dt-mut); background: transparent;
  border: 0; border-radius: 7px; cursor: pointer;
  transition: color .12s ease, background .12s ease;
}
.place-dt-tab:hover { color: var(--dt-fg); background: oklch(1 0 0 / 0.04); }
.place-dt-tab[data-active="1"] { color: var(--dt-ac); background: var(--dt-ac-soft); }
.place-dt-close {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; margin-left: 2px;
  color: var(--dt-mut); background: transparent;
  border: 0; border-radius: 6px; cursor: pointer; font-size: 12px;
  transition: color .12s ease, background .12s ease;
}
.place-dt-close:hover { color: var(--dt-fg); background: oklch(1 0 0 / 0.06); }

/* ----- body / panes ----- */
.place-dt-body { flex: 1; overflow-y: auto; overflow-x: hidden; }
.place-dt-body::-webkit-scrollbar { width: 9px; }
.place-dt-body::-webkit-scrollbar-thumb {
  background: var(--dt-line); border-radius: 99px;
  border: 2px solid var(--dt-bg-solid);
}
.place-dt-pane { display: none; padding: 10px 12px 14px; }
.place-dt[data-tab="graph"] .place-dt-pane[data-pane="graph"],
.place-dt[data-tab="islands"] .place-dt-pane[data-pane="islands"],
.place-dt[data-tab="routes"] .place-dt-pane[data-pane="routes"],
.place-dt[data-tab="console"] .place-dt-pane[data-pane="console"],
.place-dt[data-tab="perf"] .place-dt-pane[data-pane="perf"] { display: block; }

/* ----- summary strip ----- */
.place-dt-summary {
  display: flex; gap: 10px; flex-wrap: wrap;
  padding: 6px 9px; margin-bottom: 8px;
  font: 500 11px/1.4 var(--dt-mono); color: var(--dt-mut);
  background: var(--dt-raise); border-radius: 8px;
}
.place-dt-summary b { color: var(--dt-fg); font-weight: 600; }

/* ----- node / row list ----- */
.place-dt-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.place-dt-row {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px;
  padding: 7px 9px;
  background: var(--dt-raise); border: 1px solid transparent;
  border-radius: 8px;
  transition: border-color .12s ease;
}
.place-dt-row:hover { border-color: var(--dt-line); }
.place-dt-badge {
  font: 600 9px/1 var(--dt-mono); text-transform: uppercase; letter-spacing: .04em;
  padding: 3px 5px; border-radius: 4px;
  background: var(--dt-ac-soft); color: var(--dt-ac);
}
.place-dt-badge[data-kind="derived"] { background: oklch(0.72 0.14 240 / 0.16); color: oklch(0.74 0.14 240); }
.place-dt-badge[data-kind="watch"] { background: oklch(0.8 0.15 75 / 0.16); color: var(--dt-warn); }
.place-dt-badge[data-kind="error"] { background: oklch(0.7 0.2 25 / 0.18); color: oklch(0.75 0.19 25); }
.place-dt-badge[data-kind="warn"] { background: oklch(0.8 0.15 75 / 0.16); color: var(--dt-warn); }
.place-dt-badge[data-kind="info"] { background: oklch(0.72 0.14 240 / 0.16); color: oklch(0.74 0.14 240); }
.place-dt-badge[data-kind="log"] { background: oklch(1 0 0 / 0.06); color: var(--dt-mut); }
.place-dt-log .place-dt-row-main { align-self: center; }
.place-dt-log-text {
  font: 11px/1.5 var(--dt-mono); color: var(--dt-fg);
  white-space: pre-wrap; word-break: break-word;
  max-height: 84px; overflow: hidden;
}
.place-dt-row-main { min-width: 0; }
.place-dt-row-val {
  font: 12px var(--dt-mono); color: var(--dt-fg);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.place-dt-row-sub {
  font: 10px var(--dt-mono); color: var(--dt-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.place-dt-id { color: var(--dt-dim); font: 10px var(--dt-mono); }
.place-dt-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--dt-dim); flex-shrink: 0;
}
.place-dt-dot[data-on="1"] { background: var(--dt-ok); box-shadow: 0 0 0 3px oklch(0.78 0.15 155 / 0.18); }
.place-dt-status { font: 10px var(--dt-mono); color: var(--dt-dim); }
.place-dt-status[data-s="dirty"] { color: var(--dt-warn); }
.place-dt-status[data-s="computing"] { color: var(--dt-ac); }

/* ----- Reactivity panel: sub-tabs ----- */
.place-dt-subtabs {
  display: flex; gap: 2px; margin-bottom: 8px;
  padding: 2px; border-radius: 8px;
  background: var(--dt-raise);
}
.place-dt-subtab {
  flex: 1; padding: 5px 8px;
  font: 600 11px/1 var(--dt-sans);
  color: var(--dt-mut); background: transparent;
  border: 0; border-radius: 6px; cursor: pointer;
  transition: color .12s ease, background .12s ease;
}
.place-dt-subtab:hover { color: var(--dt-fg); }
.place-dt-subtab[data-active="1"] { color: var(--dt-ac); background: var(--dt-ac-soft); }

/* ----- Reactivity panel: by-island view ----- */
.place-dt-clusters { display: flex; flex-direction: column; }
.place-dt-cluster {
  margin-bottom: 8px;
  background: var(--dt-raise);
  border: 1px solid var(--dt-line);
  border-radius: 8px;
  overflow: hidden;
}
.place-dt-cluster[data-loose="1"] { border-style: dashed; }
.place-dt-cluster-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding: 6px 9px;
  background: oklch(1 0 0 / 0.025);
  border-bottom: 1px solid var(--dt-line);
}
.place-dt-cluster-name {
  font: 600 11px/1.3 var(--dt-mono); color: var(--dt-fg);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.place-dt-cluster-shape {
  flex-shrink: 0;
  font: 500 10px/1.3 var(--dt-mono); color: var(--dt-mut);
}
.place-dt-glist {
  list-style: none; margin: 0; padding: 4px;
  display: flex; flex-direction: column; gap: 3px;
}
.place-dt-gnode {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 7px; border-radius: 6px;
  background: var(--dt-bg-solid);
}
.place-dt-gnode-val {
  flex: 1; min-width: 0;
  font: 12px var(--dt-mono); color: var(--dt-fg);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ----- Reactivity panel: activity feed ----- */
.place-dt-act {
  display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px;
  padding: 6px 9px;
  background: var(--dt-raise); border-radius: 8px;
}
.place-dt-act-scope {
  font: 600 10px/1 var(--dt-mono); color: var(--dt-ac);
  padding: 3px 5px; border-radius: 4px; background: var(--dt-ac-soft);
  max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.place-dt-act-change {
  min-width: 0; font: 11px var(--dt-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.place-dt-act-from { color: var(--dt-dim); }
.place-dt-act-arrow { color: var(--dt-mut); }
.place-dt-act-to { color: var(--dt-fg); }
.place-dt-act-fired { color: var(--dt-dim); }

/* ----- key/value grid ----- */
.place-dt-kv { margin: 0; display: grid; grid-template-columns: 84px 1fr; gap: 1px; }
.place-dt-kv > div {
  display: contents;
}
.place-dt-kv dt {
  padding: 7px 9px; font: 500 11px var(--dt-mono); color: var(--dt-mut);
  background: var(--dt-raise);
}
.place-dt-kv dd {
  margin: 0; padding: 7px 9px; font: 12px var(--dt-mono); color: var(--dt-fg);
  background: var(--dt-raise); word-break: break-word;
}

/* ----- empty / hint / note ----- */
.place-dt-empty {
  padding: 24px 14px; text-align: center;
  color: var(--dt-dim); font-size: 12px;
}
.place-dt-note {
  margin-top: 8px; padding: 8px 10px;
  font-size: 11px; line-height: 1.5; color: var(--dt-mut);
  background: var(--dt-raise); border-radius: 8px;
  border-left: 2px solid var(--dt-ac);
}
`
