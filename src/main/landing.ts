import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { simpleGit, type SimpleGit } from 'simple-git';
import { appendAuditEntry, createLandingId } from '@main/audit';
import { buildLandingCommitMessage } from '@main/commitMessage';
import { fetchPrComments, resolveReviewThread } from '@main/github';
import { requireRun } from '@main/run';
import { transitionRun } from '@main/runState';
import {
  assertSandboxConfirmation,
  confirmSandboxExit,
  containWorktree,
  resolveGitIdentity,
  SANDBOX_EXIT_ACTION,
  type SandboxConfirmation,
  type SandboxExitAction,
} from '@main/sandbox';
import { resolveLocalRepoPath } from '@main/discovery';
import { getRuns } from '@main/store';
import { commitWorktree, revertToRevision } from '@main/worktree';
import { AUDIT_ACTION } from '@shared/audit';
import { isInlineThread, type PrComment } from '@shared/comments';
import { normalizeRemoteUrl, prRefKey, type PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import type {
  AssembleLandingRequest,
  ExecuteLandingRequest,
  LandingCommitPlan,
  LandingConflict,
  LandingPreview,
  LandingResult,
} from '@shared/landing';
import { RUN_STATE } from '@shared/runState';
import type { CandidatePatchFile, RunRecord } from '@shared/runs';

/**
 * The landing is assembled in a *sandbox* worktree, never in the user's checkout.
 * Previewing a landing honestly means real conflict detection, which means actually
 * performing the merges — so they are performed somewhere nothing is reachable from a
 * real branch, where a conflict can be re-run and a bad result thrown away by deleting
 * a directory. Only publishing that result reaches the repository, and that is gated.
 */
const LANDING_LOG_SCOPE = '[landing]';

/**
 * The integration worktree lives under the same sandbox root as the run worktrees and
 * on a `punchlist/` branch, which is what makes startup reconciliation sweep it: it
 * carries no run record, so it is an orphan by construction and an interrupted assembly
 * cannot leave one behind forever. `worktree.ts` keeps these private, so they are
 * restated here rather than widening its surface for a single caller.
 */
const SANDBOX_DIRECTORY_NAME = 'sandbox';
const PR_DIRECTORY_PREFIX = 'pr-';
const LANDING_DIRECTORY_NAME = 'landing';

/** git spells refnames with forward slashes on every platform. */
const GIT_PATH_SEPARATOR = '/';
const BRANCH_NAME_PREFIX = 'punchlist';
const INTEGRATION_BRANCH_SUFFIX = '-landing';

/** Mirrors `worktree.ts`: a refname may not contain spaces or `~^:?*[`, and dots rule out `..`. */
const UNSAFE_NAME_PATTERN = /[^\w-]+/g;
const UNSAFE_NAME_REPLACEMENT = '-';
const SURROUNDING_DASH_PATTERN = /^-+|-+$/g;
const FALLBACK_NAME_SEGMENT = 'unnamed';

const WORKTREE_ADD_ARGS = ['worktree', 'add', '-b'] as const;
const WORKTREE_REMOVE_ARGS = ['worktree', 'remove'] as const;
const WORKTREE_PRUNE_ARGS = ['worktree', 'prune'] as const;
const BRANCH_DELETE_ARGS = ['branch', '-D'] as const;
const MERGE_SQUASH_ARGS = ['merge', '--squash'] as const;
const MERGE_FF_ONLY_ARGS = ['merge', '--ff-only'] as const;
const CURRENT_BRANCH_ARGS = ['--abbrev-ref', 'HEAD'] as const;
/**
 * `git fetch . <src>:<dst>` fast-forwards a local branch that is not checked out,
 * touching no working tree, and refuses a non-fast-forward without any flag needed.
 */
const LOCAL_FETCH_ARGS = ['fetch', '.'] as const;
const DIFF_NAME_ONLY_ARGS = ['diff', '--name-only', '-z'] as const;
/** `U` is git's status letter for an unmerged path, which is what a conflict leaves behind. */
const UNMERGED_PATHS_ARGS = ['diff', '--name-only', '--diff-filter=U', '-z'] as const;
const PATHSPEC_TERMINATOR = '--';

const BRANCH_REF_PREFIX = 'refs/heads/';
const REFSPEC_SEPARATOR = ':';

const DEFAULT_REMOTE_NAME = 'origin';
const HEAD_REVISION = 'HEAD';
const REVISION_PATH_SEPARATOR = ':';

const EMPTY_STRING = '';
const EMPTY_FILE_CONTENT = '';
const NUL_SEPARATOR = '\0';
const PARAGRAPH_SEPARATOR = '\n\n';
const NO_ENTRIES = 0;

/**
 * Built rather than fetched. The app is github.com-only by construction — discovery's
 * PR-url pattern hardcodes the host — so a `gh` round trip per landing would buy
 * nothing the ref does not already say.
 */
const PR_URL_PREFIX = 'https://github.com/';
const PR_URL_INFIX = '/pull/';

const NOTHING_APPROVED_MESSAGE =
  'No resolution on this pull request is approved, so there is nothing to land.';
const NOTHING_APPROVED_REMEDIATION = 'Approve at least one reviewed resolution, then try again.';
const MIXED_CLONE_MESSAGE =
  'The approved runs were created from different local clones, so their branches do not live in one repository.';
const MIXED_CLONE_REMEDIATION =
  'Reject the runs from the other clone, or re-run them from this one.';
const COMMENT_GONE_MESSAGE =
  'A run is approved for a comment that is no longer on the pull request, so its commit would have no provenance.';
const COMMENT_GONE_REMEDIATION = 'Reject that run, then assemble the landing again.';
const CONFLICTS_UNRESOLVED_MESSAGE =
  'Some approved resolutions still conflict with the integration branch, so the landing was not prepared.';
const CONFLICTS_UNRESOLVED_REMEDIATION =
  'Re-run each conflicting comment against the updated integration state, or reject it.';
const NO_INTEGRATION_BRANCH_MESSAGE =
  'This pull request has no assembled integration branch, so a conflicting comment has nothing to be re-run against.';
const NO_INTEGRATION_BRANCH_REMEDIATION =
  'Assemble the landing preview first, then re-run the conflicting comment.';

/**
 * The action whose confirmation opens the landing gate. Exported so the IPC layer
 * mints the token the entry point actually asserts — a mismatch would be a runtime
 * refusal rather than a compile error, since every confirmation has the same type.
 */
export const LANDING_GATE_ACTION: SandboxExitAction = SANDBOX_EXIT_ACTION.COMMIT_INTEGRATION_BRANCH;

export interface PreparedLanding {
  /** Minted here so every audit entry this landing writes shares one id. */
  landingId: string;
  prRef: PrRef;
  repoPath: string;
  targetBranch: string;
  integrationBranchName: string;
  integrationWorktreePath: string;
  /** The tip the target branch was on, kept so a manual `git reset` has its argument. */
  baseRevision: string;
  /** The tip of the assembled integration branch, which is what lands on the target. */
  headRevision: string;
  commits: LandingCommitPlan[];
  /** Every run whose work is in the branch, so the landing can be traced to its patches. */
  runIds: string[];
}

interface AssembleOptions {
  prRef: PrRef;
  targetBranch: string;
  /** Edited messages by run id. Empty on the preview path, which derives them instead. */
  plannedCommits: ReadonlyMap<string, LandingCommitPlan>;
}

interface AssembledIntegration {
  prRef: PrRef;
  targetBranch: string;
  repoPath: string;
  branchName: string;
  worktreePath: string;
  baseRevision: string;
  headRevision: string;
  commits: LandingCommitPlan[];
  conflicts: LandingConflict[];
  combinedFiles: CandidatePatchFile[];
  runIds: string[];
}

function resolveSandboxRoot(): string {
  return join(app.getPath('userData'), SANDBOX_DIRECTORY_NAME);
}

function toSafeNameSegment(value: string): string {
  const safe = value
    .replaceAll(UNSAFE_NAME_PATTERN, UNSAFE_NAME_REPLACEMENT)
    .replaceAll(SURROUNDING_DASH_PATTERN, EMPTY_STRING);
  return safe.length === 0 ? FALLBACK_NAME_SEGMENT : safe;
}

/**
 * A real branch name derived from the PR — `punchlist/pr-42-landing` — because this is
 * what gets pushed as its own branch and read by a human in a branch list. One segment
 * under `punchlist/`, so it cannot collide with the `punchlist/<pr>/<commentId>` namespace
 * the run branches occupy.
 */
function buildIntegrationBranchName(prRef: PrRef): string {
  const leaf = `${PR_DIRECTORY_PREFIX}${prRef.number}${INTEGRATION_BRANCH_SUFFIX}`;
  return [BRANCH_NAME_PREFIX, leaf].join(GIT_PATH_SEPARATOR);
}

function buildIntegrationWorktreePath(prRef: PrRef): string {
  return join(
    resolveSandboxRoot(),
    toSafeNameSegment(prRef.repoKey),
    `${PR_DIRECTORY_PREFIX}${prRef.number}`,
    LANDING_DIRECTORY_NAME,
  );
}

function buildPrUrl(prRef: PrRef): string {
  return `${PR_URL_PREFIX}${prRef.repoKey}${PR_URL_INFIX}${prRef.number}`;
}

function splitNulSeparated(output: string): string[] {
  return output.split(NUL_SEPARATOR).filter((entry) => entry.length > 0);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function isExistingDirectory(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveRemoteName(git: SimpleGit, repoKey: string): Promise<string> {
  const remotes = await git.getRemotes(true);
  const match = remotes.find((remote) =>
    [remote.refs.fetch, remote.refs.push].some((url) => normalizeRemoteUrl(url) === repoKey),
  );
  return match === undefined ? DEFAULT_REMOTE_NAME : match.name;
}

/**
 * Merge order decides which run's change wins a textual overlap, so it has to be the
 * same on the preview and on the confirmed run. Approval order is not recorded, so the
 * order the runs were created in is what stands, with the id breaking a tie.
 */
function listApprovedRuns(prRef: PrRef): RunRecord[] {
  return getRuns()
    .filter((run) => run.prRef.repoKey === prRef.repoKey && run.prRef.number === prRef.number)
    .filter((run) => run.state === RUN_STATE.APPROVED)
    .sort((left, right) => {
      const byCreatedAt = compareStrings(left.createdAt, right.createdAt);
      return byCreatedAt === 0 ? compareStrings(left.id, right.id) : byCreatedAt;
    });
}

/**
 * The merges happen in the clone the comment branches live in, so runs spread across
 * two clones cannot be landed together — a second clone simply does not have the
 * branches. Refused rather than silently landing the subset that happens to be local.
 */
function resolveRepoPath(runs: readonly RunRecord[]): string {
  const [first] = runs;
  const isSingleClone = runs.every((run) => run.repoPath === first.repoPath);
  if (!isSingleClone) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, MIXED_CLONE_MESSAGE, MIXED_CLONE_REMEDIATION);
  }
  return first.repoPath;
}

/**
 * Re-read from GitHub rather than taken from the run record, which stores only the id:
 * the commit message quotes the remark and names its author, and the threads to resolve
 * come from the same lookup.
 */
async function indexPrComments(prRef: PrRef): Promise<Map<string, PrComment>> {
  const comments = await fetchPrComments(prRef);
  return new Map(comments.map((comment) => [comment.id, comment]));
}

function requireComment(comments: ReadonlyMap<string, PrComment>, run: RunRecord): PrComment {
  const comment = comments.get(run.commentId);
  if (comment === undefined) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, COMMENT_GONE_MESSAGE, COMMENT_GONE_REMEDIATION);
  }
  return comment;
}

