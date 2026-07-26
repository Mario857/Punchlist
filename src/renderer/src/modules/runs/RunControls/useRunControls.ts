import { useCallback, useMemo, useState } from 'react';
import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND } from '@shared/errors';
import type { StartRunRequest } from '@shared/runs';
import type { ModelTier, RunState } from '@shared/runState';
import { classifyCommentTier } from '@shared/tier';
import { keyBy } from '@renderer/lib/collections';
import { formatBytes } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import { useQueryPrComments } from '@renderer/modules/comments/useQueryPrComments';
import { TIER_LABEL } from '@renderer/modules/comments/tierPresentation';
import {
  isPoolSpendingResolution,
  isUndecidedResolution,
  resolveTierLanes,
  type TierLaneResolution,
} from '@renderer/modules/runs/modelLanes';
import {
  useExecuteCancelRun,
  useExecuteSandboxCleanup,
  useExecuteStartRun,
  useExecuteStopAllRuns,
  useQuerySandboxUsage,
} from '@renderer/modules/runs/useQueryRuns';
import { useQueryModelCatalog } from '@renderer/hooks/useQueryModelCatalog';
import { useQuerySettings } from '@renderer/modules/settings/useQuerySettings';
import { useActiveRunsForPr } from '@renderer/stores/runStore';
import { useSessionStore } from '@renderer/stores/sessionStore';

export interface UseRunControlsOptions {
  prRef: PrRef | null;
}

export interface ActiveRunItem {
  runId: string;
  label: string;
  state: RunState;
  /** Bound here so the row markup carries no inline arrow. */
  onCancelClick: () => void;
}

interface UseRunControlsResult {
  startLabel: string;
  isStartDisabled: boolean;
  isStartRunsPending: boolean;
  startErrorMessage: string | null;
  /** Passed down so the batch tier picker stays a dumb component. */
  selectedCommentIds: readonly string[];
  hasSelection: boolean;
  /** Non-null whenever starting this selection would draw down the included pool. */
  poolSpendingMessage: string | null;
  isPoolSpendingAcknowledged: boolean;
  onPoolSpendingAcknowledgedChange: (isAcknowledged: boolean) => void;
  /** Non-null while a pinned model's lane is still unknown, which blocks the start. */
  costUnknownMessage: string | null;
  activeRunItems: ActiveRunItem[];
  hasActiveRuns: boolean;
  activeRunsLabel: string;
  isCancelRunPending: boolean;
  cancelErrorMessage: string | null;
  stopAllLabel: string;
  isStopAllRunsPending: boolean;
  stopAllErrorMessage: string | null;
  onStopAllClick: () => void;
  sandboxUsageLabel: string;
  sandboxWorktreeLabel: string;
  isSandboxUsageLoading: boolean;
  isCleanupDisabled: boolean;
  isSandboxCleanupPending: boolean;
  /** Non-null whenever a cleanup left work behind, which always needs a human. */
  cleanupAttentionMessage: string | null;
  onStartClick: () => void;
  onCleanupClick: () => void;
}

/**
 * Null leaves the tier to the router's own heuristic. It stands in only for a
 * selected id whose comment is not in the fetched set, since every comment the tree
 * can show has already been classified for its badge.
 */
const UNROUTED_TIER = null;

const NO_SELECTION_LABEL = 'Start selected';
const SINGLE_SELECTION_LABEL = 'Start 1 comment';
const NO_ACTIVE_RUNS_LABEL = 'Nothing running';
const SINGLE_ACTIVE_RUN_LABEL = '1 run in flight';
const SINGLE_ACTIVE_RUN_STOP_LABEL = 'Stop the run';
const START_ERROR_FALLBACK = 'Could not start a run for the selected comments.';
const CANCEL_ERROR_FALLBACK = 'Could not cancel that run.';
const STOP_ALL_ERROR_FALLBACK = 'Could not stop the runs in flight.';
const CLEANUP_ERROR_FALLBACK = 'Could not clean up the sandbox.';

const POOL_SPENDING_PREFIX = 'This selection spends the included pool: ';
const POOL_SPENDING_SUFFIX = '. Frontier models bill at API rates, so confirm before starting.';
const POOL_SPENDING_TIER_SEPARATOR = ', ';
const POOL_SPENDING_MODEL_ARROW = ' → ';
const UNLISTED_MODEL_LABEL = 'a model your account does not list';

const COST_UNKNOWN_MESSAGE =
  'Waiting on your settings and the account model list before starting: a pinned model whose lane is unknown could spend the included pool.';

const ACKNOWLEDGEMENT_KEY_SEPARATOR = '|';
const ACKNOWLEDGEMENT_PART_SEPARATOR = ':';

/**
 * A worktree that survives cleanup held uncommitted changes, and git's refusal to
 * remove it is the feature that protects unlanded hand-edits. Reporting it as
 * "cleaned" would quietly discard the only warning the user gets.
 */
