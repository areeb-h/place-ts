// Smoke tests for the design library's base stylesheet.
//
// We can't run a real browser CSS engine here, but we CAN pin the
// presence + shape of the rules so regressions are caught at the
// unit-test layer. The actual visual behaviour is verified live in
// the docs site.

import { describe, expect, test } from 'vitest'
import { styles } from '../../src/styles.ts'

describe('design library base stylesheet', () => {
  test('exports a non-empty string on the server', () => {
    expect(typeof styles).toBe('string')
    expect(styles.length).toBeGreaterThan(100)
  })

  // ===== Tier 17-A.5 additions =====

  test(':has()-driven Field validity rule is present (label + hint)', () => {
    expect(styles).toContain(
      '.place-field:has(input:user-invalid, textarea:user-invalid, select:user-invalid) > label',
    )
    expect(styles).toContain(
      '.place-field:has(input:user-invalid, textarea:user-invalid, select:user-invalid) .place-field-hint',
    )
    // Routed to the destructive token, not a hardcoded color.
    expect(styles).toContain('var(--color-destructive')
  })

  test('form-level :has() dims submit buttons when any field is invalid', () => {
    expect(styles).toMatch(
      /form:has\(:user-invalid\)\s+\[type="submit"\]:not\(\[data-allow-invalid\]\)/,
    )
    // Provides an escape hatch — apps can opt their submit out via
    // `data-allow-invalid` for cases where they want their own UX.
  })

  test('text-wrap: balance applied to headings', () => {
    expect(styles).toMatch(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{\s*text-wrap:\s*balance/)
  })

  test('text-wrap: pretty applied to paragraph-like elements', () => {
    expect(styles).toMatch(
      /p,\s*li,\s*dd,\s*dt,\s*blockquote,\s*figcaption\s*\{[^}]*text-wrap:\s*pretty/,
    )
  })

  test('scrollbar-gutter: stable on <html> to prevent modal-open layout shift', () => {
    expect(styles).toMatch(/html\s*\{[^}]*scrollbar-gutter:\s*stable/)
  })

  // ===== Tier 17-E — per-side Sheet slide-in =====
  test('Sheet @starting-style includes per-side translate rules (all 4 sides)', () => {
    expect(styles).toMatch(/data-side="right"\]\[open\][^{]*\{[^}]*translateX\(100%\)/)
    expect(styles).toMatch(/data-side="left"\]\[open\][^{]*\{[^}]*translateX\(-100%\)/)
    expect(styles).toMatch(/data-side="top"\]\[open\][^{]*\{[^}]*translateY\(-100%\)/)
    expect(styles).toMatch(/data-side="bottom"\]\[open\][^{]*\{[^}]*translateY\(100%\)/)
  })
})
