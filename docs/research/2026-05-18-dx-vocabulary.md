---
description: DX vocabulary proposal — a pre-v1.0 API-polish reference. Captured from a 2026-05-18 brainstorm. NOT a commitment.
---

# DX vocabulary — pre-v1.0 API-polish reference

> **Status: REFERENCE, not a commitment.** Revisit when the framework
> gets its pre-v1.0 API-polish pass — *after* the entrypoint split +
> `index.ts` decomposition (Tier 20). A rename pass before then is
> churn that competes with the structural work and fixes nothing.

## Thesis — adopt as positioning now

**Static by default. Live only when declared. Explain everything.**

This is the framework's spine and matches the wedge (secure content /
document systems). It belongs on the docs landing page regardless of
whether the vocabulary below is ever adopted.

## Proposed vocabulary

`page · layout · data · view · mode · delivery · static · live · can ·
Later · action · access`

## Proposed shapes

### page — object form
```tsx
export default page({
  path: "/docs/:slug",
  mode: "static",
  access: "public",
  delivery: { js: "islands", csp: "strict", preload: "visible" },
  data: async ({ params }) => ({ doc: await getDoc(params.slug) }),
  view: ({ doc }) => ( /* … */ ),
})
```
Simple form: `page(() => <main><h1>Hello</h1></main>)`

### island activation
```tsx
<Search live="intent" can={["dom", "fetch"]} />
<Toc static />
<Later><RelatedDocs /></Later>
```

### action
```ts
export const savePost = action({
  input: PostSchema,
  can: "posts.write",
  async run({ input, user }) {
    return db.posts.save(input, user.id)
  },
})
```

### naming intent
| proposed | over |
|---|---|
| `live` | activate / hydrate / client |
| `static` | server / none |
| `view` | render |
| `data` | loader / load |
| `Later` | Defer / Suspense |
| `can` | capabilities / uses |
| `delivery` | config / strategy |

## Verdict — 2026-05-18 assessment

| Idea | Verdict | Why |
|---|---|---|
| Thesis "static by default…" | **adopt now** (positioning) | matches wedge + charter |
| `view` field name | **already shipped** | `page()` already uses `view` |
| `page` / `layout` / `action` names | **already shipped** | exist |
| `place explain` / `why-js` diagnostics | **adopted** — Tier 20 cut 7 | observability = the wedge |
| `live` / `static` activation pair | **candidate rename** | reads better than `island="visible"`; do as ONE isolated cut at the polish pass |
| `Later` for deferred content | **candidate rename** | friendlier than `Suspense`; defer to polish pass |
| `can: "perm"` on **actions** | **future feature** | declarative action auth is real — small ADR, trigger-gated |
| `mode` / `delivery` / `access` on page | **reject** | re-wrap existing/automatic behaviour (`delivery.js` has one value — islands; `delivery.csp` = `security:'strict'`; `mode` = the view-classifier's job) — surface growth, not simplification |
| `can={[...]}` on **islands** | **reject** | per-system gating *infers* what an island uses (the auto-import reference graph); hand-declaring it is more ceremony, not less |
| file-based routing (`[slug].place.tsx`) | **reject — charter conflict** | routes are values (ADR 0003); the why-page matrix's row 1. `discoverPages()` + `page('/p', viewFn)` already give the file-drop ergonomics |

## Why not now

The framework's debt is the 9,518-line `index.ts` barrel + bundle
leakage — not its vocabulary. A rename pass is decoration ("DX as a
feature, not decoration" — the brief's own line); the entrypoint split
and `place explain` are the feature. Renaming `load` → `data` competes
with the split for the same hours and fixes nothing structural.

When the framework is decomposed and the boundaries are enforced,
revisit this doc for the API-polish pass — `live` / `static` / `Later`
/ `explain` are good words and a fair starting point.