const DIRTY_WORKTREE_MESSAGE =
  'Some worktrees were kept because they hold uncommitted changes. Land or discard those edits inside the worktree, then clean up again.';

const NO_WORKTREES_LABEL = 'No worktrees on disk';
const SINGLE_WORKTREE_LABEL = '1 worktree';
const RECLAIMABLE_SUFFIX = ' reclaimable';

const EMPTY_COUNT = 0;
const SINGLE_COUNT = 1;

function toErrorMessage(error: unknown, fallback: string): string | null {
  if (!isDefined(error)) return null;
  return isIpcError(error) ? error.message : fallback;
}

function buildStartRequests(
  selectedCommentIds: readonly string[],
  commentsById: ReadonlyMap<string, PrComment>,
  tierOverrideByCommentId: Readonly<Record<string, ModelTier>>,
): StartRunRequest[] {
  return selectedCommentIds.map((commentId) => {
    const overrideTier = tierOverrideByCommentId[commentId];
    if (overrideTier !== undefined) return { commentId, tier: overrideTier };

    const comment = commentsById.get(commentId);
    if (!isDefined(comment)) return { commentId, tier: UNROUTED_TIER };
    // The same pure classification the badge showed, so what starts is what was read.
    return { commentId, tier: classifyCommentTier(comment).tier };
  });
}

function describePoolSpending(resolutions: readonly TierLaneResolution[]): string {
  const parts = resolutions.map((resolution) => {
    const modelLabel = isDefined(resolution.modelId) ? resolution.modelId : UNLISTED_MODEL_LABEL;
    return `${TIER_LABEL[resolution.tier]}${POOL_SPENDING_MODEL_ARROW}${modelLabel}`;
  });
  return `${POOL_SPENDING_PREFIX}${parts.join(POOL_SPENDING_TIER_SEPARATOR)}${POOL_SPENDING_SUFFIX}`;
}

/** Keyed by the exact tier-and-model set, so an acknowledgement cannot outlive it. */
function buildAcknowledgementKey(resolutions: readonly TierLaneResolution[]): string {
  return resolutions
    .map(
      (resolution) =>
        `${resolution.tier}${ACKNOWLEDGEMENT_PART_SEPARATOR}${resolution.modelId ?? ''}`,
    )
    .sort()
    .join(ACKNOWLEDGEMENT_KEY_SEPARATOR);
}

