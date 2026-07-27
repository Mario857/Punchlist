import type { PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { joinClassNames } from '@renderer/lib/classNames';
import { useStatusBar } from '@renderer/screens/Workspace/components/StatusBar/useStatusBar';

interface Props {
  prRef: PrRef | null;
  comments: readonly PrComment[];
}

const BAR_LABEL = 'Status';
const BAR_CLASS = joinClassNames(
  'border-border flex shrink-0 items-center gap-4 border-t px-4 py-1',
  'text-muted text-xs tabular-nums',
);
const ACTIVE_RUNS_CLASS = 'text-accent';

/**
 * The Cursor-style ambient strip: always present, never demanding. Progress through
 * the punch list on the left, live activity in the middle, disk on the right.
 */
export function StatusBar({ prRef, comments }: Props) {
  const { triageLabel, runsLabel, hasActiveRuns, sandboxLabel } = useStatusBar({
    prRef,
    comments,
  });

  const runsClassName = hasActiveRuns ? ACTIVE_RUNS_CLASS : undefined;

  return (
    <footer aria-label={BAR_LABEL} className={BAR_CLASS}>
      <span>{triageLabel}</span>
      <span role="status" className={runsClassName}>
        {runsLabel}
      </span>
      <span className="ml-auto">{sandboxLabel}</span>
    </footer>
  );
}
