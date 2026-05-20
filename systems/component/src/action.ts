// @place/component action() — typed mutation endpoint, no codegen.
//
// One declaration produces three outputs: a route handler that the
// server registers, a typed client `call()` function, and the path
// string for reference. Both sides import the same `action()` result;
// the server side spreads `.handler` into `serve({ routes })` and the
// client calls `.call(input)` with type inference end-to-end.
//
// Compared to alternatives:
//   - Next Server Actions: requires a Babel/SWC pass that hashes
//     function bodies into encrypted IDs + a runtime that POSTs to a
//     single endpoint. Magical. We don't do that.
//   - Remix `action` exports: tied to the page route. Ours are
//     standalone — any client code can call them.
//   - tRPC: requires a router DSL (`appRouter.user.list.useQuery()`).
//     Ours is a per-function declaration, no router builder needed.
//
// What this provides on top of writing a plain POST handler + fetch
// wrapper by hand:
//   - One place to define the input schema; both client validation
//     (fast-fail before fetch) and server validation use it.
//   - Inferred return type — `await like.call({id})` is typed by what
//     the handler returns, no manual `<Result>` annotations.
//   - Headers/CSRF integration via the request capability scope
//     (when running through serve(), per Phase 4.1).
//   - Error shape: structured ActionError with status code, message,
//     and optional payload. No silent fetch failures.

export interface LoadCtx {
  req: Request
  url: URL
  params: Record<string, string>
  /**
   * `true` when the request is a speculative SPA-nav **prefetch**
   * (warmed on link hover/focus, not an actual visit). Effect-running
   * code branches on this. Always `false` for an action invocation —
   * actions are POST and never prefetched — but the field is present
   * so this `LoadCtx` stays structurally identical to the component
   * system's `LoadCtx` (the `on:` handler interop point).
   */
  prefetch: boolean
}

/**
 * A schema is any function that takes raw `unknown` input and returns
 * a validated, typed value (or throws on invalid input). Compatible
 * with Zod's `.parse()`, Valibot's `.parse`, hand-rolled validators,
 * etc. — we don't import any specific validator library.
 *
 * For Zod: `input: Schema.parse` (the bound method).
 * For Valibot: `input: (raw) => parse(Schema, raw)`.
 * Plain: `input: (raw) => raw as { id: string }` (unsafe; explicit).
 *
 * For the common "object with primitive fields" case use `shape()` —
 * a tiny built-in helper that produces an `ActionSchema<T>` from a
 * field-type map. No external dependencies.
 */
export type ActionSchema<T> = (raw: unknown) => T

/**
 * Map of field type names to the runtime types we recognize for
 * `shape()`. Add `'?'` suffix to mark a field optional:
 * `{ id: 'string', count: 'number?' }` → id is required, count optional.
 */
export type ShapeField = 'string' | 'number' | 'boolean' | 'string?' | 'number?' | 'boolean?'

type StripOptional<F extends ShapeField> = F extends `${infer Base}?`
  ? Base extends 'string'
    ? string | undefined
    : Base extends 'number'
      ? number | undefined
      : Base extends 'boolean'
        ? boolean | undefined
        : never
  : F extends 'string'
    ? string
    : F extends 'number'
      ? number
      : F extends 'boolean'
        ? boolean
        : never

/** Inferred TypeScript type for a `shape({...})` definition. */
export type ShapeOf<S extends Record<string, ShapeField>> = {
  [K in keyof S]: StripOptional<S[K]>
}

/**
 * Tiny built-in object validator. Use for the common case of action
 * inputs that are flat objects of string/number/boolean fields. The
 * returned function fits `ActionSchema<T>`:
 *
 * ```ts
 * export const likePost = action({
 *   path: 'POST /api/likePost',
 *   input: shape({ id: 'string', count: 'number?' }),
 *   fn: ({ id, count }) => …,  // id: string, count: number | undefined
 * })
 * ```
 *
 * Throws on type mismatch with a clear message naming the offending
 * field. Use Zod / Valibot for nested structures, unions, transforms.
 */
