import { useCallback } from 'react';
import type { RunRecord } from '@shared/runs';
import { RUN_STATE } from '@shared/runState';
import { assertNever } from '@renderer/lib/assertNever';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useExecuteApproveRuns, useExecuteRejectRuns } from '@renderer/modules/runs/useQueryRuns';
import { useRun } from '@renderer/stores/runStore';
import { useSessionStore } from '@renderer/stores/sessionStore';

export interface UseReviewDecisionOptions {
  /**
   * Null is the no-run state. The pane always has a run, but the Workspace hands this
   * hook its current selection so `a` and `r` act on the same run the pane shows.
   */
  runId: string | null;
}

interface UseReviewDecisionResult {
  /** What this run's review state actually is, in a sentence rather than a colour. */
  statusLabel: string;
  /**
   * Says that approving lands nothing. The distinction is the product's central
   * promise, so it is stated on the control rather than left to be inferred — until
   * the pane is put in its compact mode, where it has been read enough times.
   */
  explanation: string | null;
  /** Null wherever approval is not on offer, so an approved run is never asked twice. */
  approveLabel: string | null;
  isApproveDisabled: boolean;
  rejectLabel: string | null;
  /** How a decided run gets back into review, stated where the decision was taken. */
  reopenHint: string | null;
  isDecisionPending: boolean;
  errorMessage: string | null;
  /**
   * Null while the action is not available. A shortcut handed a null handler is not
   * registered at all, so `a` on an already-approved run cannot swallow the keypress
   * to do nothing.
   */
  onApproveClick: (() => void) | null;
  onRejectClick: (() => void) | null;
}

const DECIDE_STATUS = 'Nothing leaves the sandbox either way.';

const APPROVED_STATUS =
  'This resolution is marked ready to land. No branch was created, nothing was pushed and no review thread was resolved.';

const REJECTED_STATUS =
  'This resolution was turned down and its sandbox cleaned up. Start the comment again for a fresh attempt.';

const IN_FLIGHT_STATUS = 'The agent still holds this run, so there is no candidate to decide on.';

const NO_PATCH_STATUS =
  'This run produced no candidate patch, so there is nothing to approve or reject.';

const APPLIED_STATUS =
  'This one went through the outer door after an explicit confirmation. Approving it is history now.';

/**
 * Repeated on every variant on purpose. "Approved" and "landed" are the two states
 * this app exists to keep apart, and a reviewer reads this card, not the manual.
 */
const APPROVAL_EXPLANATION =
  'Approving marks a resolution ready to land and does nothing else. Landing is a separate step with its own preview and its own confirmation.';
const REJECTION_EXPLANATION =
  'Rejecting discards the sandbox — the worktree and every change in it are removed — so the comment can be run again fresh. The transcript stays on the record.';
const APPLIED_EXPLANATION =
  'Landing already happened, so there is no decision left to take here. Undoing it is an operation on the landing record, not on this run.';

const APPROVE_LABEL = 'Approve this resolution for landing';
const REJECT_LABEL = 'Reject this resolution';
const REJECT_APPROVED_LABEL = 'Reject this resolution after all';

const APPROVED_REOPEN_HINT =
  'Approval is revocable right up to the landing gate: hand-editing the patch or rewinding a revision below puts this run back into review.';

const APPROVE_ERROR_FALLBACK = 'Could not approve this resolution.';
const REJECT_ERROR_FALLBACK = 'Could not reject this resolution.';

interface ReviewDecisionCopy {
  statusLabel: string;
  explanation: string;
  approveLabel: string | null;
  rejectLabel: string | null;
  reopenHint: string | null;
}

/**
 * Dismissing a run drops it from the store while its pane is still mounted, so a
 * missing record reads as nothing to decide rather than as a crash.
 */
const NO_RUN_COPY: ReviewDecisionCopy = {
  statusLabel: NO_PATCH_STATUS,
  explanation: APPROVAL_EXPLANATION,
  approveLabel: null,
  rejectLabel: null,
  reopenHint: null,
};

