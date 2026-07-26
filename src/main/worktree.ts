import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { app } from 'electron';
import { simpleGit, type SimpleGit } from 'simple-git';
import { containWorktree, resolveGitIdentity, setWorktreeConfig } from '@main/sandbox';
import { recordRunFailure } from '@main/runState';
import { getRepos, getRuns, getSettings } from '@main/store';
import { normalizeRemoteUrl, type PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import type { CandidatePatch, CandidatePatchFile, RunRecord, SandboxUsage } from '@shared/runs';
import { FAILURE_REASON, isTerminalRunState } from '@shared/runState';

const WORKTREE_LOG_SCOPE = '[worktree]';

/** Worktrees live outside the repo so nothing in the sandbox is reachable from it. */
const SANDBOX_DIRECTORY_NAME = 'sandbox';
const PR_DIRECTORY_PREFIX = 'pr-';

/** git spells refnames and pathspecs with forward slashes on every platform. */
const GIT_PATH_SEPARATOR = '/';
const BRANCH_NAME_PREFIX = 'airlock';
const SCRATCH_BRANCH_PREFIX = `${BRANCH_NAME_PREFIX}${GIT_PATH_SEPARATOR}`;
const BRANCH_REF_PREFIX = 'refs/heads/';

const AIRLOCK_DIRECTORY_NAME = '.airlock';
const EXCLUDE_ENTRY = `${AIRLOCK_DIRECTORY_NAME}${GIT_PATH_SEPARATOR}`;
const GIT_COMMON_DIR_ARGS = ['--git-common-dir'] as const;
const GIT_INFO_DIRECTORY_NAME = 'info';
const GIT_EXCLUDE_FILE_NAME = 'exclude';

const DEFAULT_REMOTE_NAME = 'origin';
const PR_HEAD_REF_PREFIX = 'refs/pull/';
const PR_HEAD_REF_SUFFIX = '/head';
const FETCH_HEAD_REVISION = 'FETCH_HEAD';

const WORKTREE_ADD_ARGS = ['worktree', 'add', '-b'] as const;
const WORKTREE_REMOVE_ARGS = ['worktree', 'remove'] as const;
const WORKTREE_PRUNE_ARGS = ['worktree', 'prune'] as const;
const WORKTREE_LIST_ARGS = ['worktree', 'list', '--porcelain'] as const;
const BRANCH_DELETE_ARGS = ['branch', '-D'] as const;
const RESET_HARD_ARGS = ['reset', '--hard'] as const;
const DIFF_NAME_ONLY_ARGS = ['diff', '--name-only', '-z'] as const;
const UNTRACKED_FILES_ARGS = ['ls-files', '--others', '--exclude-standard', '-z'] as const;
const PATHSPEC_TERMINATOR = '--';
const ADD_ALL_PATHSPEC = '-A';
const REVISION_PATH_SEPARATOR = ':';

/**
 * The base commit has to survive an app restart — a `ready` run stays reviewable
 * after one — and the run record has no field for it. Worktree-scoped config is the
 * right home: it is already enabled for containment, never appears in `git status`,
 * and `git worktree remove` deletes it with the worktree.
 */
const BASE_REVISION_CONFIG_KEY = 'airlock.baseRevision';

const FILE_ENCODING = 'utf8';
const EMPTY_FILE_CONTENT = '';
const LINE_SEPARATOR = '\n';
const RECORD_SEPARATOR = '\n\n';
const NUL_SEPARATOR = '\0';
const LABEL_SEPARATOR = ' ';
const NOT_FOUND_INDEX = -1;

const WORKTREE_LIST_LABEL = {
  WORKTREE: 'worktree',
  BRANCH: 'branch',
  PRUNABLE: 'prunable',
} as const;

/**
 * A refname may not contain spaces or `~^:?*[`, and a GitHub comment id is an opaque
 * node id that can carry `=`, so everything outside this set collapses to a dash. Dots
 * go too, which rules out both `..` and a `.lock` suffix.
 */
const UNSAFE_NAME_PATTERN = /[^\w-]+/g;
const UNSAFE_NAME_REPLACEMENT = '-';
const SURROUNDING_DASH_PATTERN = /^-+|-+$/g;
const EMPTY_STRING = '';
const FALLBACK_NAME_SEGMENT = 'unnamed';

const WORKTREE_DIRTY_PATTERNS = ['contains modified or untracked files', 'is dirty'] as const;
const WORKTREE_DIRTY_REMEDIATION =
  'Review the worktree, land or discard its changes, then remove it.';
const WORKTREE_RESET_DIRTY_REMEDIATION =
  'Land or discard the changes, or escalate again confirming that they may be discarded.';
const BASE_REVISION_MISSING_REMEDIATION = 'Re-run the comment to rebuild its worktree.';
const WORKTREE_MISSING_MESSAGE =
  'The run worktree is gone, so its agent can no longer resume in it.';

const NO_BYTES = 0;

export const TEARDOWN_RESULT = {
  REMOVED: 'removed',
  /** running, revising, ready and needsDecision all still need their cwd. */
  RETAINED_NON_TERMINAL: 'retainedNonTerminal',
  RETAINED_BY_SETTING: 'retainedBySetting',
  ALREADY_REMOVED: 'alreadyRemoved',
} as const;

export type TeardownResult = (typeof TEARDOWN_RESULT)[keyof typeof TEARDOWN_RESULT];

export interface CreateRunWorktreeRequest {
  repoPath: string;
  prRef: PrRef;
  commentId: string;
}

export interface RunWorktree {
  worktreePath: string;
  branchName: string;
  /** The PR head commit the worktree was created at; every diff is taken against it. */
  baseRevision: string;
}

export interface WorktreeReconcileSummary {
  orphanRemovedCount: number;
  brokenRunCount: number;
  prunedRegistrationCount: number;
}

interface WorktreeRegistration {
  worktreePath: string;
  /** Null for a detached worktree, which ours never are but git's format allows. */
  branchName: string | null;
  isPrunable: boolean;
}

/**
 * Resolved per call, not at module scope: main imports this file while wiring up
 * handlers, which happens before `app.whenReady` has resolved.
 */
function resolveSandboxRoot(): string {
  return join(app.getPath('userData'), SANDBOX_DIRECTORY_NAME);
}

function toSafeNameSegment(value: string): string {
  const safe = value
    .replaceAll(UNSAFE_NAME_PATTERN, UNSAFE_NAME_REPLACEMENT)
    .replaceAll(SURROUNDING_DASH_PATTERN, EMPTY_STRING);
  return safe.length === 0 ? FALLBACK_NAME_SEGMENT : safe;
}

function buildBranchName(prRef: PrRef, commentId: string): string {
  const segments = [BRANCH_NAME_PREFIX, String(prRef.number), toSafeNameSegment(commentId)];
  return segments.join(GIT_PATH_SEPARATOR);
}

function buildWorktreePath(prRef: PrRef, commentId: string): string {
  return join(
    resolveSandboxRoot(),
    toSafeNameSegment(prRef.repoKey),
    `${PR_DIRECTORY_PREFIX}${prRef.number}`,
    toSafeNameSegment(commentId),
  );
}

function splitNulSeparated(output: string): string[] {
  return output.split(NUL_SEPARATOR).filter((entry) => entry.length > 0);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, FILE_ENCODING);
  } catch {
    // Absent is a real state here rather than a failure: a deleted file on the
    // modified side, an added file on the base side, a first-run exclude file.
    return EMPTY_FILE_CONTENT;
  }
}