function toCommitPlan(run: RunRecord, comment: PrComment, prUrl: string): LandingCommitPlan {
  const message = buildLandingCommitMessage({ comment, prUrl, summary: run.summary });
  const [subject, ...rest] = message.split(PARAGRAPH_SEPARATOR);
  return {
    runId: run.id,
    commentId: run.commentId,
    subject,
    body: rest.join(PARAGRAPH_SEPARATOR),
  };
}

function toCommitMessage(plan: LandingCommitPlan): string {
  const body = plan.body.trim();
  return body.length === 0 ? plan.subject : `${plan.subject}${PARAGRAPH_SEPARATOR}${body}`;
}

function resolveCommitPlan(
  run: RunRecord,
  comment: PrComment,
  prUrl: string,
  plannedCommits: ReadonlyMap<string, LandingCommitPlan>,
): LandingCommitPlan {
  // What was reviewed in the preview is what gets committed: an edited message travels
  // with the confirmation rather than being re-derived here and possibly differing.
  const planned = plannedCommits.get(run.id);
  if (planned === undefined) return toCommitPlan(run, comment, prUrl);
  return { ...planned, runId: run.id, commentId: run.commentId };
}

async function deleteBranchIfPresent(git: SimpleGit, branchName: string): Promise<void> {
  const branches = await git.branchLocal();
  if (!branches.all.includes(branchName)) return;
  await git.raw([...BRANCH_DELETE_ARGS, branchName]);
}