export function useRunControls({ prRef }: UseRunControlsOptions): UseRunControlsResult {
  const selectedCommentIds = useSessionStore((state) => state.selectedCommentIds);
  const tierOverrideByCommentId = useSessionStore((state) => state.tierOverrideByCommentId);
  const activeRuns = useActiveRunsForPr(prRef);

  const [acknowledgedPoolSpendingKey, setAcknowledgedPoolSpendingKey] = useState<string | null>(
    null,
  );

  const { prComments } = useQueryPrComments(prRef);
  const { settings } = useQuerySettings();
  const { modelCatalog } = useQueryModelCatalog();

  const { startRuns, isStartRunsPending, startRunsError } = useExecuteStartRun(prRef);
  const { cancelRun, isCancelRunPending, cancelRunError } = useExecuteCancelRun();
  const { stopAllRuns, isStopAllRunsPending, stopAllRunsError } = useExecuteStopAllRuns();
  const { sandboxUsage, isSandboxUsageLoading } = useQuerySandboxUsage();
  const { cleanupSandbox, isSandboxCleanupPending, sandboxCleanupError, cleanedSandboxUsage } =
    useExecuteSandboxCleanup();

  const selectedCount = selectedCommentIds.length;

  const commentsById = useMemo(
    () => keyBy(prComments ?? [], (comment) => comment.id),
    [prComments],
  );

  const startRequests = useMemo(
    () => buildStartRequests(selectedCommentIds, commentsById, tierOverrideByCommentId),
    [commentsById, selectedCommentIds, tierOverrideByCommentId],
  );

  const laneResolutions = useMemo(() => {
    const tiers = startRequests.map((request) => request.tier).filter(isDefined);
    const tierModelMap = isDefined(settings) ? settings.tierModelMap : undefined;
    return resolveTierLanes(tiers, tierModelMap, modelCatalog);
  }, [modelCatalog, settings, startRequests]);

  const poolSpendingResolutions = useMemo(
    () => laneResolutions.filter(isPoolSpendingResolution),
    [laneResolutions],
  );

  const poolSpendingKey =
    poolSpendingResolutions.length === EMPTY_COUNT
      ? null
      : buildAcknowledgementKey(poolSpendingResolutions);
  const isPoolSpendingAcknowledged =
    poolSpendingKey !== null && acknowledgedPoolSpendingKey === poolSpendingKey;

  const isCostUndecided = laneResolutions.some(isUndecidedResolution);

  const activeRunItems = useMemo(
    () =>
      activeRuns.map((run) => ({
        runId: run.id,
        // The draft commit subject once the agent has written one; the scratch branch
        // identifies the run before that, and both beat showing a raw uuid.
        label: isDefined(run.summary) ? run.summary.subject : run.branchName,
        state: run.state,
        onCancelClick: () => cancelRun(run.id),
      })),
    [activeRuns, cancelRun],
  );

  const startLabel = (() => {
    if (selectedCount === EMPTY_COUNT) return NO_SELECTION_LABEL;
    if (selectedCount === SINGLE_COUNT) return SINGLE_SELECTION_LABEL;
    return `Start ${selectedCount} comments`;
  })();

  const activeRunsLabel = (() => {
    if (activeRunItems.length === EMPTY_COUNT) return NO_ACTIVE_RUNS_LABEL;
    if (activeRunItems.length === SINGLE_COUNT) return SINGLE_ACTIVE_RUN_LABEL;
    return `${activeRunItems.length} runs in flight`;
  })();

  const stopAllLabel =
    activeRunItems.length === SINGLE_COUNT
      ? SINGLE_ACTIVE_RUN_STOP_LABEL
      : `Stop all ${activeRunItems.length} runs`;

  const isStartDisabled = (() => {
    if (prRef === null) return true;
    if (selectedCount === EMPTY_COUNT) return true;
    // Spend has to be knowable before it can be authorised, so an undecided lane
    // blocks the start rather than defaulting to "probably free".
    if (isCostUndecided) return true;
    if (poolSpendingKey !== null) return !isPoolSpendingAcknowledged;
    return false;
  })();

  const sandboxWorktreeLabel = (() => {
    if (!isDefined(sandboxUsage)) return NO_WORKTREES_LABEL;
    if (sandboxUsage.worktreeCount === EMPTY_COUNT) return NO_WORKTREES_LABEL;
    const countLabel =
      sandboxUsage.worktreeCount === SINGLE_COUNT
        ? SINGLE_WORKTREE_LABEL
        : `${sandboxUsage.worktreeCount} worktrees`;
    return `${countLabel}, ${sandboxUsage.reclaimableCount}${RECLAIMABLE_SUFFIX}`;
  })();

  // A cleanup surfaces trouble two ways: main refuses outright with a dirty-worktree
  // error, or it succeeds and still reports worktrees it could not reclaim.
  const cleanupAttentionMessage = (() => {
    if (
      isIpcError(sandboxCleanupError) &&
      sandboxCleanupError.kind === APP_ERROR_KIND.WORKTREE_DIRTY
    ) {
      return sandboxCleanupError.message;
    }
    if (isDefined(cleanedSandboxUsage) && cleanedSandboxUsage.reclaimableCount > EMPTY_COUNT) {
      return DIRTY_WORKTREE_MESSAGE;
    }
    return toErrorMessage(sandboxCleanupError, CLEANUP_ERROR_FALLBACK);
  })();

  const onPoolSpendingAcknowledgedChange = useCallback(
    (isAcknowledged: boolean) => {
      setAcknowledgedPoolSpendingKey(isAcknowledged ? poolSpendingKey : null);
    },
    [poolSpendingKey],
  );

  const onStartClick = useCallback(() => {
    startRuns(startRequests);
    // The batch is on its way, so the authorisation it carried is spent with it.
    setAcknowledgedPoolSpendingKey(null);
  }, [startRequests, startRuns]);

  const onStopAllClick = useCallback(() => stopAllRuns(), [stopAllRuns]);

  const onCleanupClick = useCallback(() => cleanupSandbox(), [cleanupSandbox]);

  return {
    startLabel,
    isStartDisabled,
    isStartRunsPending,
    startErrorMessage: toErrorMessage(startRunsError, START_ERROR_FALLBACK),
    selectedCommentIds,
    hasSelection: selectedCount > EMPTY_COUNT,
    poolSpendingMessage:
      poolSpendingKey === null ? null : describePoolSpending(poolSpendingResolutions),
    isPoolSpendingAcknowledged,
    onPoolSpendingAcknowledgedChange,
    costUnknownMessage: isCostUndecided ? COST_UNKNOWN_MESSAGE : null,
    activeRunItems,
    hasActiveRuns: activeRunItems.length > EMPTY_COUNT,
    activeRunsLabel,
    isCancelRunPending,
    cancelErrorMessage: toErrorMessage(cancelRunError, CANCEL_ERROR_FALLBACK),
    stopAllLabel,
    isStopAllRunsPending,
    stopAllErrorMessage: toErrorMessage(stopAllRunsError, STOP_ALL_ERROR_FALLBACK),
    onStopAllClick,
    sandboxUsageLabel: formatBytes(sandboxUsage?.totalBytes),
    sandboxWorktreeLabel,
    isSandboxUsageLoading,
    isCleanupDisabled: !isDefined(sandboxUsage) || sandboxUsage.reclaimableCount === EMPTY_COUNT,
    isSandboxCleanupPending,
    cleanupAttentionMessage,
    onStartClick,
    onCleanupClick,
  };
}