// Coercion rules (FormData arrives as strings — no-JS form-submission
// path can't carry typed values natively):
//   - 'number': `Number(s)` then `Number.isFinite` check; NaN rejects.
//   - 'boolean': true ← 'true' | '1' | 'on' | 'yes'  (HTML checkbox);
//                false ← 'false' | '0' | '' | 'off' | 'no'.
//   - 'string': pass through.
// The rules are now inlined into the compiled decoder (see
// `compileShape` below) — there's no shared helper because every spec
// gets its own specialised code path.

// Keys must look like plain JS identifiers so codegen can inline
// `obj.<key>` access without escaping. Same rule for the type values
// (`'string' | 'number' | 'boolean' | '<base>?'`). Anything else
// (newlines, quotes, escape characters) means a malicious spec is
// trying to smuggle JS into the generated source — fail loud at
// schema-construction time. This is paranoid defense; the only way a
// hostile spec reaches `shape()` is if a developer's code dynamically
// builds one from untrusted input, which is itself a bug. The check is
// here so that bug surfaces at boot, not at the next request.
const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const SAFE_TYPES = new Set<string>(['string', 'number', 'boolean', 'string?', 'number?', 'boolean?'])

/**
 * `shape({...})` builds a specialised decoder at construction time
 * (Phase 5 / ADR 0055). For a flat object spec, we emit a JIT-compiled
 * `new Function('raw', '<body>')` whose body is straight-line inlined
 * property reads + type checks — no `Object.entries`, no per-call
 * `endsWith('?')` parsing, no dictionary builder loop. Net effect: the
 * interpreter walks one tight basic block per field instead of
 * dispatching on the spec map. Microbenchmarks land ~10× faster on
 * typical 3-5 field bodies, with a one-shot codegen cost amortised
 * across every request.
 *
 * The codegen inputs are TRUSTED — they're the framework user's own
 * source (the field names and type literals in their `shape({...})`
 * call). We still validate the key + type shape with anchored regexes
 * so a hostile spec built dynamically from untrusted input can't
 * smuggle JS into the generated source. The schema-construction
 * itself throws on a bad spec; runtime requests can never reach the
 * Function() call.
 *
 * Errors thrown from the compiled decoder match the legacy errors
 * exactly (same wording, same field order) so the test suite + any
 * downstream error parsers stay green.
 */
export function shape<S extends Record<string, ShapeField>>(spec: S): ActionSchema<ShapeOf<S>> {
  const entries = Object.entries(spec) as [string, ShapeField][]
  // Validate every key + type literal BEFORE emitting source. Bad
  // input throws synchronously at module-load time, never at request
  // time. JSON-pollution sentinels (`__proto__`, `constructor`,
  // `prototype`) are rejected because they could collide with the
  // output object's prototype chain via direct assignment.
  const POLLUTION = new Set<string>(['__proto__', 'constructor', 'prototype'])
  for (const [key, type] of entries) {
    if (!SAFE_KEY.test(key)) {
      throw new Error(
        `shape: field name ${JSON.stringify(key)} is not a safe JS identifier ` +
          '(must match /^[A-Za-z_$][A-Za-z0-9_$]*$/). Rename the field.',
      )
    }
    if (POLLUTION.has(key)) {
      throw new Error(`shape: field name ${JSON.stringify(key)} is a reserved object key`)
    }
    if (typeof type !== 'string' || !SAFE_TYPES.has(type)) {
      throw new Error(
        `shape: field '${key}' has unsupported type ${JSON.stringify(type)}. ` +
          'Use one of: string, number, boolean, string?, number?, boolean?',
      )
    }
  }
  return compileShape(entries) as ActionSchema<ShapeOf<S>>
}

