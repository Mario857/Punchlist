import { fetchPrComments } from '@main/github';
import {
  listModelCatalog,
  resolveEscalatedModel,
  resolveFrontierModel,
  resolveTierModel,
} from '@main/router';
import { cancelActiveRuns, prepareRunRepoPath, requireRun, restartRun, startRun } from '@main/run';
import { getRunById, getSettings } from '@main/store';
import { resetWorktreeToBase } from '@main/worktree';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import { MODEL_LANE, type ResolvedModel } from '@shared/models';
import { FAILURE_REASON, RUN_STATE, RUN_TRIGGER, type ModelTier } from '@shared/runState';
import type { EscalateRunRequest, RunRecord, StartRunRequest } from '@shared/runs';
import { classifyCommentTier } from '@shared/tier';

/**
 * How many times a run may auto-escalate before the queue stops retrying it. Without a
 * cap a persistently failing comment would climb the effort ladder and then keep
 * restarting at the top, burning a concurrency slot on the same failure forever.
 */
const MAX_AUTO_ESCALATION_ATTEMPTS = 2;

/**
 * A manual escalation is already a human decision per attempt, so it does not chain
 * into automatic ones — auto-escalation stays in the unlimited lane, and layering it on
 * top of a deliberate frontier choice would silently take the run back out of it.
 */
const NO_ESCALATION_ATTEMPTS = 0;

const ESCALATION_ATTEMPT_STEP = 1;
const ACTIVE_WORK_STEP = 1;
const NO_ACTIVE_WORK = 0;
const PENDING_QUEUE_START = 0;
const FIRST_STOP_GENERATION = 0;
const STOP_GENERATION_STEP = 1;

const COMMENT_NOT_FOUND_MESSAGE = 'That comment is no longer on the pull request.';
const NO_HIGHER_EFFORT_MESSAGE =
  'This run already used the strongest reasoning effort its model offers.';
const NO_HIGHER_EFFORT_REMEDIATION =
  'Escalate with a frontier model, or revise the comment and run it again.';
const NO_FRONTIER_MODEL_MESSAGE =
  'This Cursor account lists no pool-spending model to escalate to.';
const NO_FRONTIER_MODEL_REMEDIATION = 'Check the plan and API key at cursor.com/settings.';
const ESCALATION_STOPPED_MESSAGE =
  'The escalation never started, because every run was stopped while it was queued.';

const QUEUED_WORK_KIND = {
  START: 'start',
  RESTART: 'restart',
} as const;

interface QueuedWorkBase {
  comment: PrComment;
  model: ResolvedModel;
  /** Remaining automatic escalations, which is why manual work can carry zero. */
  escalationAttempts: number;
}

/**
 * A discriminated union rather than a work item with optional fields, so "only a
 * restart resets an existing worktree" and "only a fresh start needs a repo path" are
 * compiler guarantees.
 */
type QueuedWork =
  | (QueuedWorkBase & {
      kind: typeof QUEUED_WORK_KIND.START;
      ref: PrRef;
      repoPath: string;
      tier: ModelTier;
    })
  | (QueuedWorkBase & {
      kind: typeof QUEUED_WORK_KIND.RESTART;
      runId: string;
      worktreePath: string;
      isDiscardConfirmed: boolean;
    });

interface PendingWork {
  work: QueuedWork;
  /** Settles with null when stop-all dropped the item before it ever started. */
  settle: (run: RunRecord | null) => void;
  fail: (error: unknown) => void;
}

/**
 * Work waits here rather than as queued run records: the cap bounds how many worktrees
 * and agents exist at once, so creating a sandbox per selected comment up front would
 * defeat the thing it is capping.
 */
const pendingWork: PendingWork[] = [];

let activeWorkCount = NO_ACTIVE_WORK;

/**
 * Bumped by every stop-all. Between two escalation attempts a work item holds no
 * AbortController for a cancel to reach, so it compares this against the value it
 * started with before launching the next agent — otherwise stopping everything could be
 * followed moments later by a brand new run.
 */
let stopGeneration = FIRST_STOP_GENERATION;

/**
 * Reasoning effort is not part of `RunRecord`, so the last model a run resolved to is
 * kept here. Without it a second manual escalation would raise from the tier's
 * configured effort again and simply repeat the attempt that just failed. Deliberately
 * session-scoped: after a restart the ladder starts from the tier's own position.
 */
const lastResolvedModelByRunId = new Map<string, ResolvedModel>();

function rememberResolvedModel(runId: string, model: ResolvedModel): void {
  lastResolvedModelByRunId.set(runId, model);
  // Dismissing a run deletes its record, so entries are dropped once what they describe
  // is gone rather than accumulating for the lifetime of the session.
  for (const knownRunId of lastResolvedModelByRunId.keys()) {
    if (getRunById(knownRunId) === null) lastResolvedModelByRunId.delete(knownRunId);
  }
}

