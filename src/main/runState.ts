import { randomUUID } from 'node:crypto';
import { upsertRun } from '@main/store';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import type { AgentDecision, AgentSummary, RunRecord } from '@shared/runs';
import {
  isRunActive,
  isTerminalRunState,
  RUN_STATE,
  type FailureReason,
  type ModelTier,
  type RunState,
  type RunTrigger,
} from '@shared/runState';

/**
 * The machine over the vocabulary in src/shared/runState.ts, which owns the states
 * themselves. Every legal edge is declared once here rather than implied by whatever
 * a caller happens to assign, so an impossible move — landing a run that was never
 * approved, resuming one that already landed — fails loudly instead of leaving a
 * plausible-looking but corrupt record in the store.
 *
 * `needsDecision` is deliberately not an error state. An agent that hits a real fork
 * should stop rather than guess and hand over a confident-looking diff built on a
 * wrong assumption, so it is a normal waiting state with an edge back to `running`:
 * the answer goes to the same agent, which still holds everything it worked out.
 *
 * `noActionNeeded` and `failed` keep an edge back to `running` because escalation and
 * retry restart a fresh agent against the same worktree reset to base. `applied` has
 * no outgoing edge at all — landed work is history, not a state to move out of.
 *
 * Typed as a total Record so adding a state to RUN_STATE is a compile error here.
 */
const ALLOWED_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  [RUN_STATE.QUEUED]: [RUN_STATE.RUNNING, RUN_STATE.FAILED],
  [RUN_STATE.RUNNING]: [
    RUN_STATE.NEEDS_DECISION,
    RUN_STATE.READY,
    RUN_STATE.NO_ACTION_NEEDED,
    RUN_STATE.FAILED,
  ],
  [RUN_STATE.NEEDS_DECISION]: [RUN_STATE.RUNNING, RUN_STATE.FAILED],
  [RUN_STATE.READY]: [RUN_STATE.REVISING, RUN_STATE.APPROVED, RUN_STATE.FAILED],
  [RUN_STATE.REVISING]: [RUN_STATE.READY, RUN_STATE.NEEDS_DECISION, RUN_STATE.FAILED],
  [RUN_STATE.NO_ACTION_NEEDED]: [RUN_STATE.RUNNING],
  [RUN_STATE.FAILED]: [RUN_STATE.RUNNING],
  // Approval is revocable up to the landing gate: a hand-edit or a late guardrail flag
  // drops an approved run back into review rather than landing something unreviewed.
  [RUN_STATE.APPROVED]: [RUN_STATE.APPLIED, RUN_STATE.READY, RUN_STATE.REVISING, RUN_STATE.FAILED],
  [RUN_STATE.APPLIED]: [],
};

const REVISION_INCREMENT = 1;
/**
 * A user moving the system clock backwards mid-run would otherwise produce a negative
 * duration, which runRecordSchema rejects — turning a cosmetic problem into a failed
 * write of the whole store.
 */
const MIN_DURATION_MS = 0;

export interface CreateRunRecordInput {
  commentId: string;
  prRef: PrRef;
  repoPath: string;
  tier: ModelTier;
  /** Manual selection or auto mode; recorded per run so the origin stays auditable. */
  trigger: RunTrigger;
  worktreePath: string;
  branchName: string;
}

/**
 * Fields a transition may legitimately carry. `undefined` means "leave it alone";
 * `null` is a real value for the nullable ones, so the two cannot be conflated.
 */
export interface RunTransitionPatch {
  /** Resolved from Cursor.models.list() at run time, never a hardcoded id. */
  model?: string | null;
  isPoolSpending?: boolean;
  /** Persisted as soon as Agent.create returns, so Agent.resume survives a restart. */
  agentId?: string | null;
  decision?: AgentDecision | null;
  summary?: AgentSummary | null;
  errorMessage?: string | null;
  /**
   * A transcript can quote repository contents, so it is persisted and rendered but
   * never written to a log file — including the diagnostics thrown from this module.
   */
  transcript?: string;
}

