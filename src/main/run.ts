import { AGENT_OUTCOME_KIND, executeAgentRun, resumeAgentRun } from '@main/agent';
import { REVISION_COMMIT_SUBJECT } from '@main/commitMessage';
import {
  clearAgentDecision,
  readAgentSummary,
  watchForDecision,
  type DecisionWatch,
} from '@main/decision';
import { buildResolutionPrompt } from '@main/prompt';
import {
  canTransitionRunState,
  createRunRecord,
  patchRun,
  recordRunFailure,
  recordRunRevision,
  transitionRun,
  type RunTransitionPatch,
} from '@main/runState';
import { resolveLocalRepoPath } from '@main/discovery';
import { resolveTierModel } from '@main/router';
import { resolveGitIdentity } from '@main/sandbox';
import { deleteRun, getRunById, getRuns } from '@main/store';
import {
  commitWorktree,
  createRunWorktree,
  readCandidatePatch,
  readSandboxUsage,
  teardownRunWorktree,
} from '@main/worktree';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import { isPoolSpending, type ResolvedModel } from '@shared/models';
import {
  FAILURE_REASON,
  REVISION_KIND,
  RUN_STATE,
  isTerminalRunState,
  type ModelTier,
  type RevisionKind,
  type RunState,
  type RunTrigger,
} from '@shared/runState';
import {
  RUN_EVENT_KIND,
  type CandidatePatch,
  type RunEvent,
  type RunRecord,
  type SandboxUsage,
} from '@shared/runs';

// One run, end to end: worktree, prompt, agent, decision watch, state transitions.
// queue.ts owns the concurrency cap, tier routing and escalation, and calls into here
// rather than growing an execution path of its own.
const RUN_LOG_SCOPE = '[run]';
const RUN_NOT_FOUND_MESSAGE = 'That run no longer exists.';
const CANCEL_NOT_ACTIVE_MESSAGE = 'That run has already finished, so there is nothing to cancel.';
const DISMISS_NOT_TERMINAL_MESSAGE =
  'Only a finished run can be dismissed, because its worktree is still in use.';
const NO_LOCAL_CLONE_MESSAGE =
  'This pull request has no local clone, and a resolution runs in a git worktree.';
const NO_LOCAL_CLONE_REMEDIATION = 'Register the repository in Settings, then try again.';
const NO_AGENT_MESSAGE = 'This run has no agent to continue, so it cannot be answered.';
const NO_AGENT_REMEDIATION = 'Run the comment again to start a fresh agent.';
const NOT_CONTINUABLE_MESSAGE =
  'This run is not waiting for input, so there is nothing to continue.';

/** needsDecision is waiting on a person; ready and approved accept a follow-up. */
const CONTINUABLE_RUN_STATES: readonly RunState[] = [
  RUN_STATE.NEEDS_DECISION,
  RUN_STATE.READY,
  RUN_STATE.APPROVED,
];
const RESTART_NOT_RETRYABLE_MESSAGE =
  'Only a finished run can be retried, because a restart discards the work in progress.';
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

export function requireRun(runId: string): RunRecord {
  const run = getRunById(runId);
  if (run === null) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, RUN_NOT_FOUND_MESSAGE, null);
  }
  return run;
}

/**
 * Recorded on the way into `running` rather than only once `Agent.create` returns, so
 * a run that never starts is still attributable to the model it was about to spend on.
 */
function toModelPatch(model: ResolvedModel): RunTransitionPatch {
  return { model: model.modelId, isPoolSpending: isPoolSpending(model.lane) };
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
 * apart by a human reading the transcript — whether that outcome is worth escalating
 * depends on the run's trigger, which queue.ts decides, so this only records it.
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

async function executeRun(
  startedRun: RunRecord,
  comment: PrComment,
  model: ResolvedModel,
): Promise<RunRecord> {
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
      model,
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
 * Resolved once per batch rather than per run. The git identity preflight runs here
 * because there is no sensible default to invent for it, and failing after a worktree
 * exists would leave a sandbox behind for a run that never started.
 */
export async function prepareRunRepoPath(ref: PrRef): Promise<string> {
  const repoPath = resolveLocalRepoPath(ref.repoKey);
  if (repoPath === null) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      NO_LOCAL_CLONE_MESSAGE,
      NO_LOCAL_CLONE_REMEDIATION,
    );
  }
  await resolveGitIdentity(repoPath);
  return repoPath;
}

export interface StartRunInput {
  ref: PrRef;
  repoPath: string;
  /**
   * Re-read from GitHub by the caller rather than accepted from the renderer: the
   * prompt is built from the body and diff hunk, and main should not build an agent
   * instruction out of content the renderer handed it.
   */
  comment: PrComment;
  tier: ModelTier;
  model: ResolvedModel;
  trigger: RunTrigger;
}

/**
 * Creates the worktree and record, then executes. Resolves once the run has stopped
 * moving on its own — ready, needsDecision, noActionNeeded or failed.
 */
export async function startRun(input: StartRunInput): Promise<RunRecord> {
  const worktree = await createRunWorktree({
    repoPath: input.repoPath,
    prRef: input.ref,
    commentId: input.comment.id,
  });
  const queued = createRunRecord({
    commentId: input.comment.id,
    prRef: input.ref,
    repoPath: input.repoPath,
    tier: input.tier,
    trigger: input.trigger,
    worktreePath: worktree.worktreePath,
    branchName: worktree.branchName,
  });
  emitStateChanged(queued);

  const running = advance(queued, RUN_STATE.RUNNING, toModelPatch(input.model));
  return executeRun(running, input.comment, input.model);
}