/**
 * The comment is re-read from GitHub rather than accepted from the renderer: the prompt
 * is built from its body and diff hunk, and main should not build an agent instruction
 * out of content the renderer handed it. One fetch serves a whole batch.
 */
function findComment(comments: readonly PrComment[], commentId: string): PrComment {
  const comment = comments.find((candidate) => candidate.id === commentId);
  if (comment === undefined) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, COMMENT_NOT_FOUND_MESSAGE, null);
  }
  return comment;
}

/**
 * Only unambiguous failure escalates. Anything subtler is left to the human, who is
 * reviewing every diff regardless — and a cancelled or timed-out run must never come
 * back on its own, or stop-all would restart the work it was pressed to stop.
 */
function shouldAutoEscalate(run: RunRecord): boolean {
  if (run.state === RUN_STATE.FAILED) return run.failureReason === FAILURE_REASON.AGENT_ERROR;
  // An empty diff is a hard failure only for a run someone asked for. Auto mode reaches
  // comments nobody selected, where a colleague's "LGTM, thanks" correctly produces
  // nothing, and escalating that would retry it at rising effort forever.
  if (run.state === RUN_STATE.NO_ACTION_NEEDED) return run.trigger === RUN_TRIGGER.MANUAL;
  return false;
}

async function runFirstAttempt(work: QueuedWork): Promise<RunRecord> {
  if (work.kind === QUEUED_WORK_KIND.RESTART) {
    await resetWorktreeToBase(work.worktreePath, {
      isDiscardConfirmed: work.isDiscardConfirmed,
    });
    return restartRun({ runId: work.runId, comment: work.comment, model: work.model });
  }

  return startRun({
    ref: work.ref,
    repoPath: work.repoPath,
    comment: work.comment,
    tier: work.tier,
    model: work.model,
    trigger: RUN_TRIGGER.MANUAL,
  });
}

/**
 * One work item and however many automatic escalations it is allowed. Each escalation
 * is a fresh agent over the worktree reset to base — continuing the conversation would
 * anchor the stronger configuration to the weaker one's failed approach.
 */
async function executeWork(work: QueuedWork): Promise<RunRecord> {
  const generation = stopGeneration;
  let model = work.model;
  let run = await runFirstAttempt(work);
  rememberResolvedModel(run.id, model);

  let attemptsLeft = work.escalationAttempts;
  while (
    stopGeneration === generation &&
    attemptsLeft > NO_ESCALATION_ATTEMPTS &&
    shouldAutoEscalate(run)
  ) {
    const escalated = await resolveEscalatedModel(run.tier, model.reasoningEffort);
    // Null means the tier's model has no higher effort left, so a retry would only
    // repeat the attempt that just failed.
    if (escalated === null) break;

    model = escalated;
    attemptsLeft -= ESCALATION_ATTEMPT_STEP;
    // Discard confirmed without asking: this worktree holds nothing but the attempt
    // that just failed under the queue's own hand, never a hand-edit — a failed and a
    // noActionNeeded run are both terminal, so no review has offered to edit them.
    await resetWorktreeToBase(run.worktreePath, { isDiscardConfirmed: true });
    run = await restartRun({ runId: run.id, comment: work.comment, model });
    rememberResolvedModel(run.id, model);
  }

  return run;
}

async function executePending(pending: PendingWork): Promise<void> {
  try {
    pending.settle(await executeWork(pending.work));
  } catch (error: unknown) {
    pending.fail(error);
  } finally {
    activeWorkCount -= ACTIVE_WORK_STEP;
    pump();
  }
}

/**
 * The whole scheduler: fill every free slot, and let each finishing item refill the one
 * it frees. The cap is read per pass rather than captured, so changing it in Settings
 * takes effect on the next slot instead of the next batch.
 */
function pump(): void {
  const cap = getSettings().concurrencyCap;
  while (activeWorkCount < cap) {
    const next = pendingWork.shift();
    if (next === undefined) return;
    activeWorkCount += ACTIVE_WORK_STEP;
    void executePending(next);
  }
}

function schedule(work: QueuedWork): Promise<RunRecord | null> {
  return new Promise<RunRecord | null>((resolve, reject) => {
    pendingWork.push({ work, settle: resolve, fail: reject });
    pump();
  });
}

/**
 * The router never picks a frontier model on its own and `EscalateRunRequest` carries a
 * flag rather than an id, so the choice is made here: the first pool-spending entry in
 * the account's own catalog order. No hardcoded preference list — model lists evolve per
 * account, so a name shipped today would be wrong on someone else's plan.
 */
