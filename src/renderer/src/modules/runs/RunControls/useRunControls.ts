import { useCallback, useMemo, useState } from 'react';
import { isRecommendedForRun, type PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND } from '@shared/errors';
import { hasUnacknowledgedFlags } from '@shared/guardrails';
import type { RunRecord, StartRunRequest } from '@shared/runs';
import { RUN_STATE, type ModelTier, type RunState } from '@shared/runState';
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
  useExecuteApproveRuns,
  useExecuteCancelRun,
  useExecuteRejectRuns,
  useExecuteSandboxCleanup,
  useExecuteStartRun,
  useExecuteStopAllRuns,
  useQuerySandboxUsage,
} from '@renderer/modules/runs/useQueryRuns';
import { useQueryModelCatalog } from '@renderer/hooks/useQueryModelCatalog';
import { useQuerySettings } from '@renderer/modules/settings/useQuerySettings';
import { useActiveRunsForPr, useRunsForPr } from '@renderer/stores/runStore';
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
  /** False when no run on this PR is in a state a decision could reach at all. */
  hasBulkDecisionScope: boolean;
  bulkApproveLabel: string;
  isBulkApproveDisabled: boolean;
  isBulkApprovePending: boolean;
  /** Says on the control itself that a bulk approve moves records and lands nothing. */
  bulkApproveNote: string;
  /** Non-null whenever flags keep runs out of the batch — never a silent exclusion. */
  bulkApproveExclusionMessage: string | null;
  bulkApproveErrorMessage: string | null;
  bulkRejectLabel: string;
  isBulkRejectDisabled: boolean;
  isBulkRejectPending: boolean;
  bulkRejectErrorMessage: string | null;
  onBulkApproveClick: () => void;
  onBulkRejectClick: () => void;
  sandboxUsageLabel: string;
  sandboxWorktreeLabel: string;
  isSandboxUsageLoading: boolean;
  isCleanupDisabled: boolean;
  isSandboxCleanupPending: boolean;
  /** Non-null whenever a cleanup left work behind, which always needs a human. */
  cleanupAttentionMessage: string | null;
  onStartClick: () => void;
  onCleanupClick: () => void;
  /** Pre-selects the recommended set when auto mode is switched on. */
  onAutoModeEnabled: () => void;
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

const NO_BULK_APPROVE_LABEL = 'Approve every ready run for landing';
const SINGLE_BULK_APPROVE_LABEL = 'Approve the 1 ready run for landing';
const BULK_APPROVE_LABEL_PREFIX = 'Approve all ';
const BULK_APPROVE_LABEL_SUFFIX = ' ready runs for landing';

const NO_BULK_REJECT_LABEL = 'Reject every run awaiting a decision';
const SINGLE_BULK_REJECT_LABEL = 'Reject the 1 run awaiting a decision';
const BULK_REJECT_LABEL_PREFIX = 'Reject all ';
const BULK_REJECT_LABEL_SUFFIX = ' runs awaiting a decision';

/**
 * The gate is untouched by anything on this row, and the row says so. Approving a
 * dozen runs at once is only safe because approval moves records and nothing else.
 */
const BULK_APPROVE_NOTE =
  'Bulk approve only marks runs ready to land. It creates no branch, pushes nothing and resolves no thread — landing stays a separate step behind its own confirmation.';

/**
 * Main refuses the whole batch when one id carries an unacknowledged flag, so blocked
 * runs are left out of the request. Saying which and how many is the point: a bulk
 * action that quietly does less than its label claims is worse than one that refuses.
 */
const BULK_APPROVE_EXCLUSION_PREFIX = 'Held out of this batch by unacknowledged guardrail flags: ';
const SINGLE_BULK_APPROVE_EXCLUSION = '1 ready run';
const BULK_APPROVE_EXCLUSION_SUFFIX = ' ready runs';
const BULK_APPROVE_EXCLUSION_REMEDIATION =
  '. Open each one, acknowledge its flags, then approve it.';

const BULK_APPROVE_ERROR_FALLBACK = 'Could not approve those runs.';
const BULK_REJECT_ERROR_FALLBACK = 'Could not reject those runs.';

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

interface BulkDecisionScope {
  /** `ready` runs with every flag acknowledged: exactly the set main will accept. */
  approvableRunIds: string[];
  /** Counted rather than dropped, because the exclusion has to be visible. */
  flagBlockedCount: number;
  /** `ready` and `approved` alike — a rejection is legal from both. */
  rejectableRunIds: string[];
}

/**
 * Which runs a bulk decision may touch. Approval is offered only from `ready`, since
 * main's transition table is the authority on the rest and a button that produced a
 * refusal would be a worse control than one that is simply not offered.
 */
function toBulkDecisionScope(runs: readonly RunRecord[]): BulkDecisionScope {
  const approvableRunIds: string[] = [];
  const rejectableRunIds: string[] = [];
  let flagBlockedCount = EMPTY_COUNT;

  for (const run of runs) {
    if (run.state === RUN_STATE.READY || run.state === RUN_STATE.APPROVED) {
      rejectableRunIds.push(run.id);
    }
    if (run.state !== RUN_STATE.READY) continue;
    if (hasUnacknowledgedFlags(run.guardrailFlags, run.acknowledgedGuardrailIds)) {
      flagBlockedCount += SINGLE_COUNT;
      continue;
    }
    approvableRunIds.push(run.id);
  }

  return { approvableRunIds, flagBlockedCount, rejectableRunIds };
}