async function isExistingDirectory(directoryPath: string): Promise<boolean> {
  if (directoryPath.length === 0) return false;
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

async function readGitConfigValue(worktreePath: string, key: string): Promise<string | null> {
  try {
    return (await simpleGit(worktreePath).getConfig(key)).value;
  } catch {
    // `git config --get` exits non-zero for an unset key, which simple-git raises.
    return null;
  }
}

async function readBaseRevision(worktreePath: string): Promise<string> {
  const baseRevision = await readGitConfigValue(worktreePath, BASE_REVISION_CONFIG_KEY);
  if (baseRevision === null || baseRevision.trim().length === 0) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `${worktreePath} does not record the commit it was created at, so its patch cannot be diffed.`,
      BASE_REVISION_MISSING_REMEDIATION,
    );
  }
  return baseRevision.trim();
}

async function resolveRemoteName(git: SimpleGit, repoKey: string): Promise<string> {
  const remotes = await git.getRemotes(true);
  const match = remotes.find((remote) =>
    [remote.refs.fetch, remote.refs.push].some((url) => normalizeRemoteUrl(url) === repoKey),
  );
  return match === undefined ? DEFAULT_REMOTE_NAME : match.name;
}

/**
 * `.git/info/exclude` is shared by every worktree through the common git dir, so one
 * idempotent entry keeps the agent's protocol directory out of `git status` and out of
 * every candidate patch — without touching the user's tracked `.gitignore`.
 */
