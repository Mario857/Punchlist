import { useCallback, useMemo } from 'react';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND } from '@shared/errors';
import type { StartRunRequest } from '@shared/runs';
import type { RunState } from '@shared/runState';
import { formatBytes } from '@renderer/lib/format';
import { isDefined } from '@renderer/lib/guards';
import { isIpcError } from '@renderer/lib/unwrapIpcResult';
import {
  useExecuteCancelRun,
  useExecuteSandboxCleanup,
  useExecuteStartRun,
  useQuerySandboxUsage,
} from '@renderer/modules/runs/useQueryRuns';
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
  activeRunItems: ActiveRunItem[];
  hasActiveRuns: boolean;
  activeRunsLabel: string;
  isCancelRunPending: boolean;
  cancelErrorMessage: string | null;
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
 * Phase 2 runs one comment at a time through main's queue, so the tier is left for
 * the router to resolve rather than pinned from the UI.
 */
const UNROUTED_TIER = null;

const NO_SELECTION_LABEL = 'Start selected';
const SINGLE_SELECTION_LABEL = 'Start 1 comment';
const NO_ACTIVE_RUNS_LABEL = 'Nothing running';
const SINGLE_ACTIVE_RUN_LABEL = '1 run in flight';
const START_ERROR_FALLBACK = 'Could not start a run for the selected comments.';
const CANCEL_ERROR_FALLBACK = 'Could not cancel that run.';
const CLEANUP_ERROR_FALLBACK = 'Could not clean up the sandbox.';

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

export function useRunControls({ prRef }: UseRunControlsOptions): UseRunControlsResult {
  const selectedCommentIds = useSessionStore((state) => state.selectedCommentIds);
  const activeRuns = useActiveRunsForPr(prRef);

  const { startRuns, isStartRunsPending, startRunsError } = useExecuteStartRun(prRef);
  const { cancelRun, isCancelRunPending, cancelRunError } = useExecuteCancelRun();
  const { sandboxUsage, isSandboxUsageLoading } = useQuerySandboxUsage();
  const { cleanupSandbox, isSandboxCleanupPending, sandboxCleanupError, cleanedSandboxUsage } =
    useExecuteSandboxCleanup();

  const selectedCount = selectedCommentIds.length;

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

  const onStartClick = useCallback(() => {
    const requests: StartRunRequest[] = selectedCommentIds.map((commentId) => ({
      commentId,
      tier: UNROUTED_TIER,
    }));
    startRuns(requests);
  }, [selectedCommentIds, startRuns]);

  const onCleanupClick = useCallback(() => cleanupSandbox(), [cleanupSandbox]);

  return {
    startLabel,
    isStartDisabled: prRef === null || selectedCount === EMPTY_COUNT,
    isStartRunsPending,
    startErrorMessage: toErrorMessage(startRunsError, START_ERROR_FALLBACK),
    activeRunItems,
    hasActiveRuns: activeRunItems.length > EMPTY_COUNT,
    activeRunsLabel,
    isCancelRunPending,
    cancelErrorMessage: toErrorMessage(cancelRunError, CANCEL_ERROR_FALLBACK),
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
