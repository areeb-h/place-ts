# 03 — Writeup Strategy

The public artefact. The implementation plan claims the writeup is "50% of the v0.1 deliverable." That's only true if the writeup has a designed shape. This doc is that shape.

---

## What the writeup is

**Status:** structure decided; content drafted phase-by-phase.

A **technical book**, published online, chapter-per-system. Not a marketing site. Not a sequence of blog posts. Not a manifesto.

The book's claim is the platform's claim: that the nine systems cohere around three commitments (time as primitive, derivation as primary, graph as artefact, with typed-effects as a constraint). Each chapter argues for one system's design choices and shows them working.

---

## Audience priority

1. **Framework builders and reactivity researchers** — primary. They will read it deeply, push back hard, find errors.
2. **Solo/small-team builders** evaluating whether to adopt it — secondary. They will skim chapters and read examples.
3. **General programming-curious readers** — tertiary. They will read the introduction and one chapter; that is enough.

The writeup must serve all three without compromising for any.

---

## Structure (placeholder)

```
Introduction — the thesis
Chapter 1  — Why reactivity is broken
Chapter 2  — The synchronous core
Chapter 3  — Derivable state
Chapter 4  — The scheduler
Chapter 5  — Typed effects
Chapter 6  — Time as the primitive
Chapter 7  — The graph as artefact
Chapter 8  — The component system          (post-v0.1)
Chapter 9  — The data system               (post-v0.1)
Chapter 10 — Persistence                   (post-v0.1)
Chapter 11 — Cache                         (post-v0.1)
Chapter 12 — Routing                       (post-v0.1)
Chapter 13 — Search                        (post-v0.1)
Chapter 14 — Capability                    (post-v0.1)
Chapter 15 — The build system              (post-v0.1)
Conclusion — what didn't work, what's next
```

v0.1 ships chapters 1–7 plus introduction + conclusion. Later versions add subsequent chapters.

---

## Voice

- **Technical-but-personal.** Use first person where helpful. Acknowledge the author's uncertainty. Don't pretend to have arrived at conclusions you actually argued your way into.
- **Argued, not asserted.** Every design choice is presented with the alternative, the tradeoff, and the reason. The reader should be able to disagree.
- **Worked examples.** Every chapter has at least one example from the commonplace book reference app, full code, full graph diagram.
- **Honest limitations.** Each chapter ends with "what this doesn't solve." This is mandatory.

---

## Cadence

**One chapter per phase.** Drafted while the phase is in progress, refined when the phase closes. Do not batch chapter writing for the end. By the time you're at Phase 6, the Phase 1 chapter must already be readable.

**Reading-back rule:** after drafting a chapter, read it aloud to yourself a week later. If it makes sense, it ships. If it doesn't, it gets rewritten.

---

## Format

- **Source:** Markdown in the repo at `docs/writeup/` (folder created when chapter 1 begins).
- **Build:** static site generator — TBD. Astro or VitePress are candidates. Decide before chapter 1.
- **Deployment:** TBD. Custom domain ideal.
- **License:** TBD. CC BY 4.0 is the default for technical writing.
- **Diagrams:** Mermaid where possible (renders in GitHub and most static site generators), excalidraw for the rare hand-drawn case.

---

## What the writeup is not

- Not a tutorial. Tutorials live in the README of each system.
- Not a reference manual. References live in TypeScript types.
- Not a sales pitch. The platform earns adoption through use, not through marketing.
- Not "version-locked". Each chapter has an "as of vX.Y" header. Old chapters get marked superseded but stay readable.

---

## Open decisions

- The book's title (held until the framework name is decided).
- The static site generator.
- Whether chapter drafts are public-as-they-emerge or private-until-ready. The implementation plan recommends "publish small things along the way." That favors public drafts.

---

## Why this matters more than it sounds

The implementation plan's risk register lists "writeup procrastination" as one of five top failure modes. A platform-grade design with a six-month-late writeup is a design nobody adopts and the author can't explain. The discipline to write each chapter while the phase is hot is the discipline that ships the platform.