async function selectFrontierModelId(): Promise<string> {
  const catalog = await listModelCatalog();
  const frontier = catalog.find((entry) => entry.lane === MODEL_LANE.POOL_SPENDING);
  if (frontier === undefined) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      NO_FRONTIER_MODEL_MESSAGE,
      NO_FRONTIER_MODEL_REMEDIATION,
    );
  }
  return frontier.id;
}

/**
 * Escalation stays inside the unlimited lane by raising reasoning effort. Crossing into
 * the paid lane is only ever the deliberate `shouldUseFrontier` path, and the resulting
 * run is flagged pool-spending from the model's own lane rather than from which branch
 * of this function produced it.
 */
async function resolveEscalationModel(
  run: RunRecord,
  shouldUseFrontier: boolean,
  frontierModelId: string | null,
): Promise<ResolvedModel> {
  if (shouldUseFrontier) {
    return resolveFrontierModel(run.tier, {
      // The caller's choice wins. Falling back to the account's first frontier model
      // keeps the action usable, but which billable model to spend on is the user's
      // call whenever they have made one.
      modelId: frontierModelId ?? (await selectFrontierModelId()),
      // The tier's own position on the new model's ladder: the lane crossing is the
      // escalation here, and pinning effort on top would compound two changes at once.
      reasoningEffort: null,
    });
  }

  const previous = lastResolvedModelByRunId.get(run.id);
  const currentEffort = previous === undefined ? null : previous.reasoningEffort;
  const escalated = await resolveEscalatedModel(run.tier, currentEffort);
  if (escalated === null) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      NO_HIGHER_EFFORT_MESSAGE,
      NO_HIGHER_EFFORT_REMEDIATION,
    );
  }
  return escalated;
}

/**
 * Every selected comment, run up to the concurrency cap. Each run records the tier it
 * was classified into and the model that tier resolved to, and `startRun` flags the
 * pool-spending ones, so spend stays attributable after the fact.
 */
export async function enqueueRuns(
  ref: PrRef,
  requests: readonly StartRunRequest[],
): Promise<RunRecord[]> {
  const repoPath = await prepareRunRepoPath(ref);
  const comments = await fetchPrComments(ref);

  const scheduled: Promise<RunRecord | null>[] = [];
  for (const request of requests) {
    const comment = findComment(comments, request.commentId);
    // An explicit tier from the UI is an override; otherwise the comment classifies
    // itself, and the tier is the only thing the router maps to a model.
    const tier = request.tier ?? classifyCommentTier(comment).tier;
    const model = await resolveTierModel(tier);

    scheduled.push(
      schedule({
        kind: QUEUED_WORK_KIND.START,
        ref,
        repoPath,
        comment,
        tier,
        model,
        escalationAttempts: MAX_AUTO_ESCALATION_ATTEMPTS,
      }),
    );
  }

  const settled = await Promise.all(scheduled);
  // A null is work that stop-all dropped before it started, so there is no record of it
  // to report — it never reached a worktree.
  return settled.filter((run): run is RunRecord => run !== null);
}

/**
 * One action to halt everything. The pending list is drained *before* the cancels land:
 * a finishing run refills its own slot, so leaving queued work in place would let
 * stop-all immediately start more of exactly what it was pressed to stop.
 *
 * Cancelling reaches each agent's own cancel-and-dispose path in agent.ts, so nothing
 * here needs to duplicate the `run.supports('cancel')` guard.
 */
export async function stopAllRuns(): Promise<RunRecord[]> {
  stopGeneration += STOP_GENERATION_STEP;

  const dropped = pendingWork.splice(PENDING_QUEUE_START);
  for (const pending of dropped) pending.settle(null);

  return cancelActiveRuns();
}

/**
 * The manual retry. It goes through the same slot as any other run, because an
 * escalation starts an agent like everything else and the cap bounds agents, not
 * buttons.
 */
export async function escalateRun(request: EscalateRunRequest): Promise<RunRecord> {
  const run = requireRun(request.runId);
  const comment = findComment(await fetchPrComments(run.prRef), run.commentId);
  const model = await resolveEscalationModel(
    run,
    request.shouldUseFrontier,
    request.frontierModelId,
  );

  const escalated = await schedule({
    kind: QUEUED_WORK_KIND.RESTART,
    runId: run.id,
    worktreePath: run.worktreePath,
    // The reset discards whatever the worktree holds, so it refuses a dirty one until
    // the caller says the loss is intended.
    isDiscardConfirmed: request.isDiscardConfirmed,
    comment,
    model,
    escalationAttempts: NO_ESCALATION_ATTEMPTS,
  });

  if (escalated === null) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, ESCALATION_STOPPED_MESSAGE, null);
  }
  return escalated;
}