// Emit a per-spec decoder. The compiled function closes over a single
// `coerce` reference (the helper, by closure) — every other reference
// is a literal in the source so V8 / JSC can inline aggressively.
function compileShape(
  entries: ReadonlyArray<readonly [string, ShapeField]>,
): (raw: unknown) => Record<string, unknown> {
  const lines: string[] = [
    "if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {",
    "  throw new Error('shape: expected an object');",
    '}',
  ]
  // Build the result object literal at the end so V8's allocation
  // site is monomorphic per spec — every call to the compiled
  // decoder produces an object with the same hidden class.
  const resultFields: string[] = []
  for (const [key, type] of entries) {
    const optional = type.endsWith('?')
    const baseType = optional ? type.slice(0, -1) : type
    const localVar = `v_${key}`
    const keyLit = JSON.stringify(key)
    lines.push(`var ${localVar} = raw[${keyLit}];`)
    if (optional) {
      lines.push(`if (${localVar} === undefined || ${localVar} === null) { ${localVar} = undefined; }`)
      lines.push(`else {`)
    } else {
      lines.push(
        `if (${localVar} === undefined || ${localVar} === null) {`,
        `  throw new Error("shape: missing required field '${key}'");`,
        '}',
      )
    }
    // FormData arrives as strings — auto-coerce per legacy semantics.
    if (baseType === 'number') {
      lines.push(
        `  if (typeof ${localVar} === 'string') {`,
        `    var __n = Number(${localVar});`,
        `    if (!Number.isFinite(__n)) {`,
        `      throw new Error("shape: cannot coerce '" + ${localVar} + "' to number");`,
        '    }',
        `    ${localVar} = __n;`,
        '  }',
      )
    } else if (baseType === 'boolean') {
      lines.push(
        `  if (typeof ${localVar} === 'string') {`,
        `    var __s = ${localVar}.toLowerCase();`,
        `    if (__s === 'true' || __s === '1' || __s === 'on' || __s === 'yes') ${localVar} = true;`,
        `    else if (__s === 'false' || __s === '0' || __s === '' || __s === 'off' || __s === 'no') ${localVar} = false;`,
        `    else throw new Error("shape: cannot coerce '" + ${localVar} + "' to boolean");`,
        '  }',
      )
    }
    // Final type check matches the legacy `typeof === baseType` test.
    lines.push(
      `  var __t = typeof ${localVar};`,
      `  if (__t !== '${baseType}') {`,
      `    throw new Error("shape: field '${key}' expected ${baseType}, got " + __t);`,
      '  }',
    )
    if (optional) {
      lines.push('}')
    }
    resultFields.push(`${keyLit}: ${localVar}`)
  }
  lines.push(`return { ${resultFields.join(', ')} };`)
  const body = lines.join('\n')
  // Sanity: the keys + types passed SAFE_KEY / SAFE_TYPES, so `body`
  // contains only literal strings + identifiers built from those
  // validated tokens. We never interpolate untrusted runtime input.
  // eslint-disable-next-line no-new-func
  return new Function('raw', body) as (raw: unknown) => Record<string, unknown>
}

/**
 * `action()` definition: a path string in `'METHOD /url'` shape, an
 * input schema, and a server-side function that takes the validated
 * input plus a request context and returns a value.
 *
 * The `fn` body MUST NOT ship to the browser. The standard pattern:
 * put action definitions in `*.action.ts` files (or any module
 * imported only by server.ts), so the browser bundle never reaches
 * them.
 */
export interface ActionDef<I, R> {
  path: string
  input: ActionSchema<I>
  fn: (input: I, ctx: LoadCtx) => R | Promise<R>
  /**
   * Same-origin enforcement. State-changing methods (POST/PUT/DELETE/
   * PATCH) reject cross-origin requests by default — the browser's
   * `Origin` header must match the request URL's origin (or `Referer`
   * if Origin is missing). Closes the standard CSRF surface without
   * any per-app config.
   *
   * - `true` (default for state-changing methods): enforce same-origin
   * - `false`: opt out — the action accepts cross-origin requests.
   *   Use only for endpoints intentionally exposed cross-origin
   *   (webhook receivers, public APIs); pair with explicit token auth.
   */
  sameOrigin?: boolean
  /**
   * Maximum request body size in bytes. Requests with a `Content-Length`
   * header exceeding this are rejected with 413 before the body is read.
   * Default: 1 MB (1_048_576). Increase for actions that accept large
   * uploads; decrease for tighter DoS bounds.
   */
  maxBodyBytes?: number
  /**
   * Optional signed CSRF token verification. When set, the request must
   * include a valid `X-CSRF-Token` header (or `__csrf` form field) that
   * verifies under the same secret + audience used to mint it. Use
   * `csrfToken()` from `@place/security` to mint tokens at session
   * establishment; pass the same `verify` here.
   *
   * Origin check (`sameOrigin`) covers most CSRF surface; this is the
   * paranoid-mode add-on for high-value mutations (auth, billing, admin).
   */
  csrf?: {
    /** The verify function from `csrfToken(secret, opts).verify`. */
    verify: (token: string, audience: string) => Promise<boolean> | boolean
    /** Audience extractor — usually the user/session ID. */
    audience: (req: Request) => string | Promise<string>
  }
}

