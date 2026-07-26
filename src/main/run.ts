import { AGENT_OUTCOME_KIND, executeAgentRun, resumeAgentRun } from '@main/agent';
import { appendAuditEntry } from '@main/audit';
import { canAutoAnswer, toAutoDecision } from '@main/autoMode';
import { REVISION_COMMIT_SUBJECT } from '@main/commitMessage';
import {
  clearAgentDecision,
  readAgentSummary,
  watchForDecision,
  type DecisionWatch,
} from '@main/decision';
import { buildResolutionPrompt, buildTargetedEditPrompt } from '@main/prompt';
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
import { fetchPrComments } from '@main/github';
import { inspectCandidatePatch } from '@main/guardrails';
import { resolveTierModel } from '@main/router';
import { resolveGitIdentity } from '@main/sandbox';
import { deleteRun, getRunById, getRuns } from '@main/store';
import {
  commitWorktree,
  createRunWorktree,
  listRunRevisions,
  readCandidatePatch,
  readSandboxUsage,
  resetWorktreeToRevision,
  teardownRunWorktree,
  writeWorktreeFile,
} from '@main/worktree';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { AUDIT_ACTION } from '@shared/audit';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import { hasUnacknowledgedFlags, selectUnacknowledgedFlags } from '@shared/guardrails';
import { isPoolSpending, type ResolvedModel } from '@shared/models';
import {
  FAILURE_REASON,
  MODEL_TIER,
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
  type ContinueRunRequest,
  type RunEvent,
  type RevertRunRequest,
  type RunRecord,
  type RunRevision,
  type SandboxUsage,
  type WriteRunFileRequest,
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
const COMMENT_GONE_MESSAGE = 'That comment is no longer on the pull request.';
const GUARDRAIL_FLAG_NOT_FOUND_MESSAGE =
  'That guardrail flag is no longer on this run, so there is nothing to acknowledge.';
const NOT_CONTINUABLE_MESSAGE =
  'This run is not waiting for input, so there is nothing to continue.';
const NOT_HAND_EDITABLE_MESSAGE =
  'This run has no reviewable patch, so there is nothing to hand-edit.';
const GUARDRAIL_KIND_SEPARATOR = ', ';
const UNACKNOWLEDGED_GUARDRAIL_REMEDIATION =
  'Acknowledge every outstanding flag on those runs, then approve again.';

/** needsDecision is waiting on a person; ready and approved accept a follow-up. */
const CONTINUABLE_RUN_STATES: readonly RunState[] = [
  RUN_STATE.NEEDS_DECISION,
  RUN_STATE.READY,
  RUN_STATE.APPROVED,
];
/** The modified side is editable exactly where there is a patch to edit. */
const HAND_EDITABLE_RUN_STATES: readonly RunState[] = [RUN_STATE.READY, RUN_STATE.APPROVED];
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
  comment: PrComment;
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
  comment,
  patch,
  summary,
  decidedRun,
}: ResolvedOutcomeInput): RunRecord {
  // A decision that arrived while the agent was working wins: the run is parked
  // waiting on a person, not finished.
  if (decidedRun !== null) return decidedRun;
  const nextState = patch.isEmpty ? RUN_STATE.NO_ACTION_NEEDED : RUN_STATE.READY;
  const checked = withGuardrailFlags(run, patch, comment);
  return advance(checked, nextState, { summary });
}

