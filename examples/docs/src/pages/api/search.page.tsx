// /api/search — @place-ts/search overview.
// v0.1 ships ONE primitive: searchable().

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const SEARCHABLE = `// searchable(items, options) — reactive search over a reactive
// collection. Substring match, case-insensitive, AND-of-tokens.
import { state } from '@place-ts/reactivity'
import { searchable } from '@place-ts/search'

interface Note { title: string; content: string; tags: string[] }

const notes = state<Note[]>([])
const query = state('')

// searchable() returns a function that takes a query getter and
// yields a getter for the filtered list. Both are reactive: the
// result recomputes when the items OR the query change.
const filtered = searchable(
  () => notes(),
  { fields: (n) => [n.title, n.content, ...n.tags] },
)(() => query())

filtered()   // → readonly Note[], reactive on items + query`

const TOKENIZE = `// Tokenization: the query is split on whitespace; an item matches
// when EVERY non-empty token appears in some field (substring).
// An empty query returns the unfiltered list.

query.set('rust async')
// matches items where some field contains 'rust' AND some field
// contains 'async' — order-independent, case-insensitive.

// Case-sensitive match — opt in:
searchable(items, { fields: (n) => [n.title], caseSensitive: true })`

const COLLECTION = `// Composes with @place-ts/data — pass the collection's all() as the
// reactive items source.
import { collection } from '@place-ts/data'
import { searchable } from '@place-ts/search'

const c = collection<Note>(noteState)
const results = searchable(
  () => c.all(),
  { fields: (n) => [n.title, n.content] },
)(() => query())

// Render — recomputes when notes change or the query changes:
<ul>{() => results().map((n) => <li>{n.title}</li>)}</ul>`

const RANK = `// rank — sort matches by descending score (0.2.0).
// Optional. When omitted, matches return in insertion order.
//
// The callback receives the item plus the already-tokenized query
// (lowercased + whitespace-split — same tokens the filter used).
// Return higher = more relevant. Pure: stay deterministic, otherwise
// reactivity fires unpredictably.

import { searchable } from '@place-ts/search'

const filtered = searchable(items, {
  fields: (n) => [n.title, n.content],
  rank: (n, tokens) => {
    const title = n.title.toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (title === t)               score += 100  // exact title match
      else if (title.startsWith(t))  score +=  20  // title prefix
      else if (title.includes(t))    score +=   5  // title substring
      // body matches score 0 — only title wins ordering
    }
    return score
  },
})

// Tie-break is the underlying .sort()'s stability (modern runtimes):
// equal-scored items keep insertion order. Items that don't pass the
// substring filter are never rank()'d — filter runs first.`

export default page('/search', {
  meta: '@place-ts/search',
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>@place-ts/search</code>
      </h1>
      <p>
        Reactive search over <code>@place-ts/reactivity</code> collections. v0.1 ships exactly one
        primitive — <code>searchable()</code>. It takes a reactive list plus a field extractor and
        returns a function that, given a reactive query, yields a reactive filtered list. Substring
        match, case-insensitive, AND of whitespace-separated tokens.
      </p>

      <Callout kind="note" title="Search is a separate concern">
        Storage interfaces don't get a baked-in <code>search</code> method — that would lock every
        future store into re-implementing the same filter. <code>searchable()</code> stays a
        standalone primitive that works over any reactive list. Fuzzy match and inverted indexes are
        deferred until a real workload demands them; ranking is opt-in via the <code>rank</code>{' '}
        callback (0.2.0).
      </Callout>

      <h2 id="searchable">
        <code>searchable(items, options)</code>
      </h2>
      <p>
        <code>items</code> is a getter for the reactive list; <code>options.fields</code> returns
        the strings to search within for one item. The call returns{' '}
        <code>(query: () =&gt; string) =&gt; () =&gt; readonly T[]</code> — pass the query getter,
        get back a getter that recomputes when either the items or the query change.
      </p>
      <CodeBlock code={SEARCHABLE} />

      <h2 id="tokenize">Tokenization</h2>
      <p>
        The query is split on whitespace; an item matches when <em>every</em> non-empty token
        appears in some field (substring match). An empty query returns the unfiltered list. Pass{' '}
        <code>{`caseSensitive: true`}</code> to require exact case.
      </p>
      <CodeBlock code={TOKENIZE} />

      <h2 id="collection">Searching a collection</h2>
      <p>
        <code>searchable()</code> composes with{' '}
        <Link to="/api/data">
          <code>@place-ts/data</code>
        </Link>{' '}
        — pass the collection's <code>all()</code> as the reactive items source.
      </p>
      <CodeBlock code={COLLECTION} />

      <h2 id="rank">
        Ranking — <code>rank(item, tokens)</code>
      </h2>
      <p>
        Pass <code>rank</code> to sort matches by descending score. The callback receives the item
        plus the already-tokenized query (lowercased + whitespace-split — the same tokens the filter
        used); return a higher number for more-relevant items. Composable: write whatever scoring
        fits your domain — exact-match boost, field-weight (title &gt; body), token-frequency,
        position-in-field. The framework doesn't pick a default; ranking is opinionated and
        domain-specific. Without <code>rank</code>, results return in insertion order (back-compat).
      </p>
      <CodeBlock code={RANK} />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/data">@place-ts/data</Link> — <code>collection()</code>
        </li>
        <li>
          <Link to="/api/state">state · watch · derived</Link>
        </li>
      </ul>
    </article>
  ),
})
