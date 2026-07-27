import type { PrRef } from './discovery';
import type { CandidatePatchFile } from './runs';

/**
 * One commit the landing will create. The message is editable in the preview,
 * because the agent's summary can go stale the moment the patch is hand-edited, and
 * correcting it belongs in the same confirmation step rather than a separate one.
 */
export interface LandingCommitPlan {
  runId: string;
  commentId: string;
  subject: string;
  body: string;
}

/**
 * A squash-merge that could not be applied cleanly. Conflicts are resolved by
 * re-running that comment's agent against the updated integration state, not by a
 * merge heuristic — there is already an agent, and writing a three-way resolver
 * would be solving the wrong problem.
 */
export interface LandingConflict {
  runId: string;
  commentId: string;
  paths: string[];
}

/**
 * Exactly what confirming would do. Assembled by actually performing the merges in a
 * sandbox worktree, so conflicts are real findings rather than predictions — and so
 * they can be re-run while the real repository is still untouched.
 */
export interface LandingPreview {
  prRef: PrRef;
  /**
   * The local branch the commits land on — normally the PR's own branch. Landing
   * fast-forwards it and stops: nothing is pushed, no thread is resolved, no comment
   * is posted. Publishing the result is the user's own git flow.
   */
  targetBranch: string;
  integrationBranchName: string;
  commits: LandingCommitPlan[];
  /** The combined diff — every approved patch merged, read as one artifact. */
  combinedFiles: CandidatePatchFile[];
  /** Non-empty means the landing cannot proceed until each is re-run or dropped. */
  conflicts: LandingConflict[];
}

export interface AssembleLandingRequest {
  prRef: PrRef;
  targetBranch: string;
}

/** What a landing actually did, returned so the UI can report it without re-reading the audit log. */
export interface LandingResult {
  landingId: string;
  targetBranch: string;
  /** The tip the branch was on before, kept so a manual `git reset` has its argument. */
  previousRevision: string;
  landedRevision: string;
  commitCount: number;
  runIds: string[];
}

/**
 * The payload of the confirmation itself. The edited commit messages travel with it
 * so that what was reviewed in the preview is what gets committed, rather than main
 * re-deriving them and possibly differing.
 */
export interface ExecuteLandingRequest {
  prRef: PrRef;
  targetBranch: string;
  commits: LandingCommitPlan[];
  /**
   * The confirmation itself. Main mints the type-level `SandboxConfirmation` from
   * this, so no path can move a real branch without the user having said so at this
   * exact step.
   */
  isConfirmedByUser: boolean;
}

export interface PushBranchRequest {
  prRef: PrRef;
  targetBranch: string;
  /** Pushing publishes: the click on the labelled button is this consent. */
  isConfirmedByUser: boolean;
}

export interface PushBranchResult {
  branchName: string;
  remoteName: string;
}

export interface ResolveLandedThreadsRequest {
  prRef: PrRef;
  isConfirmedByUser: boolean;
}

export interface ResolveLandedThreadsResult {
  resolvedThreadIds: string[];
}