async function executeRun(
  startedRun: RunRecord,
  comment: PrComment,
  model: ResolvedModel,
): Promise<RunRecord> {
  const controller = new AbortController();
  activeRunControllers.set(startedRun.id, controller);

  let decidedRun: RunRecord | null = null;
  let autoAnswer: string | null = null;
  let decisionWatch: DecisionWatch | null = null;

  try {
    decisionWatch = watchForDecision({
      worktreePath: startedRun.worktreePath,
      onDecision: (decision) => {
        const current = getRunById(startedRun.id);
        if (current === null) return;
        // needsDecision is a waiting state, not an error: the agent hit a real fork
        // and stopped rather than guessing.
        const autoDecision = canAutoAnswer(current, decision) ? toAutoDecision(decision) : null;
        decidedRun = advance(current, RUN_STATE.NEEDS_DECISION, {
          decision,
          autoDecisions:
            autoDecision === null ? undefined : [...current.autoDecisions, autoDecision],
        });
        // Auto mode parks the run here too, then answers: the reply is a second
        // `agent.send` on an agent whose first turn is still in flight, so the option is
        // only chosen here and sent once that turn has settled.
        autoAnswer = autoDecision === null ? null : autoDecision.chosenOption;
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

    // Not awaited inside the try on purpose: returning the promise lets the finally run
    // now, which stops the decision watch before the continuation clears the file it
    // polls. continueRun is reused rather than duplicated — it already resumes the same
    // agent, serializes the send, commits the revision and re-runs the guardrails.
    if (autoAnswer !== null) return continueRun({ runId: startedRun.id, message: autoAnswer });

    const summary = await readAgentSummary(startedRun.worktreePath);
    const patch = await readCandidatePatch(withTranscript);
    return resolveCompletedState({ run: withTranscript, comment, patch, summary, decidedRun });
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

interface ContinuationPlan {
  nextState: RunState;
  revisionKind: RevisionKind;
  /** What the correction is worth in model terms, which is not always the run's tier. */
  tier: ModelTier;
  /** What is actually sent: the message as typed, or the message wrapped in a scope. */
  prompt: string;
}

/**
 * The decision reply, the whole-patch follow-up and the targeted edit are one mechanism:
 * all three are `agent.send` on the *same* agent, so context is never rebuilt — it
 * already knows the comment, the code, and what it tried. Where the run goes follows
 * from its state rather than a caller-supplied label the two could disagree about; what
 * is sent, and how much model it is worth, follows from whether a selection came with it.
 */
function resolveContinuation(run: RunRecord, request: ContinueRunRequest): ContinuationPlan {
  const selection = request.selection ?? null;
  // A decision reply resumes a halted agent; everything else amends a patch that already
  // exists, and that is revising rather than running so the right pane keeps showing the
  // existing diff dimmed instead of swapping to a transcript and discarding what was
  // being read.
  const isDecisionReply = run.state === RUN_STATE.NEEDS_DECISION;
  const nextState = isDecisionReply ? RUN_STATE.RUNNING : RUN_STATE.REVISING;

  if (selection !== null) {
    return {
      nextState,
      revisionKind: REVISION_KIND.TARGETED_EDIT,
      // A scoped correction is narrow by construction, so it neither needs nor should
      // pay for the run's original tier — escalating one stays available and explicit.
      tier: MODEL_TIER.MECHANICAL,
      prompt: buildTargetedEditPrompt(selection, request.message),
    };
  }

  return {
    nextState,
    revisionKind: isDecisionReply ? REVISION_KIND.DECISION_CONTINUATION : REVISION_KIND.FOLLOW_UP,
    tier: run.tier,
    prompt: request.message,
  };
}

export async function continueRun(request: ContinueRunRequest): Promise<RunRecord> {
  const { runId } = request;
  return serializePerRun(runId, async () => {
    const run = requireRun(runId);
    if (run.agentId === null) {
      throw new AppError(APP_ERROR_KIND.NOT_FOUND, NO_AGENT_MESSAGE, NO_AGENT_REMEDIATION);
    }
    if (!CONTINUABLE_RUN_STATES.includes(run.state)) {
      throw new AppError(APP_ERROR_KIND.NOT_FOUND, NOT_CONTINUABLE_MESSAGE, null);
    }

    const { nextState, revisionKind, tier, prompt } = resolveContinuation(run, request);
    // Consumed, so it cannot re-trigger needsDecision the moment the agent resumes.
    await clearAgentDecision(run.worktreePath);

    const model = await resolveTierModel(tier);
    advance(run, nextState, { decision: null });
    const controller = new AbortController();
    activeRunControllers.set(runId, controller);

    // A continuation can halt again — an answer often exposes the next fork — and
    // without a watcher that second decision file would sit unread while the run
    // settled as ready over an unfinished patch.
    let decidedRun: RunRecord | null = null;
    let decisionWatch: DecisionWatch | null = null;

    try {
      decisionWatch = watchForDecision({
        worktreePath: run.worktreePath,
        onDecision: (decision) => {
          const current = getRunById(runId);
          if (current === null) return;
          decidedRun = advance(current, RUN_STATE.NEEDS_DECISION, { decision });
        },
        onMalformed: () => {
          const current = getRunById(runId);
          if (current === null) return;
          decidedRun = recordRunFailure(
            current,
            FAILURE_REASON.AGENT_ERROR,
            MALFORMED_DECISION_MESSAGE,
          );
          emitStateChanged(decidedRun);
        },
      });

      const outcome = await resumeAgentRun({
        agentId: run.agentId,
        worktreePath: run.worktreePath,
        message: prompt,
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
      // Fetched only once a revision actually produced changes: the checks need the
      // comment's anchor and tier, and an empty patch has nothing to inspect.
      const checked = patch.isEmpty
        ? revised
        : withGuardrailFlags(revised, patch, await findRunComment(revised));
      // A fresh halt wins over the settled outcome: the run is waiting on a person
      // again, not finished, exactly as on the first turn.
      if (decidedRun !== null) return patchRun(checked, { summary });
      return advance(checked, settled, { summary });
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
      decisionWatch?.stop();
      activeRunControllers.delete(runId);
    }
  });
}

/**
 * The comment is re-read from GitHub rather than kept on the run record: the checks
 * need its anchor and the record stores only the id. Fetched lazily, so a revision
 * that produced nothing never pays for it.
 */
async function findRunComment(run: RunRecord): Promise<PrComment> {
  const comments = await fetchPrComments(run.prRef);
  const comment = comments.find((candidate) => candidate.id === run.commentId);
  if (comment === undefined) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, COMMENT_GONE_MESSAGE, null);
  }
  return comment;
}

/**
 * Re-checked on every patch rather than once when the run first goes ready, so a
 * revision cannot outrun its own checks. Acknowledgements are carried across by id,
 * which is why a flag's id is derived from what it is about: a finding that survives
 * a revision unchanged stays acknowledged, and a genuinely new one does not.
 */
function withGuardrailFlags(run: RunRecord, patch: CandidatePatch, comment: PrComment): RunRecord {
  const guardrailFlags = inspectCandidatePatch({ patch, comment, tier: run.tier });
  const flagIds = new Set(guardrailFlags.map((flag) => flag.id));
  const acknowledgedGuardrailIds = run.acknowledgedGuardrailIds.filter((id) => flagIds.has(id));
  return patchRun(run, { guardrailFlags, acknowledgedGuardrailIds });
}

/**
 * The hand-edit write-back. Debouncing is the renderer's job — main writes whatever it
 * is handed, once.
 *
 * The path is renderer-supplied and therefore untrusted, so `writeWorktreeFile` resolves
 * it against the worktree root and refuses anything landing outside it.
 */
export async function writeRunFile(request: WriteRunFileRequest): Promise<RunRecord> {
  const run = requireRun(request.runId);
  if (!HAND_EDITABLE_RUN_STATES.includes(run.state)) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, NOT_HAND_EDITABLE_MESSAGE, null);
  }

  await writeWorktreeFile(run.worktreePath, request.path, request.content);

  // A hand edit is a revision like any other, so it joins the revert-to-revision trail
  // instead of sitting outside it as an uncommitted change. Nothing to commit means the
  // write changed nothing on disk, and a phantom revision would make that trail lie.
  const subject = REVISION_COMMIT_SUBJECT[REVISION_KIND.HAND_EDIT];
  const commit = await commitWorktree(run.worktreePath, subject);
  const edited = commit === null ? run : recordRunRevision(run);

  // Re-read from git rather than from the editor buffer that produced the write: git is
  // the single source of truth, so an edit to a file the agent also changed cannot
  // desync the view. The checks are re-run for the same reason a continuation re-runs
  // them — a revision must not outrun them.
  const patch = await readCandidatePatch(edited);
  const checked = patch.isEmpty
    ? edited
    : withGuardrailFlags(edited, patch, await findRunComment(edited));
  // An edit that empties the patch stays `ready` rather than becoming `noActionNeeded`:
  // that state is terminal and would reclaim the worktree still being edited in. Coming
  // from `approved`, the transition is the point — an edit revokes the approval, because
  // what was approved is no longer what would land.
  const settled =
    checked.state === RUN_STATE.READY ? checked : transitionRun(checked, RUN_STATE.READY);
  emitStateChanged(settled);
  return settled;
}

export async function listRunRevisionTrail(runId: string): Promise<RunRevision[]> {
  return listRunRevisions(requireRun(runId).worktreePath);
}

/**
 * Reverting discards every revision after the chosen one, which is exactly what
 * makes the trail useful — but it also discards uncommitted hand-edits, so the reset
 * refuses a dirty worktree until the loss is confirmed.
 *
 * The patch is re-read and re-checked afterwards: reverting changes what the run
 * produced, so its guardrail flags describe the wrong thing until they are recomputed.
 */
export async function revertRun(request: RevertRunRequest): Promise<RunRecord> {
  const run = requireRun(request.runId);
  await resetWorktreeToRevision(run.worktreePath, request.revision, {
    isDiscardConfirmed: request.isDiscardConfirmed,
  });

  const patch = await readCandidatePatch(run);
  const checked = patch.isEmpty ? run : withGuardrailFlags(run, patch, await findRunComment(run));
  const nextState = patch.isEmpty ? RUN_STATE.NO_ACTION_NEEDED : RUN_STATE.READY;
  const reverted = checked.state === nextState ? checked : transitionRun(checked, nextState);
  emitStateChanged(reverted);
  return reverted;
}

/**
 * Acknowledging is what unblocks approval later. It is recorded on the run rather
 * than held in the UI, because the record of what was accepted has to survive a
 * restart as much as the patch does.
 */
export async function acknowledgeGuardrail(runId: string, flagId: string): Promise<RunRecord> {
  const run = requireRun(runId);
  const flag = run.guardrailFlags.find((candidate) => candidate.id === flagId);
  if (flag === undefined) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, GUARDRAIL_FLAG_NOT_FOUND_MESSAGE, null);
  }
  if (run.acknowledgedGuardrailIds.includes(flagId)) return run;

  const acknowledged = patchRun(run, {
    acknowledgedGuardrailIds: [...run.acknowledgedGuardrailIds, flagId],
  });

  // Audited even though it changes nothing outside the sandbox: acknowledging is what
  // authorises a flagged patch to be approved and eventually landed, so the decision
  // belongs in the same record as the actions it enables. The kind and path go in,
  // never the flag's detail — this is written to a file that outlives the run.
  await appendAuditEntry({
    action: AUDIT_ACTION.GUARDRAIL_ACKNOWLEDGED,
    prRef: run.prRef,
    summary: `Acknowledged a ${flag.kind} guardrail flag${flag.path === null ? '' : ` on ${flag.path}`}`,
    runIds: [run.id],
  });

  emitStateChanged(acknowledged);
  return acknowledged;
}

/**
 * Says how much is outstanding and of what kind, and nothing else. A flag's `detail`
 * and path stay out of it: this message is rendered, and a flag reporting a secret
 * must not become the leak it was raised about.
 */
function toUnacknowledgedGuardrailMessage(blocked: readonly RunRecord[], total: number): string {
  const outstanding = blocked.flatMap((run) =>
    selectUnacknowledgedFlags(run.guardrailFlags, run.acknowledgedGuardrailIds),
  );
  const kinds = [...new Set(outstanding.map((flag) => flag.kind))].join(GUARDRAIL_KIND_SEPARATOR);
  return `Approval is blocked by unacknowledged guardrail flags on ${blocked.length} of ${total} selected runs. Outstanding: ${outstanding.length} (${kinds}).`;
}

/**
 * Approving marks a run ready to land and lands nothing. No branch, no remote and no
 * GitHub call is reachable from here, which is exactly what makes approving twelve at
 * once safe: the landing gate is still ahead of every one of them, so a bulk approve
 * can only ever move records.
 *
 * Unacknowledged guardrail flags refuse the approval. Containment keeps the agent off
 * the network but says nothing about what it wrote, so the flags are the other half of
 * the check and approving past an unread one would quietly discard it.
 *
 * A blocked run refuses the *whole* batch rather than being skipped around: approving
 * nine of twelve and staying silent about the three is the one outcome a reviewer
 * cannot read off the tree, and refusing costs nothing because approval is cheap to
 * retry once the flags are acknowledged. Every id is therefore resolved and checked
 * before the first transition is committed. Whether the state itself allows approval
 * is left to the transition table, which throws — restating that rule here would give
 * it a second, driftable source.
 */
export function approveRuns(runIds: readonly string[]): RunRecord[] {
  const runs = runIds.map(requireRun);
  const blocked = runs.filter((run) =>
    hasUnacknowledgedFlags(run.guardrailFlags, run.acknowledgedGuardrailIds),
  );
  if (blocked.length > 0) {
    throw new AppError(
      APP_ERROR_KIND.CONFIRMATION_REQUIRED,
      toUnacknowledgedGuardrailMessage(blocked, runs.length),
      UNACKNOWLEDGED_GUARDRAIL_REMEDIATION,
    );
  }

  return runs.map((run) => advance(run, RUN_STATE.APPROVED));
}

/**
 * Turning a resolution down is a review decision, not a destructive one, so nothing is
 * torn down here: the worktree survives until the run is dismissed, and the transition
 * table keeps the way back to `ready` open for a reviewer who changes their mind.
 *
 * Guardrail flags do not block a rejection. They exist to stop unread work being
 * approved, and rejecting is the outcome they were raised to protect.
 *
 * Bulk rejection refuses as a batch for the same reason bulk approval does — every id
 * is resolved before the first transition is committed.
 */
export function rejectRuns(runIds: readonly string[]): RunRecord[] {
  return runIds.map(requireRun).map((run) => advance(run, RUN_STATE.REJECTED));
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
