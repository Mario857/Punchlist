import { useCallback, useMemo, useState } from 'react';
import { APP_ERROR_KIND } from '@shared/errors';
import { isPoolSpending } from '@shared/models';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useQueryModelCatalog } from '@renderer/hooks/useQueryModelCatalog';
import { useExecuteEscalateRun } from '@renderer/modules/runs/useQueryRuns';

export interface UseRunEscalationOptions {
  runId: string;
}

export interface FrontierRetryOption {
  modelId: string;
  label: string;
  onRetryClick: () => void;
}

interface UseRunEscalationResult {
  isEscalateRunPending: boolean;
  /** One button per pool-spending model: picking one *is* the opt-in to spend. */
  frontierRetryOptions: FrontierRetryOption[];
  /** Non-null when there is no frontier model to offer, which is not an error. */
  frontierUnavailableMessage: string | null;
  /** True once main has refused the reset because the worktree holds hand-edits. */
  isDiscardConfirmationOpen: boolean;
  discardWarningMessage: string;
  errorMessage: string | null;
  onRetryWithMoreEffortClick: () => void;
  onConfirmDiscardClick: () => void;
  onKeepEditsClick: () => void;
}

interface PendingEscalation {
  shouldUseFrontier: boolean;
  frontierModelId: string | null;
}

/** Raising reasoning effort stays inside the unlimited lane, so it costs nothing. */
const EFFORT_ESCALATION: PendingEscalation = { shouldUseFrontier: false, frontierModelId: null };

/**
 * Only a second, explicit press sends this. A first attempt goes out without it, and
 * main's refusal is what proves there was anything to lose.
 */
const IS_DISCARD_CONFIRMED = true;
const IS_NOT_DISCARD_CONFIRMED = false;

const DISCARD_WARNING_MESSAGE =
  'Escalation starts a fresh agent against this worktree reset to its base commit, because continuing would anchor the retry to the approach that just failed. Every uncommitted edit in the worktree — including anything you changed by hand — is discarded and cannot be recovered.';

const CATALOG_LOADING_MESSAGE = 'Reading the models your account can use…';
const NO_FRONTIER_MODELS_MESSAGE =
  'Your account lists no pool-spending models, so higher reasoning effort is the only retry available.';

const ESCALATE_ERROR_FALLBACK = 'Could not retry this run.';

const EMPTY_COUNT = 0;

export function useRunEscalation({ runId }: UseRunEscalationOptions): UseRunEscalationResult {
  const [pendingEscalation, setPendingEscalation] = useState<PendingEscalation | null>(null);
  const { escalateRun, isEscalateRunPending, escalateRunError } = useExecuteEscalateRun();
  const { modelCatalog, isModelCatalogLoading } = useQueryModelCatalog();

  const isWorktreeDirty =
    isIpcError(escalateRunError) && escalateRunError.kind === APP_ERROR_KIND.WORKTREE_DIRTY;

  const startEscalation = useCallback(
    (escalation: PendingEscalation) => {
      // Remembered so the confirmed retry uses the model that was actually asked for
      // rather than re-deriving it from which button is on screen.
      setPendingEscalation(escalation);
      escalateRun({
        runId,
        shouldUseFrontier: escalation.shouldUseFrontier,
        frontierModelId: escalation.frontierModelId,
        isDiscardConfirmed: IS_NOT_DISCARD_CONFIRMED,
      });
    },
    [escalateRun, runId],
  );

  const onRetryWithMoreEffortClick = useCallback(() => {
    startEscalation(EFFORT_ESCALATION);
  }, [startEscalation]);

  const frontierRetryOptions = useMemo(() => {
    if (!isDefined(modelCatalog)) return [];
    return modelCatalog
      .filter((entry) => isPoolSpending(entry.lane))
      .map((entry) => ({
        modelId: entry.id,
        label: entry.displayName,
        onRetryClick: () => startEscalation({ shouldUseFrontier: true, frontierModelId: entry.id }),
      }));
  }, [modelCatalog, startEscalation]);

  const frontierUnavailableMessage = (() => {
    if (isModelCatalogLoading) return CATALOG_LOADING_MESSAGE;
    if (frontierRetryOptions.length === EMPTY_COUNT) return NO_FRONTIER_MODELS_MESSAGE;
    return null;
  })();

  const onConfirmDiscardClick = useCallback(() => {
    if (!isDefined(pendingEscalation)) return;
    escalateRun({
      runId,
      shouldUseFrontier: pendingEscalation.shouldUseFrontier,
      frontierModelId: pendingEscalation.frontierModelId,
      isDiscardConfirmed: IS_DISCARD_CONFIRMED,
    });
  }, [escalateRun, pendingEscalation, runId]);

  const onKeepEditsClick = useCallback(() => setPendingEscalation(null), []);

  const errorMessage = (() => {
    if (!isDefined(escalateRunError)) return null;
    // The dirty-worktree refusal is a question, not a failure, so it is rendered as
    // the confirmation below rather than twice as an error too.
    if (isWorktreeDirty) return null;
    return isIpcError(escalateRunError) ? escalateRunError.message : ESCALATE_ERROR_FALLBACK;
  })();

  return {
    isEscalateRunPending,
    frontierRetryOptions,
    frontierUnavailableMessage,
    isDiscardConfirmationOpen: isWorktreeDirty && isDefined(pendingEscalation),
    discardWarningMessage: DISCARD_WARNING_MESSAGE,
    errorMessage,
    onRetryWithMoreEffortClick,
    onConfirmDiscardClick,
    onKeepEditsClick,
  };
}
