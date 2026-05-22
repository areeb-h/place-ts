import { describe, expect, test } from 'vitest'
import { state, watch } from '../../../reactivity/src/index.ts'
import { searchable } from '../../src/index.ts'

interface Doc {
  title: string
  body: string
  tags: readonly string[]
}

const docs: Doc[] = [
  { title: 'Reactivity primer', body: 'Two-color graph coloring.', tags: ['reactivity', 'docs'] },
  { title: 'Capability handlers', body: 'No more useContext globals.', tags: ['platform'] },
  { title: 'useEffect criticism', body: 'Universal escape hatch.', tags: ['react', 'criticism'] },
]
const fields = (d: Doc): readonly string[] => [d.title, d.body, ...d.tags]

describe('searchable', () => {
  test('empty query returns the full collection', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => '')()).toHaveLength(3)
  })

  test('whitespace-only query treated as empty', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => '   \t  ')()).toHaveLength(3)
  })

  test('single-token substring match across fields', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => 'reactivity')()).toHaveLength(1)
    expect(find(() => 'globals')()).toHaveLength(1)
    expect(find(() => 'criticism')()).toHaveLength(1)
  })

  test('multi-token query requires ALL tokens to match (AND)', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    // 'react criticism' → matches the useEffect doc only
    expect(find(() => 'react criticism')()).toHaveLength(1)
    // 'reactivity criticism' → no doc has both
    expect(find(() => 'reactivity criticism')()).toHaveLength(0)
  })

  test('case-insensitive by default', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => 'REACTIVITY')()).toHaveLength(1)
    expect(find(() => 'Reactivity')()).toHaveLength(1)
  })

  test('case-sensitive when opted in', () => {
    const items = () => docs
    const find = searchable(items, { fields, caseSensitive: true })
    expect(find(() => 'Reactivity')()).toHaveLength(1)
    expect(find(() => 'reactivity')()).toHaveLength(1)
    expect(find(() => 'REACTIVITY')()).toHaveLength(0)
  })

  test('searches inside tags (variadic field expansion)', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => 'platform')()).toHaveLength(1)
    expect(find(() => 'docs')()).toHaveLength(1)
  })

  test('reactive on the items collection', () => {
    const list = state<Doc[]>(docs.slice(0, 1))
    const find = searchable(() => list(), { fields })
    const filter = find(() => '')
    expect(filter()).toHaveLength(1)
    list.set(docs)
    expect(filter()).toHaveLength(3)
  })

  test('reactive on the query', () => {
    const q = state('reactivity')
    const find = searchable(() => docs, { fields })
    const filter = find(() => q())

    let observed = 0
    const stop = watch(() => {
      observed = filter().length
    })
    expect(observed).toBe(1)
    q.set('platform')
    expect(observed).toBe(1)
    q.set('')
    expect(observed).toBe(3)
    stop()
  })

  test('no match returns empty array', () => {
    const find = searchable(() => docs, { fields })
    expect(find(() => 'xyzzy')()).toEqual([])
  })

  test('preserves input order when rank is not provided', () => {
    const find = searchable(() => docs, { fields })
    const r = find(() => 'a')() // matches all three on the letter 'a'
    expect(r.map((d) => d.title)).toEqual([
      'Reactivity primer',
      'Capability handlers',
      'useEffect criticism',
    ])
  })

  // ===== 0.2.0 — ranking =====

  test('rank sorts results by descending score', () => {
    const find = searchable(() => docs, {
      fields,
      // Title-match score; first letter only for predictable test data.
      rank: (d, tokens) => {
        const title = d.title.toLowerCase()
        let s = 0
        for (const tok of tokens) if (title.includes(tok)) s += 10
        return s
      },
    })
    // Query "criticism" — only useEffect doc has it in the title. Other
    // matches via body/tags should rank lower.
    const r = find(() => 'criticism')()
    expect(r[0]?.title).toBe('useEffect criticism')
  })

  test('rank ties keep insertion order (stable sort)', () => {
    const find = searchable(() => docs, {
      fields,
      rank: () => 0, // everything ties
    })
    const r = find(() => 'a')()
    expect(r.map((d) => d.title)).toEqual([
      'Reactivity primer',
      'Capability handlers',
      'useEffect criticism',
    ])
  })

  test('rank receives the tokenized query', () => {
    let observedTokens: readonly string[] = []
    const find = searchable(() => docs, {
      fields,
      rank: (_, tokens) => {
        observedTokens = tokens
        return 0
      },
    })
    // Use tokens that actually match (otherwise filter rejects all
    // items before rank runs). "primer" hits doc 0.
    find(() => 'PRIMER')()
    expect(observedTokens).toEqual(['primer']) // case-folded + split
  })

  test('rank with case-sensitive option preserves casing', () => {
    let observedTokens: readonly string[] = []
    const find = searchable(() => docs, {
      fields,
      caseSensitive: true,
      rank: (_, tokens) => {
        observedTokens = tokens
        return 0
      },
    })
    // Case-sensitive: token must match exact casing in the haystack.
    // 'Reactivity' is in doc 0's title; lowercase 'reactivity' isn't
    // (the title starts with capital R). Use the actual cased value.
    find(() => 'Reactivity primer')()
    expect(observedTokens).toEqual(['Reactivity', 'primer'])
  })

  test('rank only runs on matched items', () => {
    let rankCalls = 0
    const find = searchable(() => docs, {
      fields,
      rank: () => {
        rankCalls++
        return 0
      },
    })
    // Query matches one doc; rank should fire once, not three times.
    find(() => 'useeffect')()
    expect(rankCalls).toBe(1)
  })

  test('rank is reactive — refires when query changes', () => {
    const q = state('')
    const items = () => docs
    const find = searchable(items, { fields, rank: () => 1 })
    let renders = 0
    const dispose = watch(() => {
      void find(() => q.read())()
      renders++
    })
    expect(renders).toBe(1)
    q.write('a')
    expect(renders).toBe(2)
    dispose()
  })
})