export interface RestartRunInput {
  runId: string;
  comment: PrComment;
  model: ResolvedModel;
}

/**
 * Escalation and retry: a *fresh* agent over the existing worktree, never a follow-up
 * on the previous conversation, which would anchor the stronger model to the weaker
 * one's failed approach. Resetting the worktree to base is the caller's job, because
 * only it knows whether discarding what is there was confirmed.
 *
 * The old `agentId` goes with it. Leaving it would let a later resume reach the
 * abandoned conversation, and the decision and summary it wrote describe an attempt
 * that no longer exists.
 */
export async function restartRun(input: RestartRunInput): Promise<RunRecord> {
  const run = requireRun(input.runId);
  if (!canTransitionRunState(run.state, RUN_STATE.RUNNING)) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, RESTART_NOT_RETRYABLE_MESSAGE, null);
  }

  const running = advance(run, RUN_STATE.RUNNING, {
    ...toModelPatch(input.model),
    agentId: null,
    decision: null,
    summary: null,
  });
  return executeRun(running, input.comment, input.model);
}

/**
 * An agent handling one send cannot take another, so a second prompt has to queue
 * rather than race it. Keyed by run, because serializing globally would make one
 * slow revision block every other run's follow-up.
 */
const continuationChains = new Map<string, Promise<unknown>>();

function serializePerRun<T>(runId: string, work: () => Promise<T>): Promise<T> {
  const previous = continuationChains.get(runId) ?? Promise.resolve();
  // Chained off the settled result, so one failed continuation does not poison every
  // later one for the same run.
  const next = previous.then(work, work);
  continuationChains.set(
    runId,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * The decision reply and the whole-patch follow-up are the same mechanism: both are
 * `agent.send` on the *same* agent, so context is never rebuilt — it already knows
 * the comment, the code, and what it tried. Which one this is follows from the run's
 * state rather than a caller-supplied label the two could disagree about.
 */
function resolveContinuation(run: RunRecord): { nextState: RunState; revisionKind: RevisionKind } {
  if (run.state === RUN_STATE.NEEDS_DECISION) {
    return {
      nextState: RUN_STATE.RUNNING,
      revisionKind: REVISION_KIND.DECISION_CONTINUATION,
    };
  }
  // revising rather than running, so the right pane keeps showing the existing diff
  // dimmed instead of swapping to a transcript and discarding what was being read.
  return { nextState: RUN_STATE.REVISING, revisionKind: REVISION_KIND.FOLLOW_UP };
}

export async function continueRun(runId: string, message: string): Promise<RunRecord> {
  return serializePerRun(runId, async () => {
    const run = requireRun(runId);
    if (run.agentId === null) {
      throw new AppError(APP_ERROR_KIND.NOT_FOUND, NO_AGENT_MESSAGE, NO_AGENT_REMEDIATION);
    }
    if (!CONTINUABLE_RUN_STATES.includes(run.state)) {
      throw new AppError(APP_ERROR_KIND.NOT_FOUND, NOT_CONTINUABLE_MESSAGE, null);
    }

    const { nextState, revisionKind } = resolveContinuation(run);
    // Consumed, so it cannot re-trigger needsDecision the moment the agent resumes.
    await clearAgentDecision(run.worktreePath);

    const model = await resolveTierModel(run.tier);
    advance(run, nextState, { decision: null });
    const controller = new AbortController();
    activeRunControllers.set(runId, controller);

    try {
      const outcome = await resumeAgentRun({
        agentId: run.agentId,
        worktreePath: run.worktreePath,
        message,
        model,
        onTranscriptChunk: (chunk) => emitTranscriptChunk(runId, chunk),
        signal: controller.signal,
      });

      const afterAgent = patchRun(requireRun(runId), { transcript: outcome.transcript });
      if (outcome.kind === AGENT_OUTCOME_KIND.FAILED) {
        const failed = recordRunFailure(afterAgent, outcome.reason, outcome.errorMessage);
        emitStateChanged(failed);
        return failed;
      }

      // Every change after the agent's first result is its own revision, which is
      // what makes revert-to-revision possible later.
      const revised = recordRunRevision(afterAgent);
      await commitWorktree(run.worktreePath, REVISION_COMMIT_SUBJECT[revisionKind]);

      const summary = await readAgentSummary(run.worktreePath);
      const patch = await readCandidatePatch(revised);
      const settled = patch.isEmpty ? RUN_STATE.NO_ACTION_NEEDED : RUN_STATE.READY;
      return advance(revised, settled, { summary });
    } catch (error: unknown) {
      const current = getRunById(runId);
      if (current === null) throw error;
      console.error(
        `${RUN_LOG_SCOPE} continuation failed`,
        error instanceof Error ? error.name : 'unknown',
      );
      const failed = recordRunFailure(
        current,
        FAILURE_REASON.AGENT_ERROR,
        error instanceof Error ? error.message : String(error),
      );
      emitStateChanged(failed);
      return failed;
    } finally {
      activeRunControllers.delete(runId);
    }
  });
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

/**
 * Every in-flight run at once, so a bad prompt or a wrong target branch is one action
 * to halt rather than twelve. Each abort reaches the same path a single cancel does —
 * the run is cancelled where it supports it and its agent is disposed either way — and
 * the records are read before aborting, since the cancelled state lands asynchronously.
 */
export function cancelActiveRuns(): RunRecord[] {
  const cancelled: RunRecord[] = [];
  for (const [runId, controller] of activeRunControllers) {
    const run = getRunById(runId);
    if (run !== null) cancelled.push(run);
    controller.abort();
  }
  return cancelled;
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