/**
 * Teardown is three operations for the same reason it is in `worktree.ts`: `remove`
 * leaves the branch behind, and a registration whose directory vanished out of band is
 * only swept by `prune`.
 *
 * Never `--force`. The reset is what makes the plain removal succeed: unlike a run's
 * worktree, this one holds no hand-edits — every line in it came from a comment branch
 * and is rebuilt from scratch on the next assembly — so an interrupted assembly is
 * derived state to discard rather than unlanded work to protect.
 */
async function removeIntegrationWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  const git = simpleGit(repoPath);

  if (await isExistingDirectory(worktreePath)) {
    try {
      await revertToRevision(worktreePath, HEAD_REVISION);
    } catch (error: unknown) {
      // A directory an interrupted assembly left behind may not be a usable worktree at
      // all, and the reset is only there to make the removal below succeed — so its
      // failure is reported and the removal still gets to raise the real error.
      console.warn(`${LANDING_LOG_SCOPE} ${worktreePath} could not be reset`, error);
    }
    await git.raw([...WORKTREE_REMOVE_ARGS, worktreePath]);
  }

  await deleteBranchIfPresent(git, branchName);
  await git.raw([...WORKTREE_PRUNE_ARGS]);
}

async function readUnmergedPaths(git: SimpleGit): Promise<string[]> {
  const output = await git.raw([...UNMERGED_PATHS_ARGS]);
  return [...new Set(splitNulSeparated(output))].sort();
}