function buildBulkApproveLabel(approvableCount: number): string {
  if (approvableCount === EMPTY_COUNT) return NO_BULK_APPROVE_LABEL;
  if (approvableCount === SINGLE_COUNT) return SINGLE_BULK_APPROVE_LABEL;
  return `${BULK_APPROVE_LABEL_PREFIX}${approvableCount}${BULK_APPROVE_LABEL_SUFFIX}`;
}

function buildBulkRejectLabel(rejectableCount: number): string {
  if (rejectableCount === EMPTY_COUNT) return NO_BULK_REJECT_LABEL;
  if (rejectableCount === SINGLE_COUNT) return SINGLE_BULK_REJECT_LABEL;
  return `${BULK_REJECT_LABEL_PREFIX}${rejectableCount}${BULK_REJECT_LABEL_SUFFIX}`;
}

function buildBulkApproveExclusionMessage(flagBlockedCount: number): string | null {
  if (flagBlockedCount === EMPTY_COUNT) return null;
  const countLabel =
    flagBlockedCount === SINGLE_COUNT
      ? SINGLE_BULK_APPROVE_EXCLUSION
      : `${flagBlockedCount}${BULK_APPROVE_EXCLUSION_SUFFIX}`;
  return `${BULK_APPROVE_EXCLUSION_PREFIX}${countLabel}${BULK_APPROVE_EXCLUSION_REMEDIATION}`;
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
  const setSelectedCommentIds = useSessionStore((state) => state.setSelectedCommentIds);
  const tierOverrideByCommentId = useSessionStore((state) => state.tierOverrideByCommentId);
  const activeRuns = useActiveRunsForPr(prRef);
  const runsForPr = useRunsForPr(prRef);

  const [acknowledgedPoolSpendingKey, setAcknowledgedPoolSpendingKey] = useState<string | null>(
    null,
  );

  const { prComments } = useQueryPrComments(prRef);
  const { settings } = useQuerySettings();
  const { modelCatalog } = useQueryModelCatalog();

  const { startRuns, isStartRunsPending, startRunsError } = useExecuteStartRun(prRef);
  const { cancelRun, isCancelRunPending, cancelRunError } = useExecuteCancelRun();
  const { stopAllRuns, isStopAllRunsPending, stopAllRunsError } = useExecuteStopAllRuns();
  const { approveRuns, isApproveRunsPending, approveRunsError } = useExecuteApproveRuns();
  const { rejectRuns, isRejectRunsPending, rejectRunsError } = useExecuteRejectRuns();
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

  // The one definition of "recommended" lives in src/shared/comments.ts, so the set auto
  // mode pre-selects is the same set the rest of the app calls recommended.
  const recommendedCommentIds = useMemo(
    () => (prComments ?? []).filter(isRecommendedForRun).map((comment) => comment.id),
    [prComments],
  );

  const onAutoModeEnabled = useCallback(() => {
    setSelectedCommentIds(recommendedCommentIds);
  }, [recommendedCommentIds, setSelectedCommentIds]);

  const onStopAllClick = useCallback(() => stopAllRuns(), [stopAllRuns]);

  const { approvableRunIds, flagBlockedCount, rejectableRunIds } = useMemo(
    () => toBulkDecisionScope(runsForPr),
    [runsForPr],
  );

  const onBulkApproveClick = useCallback(
    () => approveRuns(approvableRunIds),
    [approvableRunIds, approveRuns],
  );

  const onBulkRejectClick = useCallback(
    () => rejectRuns(rejectableRunIds),
    [rejectableRunIds, rejectRuns],
  );

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
    // A flag-blocked run is a `ready` run, so it is in this scope too: the row stays on
    // screen carrying its exclusion notice rather than vanishing along with the reason.
    hasBulkDecisionScope: rejectableRunIds.length > EMPTY_COUNT,
    bulkApproveLabel: buildBulkApproveLabel(approvableRunIds.length),
    isBulkApproveDisabled: approvableRunIds.length === EMPTY_COUNT,
    isBulkApprovePending: isApproveRunsPending,
    bulkApproveNote: BULK_APPROVE_NOTE,
    bulkApproveExclusionMessage: buildBulkApproveExclusionMessage(flagBlockedCount),
    bulkApproveErrorMessage: toErrorMessage(approveRunsError, BULK_APPROVE_ERROR_FALLBACK),
    bulkRejectLabel: buildBulkRejectLabel(rejectableRunIds.length),
    isBulkRejectDisabled: rejectableRunIds.length === EMPTY_COUNT,
    isBulkRejectPending: isRejectRunsPending,
    bulkRejectErrorMessage: toErrorMessage(rejectRunsError, BULK_REJECT_ERROR_FALLBACK),
    onBulkApproveClick,
    onBulkRejectClick,
    sandboxUsageLabel: formatBytes(sandboxUsage?.totalBytes),
    sandboxWorktreeLabel,
    isSandboxUsageLoading,
    isCleanupDisabled: !isDefined(sandboxUsage) || sandboxUsage.reclaimableCount === EMPTY_COUNT,
    isSandboxCleanupPending,
    cleanupAttentionMessage,
    onStartClick,
    onCleanupClick,
    onAutoModeEnabled,
  };
}
