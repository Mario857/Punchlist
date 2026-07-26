import type { PrComment } from '@shared/comments';
import { Badge } from '@renderer/components/Badge';
import { FOCUS_RING, INTERACTIVE_TRANSITION } from '@renderer/components/interactiveClassNames';
import { joinClassNames } from '@renderer/lib/classNames';
import { useCommentTierBadge } from './useCommentTierBadge';

export interface CommentTierBadgeProps {
  comment: PrComment;
}

const BADGE_BUTTON_CLASS = 'inline-flex rounded-full';

/**
 * The heuristic misfires, so the tier is a control rather than a verdict: the badge
 * itself is the override, and correcting one costs a click instead of money.
 */
export function CommentTierBadge({ comment }: CommentTierBadgeProps) {
  const { label, tone, title, ariaLabel, onCycleTierClick } = useCommentTierBadge({ comment });

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onCycleTierClick}
      className={joinClassNames(BADGE_BUTTON_CLASS, FOCUS_RING, INTERACTIVE_TRANSITION)}
    >
      <Badge tone={tone} isMuted>
        {label}
      </Badge>
    </button>
  );
}