/**
 * `git merge --squash` rather than `cherry-pick`: once revisions exist a comment's
 * branch holds several commits, so cherry-picking would either replay all of them or
 * need squashing first. A squash-merge collapses the branch into one staged change
 * *and* still performs a real three-way merge, so conflict detection is preserved.
 * `git apply` over a raw diff would give neither.
 *
 * Null means the merge applied cleanly. A conflict is a finding rather than a failure,
 * because the merge actually happened — so it is reported with its paths and the
 * remaining branches are still merged, giving the preview *every* conflict instead of
 * only the first.
 */
async function mergeRunBranch(
  worktreePath: string,
  run: RunRecord,
): Promise<LandingConflict | null> {
  const git = simpleGit(worktreePath);

  try {
    await git.raw([...MERGE_SQUASH_ARGS, run.branchName]);
    return null;
  } catch (error: unknown) {
    const paths = await readUnmergedPaths(git);
    // A merge also fails for reasons that are faults rather than findings — a branch
    // deleted out of band, unrelated histories — and those have no unmerged paths.
    if (paths.length === NO_ENTRIES) throw error;

    // `merge --squash` records no MERGE_HEAD, so `git merge --abort` has nothing to
    // abort; resetting to HEAD is what clears the conflicted index and leaves the
    // worktree usable for the merges that follow. Destructive only inside the sandbox,
    // and not --force.
    await revertToRevision(worktreePath, HEAD_REVISION);
    return { runId: run.id, commentId: run.commentId, paths };
  }
}

async function readRevisionContent(
  git: SimpleGit,
  revision: string,
  filePath: string,
): Promise<string> {
  try {
    return await git.show([`${revision}${REVISION_PATH_SEPARATOR}${filePath}`]);
  } catch {
    // Absent at this revision is a real state rather than a failure: an added file has
    // no base side, a deleted one has no modified side.
    return EMPTY_FILE_CONTENT;
  }
}

/**
 * Read from git rather than from disk, so what the preview shows is what the branch
 * actually contains — the same rule the hand-edit path follows.
 */
