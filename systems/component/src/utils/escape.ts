// HTML escape helpers. Three flavors for the three contexts in which we
// emit user-supplied content into HTML strings:
//
//   - `escapeHtmlText` — element text content (& < >). Apostrophes and
//     quotes are NOT escaped because text-content parsing doesn't treat
//     them as special.
//   - `escapeHtmlAttr` — minimal attribute escape (& "). Used in tight
//     hot paths where we control the rest of the string.
//   - `escapeHtmlAttrFull` — full attribute escape (& " < >). Used in
//     the meta / head-tag pipeline where attribute values originate
//     from user-supplied PageMeta fields.
//
// Three small, no-dependency functions extracted here so both the SSR
// emitter (`el()` → `toHtml()`) and the meta render pipeline can share
// them without one importing from the other.

export function escapeHtmlText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

export function escapeHtmlAttr(s: string): string {
  return s.replace(/[&"]/g, (c) => (c === '&' ? '&amp;' : '&quot;'))
}

export function escapeHtmlAttrFull(s: string): string {
  return s.replace(/[&"<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === '<' ? '&lt;' : '&gt;',
  )
}
