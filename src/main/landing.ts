import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  appendAuditEntry,
  createLandingId,
  listAuditEntries,
  listLandingAuditEntries,
} from '@main/audit';
import { buildLandingCommitMessage } from '@main/commitMessage';
import {
  fetchPrComments,
  postReviewThreadReply,
  resolveReviewThread,
  unresolveReviewThread,
} from '@main/github';
import { inspectCandidatePatch } from '@main/guardrails';
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
import { getRunById, getRuns } from '@main/store';
import { commitWorktree, revertToRevision } from '@main/worktree';
import { AUDIT_ACTION, type AuditEntry } from '@shared/audit';
import {
  COMMENT_KIND,
  isInlineThread,
  type PrComment,
  type UnanchoredComment,
} from '@shared/comments';
import { normalizeRemoteUrl, prRefKey, type PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import type { GuardrailFlag } from '@shared/guardrails';
import type {
  AssembleLandingRequest,
  ExecuteLandingRequest,
  LandingCommitPlan,
  LandingConflict,
  LandingPreview,
  LandingResult,
  LandingThread,
  UndoLandingRequest,
  UndoableLanding,
} from '@shared/landing';
import { MODEL_TIER, RUN_STATE, type ModelTier } from '@shared/runState';
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
const DIFF_NAME_ONLY_ARGS = ['diff', '--name-only', '-z'] as const;
/** `U` is git's status letter for an unmerged path, which is what a conflict leaves behind. */
const UNMERGED_PATHS_ARGS = ['diff', '--name-only', '--diff-filter=U', '-z'] as const;
const PATHSPEC_TERMINATOR = '--';

/**
 * Both sides of the refspec are fully qualified so nothing else can decide what this
 * push means: `push.default`, a configured `remote.<name>.push` refspec or an
 * abbreviated name could otherwise send a different ref than the one assembled here.
 * The *target* branch never appears on either side — landing pushes the integration
 * branch as its own branch, which is what makes the result reviewable as a PR and
 * reversible by deleting it.
 */
const PUSH_ARGS = ['push'] as const;
const PUSH_DELETE_FLAG = '--delete';
const BRANCH_REF_PREFIX = 'refs/heads/';
const REFSPEC_SEPARATOR = ':';
/** Read-only, so it needs no confirmation: it only asks whether the branch is still there. */
const LS_REMOTE_HEADS_ARGS = ['ls-remote', '--heads'] as const;

const DEFAULT_REMOTE_NAME = 'origin';
const FETCH_HEAD_REVISION = 'FETCH_HEAD';
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

/**
 * The combined diff belongs to no single comment, so the anchor check — "did this
 * patch stray from the file *its* comment is about" — has nothing to compare against.
 * An unanchored comment is exactly how `inspectCandidatePatch` expresses "that check
 * does not apply", so the combined diff is inspected as one. This value is local to a
 * guardrail pass: it is never persisted, rendered, or mistaken for a real remark.
 */
const COMBINED_DIFF_AUTHOR_LOGIN = 'punchlist';

/**
 * Widest wins. The combined diff legitimately contains every approved run's work, so
 * measuring it against the narrowest tier involved would flag every multi-comment
 * landing and train the flag away.
 */
const TIER_BREADTH_ORDER: readonly ModelTier[] = [
  MODEL_TIER.MECHANICAL,
  MODEL_TIER.STANDARD,
  MODEL_TIER.COMPLEX,
];

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
const NOT_LATEST_LANDING_MESSAGE =
  'That landing is no longer the most recent one, so undoing it here could unwind work built on top of it.';
const NOT_LATEST_LANDING_REMEDIATION =
  'Delete the branch and unresolve the threads by hand if that is really what you want.';
const UNDO_NO_RUNS_MESSAGE =
  'Every run this landing covered has been forgotten, so the clone its branch was pushed from is unknown.';
const UNDO_NO_RUNS_REMEDIATION =
  'Delete the pushed branch and unresolve the threads by hand, using the audit log as the record.';

/**
 * The action whose confirmation opens the landing gate, and the one that opens the undo
 * gate. Exported so the IPC layer mints the token the entry point actually asserts —
 * a mismatch would be a runtime refusal rather than a compile error, since every
 * confirmation has the same type.
 *
 * Undo is gated on `pushBranch` because deleting a branch on the remote *is* a push:
 * `git push --delete` is the operation, and it is the destructive half of an undo.
 */
export const LANDING_GATE_ACTION: SandboxExitAction = SANDBOX_EXIT_ACTION.COMMIT_INTEGRATION_BRANCH;
export const UNDO_LANDING_GATE_ACTION: SandboxExitAction = SANDBOX_EXIT_ACTION.PUSH_BRANCH;

export interface PreparedLanding {
  /**
   * Minted here so every audit entry this landing writes shares one id, and an undo can
   * replay exactly it.
   */
  landingId: string;
  prRef: PrRef;
  repoPath: string;
  remoteName: string;
  targetBranch: string;
  integrationBranchName: string;
  integrationWorktreePath: string;
  /** The tip of the assembled integration branch, which is what the landing publishes. */
  headRevision: string;
  commits: LandingCommitPlan[];
  threadsToResolve: LandingThread[];
  replyText: string | null;
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
  remoteName: string;
  branchName: string;
  worktreePath: string;
  baseRevision: string;
  headRevision: string;
  commits: LandingCommitPlan[];
  conflicts: LandingConflict[];
  combinedFiles: CandidatePatchFile[];
  guardrailFlags: GuardrailFlag[];
  threadsToResolve: LandingThread[];
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

function resolveCombinedTier(runs: readonly RunRecord[]): ModelTier {
  return runs.reduce<ModelTier>((widest, run) => {
    const isWider = TIER_BREADTH_ORDER.indexOf(run.tier) > TIER_BREADTH_ORDER.indexOf(widest);
    return isWider ? run.tier : widest;
  }, MODEL_TIER.MECHANICAL);
}

function toCombinedDiffSubject(prRef: PrRef): UnanchoredComment {
  return {
    kind: COMMENT_KIND.CONVERSATION,
    id: prRefKey(prRef),
    body: EMPTY_STRING,
    author: { login: COMBINED_DIFF_AUTHOR_LOGIN, isBot: false },
    createdAt: new Date().toISOString(),
    url: buildPrUrl(prRef),
    replies: [],
  };
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
 * The second guardrail pass. A patch that was fine on its own can combine badly, and
 * the combined diff is a different artifact — more files, more added lines, and
 * whatever the overlap of two patches produced — which is why `inspectCandidatePatch`
 * takes no per-run assumption.
 */
function inspectCombinedDiff(
  prRef: PrRef,
  runs: readonly RunRecord[],
  files: readonly CandidatePatchFile[],
): GuardrailFlag[] {
  return inspectCandidatePatch({
    // The combined patch belongs to the landing rather than to any one run, so it is
    // identified by the PR.
    patch: { runId: prRefKey(prRef), files: [...files], isEmpty: files.length === NO_ENTRIES },
    comment: toCombinedDiffSubject(prRef),
    tier: resolveCombinedTier(runs),
  });
}

/**
 * Only inline threads carry a `PRRT_`-prefixed thread node id and can be resolved
 * through the API, so review bodies and conversation comments contribute nothing here
 * rather than a fabricated id.
 */
function toLandingThreads(comments: readonly PrComment[]): LandingThread[] {
  const threads = new Map<string, LandingThread>();
  for (const comment of comments) {
    if (!isInlineThread(comment)) continue;
    threads.set(comment.threadId, { threadId: comment.threadId, url: comment.url });
  }
  return [...threads.values()];
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
  const remoteName = await resolveRemoteName(git, prRef.repoKey);
  // The target is read from the remote rather than from the local checkout, so the
  // preview is assembled against what the landing would really merge into. Fetching is
  // read-only, so it is not a gated action.
  await git.fetch([remoteName, targetBranch]);
  // FETCH_HEAD is per-repository state, so this read belongs to the fetch above.
  const baseRevision = (await git.revparse([FETCH_HEAD_REVISION])).trim();

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
  const mergedComments: PrComment[] = [];
  const runIds: string[] = [];

  for (const run of runs) {
    const comment = requireComment(comments, run);
    const conflict = await mergeRunBranch(worktreePath, run);
    if (conflict !== null) {
      conflicts.push(conflict);
      continue;
    }

    // A clean merge puts this run's work in the branch whether or not it added
    // anything new, so its thread is resolvable either way; a merge that changed
    // nothing produces no commit, and inventing an empty one would make the history lie.
    mergedComments.push(comment);
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
    remoteName,
    branchName,
    worktreePath,
    baseRevision,
    headRevision,
    commits,
    conflicts,
    combinedFiles,
    guardrailFlags: inspectCombinedDiff(prRef, runs, combinedFiles),
    threadsToResolve: toLandingThreads(mergedComments),
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
    // Recorded, never pushed to: landing pushes the integration branch as its own
    // branch so the result is reviewable as a PR and reversible.
    targetBranch: assembled.targetBranch,
    remoteName: assembled.remoteName,
    integrationBranchName: assembled.branchName,
    commits: assembled.commits,
    combinedFiles: assembled.combinedFiles,
    guardrailFlags: assembled.guardrailFlags,
    conflicts: assembled.conflicts,
    threadsToResolve: assembled.threadsToResolve,
    replyText: null,
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
    remoteName: assembled.remoteName,
    targetBranch: assembled.targetBranch,
    integrationBranchName: assembled.branchName,
    integrationWorktreePath: assembled.worktreePath,
    headRevision: assembled.headRevision,
    commits: assembled.commits,
    threadsToResolve: assembled.threadsToResolve,
    replyText: request.replyText,
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
 * Pushed from the real clone rather than from the worktree, because the worktree-scoped
 * invalid `pushurl` is containment and the clone is where the user's own credentials
 * apply.
 *
 * Never `--force` and never `--force-with-lease`, here or as a fallback: a rejected push
 * means the remote branch holds commits this landing does not contain, which is a state
 * to look at rather than to overwrite.
 */
async function pushIntegrationBranch(
  prepared: PreparedLanding,
  gate: SandboxConfirmation,
): Promise<void> {
  // The push is performed here rather than by a callee, so the gate token is what
  // authorises it directly and there is no derived one to hand anybody.
  assertSandboxConfirmation(gate, LANDING_GATE_ACTION);

  const ref = toBranchRef(prepared.integrationBranchName);
  await simpleGit(prepared.repoPath).raw([
    ...PUSH_ARGS,
    prepared.remoteName,
    `${ref}${REFSPEC_SEPARATOR}${ref}`,
  ]);
}

/**
 * One thread at a time, and the first failure stops the landing rather than being
 * collected: an error here is a real GitHub failure, and pressing on would pile more
 * half-finished work onto a landing that already needs looking at. What already
 * succeeded stays in the audit log, which is what makes the result recoverable — undo
 * replays exactly the threads that were recorded as resolved.
 */
async function resolveLandingThreads(
  prepared: PreparedLanding,
  gate: SandboxConfirmation,
): Promise<string[]> {
  const confirmation = deriveGatedConfirmation(
    gate,
    LANDING_GATE_ACTION,
    SANDBOX_EXIT_ACTION.RESOLVE_REVIEW_THREAD,
  );

  const resolvedThreadIds: string[] = [];
  for (const thread of prepared.threadsToResolve) {
    await resolveReviewThread(thread.threadId, confirmation, prepared.landingId);
    resolvedThreadIds.push(thread.threadId);
  }
  return resolvedThreadIds;
}

/**
 * The reply is posted to each thread the landing resolved, because a reply on GitHub
 * belongs to a thread: one note saying where a remark was addressed is what each
 * reviewer needs to see under their own comment.
 *
 * A landing whose comments carry no resolvable thread therefore has nowhere to post,
 * and reports that it posted nothing rather than inventing a place to put it.
 *
 * **A posted reply cannot be unposted.** GitHub only lets a comment be followed by
 * another comment, so this step has no counterpart in `undoLanding` and the returned
 * flag is a fact rather than a reversible step.
 */
async function postLandingReply(
  prepared: PreparedLanding,
  resolvedThreadIds: readonly string[],
  gate: SandboxConfirmation,
): Promise<boolean> {
  const body = prepared.replyText === null ? EMPTY_STRING : prepared.replyText.trim();
  if (body.length === NO_ENTRIES || resolvedThreadIds.length === NO_ENTRIES) return false;

  const confirmation = deriveGatedConfirmation(
    gate,
    LANDING_GATE_ACTION,
    SANDBOX_EXIT_ACTION.POST_REPLY,
  );

  for (const threadId of resolvedThreadIds) {
    await postReviewThreadReply(threadId, body, confirmation, prepared.landingId);
  }
  return true;
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
 * The gated entry point, and the only path in the app that reaches the real repository.
 * It takes a `SandboxConfirmation` at the type level because a branded token that cannot
 * be written as a literal is the only version of "the user said so" a later caller
 * cannot forget.
 *
 * Each step is audited **after** it succeeds, never before: undo replays the landing
 * from these entries, so an entry for something that did not happen would make it try to
 * reverse an action nobody took. For the same reason nothing is un-recorded when a later
 * step fails — a partial landing that is honestly recorded is recoverable through undo,
 * one that is tidied out of the log is not.
 *
 * `resolveReviewThread` and `postReviewThreadReply` are handed this landing's id and
 * write their own entries against it, which is what that parameter is for.
 */
export async function executeLanding(
  request: ExecuteLandingRequest,
  confirmation: SandboxConfirmation,
): Promise<LandingResult> {
  const prepared = await prepareLanding(request, confirmation);

  await publishIntegrationBranch(prepared, confirmation);
  await appendAuditEntry({
    action: AUDIT_ACTION.INTEGRATION_BRANCH_PUBLISHED,
    prRef: prepared.prRef,
    summary: `Published ${prepared.integrationBranchName} with ${prepared.commits.length} commit(s)`,
    runIds: prepared.runIds,
    branchName: prepared.integrationBranchName,
    landingId: prepared.landingId,
  });

  await pushIntegrationBranch(prepared, confirmation);
  await appendAuditEntry({
    action: AUDIT_ACTION.BRANCH_PUSHED,
    prRef: prepared.prRef,
    // Names the branch and the remote, never the target branch it will be reviewed
    // against and never a line of what it contains.
    summary: `Pushed ${prepared.integrationBranchName} to ${prepared.remoteName}`,
    runIds: prepared.runIds,
    branchName: prepared.integrationBranchName,
    remoteName: prepared.remoteName,
    landingId: prepared.landingId,
  });

  const resolvedThreadIds = await resolveLandingThreads(prepared, confirmation);
  const isReplyPosted = await postLandingReply(prepared, resolvedThreadIds, confirmation);

  markRunsApplied(prepared.runIds);

  return {
    landingId: prepared.landingId,
    integrationBranchName: prepared.integrationBranchName,
    remoteName: prepared.remoteName,
    resolvedThreadIds,
    isReplyPosted,
    runIds: prepared.runIds,
  };
}

function collectThreadIds(entries: readonly AuditEntry[], action: AuditEntry['action']): string[] {
  return entries.filter((entry) => entry.action === action).flatMap((entry) => entry.threadIds);
}

/**
 * One landing's entries — newest first, as the log returns them — read back as the
 * record an undo replays in reverse. Null means there is nothing an undo may reverse:
 *
 * - It has already been undone. The log is append-only, so the `LANDING_UNDONE` entry
 *   stands next to the entries it reversed rather than removing them, and it is exactly
 *   how a spent landing is recognised.
 * - Nothing reached the remote. A landing that failed before its push left a local
 *   branch and nothing else, and a button offering to undo it would be a lie.
 *
 * The *oldest* push of the group is the landing's own: an undo records its branch
 * deletion as a push too, because `git push --delete` is what it does.
 */
function toUndoableLanding(
  landingId: string,
  entries: readonly AuditEntry[],
): UndoableLanding | null {
  if (entries.some((entry) => entry.action === AUDIT_ACTION.LANDING_UNDONE)) return null;

  const pushed = entries.findLast((entry) => entry.action === AUDIT_ACTION.BRANCH_PUSHED);
  if (pushed === undefined) return null;
  if (pushed.branchName === null || pushed.remoteName === null) return null;

  // Threads an interrupted undo already brought back are dropped, so a retry unresolves
  // what is still resolved instead of replaying the whole list.
  const alreadyUnresolved = new Set(collectThreadIds(entries, AUDIT_ACTION.THREAD_UNRESOLVED));
  const resolvedThreadIds = [
    ...new Set(collectThreadIds(entries, AUDIT_ACTION.THREAD_RESOLVED)),
  ].filter((threadId) => !alreadyUnresolved.has(threadId));

  return {
    landingId,
    at: pushed.at,
    integrationBranchName: pushed.branchName,
    remoteName: pushed.remoteName,
    resolvedThreadIds,
    isReplyPosted: entries.some((entry) => entry.action === AUDIT_ACTION.REPLY_POSTED),
    runIds: pushed.runIds,
  };
}

/**
 * Undo is offered only while this is the most recent landing. Once another landing has
 * happened — or work has been built on top of that branch — unwinding it is a git
 * operation to perform deliberately rather than through a button, so the newest landing
 * id in the log is the only one this ever returns.
 */
export async function findUndoableLanding(): Promise<UndoableLanding | null> {
  const entries = await listAuditEntries();
  const latest = entries.find((entry) => entry.landingId !== null);
  if (latest === undefined || latest.landingId === null) return null;

  return toUndoableLanding(latest.landingId, await listLandingAuditEntries(latest.landingId));
}

/**
 * A run record can be forgotten while its landing stays in the log, and an undo that
 * refused over a dismissed run would leave a branch on the remote that nothing else
 * deletes. So the missing ones are skipped and the branch is still removed.
 */
function listLandedRuns(runIds: readonly string[]): RunRecord[] {
  return runIds.map((runId) => getRunById(runId)).filter((run): run is RunRecord => run !== null);
}

/** Whether the branch this landing pushed is still on the remote. */
async function hasRemoteBranch(repoPath: string, landing: UndoableLanding): Promise<boolean> {
  const output = await simpleGit(repoPath).raw([
    ...LS_REMOTE_HEADS_ARGS,
    landing.remoteName,
    toBranchRef(landing.integrationBranchName),
  ]);
  return output.trim().length > NO_ENTRIES;
}

/**
 * A deletion, never a force-push: the branch this landing created is removed whole
 * rather than rewritten, which is the only reason "reversible by deleting a branch"
 * holds without ever forcing anything.
 *
 * The local branch is deliberately left alone. The audit record authorises undoing what
 * the landing did *outside* the sandbox, and the commits are still the user's to keep or
 * delete themselves.
 *
 * False means the remote branch was already gone — an undo that was interrupted after
 * this step, or a branch deleted by hand — so there was nothing to delete and nothing to
 * record. Checked rather than discovered through a failed push, since undo is also the
 * recovery path for a partial landing and has to be safe to retry.
 */
async function deletePushedBranch(
  repoPath: string,
  landing: UndoableLanding,
  gate: SandboxConfirmation,
): Promise<boolean> {
  // The undo gate *is* the push confirmation, since deleting a remote branch is a push.
  assertSandboxConfirmation(gate, UNDO_LANDING_GATE_ACTION);
  if (!(await hasRemoteBranch(repoPath, landing))) return false;

  await simpleGit(repoPath).raw([
    ...PUSH_ARGS,
    landing.remoteName,
    PUSH_DELETE_FLAG,
    toBranchRef(landing.integrationBranchName),
  ]);
  return true;
}

/**
 * Back to `approved`, which is where the runs were when the landing gate opened.
 *
 * Written through the store rather than through `transitionRun`, because the transition
 * table has no `applied → approved` edge: it was written when landed work really was
 * final, and undo is precisely that edge. This is the one place in the app a run's state
 * moves without the machine's blessing, and the durable fix is that edge in
 * `runState.ts` — after which this becomes a `transitionRun` call like every other.
 */
function returnRunsToApproved(runs: readonly RunRecord[]): void {
  for (const run of runs) {
    // Only the runs this landing actually marked applied. One that failed before the
    // state change is already approved, and a later re-approval is not undo's to touch.
    if (run.state !== RUN_STATE.APPLIED) continue;
    transitionRun(run, RUN_STATE.APPROVED);
  }
}

/**
 * The reverse of a landing, replayed from its own audit record: delete the branch that
 * was pushed, unresolve every thread the landing resolved, return those runs to
 * `approved`. It costs no extra bookkeeping because `unresolveReviewThread` takes the
 * same `PRRT_` thread node id `resolveReviewThread` consumed, which the record holds.
 *
 * Two limits are honest rather than papered over. **A posted reply is not unposted** —
 * GitHub allows only a further comment, so `isReplyPosted` travels back to the caller as
 * a fact to state. And **only the most recent landing may be undone**, refused below
 * rather than trusted from the caller.
 *
 * The undo appends its own entry rather than editing the ones it reverses; the log is
 * append-only, and a history that quietly loses a push is worse than one that records
 * both the push and its reversal.
 */
export async function undoLanding(
  request: UndoLandingRequest,
  confirmation: SandboxConfirmation,
): Promise<UndoableLanding> {
  assertSandboxConfirmation(confirmation, UNDO_LANDING_GATE_ACTION);

  const undoable = await findUndoableLanding();
  if (undoable === null || undoable.landingId !== request.landingId) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      NOT_LATEST_LANDING_MESSAGE,
      NOT_LATEST_LANDING_REMEDIATION,
    );
  }

  // The clone the branch was pushed from is not in the log — it holds actions, not
  // paths — so it comes from the runs the landing covered, which all share one.
  const runs = listLandedRuns(undoable.runIds);
  const [firstRun] = runs;
  if (firstRun === undefined) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, UNDO_NO_RUNS_MESSAGE, UNDO_NO_RUNS_REMEDIATION);
  }

  const isBranchDeleted = await deletePushedBranch(firstRun.repoPath, undoable, confirmation);
  if (isBranchDeleted) {
    await appendAuditEntry({
      action: AUDIT_ACTION.BRANCH_PUSHED,
      prRef: firstRun.prRef,
      summary: `Deleted ${undoable.integrationBranchName} on ${undoable.remoteName}`,
      runIds: undoable.runIds,
      branchName: undoable.integrationBranchName,
      remoteName: undoable.remoteName,
      landingId: undoable.landingId,
    });
  }

  const unresolveConfirmation = deriveGatedConfirmation(
    confirmation,
    UNDO_LANDING_GATE_ACTION,
    SANDBOX_EXIT_ACTION.UNRESOLVE_REVIEW_THREAD,
  );
  for (const threadId of undoable.resolvedThreadIds) {
    await unresolveReviewThread(threadId, unresolveConfirmation, undoable.landingId);
  }

  returnRunsToApproved(runs);

  await appendAuditEntry({
    action: AUDIT_ACTION.LANDING_UNDONE,
    prRef: firstRun.prRef,
    summary: `Undid ${undoable.landingId}: ${undoable.integrationBranchName} deleted on ${undoable.remoteName}, ${undoable.resolvedThreadIds.length} thread(s) unresolved`,
    runIds: undoable.runIds,
    threadIds: undoable.resolvedThreadIds,
    branchName: undoable.integrationBranchName,
    remoteName: undoable.remoteName,
    landingId: undoable.landingId,
  });

  return undoable;
}
