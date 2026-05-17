# Agents

Concrete specs for the six agents in the roster. Policy lives in [docs/platform/06-ai-agents.md](../platform/06-ai-agents.md). The roster is **lean by design** — adding an agent requires removing one.

## Index

| Agent | Spec | Status | Trigger |
|-------|------|--------|---------|
| Researcher | [researcher.md](researcher.md) | active | "survey prior art on X" |
| Critic | [critic.md](critic.md) | active (3 scope modes) | design doc drafted, ADR proposed, public API finalized, monthly drift check |
| Test designer | [test-designer.md](test-designer.md) | active from Phase 1 | new invariant / charter clause / public API |
| Writer | [writer.md](writer.md) | activates Phase 2+ | phase shipped, chapter due |
| Benchmark steward | [benchmark-steward.md](benchmark-steward.md) | activates Phase 4+ | phase ship + nightly CI |
| Security auditor | [security-auditor.md](security-auditor.md) | activates v0.3+ | capability/persistence-sync ship, dependency updates, pre-release |
| Historian | [historian.md](historian.md) | optional | monthly digest |

The roster is **seven agents — three active, three phase-activated, one optional**. Critic carries three scope modes (charter, interface, API/DX) — see its spec — so "developer critique" doesn't fragment the roster.

## Spec format

Every spec follows the same structure (enforced by the policy doc):

- Purpose
- Status
- When to spawn / when not to spawn
- Input
- Output (with template if structured)
- Context to load
- Tools
- Non-goals
- Anti-patterns to avoid
- Quality bar

If an agent can't be specified in this shape, it doesn't belong in the roster.

## Promotion to runtime

Specs here are design docs. When Phase 0 sets up the dev environment, active agents get promoted to runnable Claude Code subagents at `.claude/agents/<name>.md`. The promotion preserves the spec but adds Claude Code frontmatter (`name`, `description`, `tools`).

The promotion is a deliberate act. A spec living here is not the same as an agent being available. The author decides when to flip the switch.

## How to read these specs

They are written for the author who will spawn the agent — not for the agent itself. The "Input" section describes what the spawn message must contain. The "Output" section describes what the agent returns. Read the spec before spawning to know what you're asking for.