/**
 * Result of `action()`: a typed call site (`call(input)` returns
 * `Promise<R>`), a route handler ready to spread into
 * `serve({ routes: { ...action.handler } })`, and the path string.
 */
export interface Action<I, R> {
  /** Call from any client component. Type-inferred end-to-end. */
  call(input: I): Promise<R>
  /**
   * Route table fragment. Spread into `serve({ routes })`:
   *
   *     serve({ routes: { ...like.handler, '/': home } })
   */
  handler: Record<string, (req: Request, params: Record<string, string>) => Promise<Response>>
  /** The path the action POSTs to. Useful for tests / debugging. */
  path: string
}

/**
 * Structured error thrown when `call()` receives a non-2xx response.
 * Captures the status code, the server's error message, and any
 * payload the handler attached.
 */
export class ActionError extends Error {
  readonly status: number
  readonly payload: unknown
  constructor(status: number, message: string, payload?: unknown) {
    super(message)
    this.status = status
    this.payload = payload
    this.name = 'ActionError'
  }
}

// ===== Standard Schema interop (T16-C, ADR 0045) =====
//
// `fromStandard(schema)` adapts any validator implementing the
// Standard Schema v1 spec (https://standardschema.dev) — Zod 3.24+,
// Valibot 0.36+, ArkType, Effect Schema, etc. — to an
// `ActionSchema<T>` with structured field-level errors. The framework
// stays validator-agnostic: no library dep, no bespoke API. The
// types below are inlined from the spec rather than pulled from
// `@standard-schema/spec` so `@place/component` ships with zero
// validation-related deps.
//
// On validation failure, throws `ActionError(400, 'Validation failed',
// { fields: { [path]: message } })`. App's `<Form onError={...}>`
// handler narrows via `isValidationFailure(err.payload)` and routes
// each path to the matching `<Field error={...}>` state cell.

/**
 * Standard Schema v1 interface. A validator implements this by
 * exposing a `~standard` property whose `validate` function returns
 * either `{ value }` or `{ issues }`. Tagged with `'~standard'` so
 * the spec is robust against bag-of-methods collisions.
 *
 * @see https://standardschema.dev
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}

export namespace StandardSchemaV1 {
  export type Result<Output> = SuccessResult<Output> | FailureResult
  export interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
    readonly value?: undefined
  }
  export interface Issue {
    readonly message: string
    /** Path through the input structure to the offending value.
     *  Each segment is either a key (string/number/symbol) or
     *  `{ key }` (the Standard Schema "PathSegment" shape). */
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
  }
  /** Infer the validated output type from a Standard Schema. */
  export type InferOutput<S extends StandardSchemaV1> =
    S extends StandardSchemaV1<unknown, infer O> ? O : never
  /** Infer the accepted input type (rarely needed; usually inferred
   *  from the runtime call site). */
  export type InferInput<S extends StandardSchemaV1> =
    S extends StandardSchemaV1<infer I, unknown> ? I : never
}

/**
 * Structured payload shape on `ActionError.payload` when validation
 * fails through `fromStandard()`. Each key in `fields` is a dotted
 * path through the input ("email", "profile.age", "items.0.name"),
 * the value is the validator's message for that path.
 *
 * Apps narrow `err.payload` via `isValidationFailure(payload)` and
 * route each field's message to the matching `<Field error={...}>`
 * state cell.
 */
export interface ValidationFailure {
  readonly fields: Readonly<Record<string, string>>
}

/**
 * Type guard for `ActionError.payload` when the failure originated
 * in `fromStandard()`. Validates that `payload.fields` is a flat map
 * of string→string before narrowing.
 */
export function isValidationFailure(payload: unknown): payload is ValidationFailure {
  if (payload === null || typeof payload !== 'object') return false
  const fields = (payload as { fields?: unknown }).fields
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return false
  for (const v of Object.values(fields as Record<string, unknown>)) {
    if (typeof v !== 'string') return false
  }
  return true
}

