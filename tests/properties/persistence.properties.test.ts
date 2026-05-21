// Property-based tests for @place-ts/persistence.
//
// The PersistenceAdapter contract: save(x); load() === x. Across the
// shipped adapters (memory, localStorage, indexedDB, server, crossTab)
// this should be structurally identical. Property tests verify the
// invariant survives arbitrary sequences of writes + the new dispose()
// chain we added closes idempotently.

// @vitest-environment happy-dom

import { IDBFactory } from 'fake-indexeddb'
import * as fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  crossTabAdapter,
  indexedDBAdapter,
  localStorageAdapter,
  memoryAdapter,
  persistedState,
} from '../../systems/persistence/src/index.ts'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
})

// JSON-safe value arbitrary — restrict to what every adapter can
// round-trip via JSON.stringify (object pollution sentinels are
// filtered out at the adapter layer; for the property contract we
// stick to clean values). Reject pollution-key dictionary keys
// (`__proto__`, `constructor`, `prototype`) — fc.dictionary can
// emit `__proto__` as a key, and JSON.parse handles it specially
// (creates a null-prototype object), breaking structural equality
// post round-trip.
const POLLUTION = new Set(['__proto__', 'constructor', 'prototype'])
const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  any: fc.oneof(
    fc.integer(),
    fc.string({ minLength: 0, maxLength: 24 }),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('any'), { maxLength: 4 }),
    fc.dictionary(
      fc
        .string({ minLength: 1, maxLength: 6 })
        .filter((s) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s) && !POLLUTION.has(s)),
      tie('any'),
      { maxKeys: 4 },
    ),
  ),
})).any

// ─── save / load round-trip ──────────────────────────────────────────

describe('persistence — property: save / load round-trip', () => {
  test('memoryAdapter: load() returns the most recently saved value', () => {
    fc.assert(
      fc.property(fc.array(jsonValue, { minLength: 1, maxLength: 8 }), (writes) => {
        const a = memoryAdapter<unknown>(null)
        for (const v of writes) a.save(v)
        // memoryAdapter holds the reference verbatim — no serialization.
        expect(a.load()).toBe(writes[writes.length - 1])
      }),
      { numRuns: 30 },
    )
  })

  test('localStorageAdapter: load() after save round-trips JSON-safely', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /^[a-z][a-z0-9_]*$/.test(s)),
        jsonValue,
        (key, value) => {
          // Each property iteration uses a fresh key so localStorage
          // entries don't bleed across runs (afterEach wipes anyway).
          const a = localStorageAdapter<unknown>(`prop-${key}`, null)
          a.save(value)
          // Fresh adapter on the same key reads the persisted value —
          // proves the storage round-trip (not just the in-memory cache).
          // Compare via JSON-stringify since the adapter is JSON-based
          // and recursive prototype-null shapes (fast-check edge case)
          // don't structurally equal after JSON.parse, even though their
          // serialised form is identical.
          const b = localStorageAdapter<unknown>(`prop-${key}`, null)
          expect(JSON.stringify(b.load())).toBe(JSON.stringify(value))
        },
      ),
      { numRuns: 30 },
    )
  })

  test('localStorageAdapter: corrupt JSON falls back to default (no throw)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 16 }), fc.integer(), (raw, defaultValue) => {
        localStorage.setItem('corrupt-test', raw)
        const a = localStorageAdapter<number>('corrupt-test', defaultValue)
        // load() must not throw on corrupt JSON. Either it parses
        // (raw happens to be valid JSON) or it falls back.
        expect(() => a.load()).not.toThrow()
      }),
      { numRuns: 40 },
    )
  })
})

// ─── dispose() idempotence + adapter contract ────────────────────────

describe('persistence — property: dispose() chains correctly', () => {
  test('indexedDBAdapter.dispose is idempotent across N calls', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (n) => {
        const a = indexedDBAdapter<number>('k', 0, { factory: new IDBFactory() })
        for (let i = 0; i < n; i++) {
          expect(() => a.dispose?.()).not.toThrow()
        }
      }),
      { numRuns: 20 },
    )
  })

  test('crossTabAdapter.dispose forwards to inner.dispose exactly once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        let innerDisposed = 0
        const inner = {
          load: () => 0,
          save: () => {},
          dispose: () => {
            innerDisposed++
          },
        }
        const a = crossTabAdapter<number>(inner, `prop-chan-${Date.now()}-${Math.random()}`)
        // N dispose calls: inner.dispose runs ONCE (the wrapper's
        // own idempotence guard short-circuits subsequent calls).
        for (let i = 0; i < n; i++) a.dispose?.()
        expect(innerDisposed).toBe(1)
      }),
      { numRuns: 20 },
    )
  })

  test('persistedState.dispose works with adapter that has no dispose()', () => {
    // memoryAdapter has no dispose; persistedState must not throw.
    fc.assert(
      fc.property(fc.integer(), (v) => {
        const adapter = memoryAdapter<number>(v)
        const { dispose } = persistedState(adapter)
        expect(() => dispose()).not.toThrow()
      }),
      { numRuns: 20 },
    )
  })
})

// ─── persistedState wraps state correctly ────────────────────────────

describe('persistence — property: persistedState mirrors adapter', () => {
  test('initial state value comes from adapter.load()', () => {
    fc.assert(
      fc.property(jsonValue, (initial) => {
        const adapter = memoryAdapter<unknown>(initial)
        const { state: s, dispose } = persistedState(adapter)
        // Reference identity — memoryAdapter doesn't serialise.
        expect(s()).toBe(initial)
        dispose()
      }),
      { numRuns: 30 },
    )
  })

  test('state writes propagate to adapter.save()', () => {
    fc.assert(
      fc.property(fc.array(jsonValue, { minLength: 1, maxLength: 5 }), (writes) => {
        const saved: unknown[] = []
        const adapter = {
          load: () => null,
          save: (v: unknown) => {
            saved.push(v)
          },
        }
        const { state: s, dispose } = persistedState(adapter)
        for (const v of writes) s.set(v)
        // The last write must reach the adapter — reference equal.
        expect(saved[saved.length - 1]).toBe(writes[writes.length - 1])
        dispose()
      }),
      { numRuns: 30 },
    )
  })
})
