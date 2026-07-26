import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { Card, CARD_PADDING, CARD_TONE } from '@renderer/components/Card';
import { CollapsibleCard } from '@renderer/components/CollapsibleCard/CollapsibleCard';
import { assertNever } from '@renderer/lib/assertNever';
import { DiffHunk } from '@renderer/modules/review/CommentDetail/components/DiffHunk';
import {
  COMMENT_DETAIL_KIND_VIEW,
  type CommentDetailKindView,
} from '@renderer/modules/review/CommentDetail/useCommentDetail';

interface Props {
  view: CommentDetailKindView;
}

const ANCHOR_SECTION_ID = 'comment-anchor';
const ANCHOR_HEADING = 'Anchored code';
const ANCHOR_SUMMARY_SEPARATOR = ' ';

export function CommentKindDetail({ view }: Props) {
  const content = (() => {
    switch (view.kind) {
      case COMMENT_DETAIL_KIND_VIEW.ANCHORED: {
        const resolvedBadge = view.isResolved ? (
          <Badge isMuted tone={BADGE_TONE.SUCCESS}>
            Resolved
          </Badge>
        ) : null;
        const outdatedBadge = view.isOutdated ? (
          <Badge isMuted tone={BADGE_TONE.WARNING}>
            Outdated
          </Badge>
        ) : null;

        // Folded by default: it is the code as it was when the comment was left, and
        // the candidate patch below shows the same file as it stands now.
        const badges =
          resolvedBadge === null && outdatedBadge === null ? undefined : (
            <span className="flex shrink-0 items-center gap-2">
              {resolvedBadge}
              {outdatedBadge}
            </span>
          );

        return (
          <CollapsibleCard
            sectionId={ANCHOR_SECTION_ID}
            heading={ANCHOR_HEADING}
            summary={`${view.path}${ANCHOR_SUMMARY_SEPARATOR}${view.lineLabel}`}
            headerAccessory={badges}
            isDefaultOpen={false}
          >
            <DiffHunk diffHunk={view.diffHunk} />
          </CollapsibleCard>
        );
      }
      case COMMENT_DETAIL_KIND_VIEW.UNANCHORED:
        return (
          <Card padding={CARD_PADDING.SM} tone={CARD_TONE.RAISED}>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Badge isMuted tone={BADGE_TONE.INFO}>
                  Unanchored
                </Badge>
                <span className="text-muted text-xs">{view.kindLabel}</span>
              </div>
              <p className="text-muted/80 text-xs leading-snug">{view.explanation}</p>
            </div>
          </Card>
        );
      default:
        return assertNever(view);
    }
  })();

  return content;
}