/**
 * Adapt a Standard Schema validator to an `ActionSchema<T>`. Use
 * inline as the `input:` field of an `action()` definition:
 *
 * ```ts
 * import { z } from 'zod'
 * import { action, fromStandard } from '@place/component'
 *
 * export const signup = action({
 *   path: 'POST /api/signup',
 *   input: fromStandard(z.object({
 *     email: z.string().email(),
 *     age: z.number().int().min(18),
 *   })),
 *   fn: async ({ email, age }) => { ... },  // typed inputs
 * })
 * ```
 *
 * **Sync-only.** `action()` validates inputs synchronously at the
 * request boundary; if the validator's `validate()` returns a
 * Promise, `fromStandard()` throws `ActionError(500, ...)` so the
 * misconfiguration is obvious in dev. Resolve async checks inside
 * the action's `fn` body.
 *
 * **Error shape**: on failure, throws `ActionError(400,
 * 'Validation failed', { fields })`. See `ValidationFailure` +
 * `isValidationFailure` for the type-narrowing pattern.
 *
 * @provisional — shipped in Tier 16 (ADR 0045). Standard Schema v1 is
 * stable; this adapter follows the spec. If v2 lands with breaking
 * changes, a `fromStandardV2()` shim will be added rather than
 * mutating this function's contract.
 */
export function fromStandard<S extends StandardSchemaV1>(
  schema: S,
): ActionSchema<StandardSchemaV1.InferOutput<S>> {
  return (raw): StandardSchemaV1.InferOutput<S> => {
    const result = schema['~standard'].validate(raw)
    if (result instanceof Promise) {
      throw new ActionError(
        500,
        'fromStandard: async validators are not supported in action input. ' +
          'Resolve async checks inside the action fn body instead.',
      )
    }
    if ('issues' in result && result.issues !== undefined) {
      const fields: Record<string, string> = {}
      for (const issue of result.issues) {
        const path = issue.path ?? []
        const pathStr = path
          .map((seg) => {
            if (typeof seg === 'object' && seg !== null && 'key' in seg) {
              return String(seg.key)
            }
            return String(seg)
          })
          .join('.')
        const key = pathStr || '_root'
        // Keep the first message per field; repeats are UI noise.
        if (!(key in fields)) fields[key] = issue.message
      }
      throw new ActionError(400, 'Validation failed', { fields })
    }
    return (result as { value: StandardSchemaV1.InferOutput<S> }).value
  }
}

function parsePath(spec: string): { method: string; path: string } {
  const space = spec.indexOf(' ')
  if (space < 0) {
    // No method given — default to POST (the most common case for actions).
    return { method: 'POST', path: spec }
  }
  return {
    method: spec.slice(0, space).toUpperCase(),
    path: spec.slice(space + 1).trim(),
  }
}

/**
 * Define a server action. Returns an object whose `handler` registers
 * the route and whose `call` is the type-safe client invocation.
 *
 * ```ts
 * // shared.action.ts (server-only file)
 * export const likePost = action({
 *   path: 'POST /api/likePost',
 *   input: (raw): { id: string } => {
 *     if (typeof raw !== 'object' || !raw || typeof (raw as { id?: unknown }).id !== 'string') {
 *       throw new Error('expected { id: string }')
 *     }
 *     return raw as { id: string }
 *   },
 *   fn: async ({ id }, ctx) => {
 *     await db.likes.add(id)
 *     return { liked: true }
 *   },
 * })
 *
 * // server.ts
 * serve({ routes: { ...likePost.handler, '/': home } })
 *
 * // any client component
 * const { liked } = await likePost.call({ id: 'abc' })
 * ```
 */
// State-changing HTTP methods that get same-origin enforcement by default.
const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

const DEFAULT_MAX_BODY_BYTES = 1_048_576 // 1 MB

/**
 * Reject objects whose JSON shape contains `__proto__` or
 * `constructor` keys at any depth. Prototype pollution via these keys
 * is one of the most common server-side JS CVEs (CVE-2018-3721,
 * CVE-2019-10744, etc.). Rejecting at the input boundary closes the
 * class regardless of what downstream code does with the value.
 *
 * The check is conservative — it walks the parsed JSON once. For
 * actions that legitimately need these keys (very rare), explicit
 * opt-out would require a separate code path; we keep it baked-in.
 */
