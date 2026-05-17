// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { renderSecurityHeaders } from '../../src/index.ts'

// renderSecurityHeaders is a pure function — covers preset baselines,
// CSP directive serialization (kebab-case + quoted keywords), HSTS
// formatting, Permissions-Policy, and the auto style-hash injection
// that lets strict CSP coexist with inlined Tailwind CSS.

describe('renderSecurityHeaders — security headers', () => {
  test('undefined → empty object (opt-in)', () => {
    expect(renderSecurityHeaders(undefined)).toEqual({})
  })

  test("'none' preset → empty object", () => {
    expect(renderSecurityHeaders('none')).toEqual({})
  })

  test("'strict' preset emits CSP, HSTS, Referrer-Policy, nosniff, frame headers", () => {
    const h = renderSecurityHeaders('strict')
    expect(h['Content-Security-Policy']).toContain("default-src 'self'")
    expect(h['Content-Security-Policy']).toContain("script-src 'self'")
    expect(h['Content-Security-Policy']).toContain("object-src 'none'")
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'")
    expect(h['Content-Security-Policy']).toContain("img-src 'self' data:")
    expect(h['Strict-Transport-Security']).toMatch(/max-age=\d+/)
    expect(h['Strict-Transport-Security']).toContain('includeSubDomains')
    expect(h['Referrer-Policy']).toBe('no-referrer')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin')
  })

  test("'standard' preset omits HSTS (dev-friendly)", () => {
    const h = renderSecurityHeaders('standard')
    expect(h['Content-Security-Policy']).toContain("default-src 'self'")
    expect(h['Strict-Transport-Security']).toBeUndefined()
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })

  test('explicit CSP overrides preset directives via merge', () => {
    const h = renderSecurityHeaders({
      preset: 'strict',
      csp: { scriptSrc: ['self', 'https://cdn.example'] },
    })
    expect(h['Content-Security-Policy']).toContain("script-src 'self' https://cdn.example")
    // Other strict directives still present.
    expect(h['Content-Security-Policy']).toContain("object-src 'none'")
  })

  test('csp: false disables the CSP header even when preset has one', () => {
    const h = renderSecurityHeaders({ preset: 'strict', csp: false })
    expect(h['Content-Security-Policy']).toBeUndefined()
    // Other strict headers still applied.
    expect(h['Strict-Transport-Security']).toBeDefined()
  })

  test('CSP: keywords get single-quoted, hosts/schemes pass through', () => {
    const h = renderSecurityHeaders({
      preset: 'none',
      csp: {
        defaultSrc: ['self', 'https://api.example.com', 'data:', "'sha256-abc='"],
      },
    })
    expect(h['Content-Security-Policy']).toBe(
      "default-src 'self' https://api.example.com data: 'sha256-abc='",
    )
  })

  test('CSP: camelCase directives serialize to kebab-case', () => {
    const h = renderSecurityHeaders({
      preset: 'none',
      csp: { scriptSrcElem: 'self', upgradeInsecureRequests: true },
    })
    expect(h['Content-Security-Policy']).toContain("script-src-elem 'self'")
    expect(h['Content-Security-Policy']).toContain('upgrade-insecure-requests')
  })

  test('CSP: report-uri / report-to render unquoted', () => {
    const h = renderSecurityHeaders({
      preset: 'none',
      csp: { defaultSrc: 'self', reportUri: '/csp-report', reportTo: 'csp-endpoint' },
    })
    expect(h['Content-Security-Policy']).toContain('report-uri /csp-report')
    expect(h['Content-Security-Policy']).toContain('report-to csp-endpoint')
  })

  test('extra style hashes auto-merge into style-src', () => {
    const h = renderSecurityHeaders('strict', { extraStyleHashes: ['ABC123='] })
    expect(h['Content-Security-Policy']).toContain("style-src 'self' 'sha256-ABC123='")
  })

  test('extra style hashes do nothing when style-src is disabled', () => {
    const h = renderSecurityHeaders(
      { preset: 'none', csp: { defaultSrc: 'self', styleSrc: false } },
      { extraStyleHashes: ['ABC='] },
    )
    expect(h['Content-Security-Policy']).not.toContain('style-src')
  })

  test('HSTS: explicit options override defaults', () => {
    const h = renderSecurityHeaders({
      preset: 'none',
      hsts: { maxAge: 60, includeSubDomains: false, preload: true },
    })
    expect(h['Strict-Transport-Security']).toBe('max-age=60; preload')
  })

  test('Permissions-Policy: deny vs allowlist', () => {
    const h = renderSecurityHeaders({
      preset: 'none',
      permissionsPolicy: {
        camera: false,
        geolocation: ['self'],
        microphone: ['self', 'https://meet.example'],
      },
    })
    const pp = h['Permissions-Policy']
    expect(pp).toContain('camera=()')
    expect(pp).toContain('geolocation=(self)')
    expect(pp).toContain('microphone=(self "https://meet.example")')
  })

  test('user-supplied SecurityOptions object with no preset defaults to standard', () => {
    const h = renderSecurityHeaders({ csp: { defaultSrc: 'self' } })
    // standard preset was applied as the baseline.
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['Strict-Transport-Security']).toBeUndefined()
  })
})
