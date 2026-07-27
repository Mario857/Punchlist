# Punchlist

Desktop app that ingests every comment on a GitHub pull request, resolves the ones you pick using Cursor agents in isolated git worktrees, and holds the results behind a review gate until you approve them.

The name is the workflow. A punch list is the list of defects a reviewer walks a job recording — the things that must be fixed before sign-off. That is what a PR's comments are, so that is how they are treated here: itemised, worked through one by one in a sandbox, and signed off through one deliberate action.

## What it actually does

1. Lists your open pull requests and matches each to a local clone.
2. Pulls every comment on the selected PR — inline review threads, review summaries and top-level conversation — into one filterable tree.
3. Runs an agent per selected comment, each in its own git worktree at the PR head, in parallel under a concurrency cap.
4. Shows you the candidate patch. You can hand-edit it, select lines and prompt for a fix, follow up on the whole patch, answer a question the agent stopped on, or revert to any earlier revision.
5. Checks each patch for protected paths, credential-shaped content, and diffs wildly larger than the comment implied.
6. Assembles the landing in a sandbox worktree by really squash-merging each approved branch, so conflicts are findings rather than predictions.
7. Pushes, resolves the review threads and optionally posts a reply — only after you confirm, and only ever as an integration branch of its own.

## The premise

**Nothing reaches your repository without an explicit confirmation**, and this is enforced by the code rather than promised by the UI:

- Agents work in throwaway worktrees whose `remote.origin.pushurl` is invalid, so a push fails at the git level rather than relying on the agent's cooperation.
- The agent's `gh` is de-authenticated — the whole process is contained and `gh` explicitly opts out for the app's own calls, so an agent cannot post a comment on your behalf.
- Every operation that leaves the sandbox takes a confirmation object at the type level. A function that could push without being handed one would not compile.
- Every such operation appends to an append-only audit log, which you can read on the Audit screen.
- The target branch is never pushed to directly, and nothing is ever force-pushed.

Approving a resolution means *ready to land*, and nothing more. Landing is a separate action with its own preview.

## Requirements

- **macOS.** The build target is macOS; little is platform-specific by design, but nothing else is tested.
- **The `gh` CLI, installed and authenticated.** Run `gh auth login` first. Punchlist stores no GitHub credential of its own — `gh` owns the token, so there is nothing here to leak.
- **A Cursor API key**, from Cursor Dashboard → API Keys. Needed from the moment you run an agent. It is stored with Electron's `safeStorage` and never crosses into the UI process.
- **A local clone** of each repository you want to work on. Discovery is global; resolution needs a worktree, so it needs a clone.

## Cost

Punchlist runs on your existing Cursor plan. Every tier defaults into the **free lane** — Auto and Cursor's first-party models, which are unlimited on paid plans and do not draw down your included dollar pool. Frontier models are never selected automatically: choosing one is an explicit, labelled action, and the UI marks those selections as pool-spending before anything runs.

So the default marginal cost of running this is zero, and any spend is something you deliberately asked for.

## Installing

```bash
bun install
bun run dist      # produces release/Punchlist-<version>.dmg
```

**The build is unsigned.** There is no Apple Developer certificate for this project, so on first open macOS will refuse to launch it. Right-click the app and choose Open, then confirm — or clear the quarantine attribute yourself:

```bash
xattr -dr com.apple.quarantine /Applications/Punchlist.app
```

That is a real security prompt doing its job, and you should be no more casual about it here than anywhere else. A tool whose entire premise is that nothing happens without explicit confirmation should not be coy about its own installation.

## Developing

```bash
bun install
bun run dev
```

Verification, all three of which must pass:

```bash
bun run typecheck
bun run lint
bun run build
```

`build` is not optional — it is the only thing that catches main/preload bundling and externalization failures, which `typecheck` cannot see.

There are no unit tests; verification is those three commands.

## Docs

- [PLAN.md](PLAN.md) — architecture and the phased checklist; the single source of truth for what is built and what is not
- [AGENTS.md](AGENTS.md) — coding rules for anyone, human or agent, working on this codebase
- [CLAUDE.md](CLAUDE.md) — Claude Code entry point; imports AGENTS.md and points at PLAN.md

## What it deliberately does not do

- **Approve anything for you.** Auto mode can answer a blocking question so a run finishes, but every diff still needs your eyes. That is the review gate, and nothing in the design erodes it.
- **Support GitLab or Bitbucket.** GitHub only; a provider abstraction for a second implementation that does not exist would be cost without benefit.
- **Force-push, ever.** Not as a fallback, not on undo. Undo deletes the branch it pushed and unresolves the threads it resolved.
- **Unpost a reply.** GitHub allows only a further comment, so undo says so rather than pretending.
