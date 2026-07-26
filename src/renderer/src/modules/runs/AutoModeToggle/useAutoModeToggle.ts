import { useCallback, useMemo } from 'react';
import type { PrRef } from '@shared/discovery';
import { RUN_STATE } from '@shared/runState';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import {
  useExecuteSetAutoMode,
  useQueryAutoModeEnabled,
} from '@renderer/modules/runs/useQueryRuns';
import { useRunsForPr } from '@renderer/stores/runStore';

export interface UseAutoModeToggleOptions {
  prRef: PrRef | null;
  /**
   * Called when auto mode is switched on. Pre-selecting the recommended set belongs to
   * the host, which already holds the PR's comments; switching off deliberately leaves
   * the selection alone, so nothing the user can see is taken away behind their back.
   */
  onEnabled: () => void;
}

interface UseAutoModeToggleResult {
  isEnabled: boolean;
  isToggleDisabled: boolean;
  /** Non-null only while auto mode is on, so the on-state is stated in words. */
  onStateLabel: string | null;
  /**
   * Non-null once auto mode has decided anything on this PR's runs. Auto mode defers
   * decisions rather than hiding them, and this is the count that says so.
   */
  deferredDecisionsLabel: string | null;
  errorMessage: string | null;
  onEnabledChange: (isEnabled: boolean) => void;
}

const ON_STATE_LABEL = 'Auto mode on';

const SINGLE_DEFERRED_DECISION_LABEL = '1 auto-answered decision is waiting in review.';
const DEFERRED_DECISIONS_SUFFIX = ' auto-answered decisions are waiting in review.';

const READ_ERROR_FALLBACK = 'Could not read whether auto mode is on.';
const WRITE_ERROR_FALLBACK = 'Could not change auto mode.';

const NO_DEFERRED_DECISIONS = 0;
const SINGLE_DEFERRED_DECISION = 1;

export function useAutoModeToggle({
  prRef,
  onEnabled,
}: UseAutoModeToggleOptions): UseAutoModeToggleResult {
  const runsForPr = useRunsForPr(prRef);
  const { isAutoModeEnabled, isAutoModeEnabledLoading, autoModeEnabledError } =
    useQueryAutoModeEnabled();
  const { setAutoModeEnabled, isSetAutoModePending, setAutoModeError } = useExecuteSetAutoMode();

  // "Awaiting review" means exactly that: an applied run's auto-decisions were seen
  // and landed, so counting them would make the number never fall to zero and stop
  // meaning anything.
  const deferredDecisionCount = useMemo(
    () =>
      runsForPr
        .filter((run) => run.state !== RUN_STATE.APPLIED)
        .reduce((total, run) => total + run.autoDecisions.length, NO_DEFERRED_DECISIONS),
    [runsForPr],
  );

  const deferredDecisionsLabel = (() => {
    if (deferredDecisionCount === NO_DEFERRED_DECISIONS) return null;
    if (deferredDecisionCount === SINGLE_DEFERRED_DECISION) return SINGLE_DEFERRED_DECISION_LABEL;
    return `${deferredDecisionCount}${DEFERRED_DECISIONS_SUFFIX}`;
  })();

  const errorMessage = (() => {
    if (isDefined(setAutoModeError)) {
      return isIpcError(setAutoModeError) ? setAutoModeError.message : WRITE_ERROR_FALLBACK;
    }
    if (isDefined(autoModeEnabledError)) {
      return isIpcError(autoModeEnabledError) ? autoModeEnabledError.message : READ_ERROR_FALLBACK;
    }
    return null;
  })();

  const onEnabledChange = useCallback(
    (isNextEnabled: boolean) => {
      setAutoModeEnabled(isNextEnabled);
      if (isNextEnabled) onEnabled();
    },
    [onEnabled, setAutoModeEnabled],
  );

  // Undefined only before the first read resolves, and the toggle is disabled until it
  // does, so the fallback never shows a state main disagrees with.
  const isEnabled = isAutoModeEnabled ?? false;

  return {
    isEnabled,
    isToggleDisabled: isAutoModeEnabledLoading || isSetAutoModePending,
    onStateLabel: isEnabled ? ON_STATE_LABEL : null,
    deferredDecisionsLabel,
    errorMessage,
    onEnabledChange,
  };
}