/**
 * Which decisions a state actually offers, exhausted with `assertNever` so a new run
 * state is a compile error rather than a card offering an action main would refuse.
 * The transition table in main is the authority; this mirrors what it permits.
 */
function toDecisionCopy(run: RunRecord): ReviewDecisionCopy {
  switch (run.state) {
    case RUN_STATE.READY:
      return {
        statusLabel: DECIDE_STATUS,
        explanation: APPROVAL_EXPLANATION,
        approveLabel: APPROVE_LABEL,
        rejectLabel: REJECT_LABEL,
        reopenHint: null,
      };
    case RUN_STATE.APPROVED:
      return {
        statusLabel: APPROVED_STATUS,
        explanation: APPROVAL_EXPLANATION,
        // Offering the same button again would read as "did that not work?", so the
        // approved card shows what it is and offers the one decision still open.
        approveLabel: null,
        rejectLabel: REJECT_APPROVED_LABEL,
        reopenHint: APPROVED_REOPEN_HINT,
      };
    case RUN_STATE.REJECTED:
      return {
        statusLabel: REJECTED_STATUS,
        explanation: REJECTION_EXPLANATION,
        approveLabel: null,
        rejectLabel: null,
        reopenHint: null,
      };
    case RUN_STATE.QUEUED:
    case RUN_STATE.RUNNING:
    case RUN_STATE.NEEDS_DECISION:
    case RUN_STATE.REVISING:
      return {
        statusLabel: IN_FLIGHT_STATUS,
        explanation: APPROVAL_EXPLANATION,
        approveLabel: null,
        rejectLabel: null,
        reopenHint: null,
      };
    case RUN_STATE.NO_ACTION_NEEDED:
    case RUN_STATE.FAILED:
      return {
        statusLabel: NO_PATCH_STATUS,
        explanation: APPROVAL_EXPLANATION,
        approveLabel: null,
        rejectLabel: null,
        reopenHint: null,
      };
    case RUN_STATE.APPLIED:
      return {
        statusLabel: APPLIED_STATUS,
        explanation: APPLIED_EXPLANATION,
        approveLabel: null,
        rejectLabel: null,
        reopenHint: null,
      };
    default:
      return assertNever(run.state);
  }
}

/**
 * The per-run review decision. Flags never touch it: they are read alongside the
 * patch, and the landing preview is the boundary where anything is actually held.
 */
export function useReviewDecision({ runId }: UseReviewDecisionOptions): UseReviewDecisionResult {
  const isVerbose = useSessionStore((state) => state.isRunPaneVerbose);
  const run = useRun(runId);
  const { approveRuns, isApproveRunsPending, approveRunsError } = useExecuteApproveRuns();
  const { rejectRuns, isRejectRunsPending, rejectRunsError } = useExecuteRejectRuns();

  const onApprove = useCallback(() => {
    if (runId === null) return;
    approveRuns([runId]);
  }, [approveRuns, runId]);

  const onReject = useCallback(() => {
    if (runId === null) return;
    rejectRuns([runId]);
  }, [rejectRuns, runId]);

  const copy = isDefined(run) ? toDecisionCopy(run) : NO_RUN_COPY;

  const isApproveAvailable = copy.approveLabel !== null;

  const decisionError = isDefined(approveRunsError) ? approveRunsError : rejectRunsError;
  const errorFallback = isDefined(approveRunsError)
    ? APPROVE_ERROR_FALLBACK
    : REJECT_ERROR_FALLBACK;

  const errorMessage = (() => {
    if (!isDefined(decisionError)) return null;
    return isIpcError(decisionError) ? decisionError.message : errorFallback;
  })();

  return {
    statusLabel: copy.statusLabel,
    explanation: isVerbose ? copy.explanation : null,
    approveLabel: copy.approveLabel,
    isApproveDisabled: false,
    rejectLabel: copy.rejectLabel,
    reopenHint: copy.reopenHint,
    isDecisionPending: isApproveRunsPending || isRejectRunsPending,
    errorMessage,
    onApproveClick: isApproveAvailable ? onApprove : null,
    onRejectClick: copy.rejectLabel === null ? null : onReject,
  };
}
