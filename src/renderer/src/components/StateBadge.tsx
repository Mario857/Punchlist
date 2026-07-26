import { RUN_STATE, type RunState } from '@shared/runState';
import { assertNever } from '@renderer/lib/assertNever';
import { joinClassNames } from '@renderer/lib/classNames';
import {
  BADGE_BASE_CLASS,
  BADGE_SIZE,
  BADGE_SIZE_CLASS,
  type BadgeSize,
} from '@renderer/components/Badge';

export interface StateBadgeProps {
  state: RunState;
  size?: BadgeSize;
}

/**
 * The one always-visible strong badge in the app. It takes no `className`: every
 * other badge on a row is muted relative to this, and letting callers restyle it
 * would let that hierarchy erode row by row.
 *
 * Colour is never the only signal — the label carries the state in text as well.
 */
export function StateBadge({ state, size = BADGE_SIZE.SM }: StateBadgeProps) {
  const { label, toneClassName } = (() => {
    switch (state) {
      case RUN_STATE.QUEUED:
        return {
          label: 'Queued',
          toneClassName: 'border-state-queued/40 bg-state-queued/15 text-state-queued',
        };
      case RUN_STATE.RUNNING:
        return {
          label: 'Running',
          toneClassName: 'border-state-running/40 bg-state-running/15 text-state-running',
        };
      case RUN_STATE.NEEDS_DECISION:
        return {
          label: 'Needs decision',
          toneClassName:
            'border-state-needs-decision/50 bg-state-needs-decision/20 text-state-needs-decision',
        };
      case RUN_STATE.READY:
        return {
          label: 'Ready',
          toneClassName: 'border-state-ready/40 bg-state-ready/15 text-state-ready',
        };
      case RUN_STATE.REVISING:
        return {
          label: 'Revising',
          toneClassName: 'border-state-revising/40 bg-state-revising/15 text-state-revising',
        };
      case RUN_STATE.NO_ACTION_NEEDED:
        return {
          label: 'No action needed',
          toneClassName:
            'border-state-no-action-needed/40 bg-state-no-action-needed/15 text-state-no-action-needed',
        };
      case RUN_STATE.FAILED:
        return {
          label: 'Failed',
          toneClassName: 'border-state-failed/50 bg-state-failed/20 text-state-failed',
        };
      case RUN_STATE.APPROVED:
        return {
          label: 'Approved',
          toneClassName: 'border-state-approved/40 bg-state-approved/15 text-state-approved',
        };
      case RUN_STATE.APPLIED:
        return {
          label: 'Applied',
          toneClassName: 'border-state-applied/40 bg-state-applied/15 text-state-applied',
        };
      default:
        return assertNever(state);
    }
  })();

  return (
    <span className={joinClassNames(BADGE_BASE_CLASS, BADGE_SIZE_CLASS[size], toneClassName)}>
      {label}
    </span>
  );
}