async function readCombinedFiles(
  git: SimpleGit,
  baseRevision: string,
): Promise<CandidatePatchFile[]> {
  const changed = await git.raw([
    ...DIFF_NAME_ONLY_ARGS,
    baseRevision,
    HEAD_REVISION,
    PATHSPEC_TERMINATOR,
  ]);
  const paths = [...new Set(splitNulSeparated(changed))].sort();

  return Promise.all(
    paths.map(async (path): Promise<CandidatePatchFile> => ({
      path,
      originalContent: await readRevisionContent(git, baseRevision, path),
      modifiedContent: await readRevisionContent(git, HEAD_REVISION, path),
    })),
  );
}

/**
 * Resolved as a fully qualified local head, so an ambiguous name — a tag, a remote
 * branch with the same name — can neither be landed on nor mask that the local branch
 * simply does not exist.
 */
async function resolveLocalBranchRevision(git: SimpleGit, branchName: string): Promise<string> {
  try {
    return (await git.revparse([toBranchRef(branchName)])).trim();
  } catch {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `The branch "${branchName}" does not exist in this clone, so there is nothing to land on.`,
      'Check out the pull request branch locally, or set the target branch to one that exists.',
    );
  }
}

async function assembleIntegration(options: AssembleOptions): Promise<AssembledIntegration> {
  const { prRef, targetBranch, plannedCommits } = options;

  const runs = listApprovedRuns(prRef);
  if (runs.length === NO_ENTRIES) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      NOTHING_APPROVED_MESSAGE,
      NOTHING_APPROVED_REMEDIATION,
    );
  }

  const repoPath = resolveRepoPath(runs);
  // Preflight before anything is created, exactly as a run does: an unset git identity
  // has no sensible default, and discovering it after the merges would waste them.
  const identity = await resolveGitIdentity(repoPath);

  const git = simpleGit(repoPath);
  // The base is the *local* branch, deliberately: the landing fast-forwards that branch
  // and nothing else, so it must be assembled on exactly the tip it will move —
  // including any local commits the remote has never seen.
  const baseRevision = await resolveLocalBranchRevision(git, targetBranch);

  const branchName = buildIntegrationBranchName(prRef);
  const worktreePath = buildIntegrationWorktreePath(prRef);
  // Assembling is idempotent: whatever a previous preview left is torn down and the
  // branch is rebuilt, so a re-run after a conflict is re-run reflects the new state.
  await removeIntegrationWorktree(repoPath, worktreePath, branchName);
  await mkdir(dirname(worktreePath), { recursive: true });
  await git.raw([...WORKTREE_ADD_ARGS, branchName, worktreePath, baseRevision]);
  // Contained like every other sandbox worktree: assembling a landing must not be able
  // to push, and the commits it creates are authored and committed by the user.
  await containWorktree({ repoPath, worktreePath, identity });

  const comments = await indexPrComments(prRef);
  const prUrl = buildPrUrl(prRef);

  const commits: LandingCommitPlan[] = [];
  const conflicts: LandingConflict[] = [];
  const runIds: string[] = [];

  for (const run of runs) {
    const comment = requireComment(comments, run);
    const conflict = await mergeRunBranch(worktreePath, run);
    if (conflict !== null) {
      conflicts.push(conflict);
      continue;
    }

    // A merge that changed nothing produces no commit, and inventing an empty one
    // would make the history lie.
    runIds.push(run.id);
    const plan = resolveCommitPlan(run, comment, prUrl, plannedCommits);
    const commit = await commitWorktree(worktreePath, toCommitMessage(plan));
    if (commit === null) continue;
    commits.push(plan);
  }

  const worktreeGit = simpleGit(worktreePath);
  const combinedFiles = await readCombinedFiles(worktreeGit, baseRevision);
  const headRevision = (await worktreeGit.revparse([HEAD_REVISION])).trim();

  return {
    prRef,
    targetBranch,
    repoPath,
    branchName,
    worktreePath,
    baseRevision,
    headRevision,
    commits,
    conflicts,
    combinedFiles,
    runIds,
  };
}

/**
 * Exactly what confirming would do, assembled by performing the merges rather than
 * predicting them. Everything here happens inside the sandbox — a throwaway worktree
 * and a `punchlist/` branch — so it needs no confirmation and touches nothing outside
 * it. The reply text defaults to none: a landing posts no comment unless one is typed.
 */
