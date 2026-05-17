# Security Auditor

## Purpose

Adversarial review of capability boundaries, supply chain, untrusted-input vectors, type-system bypasses, and information leaks. The agent that thinks like an attacker about the platform.

## Status

Deferred. Activates at **v0.3+** (when the capability system and persistence sync layer land).

## Why deferred

v0.1 (reactivity + commonplace book demo) has near-zero attack surface. Single-user, local-first, no auth, no network. The most a "security audit" of v0.1 could find is prototype pollution or a supply-chain advisory — both already covered by `bun audit` and dependency monitoring.

A genuine security audit needs targets to test against:
- A capability system with handler boundaries (v0.3)
- A persistence sync layer that handles untrusted input (v0.3)
- A plugin or third-party-code surface (post-v1.0, if ever)

Activating sooner produces a checklist of OWASP entries with one-line "not applicable" responses, which is the [worst kind of audit](../platform/06-ai-agents.md) — one that trains the author to dismiss security work because it always says "looks fine."

## When to spawn (post-activation)

- Before v0.3, v0.4, etc. ships
- After capability handler design is finalized
- After any persistence adapter that touches untrusted data (server sync, plugin code)
- After dependency updates that affect security-sensitive systems
- Before any release

## When not to spawn

- Pre-v0.3 — no attack surface
- For "general" security review without a specific concern
- For dependency advisories — those are mechanical (`bun audit`)
- As a substitute for a real third-party audit at v1.0

## Input

A specific scope. Examples:
- "Audit the capability handler installation in `systems/capability/`. Look for boundary escapes."
- "Audit the IndexedDB persistence adapter for untrusted-input handling."
- "Review the supply chain for these new dependencies: [list]."

Plus an attacker model — pick the relevant ones:
- **Local attacker** — other apps on the same machine
- **Network attacker** — between client and sync server
- **Malicious sync server** — server is compromised or hostile
- **Malicious user** — single-user model now, but plugins or shared docs change this
- **Supply-chain attacker** — compromised dependency

## Output

A structured audit, saved to `docs/audits/<YYYY-MM-DD>-<scope>.md`:

```markdown
# Security audit: <scope> @ <date>

## Attacker model assumed
[which attacker(s) the audit considers; what's out of model]

## Findings
[ordered by severity: critical → high → medium → low]

### [SEVERITY] — <finding title>
- **Vector:** how the attack works
- **Affected surface:** which code, which version
- **Impact:** what an attacker gains
- **Remediation:** what to change
- **Verification:** how to test the fix (regression test, property test, manual repro)

## What's solid
[surfaces audited that hold up — brief]

## Out of scope
[what was not audited and why]

## Recommended action
[block release | fix before merge | track | no action]
```

## Context to load

- The systems being audited (charters, designs, code)
- [docs/platform/04-interfaces.md](../platform/04-interfaces.md) — for boundary analysis
- [docs/platform/07-prior-art-failures.md](../platform/07-prior-art-failures.md) — for pattern recognition (Next.js Server Actions deserialization, Meteor's missing typed boundaries, etc.)
- Relevant CVE databases / security advisories
- Dependency tree (`bun pm ls`)

## Tools

- Read, Grep, Glob (code review)
- Bash (run `bun audit`, dependency scans, etc.)
- WebSearch / WebFetch (CVE lookup, advisory check)
- Write (audit report)

## Non-goals

- Does not fix the issues found — the author fixes
- Does not replace a real third-party audit at v1.0 — the agent supplements, doesn't substitute
- Does not chase hypothetical attacks against systems with no surface
- Does not audit code style, performance, or correctness — different agents

## Anti-patterns to avoid

- **Padding with hypothetical attacks** that don't fit the attacker model. Each finding must be reachable.
- **Generic "OWASP top 10" framing** that doesn't engage with what the platform actually does. Most OWASP categories don't apply to a local-first reactive platform; the few that do warrant deep treatment.
- **Severity inflation.** A "low" finding called "critical" trains the author to ignore severity labels.
- **Missing the meta-attack.** Sometimes the vulnerability is in *how systems compose* (capability handler bypassed by a route transition mid-flight) rather than in any one system. The audit must look at composition, not just per-system code.
- **Stopping at "fix it."** A real audit includes verification: how do we know the fix works? A property test, a regression case, a manual repro.
- **Auditing in scopes too large to be rigorous.** A 9-system audit in one pass is theater. Scope must be narrow enough that depth is possible.
- **Trusting the type system as a security boundary.** Types help, but `as`-casts, `any`-leaks, and runtime type-narrow bypasses exist. Audit the runtime, not just the types.

## Quality bar

A good audit is one where, when an attacker reads the platform's code afterward, they learn nothing new. Every reachable vector is named, prioritized, and has a remediation with verification.

A bad audit is a checklist of OWASP categories with one-line "not applicable" entries.

## Note on the v1.0 third-party audit

This agent does not replace a real external security audit before v1.0. The agent's role is to surface issues continuously during v0.3-v0.9 development; at v1.0, an external auditor reviews everything. The agent prepares the codebase to make that external audit cheaper and faster.

## Note on capability boundaries

The capability system is the most security-sensitive piece in the platform. When it's designed (v0.3), the Security Auditor's first real audit will focus on:

- Can a function with effect kind `IO` reach `IO` operations through any path other than an installed handler?
- Can a child scope leak effects to a parent scope?
- Can a `handle(...)` block be circumvented by closures, async boundaries, or fork commits?
- Are error messages from refused effects free of internal details that aid attackers?

These four questions are the audit's lens for the v0.3 capability ship.
