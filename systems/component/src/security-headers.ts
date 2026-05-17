// ===== Security headers — typed CSP + presets =====
//
// Replaces hand-rolled `'Content-Security-Policy': "default-src 'self'; …"`
// strings. Each directive is a typed field; serialization is one place.
//
//   security: 'strict'                         // preset
//   security: { csp: { scriptSrc: ['self', 'https://cdn.example'] } }
//   security: { preset: 'strict', referrerPolicy: 'origin' }  // override
//
// Why presets PLUS typed overrides: most apps want sensible defaults
// (the `'strict'` preset is a security-team-approved baseline). Apps
// that need to deviate add a typed override — no string parsing, no
// regex-substitute-the-policy gymnastics.
//
// Extracted from index.ts (audit Phase 2.1, Cut 1e). Public types and
// functions are re-exported by index.ts for the framework's public
// surface; serve()'s internal pipeline imports `renderSecurityHeaders`,
// `generateScriptNonce`, `sha256Base64`, and `RenderSecurityOptions`
// back into index.ts.

/**
 * CSP source value. Special keywords are unquoted in this type (the
 * renderer adds the single-quotes); host expressions, schemes, and
 * hashes pass through verbatim.
 *
 *   'self', 'none', 'unsafe-inline', 'unsafe-eval',
 *   'strict-dynamic', 'unsafe-hashes', 'wasm-unsafe-eval',
 *   'data:', 'blob:', 'https:', 'wss:',
 *   'https://cdn.example.com',
 *   "'sha256-…'",  // hashes are pre-quoted (escape hatch)
 *   "'nonce-…'"
 */
export type CSPSource = string

/** A CSP directive value: one source, multiple sources, or `false` to omit. */
export type CSPDirective = CSPSource | CSPSource[] | false

/** Typed CSP config. Each field maps to one CSP directive. */
export interface CSPConfig {
  defaultSrc?: CSPDirective
  scriptSrc?: CSPDirective
  scriptSrcElem?: CSPDirective
  scriptSrcAttr?: CSPDirective
  styleSrc?: CSPDirective
  styleSrcElem?: CSPDirective
  styleSrcAttr?: CSPDirective
  imgSrc?: CSPDirective
  fontSrc?: CSPDirective
  connectSrc?: CSPDirective
  mediaSrc?: CSPDirective
  objectSrc?: CSPDirective
  frameSrc?: CSPDirective
  frameAncestors?: CSPDirective
  childSrc?: CSPDirective
  workerSrc?: CSPDirective
  manifestSrc?: CSPDirective
  baseUri?: CSPDirective
  formAction?: CSPDirective
  /** `upgrade-insecure-requests` directive (no value). */
  upgradeInsecureRequests?: boolean
  /** Where the browser POSTs CSP violation reports. */
  reportUri?: string
  /** Modern report-to group name (paired with Reporting-Endpoints header). */
  reportTo?: string
}

/** HSTS (Strict-Transport-Security) options. */
export interface HSTSConfig {
  /** Cache duration in seconds. Default: 63072000 (2 years). */
  maxAge?: number
  /** Apply to subdomains too. Default: true. */
  includeSubDomains?: boolean
  /** Eligible for browser preload list. Default: false. */
  preload?: boolean
}

/** Referrer-Policy values. */
export type ReferrerPolicy =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url'

/** Cross-Origin-* policy values. */
export type CrossOriginOpenerPolicy = 'unsafe-none' | 'same-origin-allow-popups' | 'same-origin'
export type CrossOriginEmbedderPolicy = 'unsafe-none' | 'require-corp' | 'credentialless'
export type CrossOriginResourcePolicy = 'same-site' | 'same-origin' | 'cross-origin'

/** Permissions-Policy entries — featureName → allowlist or `false` for deny. */
export interface PermissionsPolicyConfig {
  [feature: string]: false | CSPSource[]
}

export type SecurityPreset = 'strict' | 'standard' | 'none'