interface RunTimestamps {
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveField<T>(patched: T | undefined, current: T): T {
  return patched === undefined ? current : patched;
}

function applyPatch(run: RunRecord, patch: RunTransitionPatch): RunRecord {
  return {
    ...run,
    model: resolveField(patch.model, run.model),
    isPoolSpending: resolveField(patch.isPoolSpending, run.isPoolSpending),
    agentId: resolveField(patch.agentId, run.agentId),
    decision: resolveField(patch.decision, run.decision),
    summary: resolveField(patch.summary, run.summary),
    errorMessage: resolveField(patch.errorMessage, run.errorMessage),
    transcript: resolveField(patch.transcript, run.transcript),
  };
}

function beginWork(run: RunRecord, now: string): RunTimestamps {
  // A retry or an escalation re-enters work from a terminal state, so its clock starts
  // over instead of reporting the elapsed time of the attempt that already ended.
  const shouldRestartClock = run.startedAt === null || isTerminalRunState(run.state);
  return {
    startedAt: shouldRestartClock ? now : run.startedAt,
    finishedAt: null,
    durationMs: null,
  };
}

function endWork(run: RunRecord, now: string): RunTimestamps {
  // Only the edge out of an active state stamps a finish. Approving and landing happen
  // on your clock, and folding review time into the run's duration would make the
  // number meaningless.
  if (!isRunActive(run.state)) {
    return { startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: run.durationMs };
  }

  const startedAt = run.startedAt ?? now;
  const elapsedMs = Date.parse(now) - Date.parse(startedAt);
  return { startedAt, finishedAt: now, durationMs: Math.max(MIN_DURATION_MS, elapsedMs) };
}

function resolveTimestamps(run: RunRecord, nextState: RunState, now: string): RunTimestamps {
  switch (nextState) {
    case RUN_STATE.QUEUED:
      return { startedAt: null, finishedAt: null, durationMs: null };
    case RUN_STATE.RUNNING:
    case RUN_STATE.REVISING:
      return beginWork(run, now);
    case RUN_STATE.NEEDS_DECISION:
    case RUN_STATE.READY:
    case RUN_STATE.NO_ACTION_NEEDED:
    case RUN_STATE.FAILED:
    case RUN_STATE.APPROVED:
    case RUN_STATE.APPLIED:
      return endWork(run, now);
    default: {
      // There is no main-side assertNever yet — the renderer's lives behind the process
      // boundary — so exhaustiveness is asserted with a never binding instead: adding a
      // state to RUN_STATE makes this assignment a compile error.
      const unhandled: never = nextState;
      throw new AppError(APP_ERROR_KIND.UNKNOWN, `Unhandled run state: ${String(unhandled)}`);
    }
  }
}

function commitTransition(
  run: RunRecord,
  nextState: RunState,
  patch: RunTransitionPatch,
  failureReason: FailureReason | null,
): RunRecord {
  if (!canTransitionRunState(run.state, nextState)) {
    throw new AppError(
      APP_ERROR_KIND.UNKNOWN,
      `A run cannot go from ${run.state} to ${nextState}.`,
      null,
    );
  }

  const now = nowIso();
  const patched = applyPatch(run, patch);
  // Resuming work makes the previous attempt's failure history, not current state.
  const isResumingWork = isRunActive(nextState);

  return upsertRun({
    ...patched,
    state: nextState,
    failureReason: isResumingWork ? null : failureReason,
    errorMessage: isResumingWork ? null : patched.errorMessage,
    updatedAt: now,
    ...resolveTimestamps(run, nextState, now),
  });
}

export function canTransitionRunState(from: RunState, to: RunState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * A fresh run always starts queued: the worktree and the agent both come later, and a
 * record that exists before either means a crash mid-setup is still reconcilable.
 * The id is minted here so no caller has to invent one.
 */
export function createRunRecord(input: CreateRunRecordInput): RunRecord {
  const now = nowIso();

  return upsertRun({
    id: randomUUID(),
    commentId: input.commentId,
    prRef: input.prRef,
    repoPath: input.repoPath,
    state: RUN_STATE.QUEUED,
    tier: input.tier,
    model: null,
    isPoolSpending: false,
    trigger: input.trigger,
    guardrailFlags: [],
    acknowledgedGuardrailIds: [],
    worktreePath: input.worktreePath,
    branchName: input.branchName,
    agentId: null,
    revisionCount: 0,
    failureReason: null,
    errorMessage: null,
    decision: null,
    summary: null,
    transcript: '',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
  });
}

/** Throws rather than returning a result: an illegal edge is a bug in the caller. */
export function transitionRun(
  run: RunRecord,
  nextState: RunState,
  patch: RunTransitionPatch = {},
): RunRecord {
  return commitTransition(run, nextState, patch, run.failureReason);
}

/**
 * Field updates that carry no state change — the agentId lands mid-run, immediately
 * after Agent.create, and streamed transcript is flushed while the state stands still.
 */
export function patchRun(run: RunRecord, patch: RunTransitionPatch): RunRecord {
  return upsertRun({ ...applyPatch(run, patch), updatedAt: nowIso() });
}

/**
 * Every change after the agent's first result is its own commit in the worktree, and
 * the counter is bumped by whoever made that commit rather than by a state edge: a
 * hand-edit commits a revision without the run ever leaving `ready`.
 */
export function recordRunRevision(run: RunRecord): RunRecord {
  return upsertRun({
    ...run,
    revisionCount: run.revisionCount + REVISION_INCREMENT,
    updatedAt: nowIso(),
  });
}

/**
 * The reason is part of the record because each one has a different remedy: `timeout`
 * means raise the limit or narrow the comment, `agentError` means read the transcript,
 * `startFailed` means fix auth or config, and none of them should look like the others.
 *
 * The first reason wins. A per-run timeout firing at the same moment the agent reports
 * an error would otherwise make the second caller throw from inside a catch handler,
 * and the earlier cause is the true one anyway.
 */
export function recordRunFailure(
  run: RunRecord,
  reason: FailureReason,
  errorMessage: string | null = null,
): RunRecord {
  if (run.state === RUN_STATE.FAILED) return run;
  return commitTransition(run, RUN_STATE.FAILED, { errorMessage }, reason);
}
