# Airlock

Desktop Electron app that ingests every comment on a GitHub PR, resolves selected ones with Cursor SDK agents in isolated git worktrees, and holds the results behind a review gate until you approve them.

The name is the architecture: work accumulates in a sandbox chamber, gets inspected, and passes into your real repo only through one deliberate action.

## Stack

- Electron
- electron-vite
- React + TypeScript

## Scripts

```bash
bun install
bun run dev      # start the app in development
bun run build    # production build
bun run typecheck
```

## Docs

- [PLAN.md](PLAN.md) — architecture and the phased implementation checklist; the single source of truth for progress
- [AGENTS.md](AGENTS.md) — coding rules and conventions for anyone (human or agent) working on this codebase
- [CLAUDE.md](CLAUDE.md) — Claude Code entry point; imports AGENTS.md and points at PLAN.md

## Status

Bootstrap only — app shell and window wiring. Phase 0 (standards) is next; see the checklist in PLAN.md.