/** Full security config. Use `preset` for a baseline, then override fields. */
export interface SecurityOptions {
  /**
   * Baseline preset. Other fields override the preset's defaults.
   * Default: 'standard'.
   */
  preset?: SecurityPreset
  /** Content-Security-Policy. Pass `false` to disable. */
  csp?: CSPConfig | false
  /** Strict-Transport-Security. `true` uses sensible defaults. */
  hsts?: boolean | HSTSConfig
  /** Referrer-Policy. */
  referrerPolicy?: ReferrerPolicy
  /** X-Content-Type-Options: nosniff. Default: true. */
  noSniff?: boolean
  /** X-Frame-Options. Superseded by CSP frame-ancestors but kept for old browsers. */
  frameOptions?: 'DENY' | 'SAMEORIGIN'
  /** Cross-Origin-Opener-Policy. */
  coop?: CrossOriginOpenerPolicy
  /** Cross-Origin-Embedder-Policy. */
  coep?: CrossOriginEmbedderPolicy
  /** Cross-Origin-Resource-Policy. */
  corp?: CrossOriginResourcePolicy
  /** Permissions-Policy (formerly Feature-Policy). */
  permissionsPolicy?: PermissionsPolicyConfig
}

export type Security = SecurityPreset | SecurityOptions

// CSP keywords that need to be wrapped in single-quotes when serialized.
const CSP_KEYWORDS = new Set([
  'self',
  'none',
  'unsafe-inline',
  'unsafe-eval',
  'unsafe-hashes',
  'strict-dynamic',
  'wasm-unsafe-eval',
  'report-sample',
])

function quoteCSPSource(s: string): string {
  // Already quoted (hash / nonce expressions): pass through.
  if (s.startsWith("'")) return s
  // Bare keyword: wrap in single quotes.
  if (CSP_KEYWORDS.has(s)) return `'${s}'`
  // Host / scheme / URL: pass through.
  return s
}

// camelCase directive name → kebab-case CSP directive.
function cspDirectiveName(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function renderCSP(csp: CSPConfig): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(csp)) {
    if (value === false || value == null) continue
    if (key === 'upgradeInsecureRequests') {
      if (value === true) parts.push('upgrade-insecure-requests')
      continue
    }
    if (key === 'reportUri') {
      parts.push(`report-uri ${value}`)
      continue
    }
    if (key === 'reportTo') {
      parts.push(`report-to ${value}`)
      continue
    }
    const directive = cspDirectiveName(key)
    const sources = Array.isArray(value) ? value : [value as CSPSource]
    parts.push(`${directive} ${sources.map(quoteCSPSource).join(' ')}`)
  }
  return parts.join('; ')
}

/**
 * Permissions-Policy denylist — every sensitive web API explicitly
 * blocked. Apps that need any of these must opt in by setting the
 * specific feature in their security override (e.g.
 * `security: { permissionsPolicy: { camera: ['self'] } }`).
 *
 * The default-deny approach matches the CSP `defaultSrc: 'self'` philosophy:
 * fail-closed, opt-in for legitimate use.
 *
 * Only features currently in the W3C Permissions Policy registry are
 * listed. Browsers warn (not just no-op) when unknown features appear
 * in the header, so deprecated names — `ambient-light-sensor` (never
 * shipped beyond Origin Trial), `battery` (Battery Status API
 * deprecated), `document-domain` (never adopted as a Permissions
 * Policy feature) — are excluded. Add new features here as the
 * registry grows.
 */
const DENY_ALL_PERMISSIONS = {
  accelerometer: false,
  autoplay: false,
  bluetooth: false,
  camera: false,
  'cross-origin-isolated': false,
  'display-capture': false,
  'encrypted-media': false,
  fullscreen: false,
  geolocation: false,
  gyroscope: false,
  hid: false,
  'idle-detection': false,
  magnetometer: false,
  microphone: false,
  midi: false,
  payment: false,
  'picture-in-picture': false,
  'publickey-credentials-get': false,
  'screen-wake-lock': false,
  serial: false,
  usb: false,
  'web-share': false,
  'xr-spatial-tracking': false,
} as const