export async function assembleLanding(request: AssembleLandingRequest): Promise<LandingPreview> {
  const assembled = await assembleIntegration({
    prRef: request.prRef,
    targetBranch: request.targetBranch,
    plannedCommits: new Map(),
  });

  return {
    prRef: assembled.prRef,
    targetBranch: assembled.targetBranch,
    integrationBranchName: assembled.branchName,
    commits: assembled.commits,
    combinedFiles: assembled.combinedFiles,
    conflicts: assembled.conflicts,
  };
}

/**
 * The tip of the branch a previous assembly built, which is what a conflicting comment
 * has to be re-run against: its patch conflicted with *this* state, not with the PR head
 * it was originally written on.
 *
 * Resolved here rather than accepted as an argument. A git revision that arrived from
 * the renderer would become the base of a worktree, and main has no reason to trust one
 * when it can read the branch it assembled itself. The branch name is derived from the
 * PR for the same reason, so a caller cannot name a different branch either.
 */
export async function resolveIntegrationRevision(prRef: PrRef, repoPath: string): Promise<string> {
  const branchName = buildIntegrationBranchName(prRef);
  const git = simpleGit(repoPath);

  const branches = await git.branchLocal();
  if (!branches.all.includes(branchName)) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      NO_INTEGRATION_BRANCH_MESSAGE,
      NO_INTEGRATION_BRANCH_REMEDIATION,
    );
  }

  return (await git.revparse([branchName])).trim();
}

function assertNoConflicts(assembled: AssembledIntegration): void {
  if (assembled.conflicts.length === NO_ENTRIES) return;
  // Named by run, never by content: a conflict's paths are already in the preview.
  console.warn(
    `${LANDING_LOG_SCOPE} landing refused`,
    `${assembled.conflicts.length} unresolved conflict(s)`,
  );
  throw new AppError(
    APP_ERROR_KIND.NOT_FOUND,
    CONFLICTS_UNRESOLVED_MESSAGE,
    CONFLICTS_UNRESOLVED_REMEDIATION,
  );
}

/**
 * Everything the landing does inside the sandbox: it rebuilds the integration branch
 * with the messages that were reviewed, and refuses while a conflict or an
 * unacknowledged finding stands. Nothing has left the sandbox when this returns, which
 * is why it writes no audit entry — the log records actions taken on the repository,
 * and the landing id minted here is what groups the entries those actions write.
 */
async function prepareLanding(
  request: ExecuteLandingRequest,
  confirmation: SandboxConfirmation,
): Promise<PreparedLanding> {
  // Checked rather than assumed: a confirmation never crosses IPC, and confirming one
  // action does not authorise another.
  assertSandboxConfirmation(confirmation, LANDING_GATE_ACTION);

  const assembled = await assembleIntegration({
    prRef: request.prRef,
    targetBranch: request.targetBranch,
    plannedCommits: new Map(request.commits.map((commit) => [commit.runId, commit])),
  });

  assertNoConflicts(assembled);

  return {
    landingId: createLandingId(),
    prRef: assembled.prRef,
    repoPath: assembled.repoPath,
    targetBranch: assembled.targetBranch,
    integrationBranchName: assembled.branchName,
    integrationWorktreePath: assembled.worktreePath,
    baseRevision: assembled.baseRevision,
    headRevision: assembled.headRevision,
    commits: assembled.commits,
    runIds: assembled.runIds,
  };
}

/**
 * The gate confirmation authorises every step downstream of it, so the per-action
 * tokens the callees assert are derived from it rather than asked for again — the user
 * confirms a landing, not five separate operations.
 *
 * The derivation is not a loophole: holding the gate token is the proof, since a
 * `SandboxConfirmation` cannot be written as a literal outside `sandbox.ts` and the
 * assertion below re-checks that this one is the gate's rather than some other action's.
 */
function deriveGatedConfirmation(
  gate: SandboxConfirmation,
  gateAction: SandboxExitAction,
  action: SandboxExitAction,
): SandboxConfirmation {
  assertSandboxConfirmation(gate, gateAction);
  return confirmSandboxExit({ action, isConfirmedByUser: true });
}

function toBranchRef(branchName: string): string {
  return `${BRANCH_REF_PREFIX}${branchName}`;
}

