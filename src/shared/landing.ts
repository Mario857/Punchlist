import type { GuardrailFlag } from './guardrails';
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

export interface LandingThread {
  threadId: string;
  url: string;
}

/**
 * Exactly what confirming would do. Assembled by actually performing the merges in a
 * sandbox worktree, so conflicts are real findings rather than predictions — and so
 * they can be re-run while the real repository is still untouched.
 */
export interface LandingPreview {
  prRef: PrRef;
  /** Never pushed to directly; the integration branch is pushed as its own branch. */
  targetBranch: string;
  remoteName: string;
  integrationBranchName: string;
  commits: LandingCommitPlan[];
  /** The combined diff, which the guardrails run over a second time. */
  combinedFiles: CandidatePatchFile[];
  guardrailFlags: GuardrailFlag[];
  /** Non-empty means the landing cannot proceed until each is re-run or dropped. */
  conflicts: LandingConflict[];
  threadsToResolve: LandingThread[];
  /** Null when no reply will be posted, which is the default. */
  replyText: string | null;
}

export interface AssembleLandingRequest {
  prRef: PrRef;
  targetBranch: string;
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
  replyText: string | null;
  /**
   * Acknowledging the combined-diff guardrail flags. The per-patch acknowledgements
   * do not carry over: the combined diff is a different artifact and may be flagged
   * for something no individual patch was.
   */
  acknowledgedGuardrailIds: string[];
}