// Preset baselines. Each preset returns a fully-resolved SecurityOptions
// (sans `preset`). Overrides merge on top of these.
function presetOptions(preset: SecurityPreset): Omit<SecurityOptions, 'preset'> {
  switch (preset) {
    case 'strict':
      // Lock everything to 'self'. Object/frame disabled. HSTS on (2y).
      // Permissions-Policy denies all sensitive APIs (camera, mic, geo,
      // etc.) — apps that legitimately need them must opt in. COEP is
      // require-corp for full process isolation.
      return {
        csp: {
          defaultSrc: 'self',
          scriptSrc: 'self',
          styleSrc: 'self',
          imgSrc: ['self', 'data:'],
          fontSrc: 'self',
          connectSrc: 'self',
          objectSrc: 'none',
          frameSrc: 'none',
          frameAncestors: 'none',
          baseUri: 'self',
          formAction: 'self',
        },
        hsts: true,
        referrerPolicy: 'no-referrer',
        noSniff: true,
        frameOptions: 'DENY',
        coop: 'same-origin',
        coep: 'require-corp',
        corp: 'same-origin',
        permissionsPolicy: DENY_ALL_PERMISSIONS,
      }
    case 'standard':
      // Same as strict, minus HSTS (avoids dev-HTTP self-pwn) and with
      // looser referrer policy. Frame-ancestors still 'none'.
      // Permissions-Policy denies sensitive APIs by default — apps opt
      // in by overriding (e.g. `permissionsPolicy: { camera: ['self'] }`).
      // COEP unset (require-corp breaks Tailwind CDN images, OAuth
      // popups, etc.; the strict preset enables it for apps that pre-
      // verified compatibility).
      return {
        csp: {
          defaultSrc: 'self',
          scriptSrc: 'self',
          styleSrc: 'self',
          imgSrc: ['self', 'data:'],
          fontSrc: 'self',
          connectSrc: 'self',
          objectSrc: 'none',
          frameAncestors: 'none',
          baseUri: 'self',
        },
        referrerPolicy: 'strict-origin-when-cross-origin',
        noSniff: true,
        coop: 'same-origin',
        permissionsPolicy: DENY_ALL_PERMISSIONS,
      }
    case 'none':
      return {}
  }
}

export interface RenderSecurityOptions {
  /** Extra hashes to add to CSP `style-src` — used when Tailwind inlines
   *  CSS so the strict CSP keeps working without `'unsafe-inline'`.
   *  These hashes cover `<style>` blocks (style-src element matching);
   *  they do NOT cover `style="…"` attribute values — see
   *  `inlineStyleAttrHashes` for those. */
  extraStyleHashes?: string[]
  /**
   * Per-request SHA-256 hashes (base64, unquoted) of `style="…"`
   * attribute values emitted during SSR. When non-empty the renderer:
   *   1. Adds `'unsafe-hashes'` to `style-src` (CSP-3 requirement for
   *      hash-matching inline-style-attribute content).
   *   2. Adds `'sha256-<hash>'` for each value.
   *
   * Pair with `_beginInlineStyleCollection` / `_endInlineStyleCollection`
   * around the SSR render so the dispatcher knows exactly which values
   * fired in THIS response. T6-B.
   */
  inlineStyleAttrHashes?: string[]
  /**
   * Per-request script nonce. When set, `'nonce-XXX'` is appended to
   * `script-src`. The same nonce must appear on the `nonce` attribute of
   * every inline `<script>` the server emits. Streaming SSR uses this
   * to allow its inline runtime + swap chunks under strict CSP without
   * needing `'unsafe-inline'` or `'unsafe-eval'`.
   *
   * Generate with `generateScriptNonce()` once per request.
   */
  scriptNonce?: string
}

/**
 * Generate a cryptographically random nonce suitable for CSP `script-src`.
 * 128 bits of entropy, base64-encoded — meets OWASP / Google CSP guidance.
 *
 * Generate ONE nonce per HTTP response and use it for both:
 *   1. The `nonce="..."` attribute on every inline `<script>` tag.
 *   2. The `'nonce-...'` source in CSP `script-src`.
 *
 * Browsers allow scripts whose attribute matches the policy's nonce and
 * block all other inline scripts. Reusing a nonce across responses
 * defeats the security model — always generate a fresh one.
 */
export function generateScriptNonce(): string {
  const bytes = new Uint8Array(16) // 128 bits — OWASP minimum
  crypto.getRandomValues(bytes)
  // Base64 (standard). The CSP-3 spec accepts both base64 and base64url
  // for nonces; standard base64 is the most widely supported.
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number)
  return btoa(binary)
}

