# 06 — AI Agents

The agent setup for this project. **Lean by design.** Seven agents: three always active, three phase-activated, one optional. Each has a concrete trigger, defined input/output, and an explicit non-goal list.

Specs for each agent live in [docs/agents/](../agents/).

---

## The roster

| Agent | Status | Cadence | Spec |
|-------|--------|---------|------|
| **Researcher** | active | on-demand | [docs/agents/researcher.md](../agents/researcher.md) |
| **Critic** | active (3 scope modes) | on-demand + monthly drift check | [docs/agents/critic.md](../agents/critic.md) |
| **Test designer** | active from Phase 1 | per-invariant / per-API | [docs/agents/test-designer.md](../agents/test-designer.md) |
| **Writer** | activates Phase 2+ | per phase ship | [docs/agents/writer.md](../agents/writer.md) |
| **Benchmark steward** | activates Phase 4+ | per phase ship + nightly | [docs/agents/benchmark-steward.md](../agents/benchmark-steward.md) |
| **Security auditor** | activates v0.3+ | capability/persistence-sync ship, deps updates, pre-release | [docs/agents/security-auditor.md](../agents/security-auditor.md) |
| **Historian** | optional | monthly | [docs/agents/historian.md](../agents/historian.md) |

In addition, **system-specialized spawns** remain available — when working deep in one system, a spawn loaded only with that system's docs is more focused than the main conversation. This is a *capability*, not a roster slot.

---

## Meta-principle: agents produce drafts, the author produces artefacts

Every agent's output gets reviewed by the author before it counts. A test the agent wrote is not a test the author thought through until the author has read it and accepted it. Same with research findings, critiques, chapters, benchmarks, syntheses.

Agents save time. They do not substitute for judgment. If the workflow ever feels like "the agent decided," that is a workflow bug.

---

## What's deliberately not in the roster

The patterns common in other AI agent setups that this project rejects, with the reason for each. This list is the *design*. Every rejected pattern was considered and intentionally cut.

### No "implementer" agent

Code embodies design. A good design often only reveals its problems when written out as code. Specializing implementation away from design produces code that satisfies the spec on paper and breaks in real use. The author writes the code; agents help around it.

### No "PM / coordinator / lead / architect" agent

The author is the lead. The author is the architect. There is no team to coordinate. Borrowed titles from human team structures don't apply to a solo project. Adding a coordinator agent invents process where none is needed.

### No "documentation agent"

System docs are inseparable from system design. They are the same artefact, written together. A documentation agent either rewrites already-correct docs, or generates docs that drift from the actual design. The Writer is different — it produces the public *writeup* (the book), which is a separate artefact.

### No "code reviewer" agent

Critic operates at the design level. Property tests + conformance tests catch most code-level drift. A code-review agent would either duplicate critic's work or pad with line-by-line nits.

### No separate "developer critique" / "DX" agent

Folded into Critic as a scope mode (API/DX). DX critique is reading-cold for usability — same cognitive shape as charter critique, different lens. Splitting it would fragment the roster without adding clarity. See Critic's spec for the API/DX scope details.

### No persona-based agents

No "Senior React Engineer," "FP Specialist," "Systems Researcher," etc. Persona-based prompting borrows authority from a name without engaging with the actual constraints of *this* project. The persona becomes a substitute for the spec — and the spec is what matters.

### No "always-on assistant"

The author is the always-on assistant. The agents listed above are spawned for *defined work*, not as ambient presence.

### No "explainer" agent

If a doc requires an explainer to make sense, the doc needs rewriting, not a translator. The Writer + the system docs are the explanations.

### No "search the web for inspiration" agent

Inspiration is a thing the author finds. The Researcher answers specific questions, not "go look around."

### No "AI co-design" agent

Design is not delegable. The Researcher provides input; the Critic reviews output; design itself sits with the author.

---

## Why this roster, and not a longer one

Three principles drive the lean roster:

1. **Each agent has a concrete trigger.** "Might be useful" is not enough. If the trigger doesn't fire reliably, the agent is dead weight.
2. **Each agent has non-overlapping work.** If two agents could do the same task, we have one too many.
3. **Each agent's failure mode is named.** When you know how it fails, you can decide whether to use it.

A roster of 12+ agents looks comprehensive but produces coordination overhead, redundant context, and the false sense that "the team has it covered." Six agents that each earn their keep beats twelve that mostly idle.

---

## Spec format

Every agent spec in [docs/agents/](../agents/) follows the same structure:

- **Purpose** — one paragraph on what the agent is for
- **Status** — active / phase-activated / optional
- **When to spawn / when not to spawn** — concrete triggers
- **Input** — what the spawn message must contain
- **Output** — what the agent produces, with a template if structured
- **Context to load** — which docs / files the agent reads at start
- **Tools** — which tools the agent needs
- **Non-goals** — what this agent deliberately does not do
- **Anti-patterns** — failure modes drawn from observed mistakes
- **Quality bar** — what good output looks like vs bad

This format is itself a constraint. If an agent can't be specified in this shape, it probably shouldn't be an agent.

---

## Setup mechanics

For now, agent specs live as design docs in `docs/agents/`. They are not yet wired up as runnable Claude Code subagents.

When Phase 0 sets up the dev environment, active agents get promoted to `.claude/agents/<name>.md` with frontmatter that Claude Code can spawn directly. Phase-activated agents are promoted when their phase begins. The Historian is promoted only if the author opts in.

The promotion is a deliberate act, not an automatic one. The spec lives as a doc first because the discipline of writing the spec matters; promoting it to runtime is the second step, not the first.

---

## When to revisit this doc

- After Phase 0 setup — does the workflow feel right with three active agents?
- After the first time an agent setup costs us a debugging round — what would have prevented it?
- When the writeup begins (Phase 2+) — Writer activates.
- When a benchmark regression slips through — Benchmark steward owns this; verify it's working.
- If the roster ever feels heavy — **cut, don't add.** That instinct is a feature.

---

## What this doc commits us to

- The lean roster (six max, three active)
- The non-goals being respected (no implementer, no PM, no persona agents, no code reviewer, no documentation agent, no explainer)
- Specs lived as docs first, promoted to subagents at Phase 0
- Reviewing the roster periodically and *cutting* before adding
- Author judgment as the final filter on every agent's output
