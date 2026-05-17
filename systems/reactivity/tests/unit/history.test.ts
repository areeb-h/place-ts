import { describe, expect, test } from 'vitest'
import { history, state, watch } from '../../src/index.ts'

describe('history — undo/redo over a writable state', () => {
  test('initial flags: cannot undo, cannot redo', () => {
    const s = state(0)
    const h = history(s)
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
    h.dispose()
  })

  test('write enables undo; undo restores prior value', () => {
    const s = state(0)
    const h = history(s)
    s.set(1)
    expect(h.canUndo()).toBe(true)
    h.undo()
    expect(s()).toBe(0)
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(true)
    h.dispose()
  })

  test('redo re-applies the undone value', () => {
    const s = state(0)
    const h = history(s)
    s.set(1)
    s.set(2)
    h.undo()
    expect(s()).toBe(1)
    h.redo()
    expect(s()).toBe(2)
    h.dispose()
  })

  test('new edit clears the redo stack', () => {
    const s = state(0)
    const h = history(s)
    s.set(1)
    s.set(2)
    h.undo() // back to 1
    expect(h.canRedo()).toBe(true)
    s.set(99) // new edit
    expect(h.canRedo()).toBe(false)
    h.dispose()
  })

  test('skip no-op writes (equal to current top)', () => {
    const s = state(0)
    const h = history(s)
    s.set(0) // same value — should not snapshot
    expect(h.canUndo()).toBe(false)
    s.set(1)
    s.set(1) // same value — should not snapshot
    h.undo()
    expect(s()).toBe(0)
    expect(h.canUndo()).toBe(false)
    h.dispose()
  })

  test('respects a custom limit by dropping oldest snapshots', () => {
    const s = state(0)
    const h = history(s, { limit: 2 })
    s.set(1)
    s.set(2)
    s.set(3) // past should now have at most limit+1 = 3 entries: [1, 2, 3]
    // The original 0 should have been dropped.
    h.undo()
    h.undo()
    expect(s()).toBe(1)
    expect(h.canUndo()).toBe(false) // only one entry left, which is current
    h.dispose()
  })

  test('canUndo and canRedo are reactive', () => {
    const s = state(0)
    const h = history(s)
    let ce = false
    const stop = watch(() => {
      ce = h.canUndo()
    })
    expect(ce).toBe(false)
    s.set(1)
    expect(ce).toBe(true)
    h.undo()
    expect(ce).toBe(false)
    stop()
    h.dispose()
  })

  test('custom equals dedupes structurally equal snapshots', () => {
    const s = state({ x: 0 })
    const h = history(s, { equals: (a, b) => a.x === b.x })
    s.set({ x: 0 }) // structurally equal — skip
    expect(h.canUndo()).toBe(false)
    s.set({ x: 1 })
    expect(h.canUndo()).toBe(true)
    h.dispose()
  })

  test('dispose stops further snapshotting', () => {
    const s = state(0)
    const h = history(s)
    h.dispose()
    s.set(1)
    s.set(2)
    expect(h.canUndo()).toBe(false)
  })

  test('deep option isolates snapshots from later mutation of the restored value', () => {
    type Doc = { lines: string[] }
    const s = state<Doc>({ lines: ['a'] })
    const h = history(s, { deep: true })
    s.set({ lines: ['a', 'b'] })
    h.undo()
    // After undo, the restored value should be a clone — mutating it
    // must not corrupt the next snapshot in the past stack.
    const restored = s()
    restored.lines.push('mutation-after-undo')
    h.redo()
    h.undo()
    // We mutated the LIVE value AFTER undo. The history's past stack
    // should still hold the original {lines: ['a']} clone, not the
    // mutated version.
    expect(s().lines).toEqual(['a'])
    h.dispose()
  })

  test('without deep, snapshots can leak references (documented behavior)', () => {
    type Doc = { lines: string[] }
    const s = state<Doc>({ lines: ['a'] })
    const h = history(s, { deep: false })
    const initial = s()
    s.set({ lines: ['a', 'b'] })
    initial.lines.push('mutation-after-write')
    h.undo()
    // Without deep cloning, the history's snapshot of {lines: ['a']}
    // is the SAME object as `initial`. Our mutation leaked. This test
    // documents the contract: deep:true is what you want for
    // mutable-object state.
    expect(s().lines).toEqual(['a', 'mutation-after-write'])
    h.dispose()
  })

  test('auto: false — explicit commit() is required to snapshot', () => {
    const s = state(0)
    const h = history(s, { auto: false })
    s.set(1)
    s.set(2)
    // Without commit, no snapshots beyond the initial.
    expect(h.canUndo()).toBe(false)
    h.commit() // snapshots current value (2)
    expect(h.canUndo()).toBe(true)
    h.undo()
    expect(s()).toBe(0)
    h.dispose()
  })

  test('auto: false ignores writes between commits — fixes the cross-tab undo bug', () => {
    // Models the scenario in commonplace: a remote (cross-tab) write
    // arrives while the user is editing locally. With auto-snapshot,
    // undo would revert the remote write — confusing. Manual mode
    // means undo only rolls back what *we* committed.
    const s = state(0)
    const h = history(s, { auto: false })
    h.commit() // baseline
    s.set(99) // simulate "remote write" — not committed
    s.set(100) // simulate another remote
    expect(h.canUndo()).toBe(false) // no commits since baseline
    s.set(7) // simulate user-driven write
    h.commit() // user commits this one
    expect(h.canUndo()).toBe(true)
    h.undo()
    // Undo restores the value that was current at baseline (0), NOT the
    // remote 99 or 100. That's the desired semantics.
    expect(s()).toBe(0)
    h.dispose()
  })

  test('undo and redo dedupe self-writes (no double-snapshot)', () => {
    const s = state(0)
    const h = history(s)
    s.set(1)
    s.set(2)
    h.undo() // applying flag suppresses re-snapshot of the restored value
    h.undo()
    expect(s()).toBe(0)
    // After two undos: redoStack has 1 then 2 — second undo pushed 1, first pushed 2.
    h.redo() // → 1
    expect(s()).toBe(1)
    h.redo() // → 2
    expect(s()).toBe(2)
    expect(h.canRedo()).toBe(false)
    h.dispose()
  })
})