async function ensureAirlockExcluded(git: SimpleGit, repoPath: string): Promise<void> {
  const commonDir = (await git.revparse([...GIT_COMMON_DIR_ARGS])).trim();
  const excludePath = join(
    resolvePath(repoPath, commonDir),
    GIT_INFO_DIRECTORY_NAME,
    GIT_EXCLUDE_FILE_NAME,
  );

  const existing = await readFileOrEmpty(excludePath);
  const isAlreadyExcluded = existing
    .split(LINE_SEPARATOR)
    .some((line) => line.trim() === EXCLUDE_ENTRY);
  if (isAlreadyExcluded) return;

  await mkdir(dirname(excludePath), { recursive: true });
  const prefix =
    existing.length === 0 || existing.endsWith(LINE_SEPARATOR) ? EMPTY_STRING : LINE_SEPARATOR;
  await writeFile(excludePath, `${existing}${prefix}${EXCLUDE_ENTRY}${LINE_SEPARATOR}`, {
    encoding: FILE_ENCODING,
  });
}

export async function createRunWorktree(request: CreateRunWorktreeRequest): Promise<RunWorktree> {
  const { repoPath, prRef, commentId } = request;
  const git = simpleGit(repoPath);

  // Preflight before anything is created: an unset git identity has no sensible
  // default, and finding out afterwards would throw away a completed agent run.
  const identity = await resolveGitIdentity(repoPath);

  // The PR head may never have been fetched, and a cross-repository PR lives on a
  // fork there is no remote for. GitHub publishes refs/pull/<number>/head on the
  // base repo, so this one fetch covers same-repo and fork PRs alike. Fetching is
  // read-only, so it is not a gated action.
  const remoteName = await resolveRemoteName(git, prRef.repoKey);
  const headRef = `${PR_HEAD_REF_PREFIX}${prRef.number}${PR_HEAD_REF_SUFFIX}`;
  await git.fetch([remoteName, headRef]);
  // FETCH_HEAD is per-repository state, so this read belongs to the fetch above:
  // fetching two different refs in one clone must not interleave.
  const baseRevision = (await git.revparse([FETCH_HEAD_REVISION])).trim();

  const branchName = buildBranchName(prRef, commentId);
  const worktreePath = buildWorktreePath(prRef, commentId);
  await mkdir(dirname(worktreePath), { recursive: true });
  await git.raw([...WORKTREE_ADD_ARGS, branchName, worktreePath, baseRevision]);

  await containWorktree({ repoPath, worktreePath, identity });
  await setWorktreeConfig(worktreePath, BASE_REVISION_CONFIG_KEY, baseRevision);
  await ensureAirlockExcluded(git, repoPath);

  return { worktreePath, branchName, baseRevision };
}

async function readChangedPaths(git: SimpleGit, baseRevision: string): Promise<string[]> {
  // A single revision compares it to the working tree, so uncommitted hand-edits are
  // part of the candidate patch. Untracked files are a separate question, and
  // --exclude-standard is what keeps .airlock/ out of the answer.
  const changed = await git.raw([...DIFF_NAME_ONLY_ARGS, baseRevision, PATHSPEC_TERMINATOR]);
  const untracked = await git.raw([...UNTRACKED_FILES_ARGS]);
  const paths = new Set([...splitNulSeparated(changed), ...splitNulSeparated(untracked)]);
  return [...paths].sort();
}

