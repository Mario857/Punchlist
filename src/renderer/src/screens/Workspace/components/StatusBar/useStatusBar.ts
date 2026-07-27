import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { formatBytes } from '@renderer/lib/format';
import { summarizeTriage } from '@renderer/modules/comments/CommentTree/commentTreeModel';
import { useQuerySandboxUsage } from '@renderer/modules/runs/useQueryRuns';
import { useActiveRunsForPr } from '@renderer/stores/runStore';

export interface UseStatusBarParams {
  prRef: PrRef | null;
  comments: readonly PrComment[];
}

interface UseStatusBarResult {
  triageLabel: string;
  runsLabel: string;
  /** True while anything is in flight, so the runs segment can carry the accent. */
  hasActiveRuns: boolean;
  sandboxLabel: string;
}

const TRIAGE_JOINER = ' of ';
const TRIAGE_SUFFIX = ' decided';
const NO_ACTIVE_RUNS_LABEL = 'Nothing running';
const SINGLE_ACTIVE_RUN_LABEL = '1 run in flight';
const ACTIVE_RUNS_LABEL_SUFFIX = ' runs in flight';
const SANDBOX_LABEL_PREFIX = 'Sandbox ';
const SINGLE_ACTIVE_RUN_COUNT = 1;

/**
 * The ambient answers to "where am I?": how much of the punch list is decided, what is
 * running, and how big the sandbox has grown. One thin strip rather than three labels
 * scattered through the panes, and it survives any pane being hidden — which is exactly
 * when the tree's own counter would have disappeared.
 */
export function useStatusBar({ prRef, comments }: UseStatusBarParams): UseStatusBarResult {
  const activeRuns = useActiveRunsForPr(prRef);
  const { sandboxUsage } = useQuerySandboxUsage();

  const triage = summarizeTriage(comments);
  const triageLabel = `${triage.decidedCount}${TRIAGE_JOINER}${triage.totalCount}${TRIAGE_SUFFIX}`;

  const runsLabel = (() => {
    if (activeRuns.length === 0) return NO_ACTIVE_RUNS_LABEL;
    if (activeRuns.length === SINGLE_ACTIVE_RUN_COUNT) return SINGLE_ACTIVE_RUN_LABEL;
    return `${activeRuns.length}${ACTIVE_RUNS_LABEL_SUFFIX}`;
  })();

  return {
    triageLabel,
    runsLabel,
    hasActiveRuns: activeRuns.length > 0,
    sandboxLabel: `${SANDBOX_LABEL_PREFIX}${formatBytes(sandboxUsage?.totalBytes)}`,
  };
}
