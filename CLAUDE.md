# Airlock

@AGENTS.md

## Implementation plan

The full architecture and phased implementation plan live in `PLAN.md`, including the per-phase todo checklist. It is the single source of truth for progress:

- Before starting work, read the `PLAN.md` section for the phase you are implementing — the design decisions there are binding, not suggestions.
- Check items off in the `PLAN.md` checklist as they complete, and update the document when a decision genuinely changes.
- Do not skip ahead across phases; each phase de-risks the next.

Note: the app's runtime agent backend is the Cursor SDK (see "Model routing and cost" in `PLAN.md` for why). That is a decision about what the app invokes, not about the tool developing it.