async function readBaseContent(
  git: SimpleGit,
  baseRevision: string,
  filePath: string,
): Promise<string> {
  try {
    return await git.show([`${baseRevision}${REVISION_PATH_SEPARATOR}${filePath}`]);
  } catch {
    // git exits non-zero when the path did not exist at the base commit, which is
    // exactly the added-file case.
    return EMPTY_FILE_CONTENT;
  }
}

export async function readCandidatePatch(run: RunRecord): Promise<CandidatePatch> {
  const git = simpleGit(run.worktreePath);
  const baseRevision = await readBaseRevision(run.worktreePath);
  const paths = await readChangedPaths(git, baseRevision);

  const files: CandidatePatchFile[] = await Promise.all(
    paths.map(async (path): Promise<CandidatePatchFile> => ({
      path,
      originalContent: await readBaseContent(git, baseRevision, path),
      modifiedContent: await readFileOrEmpty(join(run.worktreePath, path)),
    })),
  );

  return { runId: run.id, files, isEmpty: files.length === 0 };
}

/**
 * Null when there was nothing to commit, which is a meaningful run outcome rather
 * than an error. Author and committer both come from the worktree-scoped identity
 * set at creation, so no override is passed here.
 */
export async function commitWorktree(
  worktreePath: string,
  message: string,
): Promise<string | null> {
  const git = simpleGit(worktreePath);
  const status = await git.status();
  if (status.isClean()) return null;

  await git.add(ADD_ALL_PATHSPEC);
  const result = await git.commit(message);
  return result.commit;
}

export async function revertToRevision(worktreePath: string, revision: string): Promise<void> {
  // Destructive by design, and safe because it only ever discards work that exists
  // inside the sandbox. This is not --force, which is banned everywhere.
  await simpleGit(worktreePath).raw([...RESET_HARD_ARGS, revision]);
}

export interface ResetWorktreeToBaseOptions {
  /**
   * A dirty worktree may hold hand-edits the reset would destroy, so it refuses until
   * the caller says the loss is intended.
   */
  isDiscardConfirmed: boolean;
}

/**
 * Puts a worktree back at the commit it was created from. Escalation runs a *fresh*
 * agent rather than continuing the previous conversation, so it must also start from
 * a clean tree — otherwise the stronger model inherits the weaker one's failed edits,
 * which is the opposite of what escalation is for.
 *
 * Returns the base revision, so the caller does not have to read it a second time.
 */
export async function resetWorktreeToBase(
  worktreePath: string,
  options: ResetWorktreeToBaseOptions,
): Promise<string> {
  const baseRevision = await readBaseRevision(worktreePath);

  if (!options.isDiscardConfirmed) {
    const status = await simpleGit(worktreePath).status();
    if (!status.isClean()) {
      throw new AppError(
        APP_ERROR_KIND.WORKTREE_DIRTY,
        `${worktreePath} has changes that a reset to ${baseRevision} would discard.`,
        WORKTREE_RESET_DIRTY_REMEDIATION,
      );
    }
  }

  await revertToRevision(worktreePath, baseRevision);
  return baseRevision;
}

function toWorktreeRemovalError(error: unknown, worktreePath: string): Error {
  const message = readErrorMessage(error);
  const haystack = message.toLowerCase();
  if (WORKTREE_DIRTY_PATTERNS.some((pattern) => haystack.includes(pattern))) {
    return new AppError(
      APP_ERROR_KIND.WORKTREE_DIRTY,
      `${worktreePath} has changes that were never landed, so it was left in place.`,
      WORKTREE_DIRTY_REMEDIATION,
    );
  }
  return error instanceof Error ? error : new Error(message);
}

async function deleteBranchIfPresent(git: SimpleGit, branchName: string): Promise<void> {
  const branches = await git.branchLocal();
  if (!branches.all.includes(branchName)) return;
  await git.raw([...BRANCH_DELETE_ARGS, branchName]);
}