export function rejectsPollution(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    for (const item of value) if (rejectsPollution(item)) return true
    return false
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true
    if (rejectsPollution((value as Record<string, unknown>)[key])) return true
  }
  return false
}

/**
 * Same-origin enforcement: parse the request URL and compare against
 * the browser-supplied `Origin` header (or `Referer` as fallback).
 * Cross-origin → false → reject. Same-origin or no Origin (e.g.
 * non-browser clients) → true → allow.
 */
function isSameOrigin(req: Request): boolean {
  const url = new URL(req.url)
  const origin = req.headers.get('origin')
  if (origin) return origin === url.origin
  // Fallback to Referer for older browsers / lax clients.
  const referer = req.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).origin === url.origin
    } catch {
      return false
    }
  }
  // No Origin header at all — non-browser client (curl, server-to-
  // server). Allow; if the deployment wants stricter same-origin-only,
  // they should reject pre-router or use a CSRF token.
  return true
}

/**
 * Resolve `:param` placeholders in an action's parameterized path
 * against the current browser pathname. Pages registered via
 * `page('/notes/:id/edit', { on: { save: … } })` produce an action
 * whose template is `/notes/:id/edit/_action/save` — without
 * resolution, `fetch` would target the literal string with unresolved
 * `:id`, the server route table wouldn't match, and the request would
 * 404. Mirror the segment positions from the template; substitute
 * positional values from `currentPath`. Static segments pass through
 * verbatim. Trailing template segments past the live URL throw a clear
 * error rather than silently producing a broken URL.
 *
 * Exported for unit testing — `call()` is the only runtime caller.
 */
export function resolveActionUrl(template: string, currentPath: string): string {
  if (!template.includes(':')) return template
  const templateSegs = template.split('/').filter((s) => s.length > 0)
  const currentSegs = currentPath.split('/').filter((s) => s.length > 0)
  const resolved: string[] = []
  for (let i = 0; i < templateSegs.length; i++) {
    const t = templateSegs[i] ?? ''
    if (t.startsWith(':')) {
      const v = currentSegs[i]
      if (v === undefined) {
        throw new ActionError(
          0,
          `action.call(): URL param '${t}' has no value at segment ${i} of current path '${currentPath}'`,
        )
      }
      resolved.push(v)
    } else {
      resolved.push(t)
    }
  }
  return `/${resolved.join('/')}`
}

