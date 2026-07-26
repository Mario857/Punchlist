import { AGENT_OUTCOME_KIND, executeAgentRun } from '@main/agent';
import { readAgentSummary, watchForDecision, type DecisionWatch } from '@main/decision';
import { fetchPrComments } from '@main/github';
import { buildResolutionPrompt } from '@main/prompt';
import {
  createRunRecord,
  patchRun,
  recordRunFailure,
  transitionRun,
  type RunTransitionPatch,
} from '@main/runState';
import { resolveLocalRepoPath } from '@main/discovery';
import { resolveGitIdentity } from '@main/sandbox';
import { deleteRun, getRunById, getRuns } from '@main/store';
import {
  createRunWorktree,
  readCandidatePatch,
  readSandboxUsage,
  teardownRunWorktree,
} from '@main/worktree';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import {
  FAILURE_REASON,
  MODEL_TIER,
  RUN_STATE,
  RUN_TRIGGER,
  isTerminalRunState,
} from '@shared/runState';
import {
  RUN_EVENT_KIND,
  type CandidatePatch,
  type RunEvent,
  type RunRecord,
  type SandboxUsage,
  type StartRunRequest,
} from '@shared/runs';

/**
 * Phase 2 runs one comment at a time. `queue.ts` adds the concurrency cap and the
 * router in phase 3, and calls into here rather than growing its own execution path.
 */
const DEFAULT_TIER = MODEL_TIER.STANDARD;

const RUN_LOG_SCOPE = '[run]';
const COMMENT_NOT_FOUND_MESSAGE = 'That comment is no longer on the pull request.';
const RUN_NOT_FOUND_MESSAGE = 'That run no longer exists.';
const CANCEL_NOT_ACTIVE_MESSAGE = 'That run has already finished, so there is nothing to cancel.';
const DISMISS_NOT_TERMINAL_MESSAGE =
  'Only a finished run can be dismissed, because its worktree is still in use.';
const NO_LOCAL_CLONE_MESSAGE =
  'This pull request has no local clone, and a resolution runs in a git worktree.';
const NO_LOCAL_CLONE_REMEDIATION = 'Register the repository in Settings, then try again.';
const MALFORMED_DECISION_MESSAGE =
  'The agent halted but wrote an unreadable decision file, so its question could not be read.';

/** Keyed by run id, so a cancel can reach exactly one in-flight run. */
const activeRunControllers = new Map<string, AbortController>();

type RunEventListener = (event: RunEvent) => void;

let runEventListener: RunEventListener | null = null;

/**
 * Transport is owned by ipc.ts: this module knows that something wants to hear
 * about progress, not that a BrowserWindow exists.
 */
export function setRunEventListener(listener: RunEventListener | null): void {
  runEventListener = listener;
}

function emitStateChanged(run: RunRecord): void {
  runEventListener?.({ kind: RUN_EVENT_KIND.STATE_CHANGED, run });
}

function emitTranscriptChunk(runId: string, chunk: string): void {
  runEventListener?.({ kind: RUN_EVENT_KIND.TRANSCRIPT_APPENDED, runId, chunk });
}

function advance(run: RunRecord, nextState: RunRecord['state'], patch?: RunTransitionPatch) {
  const next = transitionRun(run, nextState, patch);
  emitStateChanged(next);
  return next;
}

function requireRun(runId: string): RunRecord {
  const run = getRunById(runId);
  if (run === null) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, RUN_NOT_FOUND_MESSAGE, null);
  }
  return run;
}

/**
 * The comment is re-read from GitHub rather than accepted from the renderer. The
 * prompt is built from its body and diff hunk, and main should not build an agent
 * instruction out of content the renderer handed it.
 */
async function findComment(ref: PrRef, commentId: string): Promise<PrComment> {
  const comments = await fetchPrComments(ref);
  const comment = comments.find((candidate) => candidate.id === commentId);
  if (comment === undefined) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, COMMENT_NOT_FOUND_MESSAGE, null);
  }
  return comment;
}

interface ResolvedOutcomeInput {
  run: RunRecord;
  patch: CandidatePatch;
  summary: Awaited<ReturnType<typeof readAgentSummary>>;
  decidedRun: RunRecord | null;
}

/**
 * An empty diff is not a failure here. A run that finished having changed nothing
 * either genuinely had nothing to do or misread the comment, and the two are told
 * apart by a human reading the transcript — escalation on an empty diff is a phase 3
 * decision, so this only records the outcome.
 */
function resolveCompletedState({
  run,
  patch,
  summary,
  decidedRun,
}: ResolvedOutcomeInput): RunRecord {
  // A decision that arrived while the agent was working wins: the run is parked
  // waiting on a person, not finished.
  if (decidedRun !== null) return decidedRun;
  const nextState = patch.isEmpty ? RUN_STATE.NO_ACTION_NEEDED : RUN_STATE.READY;
  return advance(run, nextState, { summary });
}