export function renderSecurityHeaders(
  security: Security | undefined,
  extra?: RenderSecurityOptions,
): Record<string, string> {
  if (!security) return {}
  const opts: SecurityOptions = typeof security === 'string' ? { preset: security } : security
  const preset = opts.preset ?? 'standard'
  const base = presetOptions(preset)
  // Merge: user options override preset. csp deep-merges.
  const merged: SecurityOptions = { ...base, ...opts }
  if (opts.csp !== undefined) {
    if (opts.csp === false) merged.csp = false
    else merged.csp = { ...(base.csp || {}), ...opts.csp }
  }

  const headers: Record<string, string> = {}

  if (merged.csp !== false && merged.csp) {
    const csp = { ...merged.csp }
    // Auto-add inline-style hashes (e.g. Tailwind) without forcing
    // 'unsafe-inline'. The hashes only apply if styleSrc is set.
    if (extra?.extraStyleHashes?.length && csp.styleSrc !== false) {
      const existing = csp.styleSrc
        ? Array.isArray(csp.styleSrc)
          ? csp.styleSrc
          : [csp.styleSrc]
        : []
      csp.styleSrc = [...existing, ...extra.extraStyleHashes.map((h) => `'sha256-${h}'`)]
    }
    // T6-B: per-request `style="…"` attribute hashes. CSP-3 requires
    // `'unsafe-hashes'` for inline-style-ATTRIBUTE hash matching (vs
    // inline `<style>` BLOCK matching, which works without it). When
    // attribute hashes are present, add both keywords automatically;
    // when there are none, leave style-src untouched so the policy
    // remains as tight as before.
    if (extra?.inlineStyleAttrHashes?.length && csp.styleSrc !== false) {
      const existing = csp.styleSrc
        ? Array.isArray(csp.styleSrc)
          ? csp.styleSrc
          : [csp.styleSrc]
        : []
      const sources: CSPSource[] = [
        ...existing,
        "'unsafe-hashes'",
        ...extra.inlineStyleAttrHashes.map((h) => `'sha256-${h}'`),
      ]
      csp.styleSrc = sources
    }
    // Auto-add the per-request script nonce so inline <script> tags we
    // emit (streaming runtime + suspense swap chunks + load data tag)
    // pass strict CSP without `'unsafe-inline'`.
    if (extra?.scriptNonce && csp.scriptSrc !== false) {
      const existing = csp.scriptSrc
        ? Array.isArray(csp.scriptSrc)
          ? csp.scriptSrc
          : [csp.scriptSrc]
        : []
      csp.scriptSrc = [...existing, `'nonce-${extra.scriptNonce}'`]
    }
    headers['Content-Security-Policy'] = renderCSP(csp)
  }

  if (merged.hsts) {
    const h = merged.hsts === true ? {} : merged.hsts
    const maxAge = h.maxAge ?? 63072000
    let value = `max-age=${maxAge}`
    if (h.includeSubDomains !== false) value += '; includeSubDomains'
    if (h.preload === true) value += '; preload'
    headers['Strict-Transport-Security'] = value
  }

  if (merged.referrerPolicy) headers['Referrer-Policy'] = merged.referrerPolicy
  if (merged.noSniff !== false && (merged.noSniff || merged.csp))
    headers['X-Content-Type-Options'] = 'nosniff'
  if (merged.frameOptions) headers['X-Frame-Options'] = merged.frameOptions
  if (merged.coop) headers['Cross-Origin-Opener-Policy'] = merged.coop
  if (merged.coep) headers['Cross-Origin-Embedder-Policy'] = merged.coep
  if (merged.corp) headers['Cross-Origin-Resource-Policy'] = merged.corp

  if (merged.permissionsPolicy) {
    const parts: string[] = []
    for (const [feature, value] of Object.entries(merged.permissionsPolicy)) {
      if (value === false) parts.push(`${feature}=()`)
      else
        parts.push(`${feature}=(${value.map((v) => (v === 'self' ? 'self' : `"${v}"`)).join(' ')})`)
    }
    headers['Permissions-Policy'] = parts.join(', ')
  }

  return headers
}

/**
 * SHA-256 base64 of a string. Used to add an inline-style hash to CSP
 * so strict CSP works alongside inlined Tailwind CSS without
 * `'unsafe-inline'`. Exported because serve()'s Tailwind integration
 * uses it; tightly related to CSP so it lives here, not in utils.
 */
export async function sha256Base64(input: string): Promise<string> {
  const enc = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input))
  // Convert ArrayBuffer to base64 without Buffer (browser-safe).
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i] as number)
  return btoa(binary)
}