/** Sweeps registrations whose directories vanished out of band. */
async function pruneRegistrations(repoPath: string): Promise<void> {
  await simpleGit(repoPath).raw([...WORKTREE_PRUNE_ARGS]);
}

/**
 * Teardown is three operations, not one: `git worktree remove` deletes the directory
 * and its registration but leaves the scratch branch behind, and a registration whose
 * directory vanished out of band is only swept by `prune`. Doing step 1 alone
 * accumulates an `airlock/<pr>/<commentId>` branch per comment forever.
 */
async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string | null,
): Promise<void> {
  const git = simpleGit(repoPath);

  if (await isExistingDirectory(worktreePath)) {
    try {
      // Never --force. Git refusing to remove a dirty worktree is the feature that
      // stops unlanded hand-edits from being deleted behind the user's back.
      await git.raw([...WORKTREE_REMOVE_ARGS, worktreePath]);
    } catch (error: unknown) {
      throw toWorktreeRemovalError(error, worktreePath);
    }
  }

  if (branchName !== null) await deleteBranchIfPresent(git, branchName);
  await pruneRegistrations(repoPath);
}

export async function teardownRunWorktree(run: RunRecord): Promise<TeardownResult> {
  // A local agent is bound to its cwd, so removing a non-terminal run's worktree
  // breaks Agent.resume: a paused decision could never be answered and a reviewable
  // patch would evaporate. Those worktrees have to survive app restarts.
  if (!isTerminalRunState(run.state)) return TEARDOWN_RESULT.RETAINED_NON_TERMINAL;
  if (getSettings().shouldRetainWorktrees) return TEARDOWN_RESULT.RETAINED_BY_SETTING;

  const wasPresent = await isExistingDirectory(run.worktreePath);
  await removeWorktree(run.repoPath, run.worktreePath, run.branchName);
  return wasPresent ? TEARDOWN_RESULT.REMOVED : TEARDOWN_RESULT.ALREADY_REMOVED;
}

function parseWorktreeList(output: string): WorktreeRegistration[] {
  const registrations: WorktreeRegistration[] = [];

  for (const block of output.split(RECORD_SEPARATOR)) {
    let worktreePath: string | null = null;
    let branchName: string | null = null;
    let isPrunable = false;

    for (const line of block.split(LINE_SEPARATOR)) {
      // Boolean attributes such as `detached` are a bare label with no value.
      const separatorIndex = line.indexOf(LABEL_SEPARATOR);
      const hasValue = separatorIndex !== NOT_FOUND_INDEX;
      const label = hasValue ? line.slice(0, separatorIndex) : line.trim();
      const value = hasValue ? line.slice(separatorIndex + 1).trim() : EMPTY_STRING;

      if (label === WORKTREE_LIST_LABEL.WORKTREE) worktreePath = value;
      if (label === WORKTREE_LIST_LABEL.PRUNABLE) isPrunable = true;
      if (label === WORKTREE_LIST_LABEL.BRANCH) {
        branchName = value.startsWith(BRANCH_REF_PREFIX)
          ? value.slice(BRANCH_REF_PREFIX.length)
          : value;
      }
    }

    if (worktreePath === null || worktreePath.length === 0) continue;
    registrations.push({ worktreePath: resolvePath(worktreePath), branchName, isPrunable });
  }

  return registrations;
}

/**
 * Only registrations inside the sandbox root on an `airlock/` branch: the user's own
 * worktrees are never candidates for anything in this file.
 */
async function readSandboxRegistrations(repoPath: string): Promise<WorktreeRegistration[]> {
  // The trailing separator matters: a sibling directory whose name merely starts with
  // the sandbox root's is not inside it.
  const sandboxPrefix = `${resolveSandboxRoot()}${sep}`;

  const output = await (async (): Promise<string> => {
    try {
      return await simpleGit(repoPath).raw([...WORKTREE_LIST_ARGS]);
    } catch (error: unknown) {
      // A repo that has been moved or deleted since it was registered is skipped
      // rather than aborting reconciliation for every other repo.
      console.warn(WORKTREE_LOG_SCOPE, `${repoPath} could not be listed.`, error);
      return EMPTY_STRING;
    }
  })();

  return parseWorktreeList(output).filter((registration) => {
    if (!registration.worktreePath.startsWith(sandboxPrefix)) return false;
    return (
      registration.branchName === null || registration.branchName.startsWith(SCRATCH_BRANCH_PREFIX)
    );
  });
}

