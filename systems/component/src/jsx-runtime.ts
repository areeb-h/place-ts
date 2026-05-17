// JSX automatic runtime for @place/component.
//
// Per ADR 0002: TypeScript's automatic JSX runtime emits calls to `jsx`,
// `jsxs`, and `jsxDEV` here. We translate those calls to element-factory
// invocations from index.ts. No Babel plugin, no SWC plugin — TypeScript's
// own emission is the only transform.
//
// Consumer config:
//
//   {
//     "compilerOptions": {
//       "jsx": "react-jsx",
//       "jsxImportSource": "@place/component"
//     }
//   }
//
// Author writes: <div class="x">{state.read}</div>
// TypeScript emits: jsx(div, { class: "x", children: state.read })
// We resolve `div` (the imported factory or the string 'div') to the element.

import {
  component,
  type ElementProps,
  el,
  Fragment as FragmentImpl,
  ISLAND_BRAND,
  TAB_BRAND,
  type View,
} from './index.ts'

export { Fragment } from './index.ts'

type JsxType = string | ((props: Record<string, unknown>) => View) | typeof FragmentImpl

export function jsx(type: JsxType, props: Record<string, unknown>, _key?: unknown): View {
  if (typeof type === 'string') {
    return el(type, props as ElementProps)
  }
  // Auto-wrap component invocations so that `onCleanup` works without the
  // author needing to explicitly call `component(fn)`. Two special cases
  // skip the wrap:
  //
  //  • `Fragment` — no cleanup scope needed (it's a passthrough).
  //  • `island(...)` returns — its callable already handles SSR-throw
  //    recovery internally (emits its `data-place-island` marker even
  //    when the body throws a browser-global ReferenceError at SSR
  //    time). Wrapping it in `component()` would let `component()`'s
  //    auto-placeholder substitute a marker-less span, and the island
  //    bundle's auto-mount wrapper would never find a matching marker
  //    in the DOM — the bug that left SearchPalette dead on every
  //    page even though its bundle loaded fine.
  if (type === FragmentImpl) {
    return (type as (props: Record<string, unknown>) => View)(props)
  }
  if ((type as { __islandBrand?: symbol }).__islandBrand === ISLAND_BRAND) {
    return (type as (props: Record<string, unknown>) => View)(props)
  }
  // `<Tab>` is a data-carrier marker — its return is read by `<Tabs>`
  // for label/value/children extraction. Wrapping in component() would
  // make `<Tab>` actually render in place (a no-op) and strip the
  // marker fields the parent needs. Skip the wrap like Fragment.
  if ((type as { __tabBrand?: symbol }).__tabBrand === TAB_BRAND) {
    return (type as (props: Record<string, unknown>) => View)(props)
  }
  return component(type as (props: Record<string, unknown>) => View)(props)
}

// `jsxs` is the multi-children variant TypeScript emits when there are
// multiple children. For our model the behavior is identical.
export const jsxs = jsx

// `jsxDEV` is what TypeScript emits in development mode (with extra args
// for source location). We accept and ignore the extra args.
export function jsxDEV(
  type: JsxType,
  props: Record<string, unknown>,
  _key?: unknown,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): View {
  return jsx(type, props)
}

// ===== JSX namespace =====
//
// TypeScript looks up element types and intrinsic-element props inside the
// `JSX` namespace at this import source. Minimal shape that lets <div>,
// <span>, <button>, etc. work with our ElementProps.

declare global {
  namespace JSX {
    type Element = View

    interface ElementChildrenAttribute {
      children: Record<string, never>
    }

    interface IntrinsicElements {
      [tag: string]: ElementProps
    }
  }
}
