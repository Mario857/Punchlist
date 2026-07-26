import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { simpleGit, type SimpleGit } from 'simple-git';
import { createLandingId } from '@main/audit';
import { buildLandingCommitMessage } from '@main/commitMessage';
import { fetchPrComments } from '@main/github';
import { inspectCandidatePatch } from '@main/guardrails';
import {
  assertSandboxConfirmation,
  containWorktree,
  resolveGitIdentity,
  SANDBOX_EXIT_ACTION,
  type SandboxConfirmation,
} from '@main/sandbox';
import { getRuns } from '@main/store';
import { commitWorktree, revertToRevision } from '@main/worktree';
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
  LandingThread,
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
 * on an `airlock/` branch, which is what makes startup reconciliation sweep it: it
 * carries no run record, so it is an orphan by construction and an interrupted assembly
 * cannot leave one behind forever. `worktree.ts` keeps these private, so they are
 * restated here rather than widening its surface for a single caller.
 */
const SANDBOX_DIRECTORY_NAME = 'sandbox';
const PR_DIRECTORY_PREFIX = 'pr-';
const LANDING_DIRECTORY_NAME = 'landing';

/** git spells refnames with forward slashes on every platform. */
const GIT_PATH_SEPARATOR = '/';
const BRANCH_NAME_PREFIX = 'airlock';
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
const COMBINED_DIFF_AUTHOR_LOGIN = 'airlock';

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
const MIXED_CLONE_REMEDIATION = 'Reject the runs from the other clone, or re-run them from this one.';
const COMMENT_GONE_MESSAGE =
  'A run is approved for a comment that is no longer on the pull request, so its commit would have no provenance.';
const COMMENT_GONE_REMEDIATION = 'Reject that run, then assemble the landing again.';
const CONFLICTS_UNRESOLVED_MESSAGE =
  'Some approved resolutions still conflict with the integration branch, so the landing was not prepared.';
const CONFLICTS_UNRESOLVED_REMEDIATION =
  'Re-run each conflicting comment against the updated integration state, or reject it.';
const UNACKNOWLEDGED_FLAGS_REMEDIATION =
  'Acknowledge each combined-diff finding in the landing preview, then confirm again.';

export interface PreparedLanding {
  /** Minted here so every audit entry phase 6 writes for this landing shares one id. */
  landingId: string;
  prRef: PrRef;
  repoPath: string;
  remoteName: string;
  targetBranch: string;
  integrationBranchName: string;
  integrationWorktreePath: string;
  /** The tip of the assembled integration branch, which is what phase 6 publishes. */
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
 * A real branch name derived from the PR — `airlock/pr-42-landing` — because this is
 * what gets pushed as its own branch and read by a human in a branch list. One segment
 * under `airlock/`, so it cannot collide with the `airlock/<pr>/<commentId>` namespace
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
 * takes no per-run assumption and why the per-patch acknowledgements do not carry over.
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
 * and an `airlock/` branch — so it needs no confirmation and touches nothing outside
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
 * Flags are acknowledgements rather than hard blocks — a comment may legitimately ask
 * for a lock-file bump — but the acknowledgement has to be against *these* findings.
 * They are re-read from the freshly assembled diff rather than trusted from the
 * preview, so a flag that appeared since the preview was rendered still stops here.
 */
function assertGuardrailsAcknowledged(
  assembled: AssembledIntegration,
  acknowledgedGuardrailIds: readonly string[],
): void {
  const acknowledged = new Set(acknowledgedGuardrailIds);
  const unacknowledged = assembled.guardrailFlags.filter((flag) => !acknowledged.has(flag.id));
  if (unacknowledged.length === NO_ENTRIES) return;

  throw new AppError(
    APP_ERROR_KIND.CONFIRMATION_REQUIRED,
    `${unacknowledged.length} finding(s) on the combined diff have not been acknowledged, so the landing was not prepared.`,
    UNACKNOWLEDGED_FLAGS_REMEDIATION,
  );
}

/**
 * The gated entry point. It takes a `SandboxConfirmation` at the type level because
 * the confirmation the user gives at the landing gate is what authorises everything
 * downstream of it — and a branded token that cannot be written as a literal is the
 * only version of that rule a later caller cannot forget.
 *
 * What it does today is bounded by phase 5: it rebuilds the integration branch with the
 * messages that were reviewed, refuses while a conflict or an unacknowledged finding
 * stands, and hands back the prepared branch. **Publishing that branch, pushing it,
 * resolving the threads and posting the reply are phase 6** and are deliberately absent
 * rather than stubbed. Nothing has left the sandbox yet, which is also why no audit
 * entry is written here: the log records actions taken on the repository, and the
 * landing id minted below is what groups the entries those actions will write.
 */
export async function executeLanding(
  request: ExecuteLandingRequest,
  confirmation: SandboxConfirmation,
): Promise<PreparedLanding> {
  // Checked rather than assumed: a confirmation never crosses IPC, and confirming one
  // action does not authorise another.
  assertSandboxConfirmation(confirmation, SANDBOX_EXIT_ACTION.COMMIT_INTEGRATION_BRANCH);

  const assembled = await assembleIntegration({
    prRef: request.prRef,
    targetBranch: request.targetBranch,
    plannedCommits: new Map(request.commits.map((commit) => [commit.runId, commit])),
  });

  assertNoConflicts(assembled);
  assertGuardrailsAcknowledged(assembled, request.acknowledgedGuardrailIds);

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