export function action<I, R>(def: ActionDef<I, R>): Action<I, R> {
  const { method, path } = parsePath(def.path)
  const routeKey = `${method} ${path}`
  const sameOriginRequired = def.sameOrigin ?? STATE_CHANGING.has(method)
  const maxBodyBytes = def.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  const handler = async (req: Request, params: Record<string, string>): Promise<Response> => {
    // Same-origin CSRF guard. Defaults on for state-changing methods
    // (POST/PUT/DELETE/PATCH); state-reading methods (GET/HEAD) skip.
    // Cross-origin requests get a 403 with no body details so the
    // failure mode doesn't leak whether the action exists.
    if (sameOriginRequired && !isSameOrigin(req)) {
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // Body size guard. Reject early on `Content-Length` over the cap.
    // (For chunked-transfer / streaming bodies without Content-Length,
    // we still parse — but req.json()/req.formData() in Bun apply
    // their own limits internally.)
    const contentLength = Number.parseInt(req.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return new Response(`Payload too large (max ${maxBodyBytes} bytes)`, {
        status: 413,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // Accept BOTH JSON (from `action.call()`) AND form-encoded (from a
    // no-JS `<form method="post">` submission). The latter enables
    // progressive enhancement: the same action handler works whether
    // or not the client bundle has loaded. Content-Type drives the
    // parser; falls back to JSON for unknown types.
    const contentType = req.headers.get('content-type') ?? ''
    let raw: unknown
    try {
      if (
        contentType.includes('application/x-www-form-urlencoded') ||
        contentType.includes('multipart/form-data')
      ) {
        const fd = await req.formData()
        raw = Object.fromEntries(fd)
      } else {
        raw = await req.json()
      }
    } catch {
      return new Response('action: invalid request body', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // Prototype pollution guard. JSON.parse'd objects can carry
    // `__proto__` / `constructor` keys that, when spread into other
    // objects, mutate Object.prototype. Reject at the boundary.
    if (rejectsPollution(raw)) {
      return new Response('action: rejected suspicious request body', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // Optional signed CSRF token: opt-in for high-value mutations.
    // Looks in BOTH the `X-CSRF-Token` header (JS path) AND a `csrf`
    // form field (no-JS form submission path) so progressive
    // enhancement covers both. Same-origin already rejected the bulk
    // of attacker traffic; this catches the residue (legitimate
    // browsers under XSS or session fixation).
    if (def.csrf) {
      let token = req.headers.get('x-csrf-token') ?? ''
      if (!token && raw && typeof raw === 'object') {
        const formToken = (raw as Record<string, unknown>)['csrf']
        if (typeof formToken === 'string') token = formToken
      }
      if (!token) {
        return new Response('Forbidden: missing CSRF token', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
      try {
        const audience = await def.csrf.audience(req)
        const valid = await def.csrf.verify(token, audience)
        if (!valid) {
          return new Response('Forbidden: invalid CSRF token', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
      } catch {
        return new Response('Forbidden: CSRF verification failed', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
      // Strip the `csrf` field from `raw` so the input validator
      // doesn't see it as an unexpected key.
      if (raw && typeof raw === 'object' && 'csrf' in (raw as object)) {
        const obj = raw as Record<string, unknown>
        const rest: Record<string, unknown> = {}
        for (const k of Object.keys(obj)) {
          if (k !== 'csrf') rest[k] = obj[k]
        }
        raw = rest
      }
    }
    let validated: I
    try {
      validated = def.input(raw)
    } catch (e) {
      return new Response(e instanceof Error ? e.message : 'invalid input', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    let result: R
    try {
      const url = new URL(req.url)
      // Actions are POST and never prefetched — `prefetch` is present
      // for structural parity with the component `LoadCtx` and is
      // always false here.
      const ctx: LoadCtx = { req, url, params, prefetch: false }
      result = await def.fn(validated, ctx)
    } catch (e) {
      // Handler threw. If it's an ActionError, honor its status.
      // Otherwise it's a 500 with the message (no stack).
      if (e instanceof ActionError) {
        return new Response(JSON.stringify({ error: e.message, payload: e.payload }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        })
      }
      return new Response(e instanceof Error ? e.message : String(e), {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  const call = async (input: I): Promise<R> => {
    // Validate client-side too — fail fast before the network roundtrip.
    // The server re-validates because client validation can be bypassed
    // by anyone who knows the URL.
    def.input(input)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
    }
    // Auto-CSRF: when the page emits `<meta name="csrf-token">` (which
    // the framework does automatically for any page whose load() returns
    // a `csrf` field), action.call() picks it up here and sends it as
    // X-CSRF-Token. Dev never sees the transmission — only the mint at
    // load time on the server.
    if (typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="csrf-token"]')
      const token = meta?.getAttribute('content')
      if (token) headers['X-CSRF-Token'] = token
    }
    // Resolve route parameters (`:id`, `:slug`, …) against the current
    // browser URL before fetching. Actions registered by `page(path, def)`
    // inherit the page's parameterized path; without resolution the
    // request goes to the literal template (which the server route table
    // doesn't match), 404s, and the form silently fails. Server-side
    // never calls `call()` (it's the client-facing typed caller), so
    // referencing `window.location` here is safe.
    const targetUrl = resolveActionUrl(
      path,
      typeof window !== 'undefined' ? window.location.pathname : '/',
    )
    const res = await fetch(targetUrl, {
      method,
      headers,
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        const data = (await res.json()) as { error?: string; payload?: unknown }
        throw new ActionError(res.status, data.error ?? `HTTP ${res.status}`, data.payload)
      }
      throw new ActionError(res.status, await res.text())
    }
    return (await res.json()) as R
  }

  return {
    call,
    handler: { [routeKey]: handler },
    path,
  }
}