/**
 * The first step outside the sandbox. The branch ref already exists in the real
 * repository — `git worktree add -b` created it there — but while the sandbox worktree
 * holds it, it is checked out under a contained worktree whose invalid `pushurl` makes
 * it unpushable, and the next assembly tears it down. Removing the worktree is what
 * publishes it: the branch stays behind as an ordinary branch of the repository, and the
 * worktree-scoped containment config leaves with the worktree's own config file.
 *
 * Never `--force`, and no reset first. Unlike the idempotent teardown in
 * `removeIntegrationWorktree`, this one runs on a worktree that is clean by construction
 * — every merge either committed or changed nothing — so a plain removal succeeds, and a
 * removal that refuses means something is in that directory that nobody has looked at.
 */
async function publishIntegrationBranch(
  prepared: PreparedLanding,
  gate: SandboxConfirmation,
): Promise<void> {
  // `commitIntegrationBranch` is exactly this step, so the gate token authorises it as
  // itself rather than through a derivation.
  assertSandboxConfirmation(gate, LANDING_GATE_ACTION);

  const git = simpleGit(prepared.repoPath);

  if (await isExistingDirectory(prepared.integrationWorktreePath)) {
    await git.raw([...WORKTREE_REMOVE_ARGS, prepared.integrationWorktreePath]);
  }
  // `remove` drops the registration, but one whose directory vanished out of band is
  // only swept by `prune`. The branch is deliberately kept — it *is* the landing.
  await git.raw([...WORKTREE_PRUNE_ARGS]);
}

/**
 * The one step that touches a real branch. `--ff-only` in the user's own checkout when
 * the target is the current branch — git updates branch, index and working tree
 * coherently, and refuses if uncommitted changes overlap. When the target is not
 * checked out, `git fetch . <integration>:<target>` moves the ref alone, and refuses
 * anything that is not a fast-forward. Never `--force` in either shape: a refusal
 * means the branch holds commits this landing was not assembled on, which is a state
 * to look at rather than overwrite.
 */
async function fastForwardTargetBranch(
  prepared: PreparedLanding,
  gate: SandboxConfirmation,
): Promise<void> {
  const confirmation = deriveGatedConfirmation(
    gate,
    LANDING_GATE_ACTION,
    SANDBOX_EXIT_ACTION.UPDATE_TARGET_BRANCH,
  );
  assertSandboxConfirmation(confirmation, SANDBOX_EXIT_ACTION.UPDATE_TARGET_BRANCH);

  const git = simpleGit(prepared.repoPath);
  const currentBranch = (await git.revparse([...CURRENT_BRANCH_ARGS])).trim();

  if (currentBranch === prepared.targetBranch) {
    await git.raw([...MERGE_FF_ONLY_ARGS, toBranchRef(prepared.integrationBranchName)]);
    return;
  }

  await git.raw([
    ...LOCAL_FETCH_ARGS,
    `${toBranchRef(prepared.integrationBranchName)}${REFSPEC_SEPARATOR}${toBranchRef(prepared.targetBranch)}`,
  ]);
}

/**
 * The integration branch was the vehicle, and after a successful fast-forward the
 * target branch holds everything it held — leaving it behind would accumulate one
 * spent `punchlist/` branch per landing.
 */
async function removeIntegrationBranch(prepared: PreparedLanding): Promise<void> {
  try {
    await simpleGit(prepared.repoPath).raw([...BRANCH_DELETE_ARGS, prepared.integrationBranchName]);
  } catch (error: unknown) {
    // A leftover branch is clutter, not damage, so it must not fail the landing.
    console.warn(
      `${LANDING_LOG_SCOPE} could not delete the integration branch`,
      error instanceof Error ? error.name : 'unknown',
    );
  }
}

/**
 * Last, and only once everything above has succeeded: `applied` is the one state with no
 * way out, so a failure earlier leaves the runs `approved` and the landing something to
 * finish rather than marking work landed that never reached the remote.
 */
function markRunsApplied(runIds: readonly string[]): void {
  for (const runId of runIds) {
    transitionRun(requireRun(runId), RUN_STATE.APPLIED);
  }
}

/**
 * The gated entry point, and the only path in the app that reaches a real branch. It
 * takes a `SandboxConfirmation` at the type level because a branded token that cannot
 * be written as a literal is the only version of "the user said so" a later caller
 * cannot forget.
 *
 * Everything stays on this machine: the target branch is fast-forwarded to the
 * reviewed result and that is all. Nothing is pushed, no thread is resolved, no
 * comment is posted — publishing the result is the user's own git flow, which is
 * exactly where they said they wanted it.
 */
