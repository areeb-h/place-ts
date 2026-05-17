# Design Journal

A 10-minute-per-session habit. The single most important Phase 0 deliverable, per the implementation plan.

## Why

In month 9, when revisiting a Phase 2 decision, the reasoning at the time will not be in your head. It will not be in the code. It needs to be somewhere readable.

## Cadence

One entry per work session. Whatever a "session" means — an evening, a focused hour, a weekend morning. If it produced any decision, write the entry.

## Format

Files at `YYYY-MM.md`, one per month, with entries appended chronologically.

```markdown
## YYYY-MM-DD — short title

**Worked on:** what you touched today.

**Decided:** what you committed to and why. Include the alternative you rejected.

**Uncertain about:** open questions. The ones bothering you. The ones you parked. Don't leave this section empty even when nothing's bugging you — write "nothing pressing" so the discipline holds.
```

## Rules

- **10 minutes maximum.** The point is not to write well. It is to leave a trail.
- **Specific over abstract.** "Picked `state` over `signal` because Solid baggage" beats "discussed naming."
- **Honest about doubt.** The "uncertain about" section is the most valuable one in month 9.
- **No editing past entries.** A wrong recollection in May is more useful than a corrected one written in October.

## What goes here vs ADRs vs system docs

- **Journal** — fleeting thoughts, today's reasoning, what's bothering you.
- **ADR** — committed cross-system decisions worth referencing later.
- **System docs** — the design itself, written for a reader who doesn't have your conversation context.

The journal feeds the ADRs. The ADRs feed the system docs. Don't skip the journal because the doc exists.