async function executeRun(startedRun: RunRecord, comment: PrComment): Promise<RunRecord> {
  const controller = new AbortController();
  activeRunControllers.set(startedRun.id, controller);

  let decidedRun: RunRecord | null = null;
  let decisionWatch: DecisionWatch | null = null;

  try {
    decisionWatch = watchForDecision({
      worktreePath: startedRun.worktreePath,
      onDecision: (decision) => {
        const current = getRunById(startedRun.id);
        if (current === null) return;
        // needsDecision is a waiting state, not an error: the agent hit a real fork
        // and stopped rather than guessing.
        decidedRun = advance(current, RUN_STATE.NEEDS_DECISION, { decision });
      },
      onMalformed: () => {
        const current = getRunById(startedRun.id);
        if (current === null) return;
        decidedRun = recordRunFailure(
          current,
          FAILURE_REASON.AGENT_ERROR,
          MALFORMED_DECISION_MESSAGE,
        );
        emitStateChanged(decidedRun);
      },
    });

    const outcome = await executeAgentRun({
      runId: startedRun.id,
      worktreePath: startedRun.worktreePath,
      message: buildResolutionPrompt(comment),
      onTranscriptChunk: (chunk) => emitTranscriptChunk(startedRun.id, chunk),
      signal: controller.signal,
    });

    const afterAgent = requireRun(startedRun.id);
    const withTranscript = patchRun(afterAgent, { transcript: outcome.transcript });

    if (outcome.kind === AGENT_OUTCOME_KIND.FAILED) {
      const failed = recordRunFailure(withTranscript, outcome.reason, outcome.errorMessage);
      emitStateChanged(failed);
      return failed;
    }

    const summary = await readAgentSummary(startedRun.worktreePath);
    const patch = await readCandidatePatch(withTranscript);
    return resolveCompletedState({ run: withTranscript, patch, summary, decidedRun });
  } catch (error: unknown) {
    const current = getRunById(startedRun.id);
    if (current === null) throw error;
    // The message can quote repository contents, so it is persisted and rendered
    // but never logged.
    console.error(`${RUN_LOG_SCOPE} run failed`, error instanceof Error ? error.name : 'unknown');
    const failed = recordRunFailure(
      current,
      FAILURE_REASON.AGENT_ERROR,
      error instanceof Error ? error.message : String(error),
    );
    emitStateChanged(failed);
    return failed;
  } finally {
    decisionWatch?.stop();
    activeRunControllers.delete(startedRun.id);
  }
}

/**
 * Creates the worktree and record, then executes. The git identity preflight runs
 * first because there is no sensible default to invent for it, and failing after a
 * worktree exists would leave a sandbox behind for a run that never started.
 */
export async function startRuns(
  ref: PrRef,
  requests: readonly StartRunRequest[],
): Promise<RunRecord[]> {
  const repoPath = resolveLocalRepoPath(ref.repoKey);
  if (repoPath === null) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      NO_LOCAL_CLONE_MESSAGE,
      NO_LOCAL_CLONE_REMEDIATION,
    );
  }
  await resolveGitIdentity(repoPath);

  const started: RunRecord[] = [];
  for (const request of requests) {
    const comment = await findComment(ref, request.commentId);
    const worktree = await createRunWorktree({
      repoPath,
      prRef: ref,
      commentId: request.commentId,
    });
    const queued = createRunRecord({
      commentId: request.commentId,
      prRef: ref,
      repoPath,
      tier: request.tier ?? DEFAULT_TIER,
      trigger: RUN_TRIGGER.MANUAL,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
    });
    emitStateChanged(queued);

    const running = advance(queued, RUN_STATE.RUNNING);
    started.push(await executeRun(running, comment));
  }
  return started;
}

export function listRunsForPr(ref: PrRef): RunRecord[] {
  return getRuns().filter(
    (run) => run.prRef.repoKey === ref.repoKey && run.prRef.number === ref.number,
  );
}

export async function cancelRun(runId: string): Promise<RunRecord> {
  const run = requireRun(runId);
  const controller = activeRunControllers.get(runId);
  if (controller === undefined) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, CANCEL_NOT_ACTIVE_MESSAGE, null);
  }
  controller.abort();
  return run;
}

export async function getRunPatch(runId: string): Promise<CandidatePatch> {
  return readCandidatePatch(requireRun(runId));
}

/**
 * Only a terminal run can be dismissed. The worktree teardown refuses a dirty
 * directory rather than forcing it, so unlanded hand-edits surface instead of
 * vanishing, and the record is forgotten only once the sandbox is actually gone.
 */
/**
 * Tears down every terminal run's worktree and reports the remaining usage. A dirty
 * worktree refuses removal, and that refusal is kept rather than forced: it means
 * unlanded hand-edits. One refusal must not abandon the rest of the sweep, so it is
 * counted and the loop continues.
 */
export async function cleanupTerminalRuns(): Promise<SandboxUsage> {
  for (const run of getRuns()) {
    if (!isTerminalRunState(run.state)) continue;
    try {
      await teardownRunWorktree(run);
    } catch (error: unknown) {
      const kind = error instanceof AppError ? error.kind : APP_ERROR_KIND.UNKNOWN;
      console.warn(`${RUN_LOG_SCOPE} could not reclaim a worktree`, kind);
    }
  }
  return readSandboxUsage();
}

export async function dismissRun(runId: string): Promise<void> {
  const run = requireRun(runId);
  if (!isTerminalRunState(run.state)) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, DISMISS_NOT_TERMINAL_MESSAGE, null);
  }
  await teardownRunWorktree(run);
  deleteRun(runId);
}
