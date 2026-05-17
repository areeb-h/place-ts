// @vitest-environment happy-dom
//
// Tests for `fromStandard()` + `isValidationFailure` + `StandardSchemaV1`
// (T16-C, ADR 0045).
//
// We hand-roll tiny Standard-Schema-conformant validators here so the
// test suite doesn't pull in Zod / Valibot / ArkType. The spec is
// stable enough that a faithful inline implementation is a real
// integration test — any validator library that ships
// `~standard.validate` plugs into `fromStandard` the same way.

import { describe, expect, test } from 'vitest'
import {
  ActionError,
  fromStandard,
  isValidationFailure,
  type StandardSchemaV1,
} from '../../src/index.ts'

// ── Hand-rolled Standard Schema validators (mimicking Zod's shape) ───
//
// Each helper returns a value implementing `StandardSchemaV1`. The
// generic `Output` parameter lets `fromStandard.InferOutput` flow.

function stringSchema(): StandardSchemaV1<unknown, string> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        if (typeof value !== 'string') {
          return { issues: [{ message: 'expected string' }] }
        }
        return { value }
      },
    },
  }
}

function objectSchema<T extends Record<string, StandardSchemaV1>>(shape: T) {
  type Output = { [K in keyof T]: StandardSchemaV1.InferOutput<T[K]> }
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value: unknown): StandardSchemaV1.Result<Output> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return { issues: [{ message: 'expected object' }] }
        }
        const out: Record<string, unknown> = {}
        const issues: StandardSchemaV1.Issue[] = []
        for (const key of Object.keys(shape)) {
          const fieldSchema = shape[key]
          if (!fieldSchema) continue
          const raw = (value as Record<string, unknown>)[key]
          const result = fieldSchema['~standard'].validate(raw)
          if (result instanceof Promise) {
            throw new Error('test validator does not support async')
          }
          if ('issues' in result && result.issues !== undefined) {
            for (const issue of result.issues) {
              issues.push({
                message: issue.message,
                path: [key, ...(issue.path ?? [])],
              })
            }
          } else {
            out[key] = (result as { value: unknown }).value
          }
        }
        if (issues.length > 0) return { issues }
        return { value: out as Output }
      },
    },
  } satisfies StandardSchemaV1<unknown, Output>
}

// Async validator — used to exercise the "promise rejection" branch.
function asyncSchema(): StandardSchemaV1<unknown, string> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      async validate(value) {
        return typeof value === 'string'
          ? { value }
          : { issues: [{ message: 'expected string' }] }
      },
    },
  }
}

describe('fromStandard()', () => {
  test('happy path: returns the validated value', () => {
    const adapt = fromStandard(stringSchema())
    expect(adapt('hello')).toBe('hello')
  })

  test('throws ActionError(400) with `Validation failed` on failure', () => {
    const adapt = fromStandard(stringSchema())
    try {
      adapt(42)
      expect.fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ActionError)
      expect((e as ActionError).status).toBe(400)
      expect((e as ActionError).message).toBe('Validation failed')
    }
  })

  test('packages issues with no path under `_root`', () => {
    const adapt = fromStandard(stringSchema())
    try {
      adapt(42)
      expect.fail('expected throw')
    } catch (e) {
      const err = e as ActionError
      expect(isValidationFailure(err.payload)).toBe(true)
      const failure = err.payload as { fields: Record<string, string> }
      expect(failure.fields).toEqual({ _root: 'expected string' })
    }
  })

  test('packages object-field issues under dotted paths', () => {
    const schema = objectSchema({ email: stringSchema(), name: stringSchema() })
    const adapt = fromStandard(schema)
    try {
      adapt({ email: 42, name: null })
      expect.fail('expected throw')
    } catch (e) {
      const err = e as ActionError
      expect(isValidationFailure(err.payload)).toBe(true)
      const failure = err.payload as { fields: Record<string, string> }
      expect(failure.fields).toEqual({
        email: 'expected string',
        name: 'expected string',
      })
    }
  })

  test('handles { key } path segments (Standard Schema PathSegment form)', () => {
    const schema: StandardSchemaV1<unknown, { a: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate() {
          return {
            issues: [
              { message: 'bad', path: [{ key: 'a' }, { key: 0 }, 'b'] },
            ],
          }
        },
      },
    }
    const adapt = fromStandard(schema)
    try {
      adapt({})
      expect.fail('expected throw')
    } catch (e) {
      const err = e as ActionError
      const failure = err.payload as { fields: Record<string, string> }
      expect(failure.fields).toEqual({ 'a.0.b': 'bad' })
    }
  })

  test('keeps the FIRST message per field when validator emits multiple', () => {
    const schema: StandardSchemaV1<unknown, never> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate() {
          return {
            issues: [
              { message: 'first', path: ['email'] },
              { message: 'second', path: ['email'] },
            ],
          }
        },
      },
    }
    const adapt = fromStandard(schema)
    try {
      adapt({})
      expect.fail('expected throw')
    } catch (e) {
      const failure = (e as ActionError).payload as { fields: Record<string, string> }
      expect(failure.fields).toEqual({ email: 'first' })
    }
  })

  test('rejects async validators with ActionError(500)', () => {
    const adapt = fromStandard(asyncSchema())
    try {
      adapt('hello')
      expect.fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ActionError)
      expect((e as ActionError).status).toBe(500)
      expect((e as ActionError).message).toMatch(/async/i)
    }
  })

  test('inferred output type flows (compile-time check)', () => {
    const schema = objectSchema({ email: stringSchema() })
    const adapt = fromStandard(schema)
    const result = adapt({ email: 'x@y' })
    // TS: result is { email: string }
    const email: string = result.email
    expect(email).toBe('x@y')
  })
})

describe('isValidationFailure()', () => {
  test('accepts { fields: { [k]: string } }', () => {
    expect(isValidationFailure({ fields: { email: 'bad' } })).toBe(true)
    expect(isValidationFailure({ fields: {} })).toBe(true)
  })

  test('rejects null / undefined / non-object', () => {
    expect(isValidationFailure(null)).toBe(false)
    expect(isValidationFailure(undefined)).toBe(false)
    expect(isValidationFailure('error')).toBe(false)
    expect(isValidationFailure(42)).toBe(false)
  })

  test('rejects shape without fields key', () => {
    expect(isValidationFailure({})).toBe(false)
    expect(isValidationFailure({ message: 'bad' })).toBe(false)
  })

  test('rejects fields with non-string values', () => {
    expect(isValidationFailure({ fields: { email: 42 } })).toBe(false)
    expect(isValidationFailure({ fields: { email: null } })).toBe(false)
    expect(isValidationFailure({ fields: { email: { msg: 'bad' } } })).toBe(false)
  })

  test('rejects fields that is an array', () => {
    expect(isValidationFailure({ fields: ['error'] })).toBe(false)
  })

  test('narrows the type correctly', () => {
    const payload: unknown = { fields: { email: 'bad' } }
    if (isValidationFailure(payload)) {
      // TS: payload.fields is Readonly<Record<string, string>>
      const msg: string | undefined = payload.fields.email
      expect(msg).toBe('bad')
    } else {
      expect.fail('expected narrowing')
    }
  })
})