/**
 * Runs point at the clone they were created from, and the registry covers a repo
 * whose runs have all been deleted while an orphaned worktree survived.
 */
function collectRepoPaths(runs: readonly RunRecord[]): string[] {
  const paths = new Set<string>();
  for (const run of runs) {
    if (run.repoPath.length > 0) paths.add(resolvePath(run.repoPath));
  }
  for (const repo of getRepos()) {
    paths.add(resolvePath(repo.path));
  }
  return [...paths];
}

/**
 * Goes through the state machine rather than writing the record directly, so the
 * transition is validated and timestamped in one place. Callers must already have
 * excluded terminal runs — an applied run's worktree is *supposed* to be gone.
 */
function markRunBroken(run: RunRecord): void {
  recordRunFailure(run, FAILURE_REASON.WORKTREE_MISSING, WORKTREE_MISSING_MESSAGE);
}

export async function reconcileWorktrees(): Promise<WorktreeReconcileSummary> {
  const runs = getRuns();
  const runPaths = new Set(
    runs.filter((run) => run.worktreePath.length > 0).map((run) => resolvePath(run.worktreePath)),
  );

  let orphanRemovedCount = 0;
  let prunedRegistrationCount = 0;

  for (const repoPath of collectRepoPaths(runs)) {
    const registrations = await readSandboxRegistrations(repoPath);

    for (const registration of registrations) {
      // A registration that still has a run record keeps its scratch branch even when
      // the directory is gone: those commits are the only remaining trace of the
      // run's work, and the run itself is marked broken below.
      if (runPaths.has(registration.worktreePath)) {
        if (!registration.isPrunable) continue;
        await pruneRegistrations(repoPath);
        prunedRegistrationCount += 1;
        continue;
      }

      try {
        await removeWorktree(repoPath, registration.worktreePath, registration.branchName);
        orphanRemovedCount += 1;
      } catch (error: unknown) {
        // An orphan holding unlanded edits is left for the user to decide about: a
        // crash is not a licence to delete work.
        console.warn(
          WORKTREE_LOG_SCOPE,
          `${registration.worktreePath} was left in place.`,
          readErrorMessage(error),
        );
      }
    }
  }

  let brokenRunCount = 0;
  for (const run of runs) {
    if (run.worktreePath.length === 0) continue;
    if (isTerminalRunState(run.state)) continue;
    if (await isExistingDirectory(run.worktreePath)) continue;
    markRunBroken(run);
    brokenRunCount += 1;
  }

  return { orphanRemovedCount, brokenRunCount, prunedRegistrationCount };
}

async function readDirectoryBytes(directoryPath: string): Promise<number> {
  let total = NO_BYTES;
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // lstat, so a symlink counts as itself rather than as its target.
      total += (await lstat(join(entry.parentPath, entry.name))).size;
    }
  } catch (error: unknown) {
    console.warn(WORKTREE_LOG_SCOPE, `${directoryPath} could not be measured.`, error);
  }
  return total;
}

export async function readSandboxUsage(): Promise<SandboxUsage> {
  let worktreeCount = 0;
  let totalBytes = NO_BYTES;
  let reclaimableCount = 0;

  for (const run of getRuns()) {
    if (!(await isExistingDirectory(run.worktreePath))) continue;
    worktreeCount += 1;
    // Worktrees share the repository's object store, so what is measured here is
    // working files rather than history.
    totalBytes += await readDirectoryBytes(run.worktreePath);
    if (isTerminalRunState(run.state)) reclaimableCount += 1;
  }

  return { worktreeCount, totalBytes, reclaimableCount };
}