export async function executeLanding(
  request: ExecuteLandingRequest,
  confirmation: SandboxConfirmation,
): Promise<LandingResult> {
  const prepared = await prepareLanding(request, confirmation);

  await publishIntegrationBranch(prepared, confirmation);
  await fastForwardTargetBranch(prepared, confirmation);
  await appendAuditEntry({
    action: AUDIT_ACTION.TARGET_BRANCH_UPDATED,
    prRef: prepared.prRef,
    // The previous tip is the audit's most load-bearing fact: it is the argument a
    // manual `git reset` needs if the landing is ever unwanted.
    summary: `Fast-forwarded ${prepared.targetBranch} from ${prepared.baseRevision} to ${prepared.headRevision} (${prepared.commits.length} commit(s))`,
    runIds: prepared.runIds,
    branchName: prepared.targetBranch,
    landingId: prepared.landingId,
  });

  await removeIntegrationBranch(prepared);
  markRunsApplied(prepared.runIds);

  return {
    landingId: prepared.landingId,
    targetBranch: prepared.targetBranch,
    previousRevision: prepared.baseRevision,
    landedRevision: prepared.headRevision,
    commitCount: prepared.commits.length,
    runIds: prepared.runIds,
  };
}

const NOTHING_LANDED_MESSAGE =
  'No landed run covers this pull request, so there is no thread to resolve.';
const NOTHING_LANDED_REMEDIATION = 'Land at least one approved resolution first.';

/**
 * Pushes the target branch to its remote counterpart — on demand, never as part of a
 * landing. Fully qualified on both sides so `push.default` and configured refspecs
 * cannot reinterpret it, and never forced: a rejection means the remote moved, which
 * is a state to look at.
 */
export async function pushTargetBranch(
  request: { prRef: PrRef; targetBranch: string },
  confirmation: SandboxConfirmation,
): Promise<{ branchName: string; remoteName: string }> {
  assertSandboxConfirmation(confirmation, SANDBOX_EXIT_ACTION.PUSH_BRANCH);

  const repoPath = resolveLocalRepoPath(request.prRef.repoKey);
  if (repoPath === null) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, MIXED_CLONE_MESSAGE, MIXED_CLONE_REMEDIATION);
  }
  const git = simpleGit(repoPath);
  const remoteName = await resolveRemoteName(git, request.prRef.repoKey);
  const ref = toBranchRef(request.targetBranch);
  await git.raw(['push', remoteName, `${ref}${REFSPEC_SEPARATOR}${ref}`]);

  await appendAuditEntry({
    action: AUDIT_ACTION.BRANCH_PUSHED,
    prRef: request.prRef,
    summary: `Pushed ${request.targetBranch} to ${remoteName}`,
    branchName: request.targetBranch,
    remoteName,
  });

  return { branchName: request.targetBranch, remoteName };
}

/**
 * Resolves the review threads of every comment a *landed* run addressed. Derived from
 * the applied runs and a fresh comment fetch rather than remembered from the landing,
 * so it can run any time after — including after several landings — and never touches
 * a thread that is already resolved.
 */
export async function resolveLandedThreads(
  prRef: PrRef,
  confirmation: SandboxConfirmation,
): Promise<{ resolvedThreadIds: string[] }> {
  assertSandboxConfirmation(confirmation, SANDBOX_EXIT_ACTION.RESOLVE_REVIEW_THREAD);

  const appliedCommentIds = new Set(
    getRuns()
      .filter((run) => prRefKey(run.prRef) === prRefKey(prRef) && run.state === RUN_STATE.APPLIED)
      .map((run) => run.commentId),
  );
  if (appliedCommentIds.size === NO_ENTRIES) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      NOTHING_LANDED_MESSAGE,
      NOTHING_LANDED_REMEDIATION,
    );
  }

  const comments = await fetchPrComments(prRef);
  const resolvedThreadIds: string[] = [];
  for (const comment of comments) {
    if (!isInlineThread(comment)) continue;
    if (!appliedCommentIds.has(comment.id)) continue;
    if (comment.isResolved) continue;
    await resolveReviewThread(comment.threadId, confirmation);
    resolvedThreadIds.push(comment.threadId);
  }
  return { resolvedThreadIds };
}
