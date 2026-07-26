# Airlock

> Desktop Electron app that ingests every comment on a GitHub PR, resolves selected ones with Cursor SDK agents in isolated git worktrees, and holds the results behind a review gate until the user approves them. The name is the architecture: work accumulates in a sandbox chamber, gets inspected, and passes into the real repo through one deliberate action.

## Tech Stack

- **Shell**: Electron 36 + electron-vite 3
- **UI**: React 19 + TypeScript (strict), Tailwind CSS v4 (CSS-first `@theme` tokens, no config file)
- **Client state**: Zustand (`src/renderer/src/stores/`)
- **Server state**: TanStack Query over IPC (`useQuery*` hooks, keys from a query-key factory)
- **Validation**: Zod 4 — load-bearing, see [Parse Boundaries](#parse-boundaries)
- **AI**: `@cursor/sdk` — `Agent.create` + `agent.send`, never `Agent.prompt`
- **GitHub**: the `gh` CLI via `execFile`. No Octokit, no stored GitHub token
- **Git**: `simple-git`, plus raw `git worktree` commands
- **Diff UI**: `@monaco-editor/react`
- **Package manager**: **bun** (install and script runner only — Electron still runs on its embedded Node; `electron` is in `trustedDependencies` so its postinstall can fetch the binary). Target: local desktop (macOS first)

## Directory Structure

```
src/
  main/        → Node-side only, flat. ghCli, discovery, github, prompt, worktree,
                 agent, runState, decision, sandbox, guardrails, landing,
                 audit, queue, router, store, ipc
  preload/     → the typed contextBridge surface, nothing else
  renderer/
    src/
      screens/     → pages: Workspace (three-pane shell), Settings; each owns its
                     page-focused components; pages NEVER import from each other
      modules/     → cross-page feature blocks: discovery, comments, review, runs,
                     landing, audit, settings; may compose each other, no cycles
      components/  → shared primitives; icons/ for icon components
      hooks/       → cross-module hooks only
      stores/      → Zustand, one domain per store
      lib/         → queryKeys, classNames, format helpers, assertNever, …
  shared/      → types imported by BOTH processes (comments.ts, runState.ts)
```

### Renderer boundaries

A module under `modules/` owns one feature area: its components (with their colocated `use<ComponentName>` hooks), its data hooks, and any module-local types. A screen (page) owns its layout and its page-focused components, which live under that screen's folder. Four rules keep this scalable, and the first two are enforced by ESLint rather than convention — `import-x/no-restricted-paths` zones for the direction rules and `import-x/no-cycle` for the module layer, both resolving `@renderer/*` so the aliased and relative form of a violation fail alike:

1. **Pages never import from other pages.** `Workspace` cannot reach into `Settings` or vice versa; page-focused components stay under their own screen. The moment a second page needs one, it is no longer page-focused — move it down into `modules/`. A page-to-page import is a lint error, not a code-review nitpick.
2. **Modules may import each other, but import cycles are a lint error.** `landing` composing the diff viewer and guardrail flags is exactly what the module layer is for. A cycle between modules is not — it welds them into one undeletable blob, so `import-x/no-cycle` guards the freedom this rule grants. Modules never import from `screens/`; the direction is strictly downward: screens → modules → `components/`/`hooks/`/`stores/`/`lib/`.
3. **Cross-page data flows through props or shared state, never via page imports.** The selected comment is lifted to the `Workspace` screen and passed down; run state is read from `stores/runStore` because several modules render it.
4. **Born scoped, promoted on the second consumer.** New code starts in the most local layer that works: a page-focused component under its screen, a feature component in its module. Promote page → module when a second page needs it, and module → `components/` when it turns out to be a generic primitive (`TreeRow` and `StateBadge` are primitives because the comment tree and the diff's file tree both render them). Never promote speculatively.

## Modular Rules

Focused rule files (also apply):

```
@.cursor/rules/core-principles.mdc
@.cursor/rules/typescript-standards.mdc
@.cursor/rules/react-patterns.mdc
@.cursor/rules/state-management.mdc
```

## Verification

After making edits, **always** run:

```bash
bun run typecheck     # tsc --noEmit on node + web configs
bun run lint          # eslint --fix
bun run build         # electron-vite build
```

All must pass before work is considered complete.

`build` is not optional. It is the only thing that catches main/preload bundling and externalization failures — the Electron analogue of a Server/Client boundary error, and invisible to `typecheck`.

> **There are no unit tests.** Do NOT run `test` commands — they do not exist. Verify with typecheck + lint + build.

---

## Process Boundaries (Electron-specific, read first)

This is the rule category with no equivalent in a web app, and the easiest to get wrong.

- **Node APIs never appear in the renderer.** No `fs`, `child_process`, `path`, or `process` beyond what preload explicitly exposes. `contextIsolation: true` and `nodeIntegration: false` are never relaxed.
- **All main↔renderer traffic goes through `src/main/ipc.ts`.** It is the single place a channel is defined. Do not call `ipcRenderer.invoke` with an ad-hoc string from a component.
- **Secrets never cross IPC.** `CURSOR_API_KEY` is read from `safeStorage` in main and used in main. The renderer may learn _whether_ a key is set, never its value.
- **Preload exposes a typed object, not `ipcRenderer`.** Handing the renderer a general-purpose invoke function defeats the boundary.
- **`src/shared/` is the only code both processes import**, so it must stay dependency-free and Node-free.

### Trust Boundary

Airlock's whole value is that nothing reaches a real branch or GitHub without explicit confirmation. Treat this as an invariant, not a convention:

- Operations outside the sandbox — committing to the integration branch, pushing, `resolveReviewThread`, `unresolveReviewThread`, posting replies — must require a confirmation argument at the type level. A function that can push without being handed a confirmation is a bug.
- Every out-of-sandbox action appends to the audit log. No exceptions, no silent paths.
- Never widen the agent's environment. `GH_CONFIG_DIR`, the cleared `GH_TOKEN`/`GITHUB_TOKEN`, the invalid `pushurl`, and the scrubbed `GIT_AUTHOR_*`/`GIT_COMMITTER_*` vars are containment, not configuration.
- **Never `--force`.** No force-push, and no `git worktree remove --force` on a dirty worktree — a dirty worktree means unlanded user edits.

### Parse Boundaries

Zod is required at exactly three places, all untrusted:

1. **`gh` subprocess stdout** — untyped by definition; `author` can be null on deleted accounts.
2. **The persisted JSON store** — may have been written by an older version of the app.
3. **`.airlock/decision.json` and `.airlock/summary.json`** — written by an LLM, the least trustworthy input in the system. Malformed agent output must degrade to a clean state, never crash the main process.

Derive types with `z.infer`. Do not hand-write a type next to a schema.

---

## Core Principles

- **Follow existing patterns.** Find a similar example in the codebase and match its structure before inventing a new approach.
- **Minimal impact.** Touch only what is necessary to complete the task.
- **Type safety.** No `any`. Prefer schema-validated types (`z.infer`) and narrow with runtime checks.
- **Don't over-document.** Don't add JSDoc/comments to code you didn't write or change.
- **Small, focused changes.** Prefer the smallest diff that solves the problem.

## Separate Logic from Presentation

> Keep components dumb. A component file describes **what the UI looks like**; all the **how it behaves** lives in a colocated custom hook.

- For any non-trivial component, extract logic into a colocated `use<ComponentName>` hook.
- The component receives `props`, calls the hook once, destructures, and renders. No fetching, business rules, or derived calculations inline in JSX.
- The hook owns state, data fetching, handlers, derived values, and effects, returning a flat object of ready-to-render values and callbacks.
- Keep handlers in the hook (`onApproveClick`, `onSelectionPrompt`), not inline in the component.
- Colocate the pair:

  ```
  modules/review/DiffReview/
  ├── DiffReview.tsx        # presentational: props in, JSX out
  ├── useDiffReview.ts      # logic: state, handlers, derived values
  └── components/           # child components, same pattern
  ```

- Don't over-apply: a tiny purely-presentational component needs no hook — adding one is just indirection.

This rule has unusual bite here because the right-hand pane branches on `RunState`. That branch is a named `const` computed in a hook, never a ternary chain in JSX.

## Code Rules

### No Magic Numbers

Never use raw numeric or string literals in logic or JSX. Promote to named constants in domain-scoped files. This includes the values that will be tempting to inline: concurrency caps, the diff debounce interval, the watcher poll interval, per-run timeouts, and the auto-answer cap.

### No Logic in JSX

Never put state, conditionals, or computations inside JSX. Extract into hooks.

### No Rendering Conditionals in JSX

Never use inline ternaries or `&&` for conditional rendering in returned markup. Assign to a named `const` first:

```tsx
const content = isReady ? <Ready /> : <Loading />; // ✅
return <div>{content}</div>;

return <div>{isReady ? <Ready /> : <Loading />}</div>; // ❌
```

### IIFE Over Nested Ternaries

When a value depends on multiple conditions, use an IIFE with early returns:

```tsx
const label = (() => {                                 // ✅
  if (state === RUN_STATE.RUNNING) return 'Running…';
  if (state === RUN_STATE.REVISING) return 'Revising…';
  return 'Ready';
})();
```

Prefer `switch` with `assertNever` when exhausting a discriminated union like `RunState` or `PrComment['kind']`, so a new variant becomes a compile error.

### No `forwardRef`

React 19 passes `ref` as a regular prop.

### No Inline SVG in JSX

Extract SVGs into components under `src/renderer/src/components/icons/`.

### No Type Hacks

Never use `as` or `any` to silence the compiler. Fix the real cause. This matters most at IPC and subprocess boundaries, which are exactly where casting feels easiest and is most dangerous — that is what the Zod schemas are for.

### No Barrel Exports

No `index.ts` files re-exporting from siblings. Import directly from the source.

`src/main/ipc.ts` is **not** a barrel — it defines the channel contracts rather than re-exporting neighbours. Same for `src/shared/comments.ts`.

### No Dynamic Imports

Prefer static `import`. Don't use `import()` or `typeof import('…')` in type annotations — define explicit interfaces.

Electron carve-out: an ESM-only dependency consumed from the CJS main process may require `import()`. That is a build constraint, not a style choice — comment why at the call site.

### No Deprecated APIs

Stay on latest stable APIs. For Electron specifically, `remote`, `webPreferences.nodeIntegration`, and synchronous IPC are out.

### No Unnecessary Nesting

Every wrapper element must justify itself with layout, styling, or semantics.

### No Unnecessary Null/Undefined Checks

Trust the types; guard only at real boundaries. Those boundaries are well-defined here: `gh` output, the JSON store, agent-written files, and IPC payloads. Inside them, no defensive `?.`.

### Prefer Simplicity

Choose the simplest thing that works. No abstraction for a second implementation that does not exist — this is why there is no provider layer for GitLab and no backend abstraction over the Cursor SDK.

### Standardization & Deduplication

Reuse existing components, patterns, and constants. Every piece of knowledge has one authoritative source.

### Meaningful Comments

Comment the **why** — non-obvious git behaviour, SDK constraints, workarounds. Never the obvious. Git and Electron both have enough surprising behaviour that a _why_ comment often earns its place:

```ts
// ✅ explains why
// git worktree remove leaves the branch behind, so teardown is three ops not one
await git.raw(['branch', '-D', branchName]);
```

## Critical Rules

### Do NOT Touch

- Vendored / third-party directories — never hand-edit
- `*.generated.*` files — edit the source
- Lock files (`bun.lock`) — only via bun
- Build output: `out/`, `dist/`, `node_modules/`, `*.tsbuildinfo`

> These are the rules for agents working **on Airlock**. Airlock separately enforces an overlapping protected-path list on agents working on _your_ repos through it (`src/main/guardrails.ts`). Keep the two lists consistent — the guardrail defaults are seeded from this one — but do not conflate their scope.

### Security

- Never commit `.env`, private keys, or API secrets
- Never log secrets, tokens, or credentials
- Validate and sanitize all external input

Two leak surfaces are specific to this app and easy to miss:

- **Agent transcripts are persisted** to the JSON store and rendered in the UI. A transcript can quote repository contents, so treat it as potentially sensitive. Never write one to a log file.
- **The audit log records actions, not payloads.** Log which threads were resolved and which branch was pushed — never token values or diff contents.

### Comments

- When refactoring or moving code, preserve existing comments — don't silently drop them
- If restructuring makes a comment no longer fit, adapt it rather than deleting it

## State Management

One source of truth per kind of state; never mix patterns.

- **TanStack Query** — PR comments, PR metadata, discovery results. The `queryFn` calls the preload bridge instead of `fetch`. Transport is irrelevant to Query, and this buys refetch-on-demand for re-polling a PR.
- **Zustand** — run and queue state, which arrives as streamed IPC events (transcript chunks, state transitions). Push-based, so a request/response cache is the wrong shape. This is local process state, not server data, so it does not violate the rule below.
- **`useState`** — genuinely local only, such as a filter toggle before it is lifted.
- **Never put server data in a global client store.**

## Data Fetching & Mutation

- Always wrap fetching/mutation in custom hooks — never inline in components
- Naming: `useQuery<Name>` / `useExecute<Name>`, e.g. `useQueryPrComments`, `useExecuteLanding`
- Loading variables match their data variable: `data: prComments` → `isPrCommentsLoading`
- Use the query-key factory, never ad-hoc key arrays
- Handle disabled/loading/error states explicitly — never silently swallow errors
- Route all error logging through `logError`

`ghCli` errors are already typed by kind (missing binary, unauthenticated, rate limited, network, no access). Preserve that kind across IPC — collapsing them into a generic `Error` makes "gh is not installed" indistinguishable from "your token expired", which the settings UI needs to tell apart.

## Number & Value Formatting

- Use a single helper per display concern; define shared presets rather than inlining options at call sites
- Decide nullish behavior once (return `'--'`) so callers don't repeat null checks
- Use a safe-division helper to avoid divide-by-zero

Airlock's real formatting needs are **durations** (run elapsed time) and **byte sizes** (worktree disk usage), so `formatDuration` and `formatBytes` are the helpers to build. There is no money in this app, so arbitrary-precision numeric libraries are explicitly **not** used — native `number` is correct here.

## Styling & classNames

Standardize on two helpers, both built on `tailwind-merge`:

- **`joinClassNames` (default).** Combines classes with no override resolution. Cheaper — prefer it whenever overrides aren't needed.
- **`mergeClassNames` (override-aware).** Use when a component exposes a `className` prop consumers must be able to override. Place `className` last so overrides win.
- **Never** hand-concatenate with template strings or `[a, b].join(' ')`.
- Both accept conditional values, so branch inline rather than building strings.
- **Use a merge helper for any className long enough to scroll off-screen**, grouped into separate string arguments by concern — layout, spacing, typography, decoration, states, conditionals.
- **No ad-hoc className overrides on shared components.** Add a `variant`/`size` prop instead.
- **No arbitrary values** (`w-[5rem]`, `text-[14px]`) when a standard utility exists. Brackets are acceptable only for design tokens (`bg-[var(--token)]`) or true one-offs.
- Prefer theme tokens from the `@theme` block over raw colors and spacing.

## TypeScript Style

- **Typed consts over enums.** `as const` objects, never `enum`. `RUN_STATE` is the canonical example.
- **Interfaces over types for object shapes.** Use `type` only for unions, intersections, and mapped types.
- **Zod-derived types are the documented exception.** `z.infer` produces a `type` alias, and that is correct — do not hand-write a parallel `interface` to satisfy the preference above. `PrComment` is a discriminated union, so `type` is right for it on both counts.
- **Naming:** exported interfaces use verbose descriptive names (`LandingPreviewProps`); file-local ones use simple names (`Props`).
- **Explicit props interfaces — never derive props inline with `typeof`.**
- **No `any`.** Use `unknown` and narrow.
- Prefer discriminated unions over optional-field soup, so illegal states don't typecheck. `PrComment` exists in this shape specifically so "only inline threads have an anchor" is a compiler guarantee.

## Naming & Conventions

- Match surrounding code's naming, casing, and file structure
- **camelCase** variables/functions, **UPPER_SNAKE_CASE** constants, **PascalCase** components/types
- **Booleans** read as predicates — `is`/`has`/`should` (`isPrCommentsLoading`, `hasUnlandedWork`)
- **Files:** `camelCase.ts` for modules, `PascalCase.tsx` for components
- No abbreviations not already used in the codebase
- **Components:** named exports, one per file, `function` declarations (no `React.FC`)
- **Accessibility:** interactive elements need an accessible label and a visible focus ring. Every keyboard shortcut has a visible button equivalent — the keyboard is an accelerator, never the only path.
- Keep transitions consistent on interactive elements

## Shared Components

Extract repeated UI into `src/renderer/src/components/`. Drive variation through variant/size props, never per-instance className overrides.

| Component    | Purpose                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `Button`     | Variants (`primary`/`secondary`/`ghost`/`danger`), sizes (`sm`/`md`/`lg`) |
| `IconButton` | Square icon-only button                                                   |
| `Card`       | Rounded container with border + background                                |
| `Badge`      | Inline status/label with color variants                                   |
| `Toggle`     | Boolean switch                                                            |
| `TreeRow`    | One row of the comment tree: indent, disclosure, label, badge slot        |
| `StateBadge` | Renders a `RunState` — the single strong signal on a row                  |

`StateBadge` is deliberately the only always-visible strong badge. Secondary attributes (bot, outdated, unanchored) render muted and only when true; tier shows only before a run starts. A row carrying eight equal badges communicates nothing, so adding a new always-visible badge needs a real justification.

## Git & PR Workflow

- Branch off the main branch; never commit directly to it
- Keep commits focused; messages describe the _why_
- **Commit or push only when explicitly asked**
- Don't include unrelated formatting churn in a functional change

---

## Useful Utilities

Define once, reuse everywhere:

| Utility                                  | Purpose                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `logError(error, context)`               | Centralized structured error logging                       |
| `assertNever(value)`                     | Exhaustiveness checks over `RunState`, `PrComment['kind']` |
| `isDefined(value)`                       | Type-narrowing nullish filter                              |
| `invariant(cond, msg)`                   | Runtime assertion that narrows and fails loudly            |
| `sleep(ms)` / `withTimeout(promise, ms)` | Async timing; `withTimeout` backs the per-run timeout      |
| `clamp(n, min, max)`                     | Bound a numeric value                                      |
| `groupBy` / `keyBy` / `chunk`            | Collection transforms                                      |
| `createQueryKey(...)`                    | Standardized type-safe query keys                          |
| `joinClassNames(...)`                    | Combine Tailwind classes, no override resolution (default) |
| `mergeClassNames(...)`                   | Combine Tailwind classes with override resolution          |
| `formatDuration(ms)`                     | Run elapsed time; `'--'` when nullish                      |
| `formatBytes(n)`                         | Worktree disk usage; `'--'` when nullish                   |
| `safeDiv(a, b)`                          | Division guarded against divide-by-zero                    |
| `normalizeRemoteUrl(url)`                | Reduce any git remote form to an `owner/repo` key          |

## Not Applicable to This Project

Stated explicitly so they are not ported by reflex from sibling projects:

- **i18n.** Airlock is a single-user English developer tool. There are no translation keys and no `messages/` directory. Hard-coded user-facing strings are acceptable here.
- **Arbitrary-precision numbers.** No money, no financial math. Native `number` throughout.
- **Next.js conventions.** No App Router, Server Components, route builders, or `next build`. The renderer is a plain SPA in a `BrowserWindow`.
- **ORM / database.** State is a JSON file in `app.getPath('userData')`. No Prisma, no SQL, no migrations.

---

## Checklist Before Considering Work Done

- [ ] Typecheck passes
- [ ] Lint passes (with `--fix` applied)
- [ ] Build passes
- [ ] No `any` types or `as` hacks introduced
- [ ] Zod schemas at every new untrusted boundary
- [ ] No Node APIs in the renderer; no new ad-hoc IPC channel outside `ipc.ts`
- [ ] No page-to-page imports; no import cycles between modules; code promoted only on its second consumer
- [ ] No secret crossing IPC, appearing in a log, or entering a transcript
- [ ] Any out-of-sandbox operation requires a confirmation and writes to the audit log
- [ ] No magic numbers — promoted to named constants
- [ ] No logic or conditional rendering inline in JSX
- [ ] No barrel exports, dynamic imports, or deprecated APIs
- [ ] No arbitrary Tailwind values or ad-hoc overrides on shared components
- [ ] Reused shared components/utilities instead of duplicating
- [ ] Followed an existing pattern; diff is minimal and focused
- [ ] Comments preserved/adapted, none silently dropped
