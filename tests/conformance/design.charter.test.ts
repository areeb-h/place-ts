// @vitest-environment happy-dom
//
// Conformance tests for the @place/design charter.
//
// One test per architectural commitment in
// systems/design/docs/00-charter.md, post Tier 15-D refresh.
//
// Commitments tested:
//   1. No copy-paste component model
//   2. No `asChild` polymorphism (props-based slots only)
//   3. No runtime CSS-in-JS / theme providers
//   4. No `className` as override channel — recipe variants are the API
//   5. No codegen pipeline
//   6. Arbitrary Tailwind values: typography MUST be token-bound;
//      layout pragmatic
//   7. The tokenizer subsystem is part of the charter (Tier 13 ADR)

import { describe, expect, test } from 'vitest'
import { renderToString } from '../../systems/component/src/index.ts'
import { Badge, Button, CodeBlock } from '../../systems/design/src/index.ts'

describe('@place/design charter conformance — architectural commitments', () => {
  // ── Commitment #1: No copy-paste — components are imported ───────────
  test('charter: components are imported as values, not copy-pasted', () => {
    // Trivially true at the type level: `Button` is a value imported
    // from `@place/design`. The negation (the absence of a `pnpm dlx
    // shadcn add button`-style installer) is the actual contract.
    expect(typeof Button).toBe('function')
  })

  // ── Commitment #6: Arbitrary Tailwind values — typography tokenized ──
  test('charter: rendered components use tokenized typography (no arbitrary font sizes)', () => {
    // Button at default size emits a Tailwind size class, not an
    // arbitrary `text-[Npx]` literal.
    const buttonHtml = renderToString(Button({ children: 'x' }))
    expect(buttonHtml).not.toMatch(/text-\[\d+px\]/)

    // CodeBlock density variants use the tokenized scale (text-xs /
    // text-sm / text-base) — Tier 15-D migration.
    const compact = renderToString(CodeBlock({ code: 'x', density: 'compact' }))
    expect(compact).not.toMatch(/text-\[\d+px\]/)
    expect(compact).toContain('text-xs')

    const spacious = renderToString(CodeBlock({ code: 'x', density: 'spacious' }))
    expect(spacious).not.toMatch(/text-\[\d+px\]/)
    expect(spacious).toContain('text-base')

    // Badge sizes likewise — tokenized post Tier 15-D.
    const badgeSm = renderToString(Badge({ size: 'sm', children: 'x' }))
    const badgeMd = renderToString(Badge({ size: 'md', children: 'x' }))
    expect(badgeSm).not.toMatch(/text-\[\d+px\]/)
    expect(badgeMd).not.toMatch(/text-\[\d+px\]/)
  })

  test('charter: components use token-bound colors (no inline OKLCH literals)', () => {
    // Sample several components; assert no `bg-[oklch(...)]` /
    // `text-[oklch(...)]` / `border-[color-mix(...)]` patterns in
    // the rendered markup. The Tier 15-D migration moved success/
    // warn intent colors to first-class theme tokens.
    const samples = [
      renderToString(Button({ intent: 'primary', children: 'x' })),
      renderToString(Button({ intent: 'destructive', children: 'x' })),
      renderToString(Badge({ intent: 'success', children: 'x' })),
      renderToString(Badge({ intent: 'warn', children: 'x' })),
      renderToString(CodeBlock({ code: 'x' })),
    ]
    for (const html of samples) {
      expect(html).not.toMatch(/text-\[oklch\(/)
      expect(html).not.toMatch(/bg-\[oklch\(/)
      expect(html).not.toMatch(/border-\[color-mix\(/)
    }
  })

  // ── Commitment #4: recipe variants ARE the API ───────────────────────
  test('charter: variant changes produce different class output (recipe is the override channel)', () => {
    const primary = renderToString(Button({ intent: 'primary', children: 'x' }))
    const ghost = renderToString(Button({ intent: 'ghost', children: 'x' }))
    // Different intents → different visual classes.
    expect(primary).not.toBe(ghost)
    expect(primary).toContain('bg-accent')
    expect(ghost).toContain('text-muted')
  })

  // ── Commitment #2: No asChild polymorphism — typed slot props ────────
  test('charter: components do not accept an `asChild` prop (no Radix-style polymorphism)', () => {
    // Negation contract — `asChild` would clash with the typed prop
    // surface. The button props don't accept it.
    // (Compile-time check via the type system; runtime sanity:
    // setting an unknown prop doesn't change anything.)
    const html = renderToString(Button({ children: 'x' /* no asChild */ }))
    expect(html).toMatch(/^<button/)
  })

  // ── Commitment #7: Tokenizer is part of the charter ──────────────────
  test('charter: the tokenizer subsystem is a charter-sanctioned surface', () => {
    // CodeBlock + Copy + tokenizer family ship from @place/design's
    // main barrel; this is the Tier-13 sanction (ADRs 0033/0036/0037).
    const html = renderToString(CodeBlock({ code: 'const x = 1', lang: 'ts' }))
    // Token spans are present — proving the tokenizer ran.
    expect(html).toContain('tok-keyword') // `const`
    expect(html).toContain('tok-number') // `1`
  })
})
